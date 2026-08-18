const SHEETS = Object.freeze({
  USERS: "Users",
  DEVICES: "Devices",
  MESSAGES: "Messages",
  CONFIG: "Config"
});

const HEADERS = Object.freeze({
  USERS: [
    "user_id",
    "username",
    "username_key",
    "password_hash",
    "password_salt",
    "phone",
    "status",
    "created_at",
    "updated_at",
    "last_login_at",
    "last_message_at_ms"
  ],
  DEVICES: [
    "device_id",
    "user_id",
    "session_hash",
    "device_name",
    "platform",
    "push_token",
    "is_primary",
    "created_at",
    "last_seen_at",
    "expires_at",
    "revoked_at"
  ],
  MESSAGES: [
    "seq",
    "message_id",
    "chat_id",
    "sender_user_id",
    "sender_username",
    "recipient_user_id",
    "message_type",
    "content_json",
    "reply_to_message_id",
    "created_at",
    "edited_at",
    "deleted_at"
  ],
  CONFIG: ["key", "value"]
});

const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._]{2,31}$/u;
const MESSAGE_TYPES = Object.freeze(["text", "photo", "video"]);
const MESSAGE_RATE_LIMIT_MS = 1000;
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 4000;
const MAX_PHONE_LENGTH = 32;

function doGet() {
  return jsonOutput_({ ok: true, service: "sheet-messenger", version: "0.3.0" });
}

function doPost(event) {
  try {
    const request = JSON.parse(event.postData.contents || "{}");
    return jsonOutput_(api(request.action, request.payload || {}));
  } catch (error) {
    return jsonOutput_({
      ok: false,
      code: error.code || "SERVER_ERROR",
      error: error.message || "Ошибка сервера"
    });
  }
}

function api(action, payload) {
  switch (action) {
    case "register":
      return registerUser_(payload);
    case "login":
      return loginUser_(payload);
    case "logout":
      return logoutUser_(payload);
    case "me":
      return getMe_(payload);
    case "updatePhone":
      return updatePhone_(payload);
    case "searchUsers":
      return searchUsers_(payload);
    case "registerPush":
      return registerPush_(payload);
    case "disablePush":
      return disablePush_(payload);
    case "send":
      return sendMessage_(payload);
    case "sync":
      return syncMessages_(payload);
    case "health":
      return { ok: true, serverTime: new Date().toISOString() };
    default:
      throwApi_("UNKNOWN_ACTION", "Неизвестное действие");
  }
}

function setupProject() {
  const storedId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const spreadsheet = storedId ? SpreadsheetApp.openById(storedId) : activeSpreadsheet;

  if (!spreadsheet) {
    throw new Error("Укажите SPREADSHEET_ID в свойствах скрипта или откройте Apps Script из таблицы");
  }

  ensureSheet_(spreadsheet, SHEETS.USERS, HEADERS.USERS);
  ensureSheet_(spreadsheet, SHEETS.DEVICES, HEADERS.DEVICES);
  ensureSheet_(spreadsheet, SHEETS.MESSAGES, HEADERS.MESSAGES);
  ensureSheet_(spreadsheet, SHEETS.CONFIG, HEADERS.CONFIG);

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty("SPREADSHEET_ID", spreadsheet.getId());
  getAuthPepper_();

  return { ok: true, spreadsheetId: spreadsheet.getId(), schemaVersion: "0.3.0" };
}

function registerUser_(payload) {
  const username = validateUsername_(payload.username);
  const usernameKey = normalizeUsername_(username);
  const password = validatePassword_(payload.password);
  const phone = validatePhone_(payload.phone);
  const now = new Date().toISOString();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const spreadsheet = getSpreadsheet_();
    const usersSheet = spreadsheet.getSheetByName(SHEETS.USERS);
    if (findRowByValue_(usersSheet, 3, usernameKey)) {
      throwApi_("USERNAME_TAKEN", "Этот username уже занят");
    }

    const userId = "usr_" + compactUuid_();
    const salt = compactUuid_();
    const passwordHash = hashPassword_(password, salt);

    usersSheet.appendRow([
      userId,
      username,
      usernameKey,
      passwordHash,
      salt,
      phone,
      "active",
      now,
      now,
      now,
      0
    ]);

    const session = issueSession_(spreadsheet, userId, payload, now);
    return {
      ok: true,
      user: publicUser_({ userId, username, phone }),
      session
    };
  } finally {
    lock.releaseLock();
  }
}

