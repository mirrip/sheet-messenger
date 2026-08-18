import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

class Range {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ""
      )
    );
  }

  setValues(values) {
    values.forEach((row, rowOffset) => {
      row.forEach((value, columnOffset) => this.setCell_(rowOffset, columnOffset, value));
    });
    return this;
  }

  setValue(value) {
    this.setCell_(0, 0, value);
    return this;
  }

  setCell_(rowOffset, columnOffset, value) {
    const rowIndex = this.row - 1 + rowOffset;
    const columnIndex = this.column - 1 + columnOffset;
    while (this.sheet.rows.length <= rowIndex) this.sheet.rows.push([]);
    while (this.sheet.rows[rowIndex].length <= columnIndex) this.sheet.rows[rowIndex].push("");
    this.sheet.rows[rowIndex][columnIndex] = value;
  }
}

class Sheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }

  appendRow(row) {
    this.rows.push([...row]);
    return this;
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return Math.max(0, ...this.rows.map((row) => row.length));
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new Range(this, row, column, rowCount, columnCount);
  }

  setFrozenRows() {}
}

class Spreadsheet {
  constructor(id) {
    this.id = id;
    this.sheets = new Map();
  }

  getId() {
    return this.id;
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    const sheet = new Sheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

const spreadsheet = new Spreadsheet("test-sheet");
const properties = new Map();
const scriptProperties = {
  getProperty: (key) => properties.get(key) || null,
  setProperty: (key, value) => properties.set(key, String(value))
};

const context = vm.createContext({
  console,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => spreadsheet,
    openById: (id) => {
      assert.equal(id, spreadsheet.id);
      return spreadsheet;
    }
  },
  PropertiesService: { getScriptProperties: () => scriptProperties },
  LockService: {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
  },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (value, key) =>
      [...crypto.createHmac("sha256", key).update(value).digest()]
        .map((byte) => (byte > 127 ? byte - 256 : byte))
  },
  ContentService: {
    MimeType: { JSON: "application/json" },
    createTextOutput: (value) => ({ setMimeType: () => value })
  }
});

const backendCode = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
vm.runInContext(backendCode, context);

const setup = context.setupProject();
assert.equal(setup.ok, true);
assert.equal(setup.schemaVersion, "0.3.0");
assert.ok(properties.get("AUTH_PEPPER"));

const alice = context.api("register", {
  username: "Alice_1",
  password: "password123",
  phone: "+7 900 000-00-00",
  platform: "web"
});
assert.equal(alice.user.username, "Alice_1");
assert.ok(alice.user.userId.startsWith("usr_"));
assert.equal(alice.session.sessionToken.length, 64);

const usersSheet = spreadsheet.getSheetByName("Users");
const devicesSheet = spreadsheet.getSheetByName("Devices");
assert.notEqual(usersSheet.rows[1][3], "password123");
assert.notEqual(devicesSheet.rows[1][2], alice.session.sessionToken);

assert.throws(
  () => context.api("register", { username: "alice_1", password: "password123" }),
  (error) => error.code === "USERNAME_TAKEN"
);
assert.throws(
  () => context.api("login", { username: "Alice_1", password: "wrongpass" }),
  (error) => error.code === "INVALID_CREDENTIALS"
);

const login = context.api("login", { username: "Alice_1", password: "password123" });
assert.equal(login.user.userId, alice.user.userId);

const bob = context.api("register", {
  username: "Bob_2",
  password: "password456",
  phone: "+1 555 0100"
});
const pushRegistration = context.api("registerPush", {
  sessionToken: bob.session.sessionToken,
  fid: "firebase-installation-bob-123"
});
assert.equal(pushRegistration.enabled, true);
assert.equal(pushRegistration.configured, false);
const bobDevice = devicesSheet.rows.find((row) => row[0] === bob.session.deviceId);
assert.equal(bobDevice[5], "firebase-installation-bob-123");
assert.equal(bobDevice[6], true);

const search = context.api("searchUsers", { sessionToken: alice.session.sessionToken, query: "bo" });
assert.deepEqual(JSON.parse(JSON.stringify(search.users)), [{ userId: bob.user.userId, username: "Bob_2" }]);

