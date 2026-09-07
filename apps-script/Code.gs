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
const MEDIA_CHUNK_SIZE_BYTES = 2 * 1024 * 1024;
const MEDIA_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const MEDIA_MANIFEST_FILE = ".gm-manifest.json";
const MEDIA_CHUNK_PREFIX = "chunk_";

function doGet() {
  return jsonOutput_({ ok: true, service: "sheet-messenger", version: "0.3.2" });
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
    case "getUserChats":
      return getUserChats_(payload);
    case "uploadMedia":
      return uploadMedia_(payload);
    case "health":
      return { ok: true, serverTime: new Date().toISOString() };
    default:
      throwApi_("UNKNOWN_ACTION", "Неизвестное действие");
  }
}

const DEFAULT_DATABASE_SPREADSHEET_ID = "1WesvVOUgneIPSlfG5BYgTzA1lOurdjtsOCPdvclquv8";

function setupProject() {
  const properties = PropertiesService.getScriptProperties();
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const authSpreadsheet = openConfiguredSpreadsheet_("SPREADSHEET_AUTH_ID", activeSpreadsheet);
  const messagesSpreadsheet = openConfiguredSpreadsheet_("SPREADSHEET_MESSAGES_ID", activeSpreadsheet);
  const archiveSpreadsheet = openConfiguredSpreadsheet_("SPREADSHEET_ARCHIVE_ID", activeSpreadsheet);

  if (!authSpreadsheet) {
    throw new Error("Не удалось открыть таблицу базы данных: " + DEFAULT_DATABASE_SPREADSHEET_ID);
  }

  ensureSheet_(authSpreadsheet, SHEETS.USERS, HEADERS.USERS);
  ensureSheet_(authSpreadsheet, SHEETS.DEVICES, HEADERS.DEVICES);
  ensureSheet_(messagesSpreadsheet, SHEETS.MESSAGES, HEADERS.MESSAGES);
  ensureSheet_(archiveSpreadsheet, SHEETS.CONFIG, HEADERS.CONFIG);

  properties.setProperty("SPREADSHEET_AUTH_ID", authSpreadsheet.getId());
  properties.setProperty("SPREADSHEET_MESSAGES_ID", messagesSpreadsheet.getId());
  properties.setProperty("SPREADSHEET_ARCHIVE_ID", archiveSpreadsheet.getId());
  getAuthPepper_();

  return {
    ok: true,
    authSpreadsheetId: authSpreadsheet.getId(),
    messagesSpreadsheetId: messagesSpreadsheet.getId(),
    archiveSpreadsheetId: archiveSpreadsheet.getId(),
    schemaVersion: "0.3.0"
  };
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
  const rawQuery = String(payload.query || "").trim();
  const query = normalizeUsername_(rawQuery.replace(/^@/, ""));
  if (query.length < 1) throwApi_("QUERY_TOO_SHORT", "Введите минимум один символ для поиска");

  const rows = readDataRows_(auth.usersSheet, HEADERS.USERS.length);
  const users = rows
    .filter((row) => String(row[6]) === "active")
    .filter((row) => {
      const uKey = String(row[2] || "").toLowerCase();
      const uName = String(row[1] || "").toLowerCase();
      return uKey.indexOf(query) !== -1 || uName.indexOf(query) !== -1;
    })
    .filter((row) => String(row[0]) !== auth.user.userId && normalizeUsername_(String(row[1])) !== normalizeUsername_(auth.user.username))
    .slice(0, 30)
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

  let chatId;
  let recipient = null;

  if (recipientUserId) {
    recipient = findActiveRecipient_(auth, recipientUserId);
    chatId = directChatId_(auth.user.username, recipient.username);
  } else {
    // Прямой chatId (dm:username1:username2 или dm:general / general)
    const rawChatId = String(payload.chatId || "dm:general").trim();
    if (rawChatId === "general" || rawChatId === "dm:general") {
      chatId = "dm:general";
    } else {
      // Проверяем что это DM и пользователь участник (по username)
      authorizeChatByUsername_(auth.user.username, rawChatId);
      chatId = rawChatId;
    }
  }

  const messageType = String(payload.messageType || "text").toLowerCase();
  const content = normalizeMessageContent_(messageType, payload, auth, chatId);
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

    const messagesSheet = auth.messagesSpreadsheet.getSheetByName(SHEETS.MESSAGES);
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
  let rawChatId = String(payload.chatId || "dm:general").trim();
  if (rawChatId === "general") rawChatId = "dm:general";
  const chatId = validateId_(rawChatId, "chat_id");
  
  // Строгая проверка доступа по username
  authorizeChatByUsername_(auth.user.username, chatId);
  const sheet = auth.messagesSpreadsheet.getSheetByName(SHEETS.MESSAGES);
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
    messagesSpreadsheet: getMessagesSpreadsheet_(),
    archiveSpreadsheet: getArchiveSpreadsheet_(),
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

function normalizeMessageContent_(messageType, payload, auth, chatId) {
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

  if (mediaFileId) {
    const manifest = getPrivateMediaManifest_(mediaFileId);
    if (manifest.status !== "ready"
        || manifest.ownerUserId !== auth.user.userId
        || manifest.chatId !== chatId) {
      throwApi_("MEDIA_ACCESS_DENIED", "Файл недоступен для этого сообщения");
    }
    return {
      mediaFileId,
      mediaUrl: "",
      fileName: manifest.fileName,
      mimeType: manifest.mimeType,
      size: manifest.size,
      chunkSize: manifest.chunkSize,
      totalChunks: manifest.totalChunks,
      thumbnailUrl: "",
      caption
    };
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

function directChatId_(firstUsername, secondUsername) {
  // Строим из нормализованных username (lowercase) — совпадает с getDmChatId на фронте
  return "dm:" + [normalizeUsername_(String(firstUsername)), normalizeUsername_(String(secondUsername))].sort().join(":");
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

// Авторизация по username (т.к. chatId строится из username)
function authorizeChatByUsername_(username, chatId) {
  if (chatId === "general" || chatId === "dm:general") return;
  const parts = chatId.split(":");
  const normalizedUsername = normalizeUsername_(username);
  if (parts.length !== 3 || parts[0] !== "dm" || parts.indexOf(normalizedUsername) === -1) {
    throwApi_("CHAT_FORBIDDEN", "Нет доступа к этому чату");
  }
}

// Возвращает список уникальных chatId пользователя с данными о последнем сообщении
function getUserChats_(payload) {
  const auth = authenticate_(payload.sessionToken);
  const myUsername = normalizeUsername_(auth.user.username);
  const sheet = auth.messagesSpreadsheet.getSheetByName(SHEETS.MESSAGES);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return { ok: true, chats: [] };

  const rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.MESSAGES.length).getValues();
  const chatMap = {};

  rows.forEach(function(row) {
    const msg = messageFromRow_(row);
    if (msg.deletedAt) return;

    // Проверяем участие: general / dm:general доступен всем, dm — только если username в chatId
    const isGeneral = msg.chatId === "general" || msg.chatId === "dm:general";
    const parts = msg.chatId.split(":");
    const isDm = parts.length === 3 && parts[0] === "dm" && parts.indexOf(myUsername) !== -1;

    if (!isGeneral && !isDm) return;
    if (isGeneral) return; // general — не добавляем в список личных диалогов, он всегда закреплен первым

    if (!chatMap[msg.chatId] || msg.seq > chatMap[msg.chatId].seq) {
      // Определяем собеседника (peer)
      let peerUsername = null;
      if (isDm) {
        peerUsername = parts[1] === myUsername ? parts[2] : parts[1];
      }

      let snippet = "Диалог";
      if (msg.messageType === "text" && msg.content && msg.content.text) {
        snippet = msg.content.text.slice(0, 40);
      } else if (msg.messageType === "video") {
        snippet = "🎬 Видео";
      } else if (msg.messageType === "photo") {
        snippet = "📷 Фото";
      }

      chatMap[msg.chatId] = {
        chatId: msg.chatId,
        peerUsername,
        lastSender: msg.senderUsername,
        lastSnippet: snippet,
        lastTime: new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        lastTimestamp: new Date(msg.createdAt).getTime(),
        seq: msg.seq
      };
    }
  });

  const chats = Object.values(chatMap).sort(function(a, b) { return b.lastTimestamp - a.lastTimestamp; });
  return { ok: true, chats };
}

// Приватное чанковое хранилище. Ни папка, ни файлы не публикуются по ссылке.
function uploadMedia_(payload) {
  const auth = authenticate_(payload.sessionToken);
  const operation = String(payload.operation || "").trim().toLowerCase();
  if (operation === "start") return startPrivateMediaUpload_(auth, payload);
  if (operation === "chunk") return savePrivateMediaChunk_(auth, payload);
  if (operation === "finish") return finishPrivateMediaUpload_(auth, payload);
  if (operation === "download") return downloadPrivateMediaChunk_(auth, payload);
  throwApi_("INVALID_MEDIA_OPERATION", "Неизвестная операция с файлом");
}

// Одноразовая миграция ранее загруженных публичных файлов.
function privatizeLegacyMediaFiles() {
  let updated = 0;
  const folders = DriveApp.getFoldersByName("GlobalMessenger_Media");
  while (folders.hasNext()) {
    const folder = folders.next();
    const files = folder.getFiles();
    while (files.hasNext()) {
      files.next().setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      updated += 1;
    }
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  }
  return { ok: true, updated };
}

function startPrivateMediaUpload_(auth, payload) {
  let chatId = String(payload.chatId || "dm:general").trim();
  if (chatId === "general") chatId = "dm:general";
  authorizeChatByUsername_(auth.user.username, chatId);

  const size = Math.floor(Number(payload.size || 0));
  const chunkSize = Math.floor(Number(payload.chunkSize || 0));
  const totalChunks = Math.floor(Number(payload.totalChunks || 0));
  if (size <= 0 || size > MEDIA_MAX_FILE_SIZE_BYTES) {
    throwApi_("FILE_TOO_LARGE", "Допустимый размер файла: до 100 МБ");
  }
  if (chunkSize <= 0 || chunkSize > MEDIA_CHUNK_SIZE_BYTES
      || totalChunks !== Math.ceil(size / chunkSize)) {
    throwApi_("INVALID_CHUNK_PLAN", "Некорректный план загрузки файла");
  }

  const root = getPrivateMediaRoot_();
  const folder = root.createFolder("media_" + compactUuid_());
  const manifest = {
    version: 1,
    status: "uploading",
    ownerUserId: auth.user.userId,
    ownerUsername: auth.user.username,
    chatId,
    fileName: sanitizePrivateFileName_(payload.fileName),
    mimeType: String(payload.mimeType || "application/octet-stream").slice(0, 100),
    size,
    chunkSize,
    totalChunks,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  folder.createFile(MEDIA_MANIFEST_FILE, JSON.stringify(manifest), MimeType.PLAIN_TEXT);
  return { ok: true, mediaId: folder.getId(), chunkSize, totalChunks };
}

function savePrivateMediaChunk_(auth, payload) {
  const mediaId = validatePrivateMediaId_(payload.mediaId);
  const folder = DriveApp.getFolderById(mediaId);
  const manifest = readPrivateMediaManifest_(folder);
  assertPrivateMediaOwner_(auth, manifest);
  if (manifest.status !== "uploading") throwApi_("UPLOAD_CLOSED", "Загрузка уже завершена");

  const chunkIndex = Math.floor(Number(payload.chunkIndex));
  if (chunkIndex < 0 || chunkIndex >= manifest.totalChunks) {
    throwApi_("INVALID_CHUNK_INDEX", "Некорректный номер части");
  }
  const bytes = Utilities.base64Decode(String(payload.base64 || ""));
  const expected = chunkIndex === manifest.totalChunks - 1
    ? manifest.size - chunkIndex * manifest.chunkSize
    : manifest.chunkSize;
  if (bytes.length !== expected || bytes.length > MEDIA_CHUNK_SIZE_BYTES) {
    throwApi_("INVALID_CHUNK_SIZE", "Некорректный размер части файла");
  }

  const name = privateChunkName_(chunkIndex);
  const previous = folder.getFilesByName(name);
  while (previous.hasNext()) previous.next().setTrashed(true);
  folder.createFile(Utilities.newBlob(bytes, "application/octet-stream", name));
  return { ok: true, mediaId, chunkIndex };
}

function finishPrivateMediaUpload_(auth, payload) {
  const mediaId = validatePrivateMediaId_(payload.mediaId);
  const folder = DriveApp.getFolderById(mediaId);
  const manifest = readPrivateMediaManifest_(folder);
  assertPrivateMediaOwner_(auth, manifest);

  let totalSize = 0;
  for (let index = 0; index < manifest.totalChunks; index += 1) {
    const files = folder.getFilesByName(privateChunkName_(index));
    if (!files.hasNext()) throwApi_("UPLOAD_INCOMPLETE", "Не все части файла загружены");
    totalSize += Number(files.next().getSize());
    if (files.hasNext()) throwApi_("DUPLICATE_CHUNK", "Обнаружена лишняя часть файла");
  }
  if (totalSize !== manifest.size) throwApi_("INVALID_FILE_SIZE", "Размер загруженного файла не совпадает");

  manifest.status = "ready";
  manifest.updatedAt = new Date().toISOString();
  writePrivateMediaManifest_(folder, manifest);
  return {
    ok: true,
    mediaId,
    fileName: manifest.fileName,
    mimeType: manifest.mimeType,
    size: manifest.size,
    chunkSize: manifest.chunkSize,
    totalChunks: manifest.totalChunks
  };
}

function downloadPrivateMediaChunk_(auth, payload) {
  const mediaId = validatePrivateMediaId_(payload.mediaId);
  const folder = DriveApp.getFolderById(mediaId);
  const manifest = readPrivateMediaManifest_(folder);
  if (manifest.status !== "ready") throwApi_("MEDIA_NOT_READY", "Файл ещё не готов");
  authorizeChatByUsername_(auth.user.username, manifest.chatId);

  const chunkIndex = Math.floor(Number(payload.chunkIndex));
  if (chunkIndex < 0 || chunkIndex >= manifest.totalChunks) {
    throwApi_("INVALID_CHUNK_INDEX", "Некорректный номер части");
  }
  const files = folder.getFilesByName(privateChunkName_(chunkIndex));
  if (!files.hasNext()) throwApi_("MEDIA_CORRUPTED", "Часть файла отсутствует");
  return {
    ok: true,
    mediaId,
    chunkIndex,
    totalChunks: manifest.totalChunks,
    fileName: manifest.fileName,
    mimeType: manifest.mimeType,
    size: manifest.size,
    base64: Utilities.base64Encode(files.next().getBlob().getBytes())
  };
}

function getPrivateMediaRoot_() {
  const properties = PropertiesService.getScriptProperties();
  const storedId = properties.getProperty("PRIVATE_MEDIA_ROOT_ID");
  if (storedId) {
    try { return DriveApp.getFolderById(storedId); } catch (error) { console.warn(error); }
  }
  const folder = DriveApp.createFolder("GlobalMessenger_Private_Media");
  properties.setProperty("PRIVATE_MEDIA_ROOT_ID", folder.getId());
  return folder;
}

function getPrivateMediaManifest_(mediaId) {
  return readPrivateMediaManifest_(DriveApp.getFolderById(validatePrivateMediaId_(mediaId)));
}

function readPrivateMediaManifest_(folder) {
  const files = folder.getFilesByName(MEDIA_MANIFEST_FILE);
  if (!files.hasNext()) throwApi_("MEDIA_NOT_FOUND", "Файл не найден");
  try { return JSON.parse(files.next().getBlob().getDataAsString()); }
  catch (error) { throwApi_("MEDIA_CORRUPTED", "Повреждены данные файла"); }
}

function writePrivateMediaManifest_(folder, manifest) {
  const files = folder.getFilesByName(MEDIA_MANIFEST_FILE);
  if (!files.hasNext()) throwApi_("MEDIA_NOT_FOUND", "Файл не найден");
  files.next().setContent(JSON.stringify(manifest));
}

function assertPrivateMediaOwner_(auth, manifest) {
  if (manifest.ownerUserId !== auth.user.userId) {
    throwApi_("MEDIA_ACCESS_DENIED", "Нет доступа к загрузке");
  }
}

function validatePrivateMediaId_(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throwApi_("INVALID_MEDIA_ID", "Некорректный файл");
  return id;
}

function privateChunkName_(index) {
  return MEDIA_CHUNK_PREFIX + String(index).padStart(6, "0");
}

function sanitizePrivateFileName_(value) {
  const name = String(value || "file").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return (name || "file").slice(0, 180);
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
  return openRequiredSpreadsheet_("SPREADSHEET_AUTH_ID");
}

function getMessagesSpreadsheet_() {
  return openRequiredSpreadsheet_("SPREADSHEET_MESSAGES_ID");
}

function getArchiveSpreadsheet_() {
  return openRequiredSpreadsheet_("SPREADSHEET_ARCHIVE_ID");
}

function openRequiredSpreadsheet_(propertyName) {
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const spreadsheet = openConfiguredSpreadsheet_(propertyName, activeSpreadsheet);
  if (!spreadsheet) throwApi_("NOT_CONFIGURED", "Сначала запустите setupProject()");
  return spreadsheet;
}

function openConfiguredSpreadsheet_(propertyName, fallback) {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(propertyName);
  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (e) {}
  }
  if (DEFAULT_DATABASE_SPREADSHEET_ID) {
    try {
      return SpreadsheetApp.openById(DEFAULT_DATABASE_SPREADSHEET_ID);
    } catch (e) {}
  }
  return fallback;
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