function loginUser_(payload) {
  const usernameKey = normalizeUsername_(validateUsername_(payload.username));
  const password = validatePassword_(payload.password);
  const spreadsheet = getSpreadsheet_();
  const usersSheet = spreadsheet.getSheetByName(SHEETS.USERS);
  const userRow = findRowByValue_(usersSheet, 3, usernameKey);

  if (!userRow || String(userRow.values[6]) !== "active") {
    throwApi_("INVALID_CREDENTIALS", "Неверный username или пароль");
  }

  const expectedHash = String(userRow.values[3]);
  const actualHash = hashPassword_(password, String(userRow.values[4]));
  if (!constantTimeEqual_(expectedHash, actualHash)) {
    throwApi_("INVALID_CREDENTIALS", "Неверный username или пароль");
  }

  const now = new Date().toISOString();
  usersSheet.getRange(userRow.rowIndex, 9, 1, 2).setValues([[now, now]]);
  const session = issueSession_(spreadsheet, String(userRow.values[0]), payload, now);

  return {
    ok: true,
    user: publicUser_({
      userId: String(userRow.values[0]),
      username: String(userRow.values[1]),
      phone: String(userRow.values[5] || "")
    }),
    session
  };
}

function logoutUser_(payload) {
  const auth = authenticate_(payload.sessionToken);
  auth.devicesSheet.getRange(auth.deviceRowIndex, 6, 1, 2).setValues([["", false]]);
  auth.devicesSheet.getRange(auth.deviceRowIndex, 11).setValue(new Date().toISOString());
  return { ok: true };
}

function getMe_(payload) {
  const auth = authenticate_(payload.sessionToken);
  return { ok: true, user: publicUser_(auth.user) };
}

function updatePhone_(payload) {
  const auth = authenticate_(payload.sessionToken);
  const phone = validatePhone_(payload.phone);
  const now = new Date().toISOString();
  auth.usersSheet.getRange(auth.userRowIndex, 6).setValue(phone);
  auth.usersSheet.getRange(auth.userRowIndex, 9).setValue(now);
  auth.user.phone = phone;
  return { ok: true, user: publicUser_(auth.user) };
}

function searchUsers_(payload) {
  const auth = authenticate_(payload.sessionToken);
  const query = normalizeUsername_(String(payload.query || "").trim());
  if (query.length < 2) throwApi_("QUERY_TOO_SHORT", "Введите минимум два символа");

  const rows = readDataRows_(auth.usersSheet, HEADERS.USERS.length);
  const users = rows
    .filter((row) => String(row[6]) === "active")
    .filter((row) => String(row[2]).indexOf(query) === 0)
    .filter((row) => String(row[0]) !== auth.user.userId)
    .slice(0, 20)
    .map((row) => ({ userId: String(row[0]), username: String(row[1]) }));

  return { ok: true, users };
}

function registerPush_(payload) {
  const auth = authenticate_(payload.sessionToken);
  const fid = validatePushFid_(payload.fid);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rows = readDataRows_(auth.devicesSheet, HEADERS.DEVICES.length);
    rows.forEach((row, index) => {
      if (String(row[1]) !== auth.user.userId || row[10]) return;
      const rowIndex = index + 2;
      const isCurrent = rowIndex === auth.deviceRowIndex;
      auth.devicesSheet.getRange(rowIndex, 6, 1, 2).setValues([[
        isCurrent ? fid : "",
        isCurrent
      ]]);
    });
    auth.devicesSheet.getRange(auth.deviceRowIndex, 9).setValue(new Date().toISOString());
  } finally {
    lock.releaseLock();
  }

  return { ok: true, enabled: true, configured: isPushConfigured_() };
}

function disablePush_(payload) {
  const auth = authenticate_(payload.sessionToken);
  auth.devicesSheet.getRange(auth.deviceRowIndex, 6, 1, 2).setValues([["", false]]);
  return { ok: true, enabled: false };
}