const firstMessage = context.api("send", {
  sessionToken: alice.session.sessionToken,
  chatId: "general",
  messageType: "text",
  text: "Первое сообщение"
});
assert.equal(firstMessage.message.senderUserId, alice.user.userId);
assert.equal(firstMessage.message.content.text, "Первое сообщение");

assert.throws(
  () => context.api("send", {
    sessionToken: alice.session.sessionToken,
    chatId: "general",
    messageType: "text",
    text: "Слишком быстро"
  }),
  (error) => error.code === "RATE_LIMITED"
);

usersSheet.rows[1][10] = 0;
const directMessage = context.api("send", {
  sessionToken: alice.session.sessionToken,
  recipientUserId: bob.user.userId,
  messageType: "text",
  text: "Личное сообщение"
});
assert.equal(directMessage.message.recipientUserId, bob.user.userId);
assert.ok(directMessage.message.chatId.startsWith("dm:"));
assert.equal(directMessage.push.reason, "NOT_CONFIGURED");

const directSync = context.api("sync", {
  sessionToken: bob.session.sessionToken,
  chatId: directMessage.message.chatId,
  afterSeq: 0
});
assert.equal(directSync.messages.length, 1);
assert.equal(directSync.messages[0].content.text, "Личное сообщение");

const fcmRequests = [];
const tokenCache = new Map();
context.CacheService = {
  getScriptCache: () => ({
    get: (key) => tokenCache.get(key) || null,
    put: (key, value) => tokenCache.set(key, value)
  })
};
context.Utilities.computeRsaSha256Signature = () => [1, 2, 3, 4];
context.Utilities.base64EncodeWebSafe = (value) => Buffer
  .from(typeof value === "string" ? value : Uint8Array.from(value))
  .toString("base64url");
context.UrlFetchApp = {
  fetch: (url, options) => {
    fcmRequests.push({ url, options });
    const isTokenRequest = url === "https://oauth2.googleapis.com/token";
    return {
      getResponseCode: () => 200,
      getContentText: () => isTokenRequest
        ? JSON.stringify({ access_token: "test-access-token" })
        : JSON.stringify({ name: "projects/test/messages/1" })
    };
  }
};
properties.set("FCM_SERVICE_ACCOUNT_JSON", JSON.stringify({
  project_id: "test-firebase-project",
  client_email: "push@test-firebase-project.iam.gserviceaccount.com",
  private_key: "test-private-key"
}));
properties.set("WEB_APP_URL", "https://example.github.io/sheet-messenger/");
usersSheet.rows[1][10] = 0;
const pushedMessage = context.api("send", {
  sessionToken: alice.session.sessionToken,
  recipientUserId: bob.user.userId,
  messageType: "text",
  text: "Сообщение с push"
});
assert.equal(pushedMessage.push.sent, true);
assert.equal(fcmRequests.length, 2);
const fcmPayload = JSON.parse(fcmRequests[1].options.payload);
assert.equal(fcmPayload.message.fid, "firebase-installation-bob-123");
assert.equal(fcmPayload.message.data.chatId, pushedMessage.message.chatId);
assert.ok(fcmPayload.message.webpush.fcm_options.link.includes("chat=dm%3A"));

usersSheet.rows[1][10] = 0;
const photoMessage = context.api("send", {
  sessionToken: alice.session.sessionToken,
  chatId: "general",
  messageType: "photo",
  mediaFileId: "file_123",
  mimeType: "image/jpeg",
  caption: "Подпись"
});
assert.equal(photoMessage.message.messageType, "photo");
assert.equal(photoMessage.message.content.caption, "Подпись");

const sync = context.api("sync", {
  sessionToken: bob.session.sessionToken,
  chatId: "general",
  afterSeq: 0
});
assert.equal(sync.messages.length, 2);
assert.equal(sync.messages[0].senderUsername, "Alice_1");

const updated = context.api("updatePhone", {
  sessionToken: alice.session.sessionToken,
  phone: "+7 911 111-11-11"
});
assert.equal(updated.user.phone, "+7 911 111-11-11");

console.log("Backend smoke tests passed");
