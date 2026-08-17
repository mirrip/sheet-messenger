const SHEETS = Object.freeze({
  USERS: "Users",
  DEVICES: "Devices",
  MESSAGES: "Messages",
  CONFIG: "Config"
});

function doGet() {
  return jsonOutput_({ ok: true, service: "sheet-messenger", version: "0.1.0" });
}

function doPost(event) {
  try {
    const request = JSON.parse(event.postData.contents || "{}");
    return jsonOutput_(api(request.action, request.payload || {}));
  } catch (error) {
    return jsonOutput_({ ok: false, error: error.message });
  }
}

function api(action, payload) {
  switch (action) {
    case "send":
      return sendMessage_(payload);
    case "sync":
      return syncMessages_(payload);
    case "health":
      return { ok: true, serverTime: new Date().toISOString() };
    default:
      throw new Error("Неизвестное действие");
  }
}

function setupProject() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Откройте Apps Script из нужной Google Таблицы");

  ensureSheet_(spreadsheet, SHEETS.USERS, ["user_id", "display_name", "status", "created_at"]);
  ensureSheet_(spreadsheet, SHEETS.DEVICES, ["device_id", "user_id", "push_token", "is_primary", "last_seen", "revoked_at"]);
  ensureSheet_(spreadsheet, SHEETS.MESSAGES, ["seq", "message_id", "chat_id", "user_id", "display_name", "text", "created_at"]);
  ensureSheet_(spreadsheet, SHEETS.CONFIG, ["key", "value"]);

  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", spreadsheet.getId());
  return { ok: true, spreadsheetId: spreadsheet.getId() };
}

function sendMessage_(payload) {
  const text = String(payload.text || "").trim();
  const userId = String(payload.userId || "").trim();
  const displayName = String(payload.displayName || "").trim().slice(0, 40);
  const chatId = String(payload.chatId || "general").trim();

  if (!userId || !displayName || !text) throw new Error("Недостаточно данных для отправки");
  if (text.length > 4000) throw new Error("Сообщение длиннее 4000 символов");

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.MESSAGES);
    const seq = Math.max(1, sheet.getLastRow());
    const message = {
      seq,
      id: Utilities.getUuid(),
      chatId,
      userId,
      displayName,
      text,
      createdAt: new Date().toISOString()
    };

    sheet.appendRow([
      message.seq,
      message.id,
      message.chatId,
      message.userId,
      message.displayName,
      message.text,
      message.createdAt
    ]);

    return { ok: true, message };
  } finally {
    lock.releaseLock();
  }
}

function syncMessages_(payload) {
  const afterSeq = Math.max(0, Number(payload.afterSeq || 0));
  const limit = Math.min(200, Math.max(1, Number(payload.limit || 100)));
  const chatId = String(payload.chatId || "general");
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.MESSAGES);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1 || afterSeq >= lastRow - 1) return { ok: true, messages: [] };

  const startRow = Math.max(2, afterSeq + 2);
  const rowCount = Math.min(limit, lastRow - startRow + 1);
  const rows = sheet.getRange(startRow, 1, rowCount, 7).getValues();
  const messages = rows
    .map((row) => ({
      seq: Number(row[0]),
      id: String(row[1]),
      chatId: String(row[2]),
      userId: String(row[3]),
      displayName: String(row[4]),
      text: String(row[5]),
      createdAt: String(row[6])
    }))
    .filter((message) => message.chatId === chatId);

  return { ok: true, messages };
}

function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("Сначала запустите setupProject()");
  return SpreadsheetApp.openById(spreadsheetId);
}

function ensureSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  sheet.setFrozenRows(1);
}

function jsonOutput_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