function sendMessage_(payload) {
  const auth = authenticate_(payload.sessionToken);
  const recipientUserId = String(payload.recipientUserId || "").trim();
  const recipient = recipientUserId ? findActiveRecipient_(auth, recipientUserId) : null;
  const chatId = recipient
    ? directChatId_(auth.user.userId, recipient.userId)
    : validatePublicChatId_(payload.chatId || "general");
  const messageType = String(payload.messageType || "text").toLowerCase();
  const content = normalizeMessageContent_(messageType, payload);
  const replyToMessageId = payload.replyToMessageId
    ? validateId_(payload.replyToMessageId, "reply_to_message_id")
    : "";
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  let message;
  try {
    const nowMs = Date.now();
    const refreshedUserRow = auth.usersSheet
      .getRange(auth.userRowIndex, 1, 1, HEADERS.USERS.length)
      .getValues()[0];
    const lastMessageAt = Number(refreshedUserRow[10] || 0);
    if (nowMs - lastMessageAt < MESSAGE_RATE_LIMIT_MS) {
      throwApi_("RATE_LIMITED", "Можно отправлять не больше одного сообщения в секунду");
    }

    const messagesSheet = auth.spreadsheet.getSheetByName(SHEETS.MESSAGES);
    const seq = Math.max(1, messagesSheet.getLastRow());
    message = {
      seq,
      id: "msg_" + compactUuid_(),
      chatId,
      senderUserId: auth.user.userId,
      senderUsername: auth.user.username,
      recipientUserId: recipient ? recipient.userId : "",
      messageType,
      content,
      replyToMessageId,
      createdAt: new Date(nowMs).toISOString(),
      editedAt: "",
      deletedAt: ""
    };

    messagesSheet.appendRow([
      message.seq,
      message.id,
      message.chatId,
      message.senderUserId,
      message.senderUsername,
      message.recipientUserId,
      message.messageType,
      JSON.stringify(message.content),
      message.replyToMessageId,
      message.createdAt,
      message.editedAt,
      message.deletedAt
    ]);
    auth.usersSheet.getRange(auth.userRowIndex, 11).setValue(nowMs);

  } finally {
    lock.releaseLock();
  }

  const push = recipient ? trySendMessagePush_(auth.spreadsheet, recipient, message) : { sent: false };
  return { ok: true, message, push };
}

function syncMessages_(payload) {
  const auth = authenticate_(payload.sessionToken);
  const afterSeq = Math.max(0, Number(payload.afterSeq || 0));
  const limit = Math.min(200, Math.max(1, Number(payload.limit || 100)));
  const chatId = validateId_(payload.chatId || "general", "chat_id");
  authorizeChat_(auth.user.userId, chatId);
  const sheet = auth.spreadsheet.getSheetByName(SHEETS.MESSAGES);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1 || afterSeq >= lastRow - 1) {
    return { ok: true, messages: [], cursor: afterSeq };
  }

  const startRow = Math.max(2, afterSeq + 2);
  const rowCount = Math.min(500, lastRow - startRow + 1);
  const rows = sheet.getRange(startRow, 1, rowCount, HEADERS.MESSAGES.length).getValues();
  const matchingMessages = rows
    .map(messageFromRow_)
    .filter((message) => message.chatId === chatId && !message.deletedAt);
  const messages = matchingMessages.slice(0, limit);
  const cursor = matchingMessages.length > limit
    ? messages[messages.length - 1].seq
    : startRow - 2 + rowCount;

  return { ok: true, messages, cursor };
}

function authenticate_(sessionToken) {
  const token = String(sessionToken || "").trim();
  if (token.length < 40) throwApi_("AUTH_REQUIRED", "Требуется вход");

  const spreadsheet = getSpreadsheet_();
  const devicesSheet = spreadsheet.getSheetByName(SHEETS.DEVICES);
  const deviceRow = findRowByValue_(devicesSheet, 3, hashSessionToken_(token));

  const expiresAt = deviceRow ? new Date(String(deviceRow.values[9] || 0)).getTime() : 0;
  if (!deviceRow || deviceRow.values[10] || !expiresAt || Date.now() >= expiresAt) {
    throwApi_("INVALID_SESSION", "Сессия недействительна. Войдите снова");
  }

  const usersSheet = spreadsheet.getSheetByName(SHEETS.USERS);
  const userRow = findRowByValue_(usersSheet, 1, String(deviceRow.values[1]));
  if (!userRow || String(userRow.values[6]) !== "active") {
    throwApi_("INVALID_SESSION", "Аккаунт недоступен");
  }

  const now = new Date().toISOString();
  const lastSeen = new Date(String(deviceRow.values[8] || 0)).getTime();
  if (!lastSeen || Date.now() - lastSeen > 5 * 60 * 1000) {
    devicesSheet.getRange(deviceRow.rowIndex, 9).setValue(now);
  }

  return {
    spreadsheet,
    devicesSheet,
    usersSheet,
    deviceRowIndex: deviceRow.rowIndex,
    userRowIndex: userRow.rowIndex,
    user: {
      userId: String(userRow.values[0]),
      username: String(userRow.values[1]),
      phone: String(userRow.values[5] || "")
    }
  };
}

function issueSession_(spreadsheet, userId, payload, now) {
  const devicesSheet = spreadsheet.getSheetByName(SHEETS.DEVICES);
  const isPrimary = payload.isPrimary !== false;
  if (isPrimary) clearPrimaryDevices_(devicesSheet, userId);

  const sessionToken = compactUuid_() + compactUuid_();
  const deviceId = "dev_" + compactUuid_();
  devicesSheet.appendRow([
    deviceId,
    userId,
    hashSessionToken_(sessionToken),
    String(payload.deviceName || "Браузер").trim().slice(0, 80),
    String(payload.platform || "web").trim().slice(0, 30),
    "",
    isPrimary,
    now,
    now,
    new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    ""
  ]);

  return { sessionToken, deviceId };
}

function clearPrimaryDevices_(sheet, userId) {
  const rows = readDataRows_(sheet, HEADERS.DEVICES.length);
  rows.forEach((row, index) => {
    if (String(row[1]) === userId && row[6] === true && !row[10]) {
      sheet.getRange(index + 2, 7).setValue(false);
    }
  });
}

function normalizeMessageContent_(messageType, payload) {
  if (MESSAGE_TYPES.indexOf(messageType) === -1) {
    throwApi_("INVALID_MESSAGE_TYPE", "Поддерживаются text, photo и video");
  }

  if (messageType === "text") {
    const text = String(payload.text || "").trim();
    if (!text) throwApi_("EMPTY_MESSAGE", "Сообщение пустое");
    if (text.length > MAX_TEXT_LENGTH) {
      throwApi_("MESSAGE_TOO_LONG", "Сообщение длиннее 4000 символов");
    }
    return { text };
  }

  const mediaUrl = String(payload.mediaUrl || "").trim();
  const mediaFileId = String(payload.mediaFileId || "").trim();
  if (!mediaUrl && !mediaFileId) throwApi_("MEDIA_REQUIRED", "Не указан файл");
  if (mediaUrl && !/^https:\/\//i.test(mediaUrl)) {
    throwApi_("INVALID_MEDIA_URL", "Файл должен иметь HTTPS-адрес");
  }

  const caption = String(payload.caption || "").trim();
  if (caption.length > MAX_TEXT_LENGTH) {
    throwApi_("CAPTION_TOO_LONG", "Подпись длиннее 4000 символов");
  }

  return {
    mediaFileId: mediaFileId.slice(0, 200),
    mediaUrl: mediaUrl.slice(0, 2000),
    mimeType: String(payload.mimeType || "").trim().slice(0, 100),
    size: Math.max(0, Number(payload.size || 0)),
    thumbnailUrl: String(payload.thumbnailUrl || "").trim().slice(0, 2000),
    caption
  };
}

function messageFromRow_(row) {
  let content = {};
  try {
    content = JSON.parse(String(row[7] || "{}"));
  } catch (error) {
    content = {};
  }

  return {
    seq: Number(row[0]),
    id: String(row[1]),
    chatId: String(row[2]),
    senderUserId: String(row[3]),
    senderUsername: String(row[4]),
    recipientUserId: String(row[5] || ""),
    messageType: String(row[6]),
    content,
    replyToMessageId: String(row[8] || ""),
    createdAt: String(row[9]),
    editedAt: String(row[10] || ""),
    deletedAt: String(row[11] || "")
  };
}

function findActiveRecipient_(auth, recipientUserId) {
  const userId = validateId_(recipientUserId, "recipient_user_id");
  if (userId === auth.user.userId) {
    throwApi_("INVALID_RECIPIENT", "Нельзя создать личный чат с самим собой");
  }

  const row = findRowByValue_(auth.usersSheet, 1, userId);
  if (!row || String(row.values[6]) !== "active") {
    throwApi_("USER_NOT_FOUND", "Пользователь не найден");
  }

  return { userId: String(row.values[0]), username: String(row.values[1]) };
}

function directChatId_(firstUserId, secondUserId) {
  return "dm:" + [String(firstUserId), String(secondUserId)].sort().join(":");
}

function validatePublicChatId_(value) {
  const chatId = validateId_(value, "chat_id");
  if (chatId !== "general") {
    throwApi_("CHAT_FORBIDDEN", "Пока доступен только общий канал и личные чаты");
  }
  return chatId;
}

function authorizeChat_(userId, chatId) {
  if (chatId === "general") return;
  const parts = chatId.split(":");
  if (parts.length !== 3 || parts[0] !== "dm" || parts.indexOf(userId) === -1) {
    throwApi_("CHAT_FORBIDDEN", "Нет доступа к этому чату");
  }
}

function validatePushFid_(value) {
  const fid = String(value || "").trim();
  if (!/^[A-Za-z0-9_:-]{10,300}$/.test(fid)) {
    throwApi_("INVALID_PUSH_ID", "Некорректный идентификатор уведомлений");
  }
  return fid;
}

function isPushConfigured_() {
  return Boolean(PropertiesService.getScriptProperties().getProperty("FCM_SERVICE_ACCOUNT_JSON"));
}

function trySendMessagePush_(spreadsheet, recipient, message) {
  if (!isPushConfigured_()) return { sent: false, reason: "NOT_CONFIGURED" };

  const devicesSheet = spreadsheet.getSheetByName(SHEETS.DEVICES);
  const rows = readDataRows_(devicesSheet, HEADERS.DEVICES.length);
  const device = rows.find((row) =>
    String(row[1]) === recipient.userId
    && String(row[5] || "")
    && (row[6] === true || String(row[6]).toLowerCase() === "true")
    && !row[10]
  );
  if (!device) return { sent: false, reason: "NO_PRIMARY_DEVICE" };

  try {
    sendFcmMessage_(String(device[5]), message);
    return { sent: true };
  } catch (error) {
    console.error("Push delivery failed", error);
    return { sent: false, reason: "DELIVERY_FAILED" };
  }
}

function sendFcmMessage_(fid, message) {
  const serviceAccount = getFcmServiceAccount_();
  const accessToken = getFcmAccessToken_(serviceAccount);
  const properties = PropertiesService.getScriptProperties();
  const webAppUrl = String(properties.getProperty("WEB_APP_URL") || "").trim();
  const body = pushBody_(message);
  const webpush = {
    headers: { Urgency: "high" },
    notification: {
      tag: "chat-" + message.chatId,
      renotify: false
    }
  };
  if (/^https:\/\//i.test(webAppUrl)) {
    webpush.fcm_options = { link: appendChatQuery_(webAppUrl, message.chatId) };
  }

  const response = UrlFetchApp.fetch(
    "https://fcm.googleapis.com/v1/projects/"
      + encodeURIComponent(serviceAccount.project_id)
      + "/messages:send",
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + accessToken },
      payload: JSON.stringify({
        message: {
          fid,
          notification: {
            title: "@" + message.senderUsername,
            body
          },
          data: {
            chatId: String(message.chatId),
            messageId: String(message.id),
            senderUsername: String(message.senderUsername)
          },
          webpush
        }
      }),
      muteHttpExceptions: true
    }
  );

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("FCM HTTP " + status + ": " + response.getContentText().slice(0, 500));
  }
}

function pushBody_(message) {
  if (message.messageType === "photo") {
    return message.content.caption ? "Фото — " + message.content.caption : "Фото";
  }
  if (message.messageType === "video") {
    return message.content.caption ? "Видео — " + message.content.caption : "Видео";
  }
  const text = String(message.content.text || "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? text.slice(0, 157) + "…" : text;
}

function appendChatQuery_(url, chatId) {
  return url + (url.indexOf("?") === -1 ? "?" : "&") + "chat=" + encodeURIComponent(chatId);
}

function getFcmServiceAccount_() {
  const raw = PropertiesService.getScriptProperties().getProperty("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("FCM_SERVICE_ACCOUNT_JSON не настроен");

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (error) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON содержит некорректный JSON");
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.project_id) {
    throw new Error("В сервисном аккаунте Firebase не хватает обязательных полей");
  }
  return serviceAccount;
}

function getFcmAccessToken_(serviceAccount) {
  const cache = typeof CacheService !== "undefined" ? CacheService.getScriptCache() : null;
  const cacheKey = "fcm_access_token_" + serviceAccount.project_id;
  const cached = cache ? cache.get(cacheKey) : null;
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson_({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlJson_({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  });
  const unsignedJwt = header + "." + claims;
  const signature = Utilities.computeRsaSha256Signature(unsignedJwt, serviceAccount.private_key);
  const assertion = unsignedJwt + "." + Utilities.base64EncodeWebSafe(signature).replace(/=+$/g, "");
  const response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: "grant_type="
      + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")
      + "&assertion=" + encodeURIComponent(assertion),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const data = JSON.parse(response.getContentText() || "{}");
  if (status < 200 || status >= 300 || !data.access_token) {
    throw new Error("Не удалось получить доступ FCM: HTTP " + status);
  }
  if (cache) cache.put(cacheKey, data.access_token, 3300);
  return data.access_token;
}

function base64UrlJson_(value) {
  return Utilities.base64EncodeWebSafe(JSON.stringify(value)).replace(/=+$/g, "");
}

function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) throwApi_("NOT_CONFIGURED", "Сначала запустите setupProject()");
  return SpreadsheetApp.openById(spreadsheetId);
}

function getAuthPepper_() {
  const properties = PropertiesService.getScriptProperties();
  let pepper = properties.getProperty("AUTH_PEPPER");
  if (!pepper) {
    pepper = compactUuid_() + compactUuid_();
    properties.setProperty("AUTH_PEPPER", pepper);
  }
  return pepper;
}

function hashPassword_(password, salt) {
  return hmacHex_(salt + "\n" + password, getAuthPepper_());
}

function hashSessionToken_(sessionToken) {
  return hmacHex_("session\n" + sessionToken, getAuthPepper_());
}

function hmacHex_(value, key) {
  return Utilities.computeHmacSha256Signature(value, key)
    .map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual_(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index % Math.max(1, a.length)) || 0)
      ^ (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return difference === 0;
}

function validateUsername_(value) {
  const username = String(value || "").trim().normalize("NFKC");
  if (!USERNAME_PATTERN.test(username)) {
    throwApi_("INVALID_USERNAME", "Username: 3–32 символа, только буквы, цифры, точка и подчёркивание");
  }
  return username;
}

function normalizeUsername_(value) {
  return String(value || "").trim().normalize("NFKC").toLocaleLowerCase("ru-RU");
}

function validatePassword_(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 128) {
    throwApi_("INVALID_PASSWORD", "Пароль должен содержать от 8 до 128 символов");
  }
  return password;
}

function validatePhone_(value) {
  const phone = String(value || "").trim();
  if (phone.length > MAX_PHONE_LENGTH || (phone && !/^[+\d()\s-]+$/.test(phone))) {
    throwApi_("INVALID_PHONE", "Некорректный номер телефона");
  }
  return phone;
}

function validateId_(value, fieldName) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) {
    throwApi_("INVALID_ID", "Некорректное поле " + fieldName);
  }
  return id;
}

function publicUser_(user) {
  return { userId: user.userId, username: user.username, phone: user.phone || "" };
}

function compactUuid_() {
  return Utilities.getUuid().replace(/-/g, "");
}

function findRowByValue_(sheet, column, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  const matches = sheet.getRange(2, column, lastRow - 1, 1).getValues();
  for (let index = 0; index < matches.length; index += 1) {
    if (String(matches[index][0]) === String(value)) {
      const rowIndex = index + 2;
      return {
        rowIndex,
        values: sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0]
      };
    }
  }
  return null;
}

function readDataRows_(sheet, columnCount) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, columnCount).getValues();
}

function ensureSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() > 1) {
    const currentHeaders = sheet
      .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
      .getValues()[0];
    const matches = headers.every((header, index) => String(currentHeaders[index] || "") === header);
    if (!matches) throw new Error("Лист " + name + " содержит данные старой схемы; нужна миграция");
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.setFrozenRows(1);
}

function throwApi_(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function jsonOutput_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
