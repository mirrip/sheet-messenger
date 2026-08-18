const API_URL = String(globalThis.SHEET_MESSENGER_API_URL || "").trim();
const FIREBASE_CONFIG = globalThis.SHEET_MESSENGER_FIREBASE_CONFIG || null;
const FIREBASE_VAPID_KEY = String(globalThis.SHEET_MESSENGER_FIREBASE_VAPID_KEY || "").trim();
const FIREBASE_SDK_VERSION = "12.16.0";
const SESSION_KEY = "sheet-messenger-session-v3";
const ACTIVE_CHAT_KEY = "sheet-messenger-active-chat-v3";
const PUSH_OPT_OUT_KEY = "sheet-messenger-push-disabled-v3";
const LOCAL_USERS_KEY = "sheet-messenger-local-users-v3";
const LOCAL_SESSIONS_KEY = "sheet-messenger-local-sessions-v3";
const LOCAL_MESSAGES_KEY = "sheet-messenger-local-messages-v3";
const POLL_INTERVAL_MS = 5000;
const SEND_INTERVAL_MS = 1000;
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._]{2,31}$/u;

const elements = {
  authDialog: document.querySelector("#authDialog"),
  authError: document.querySelector("#authError"),
  authForm: document.querySelector("#authForm"),
  authHint: document.querySelector("#authHint"),
  authSubmitButton: document.querySelector("#authSubmitButton"),
  authTitle: document.querySelector("#authTitle"),
  chatName: document.querySelector("#chatName"),
  chatSubtitle: document.querySelector("#chatSubtitle"),
  composer: document.querySelector("#composer"),
  generalChatButton: document.querySelector("#generalChatButton"),
  inAppNotice: document.querySelector("#inAppNotice"),
  input: document.querySelector("#messageInput"),
  loginModeButton: document.querySelector("#loginModeButton"),
  logoutButton: document.querySelector("#logoutButton"),
  messages: document.querySelector("#messages"),
  passwordInput: document.querySelector("#passwordInput"),
  phoneField: document.querySelector("#phoneField"),
  phoneInput: document.querySelector("#phoneInput"),
  profileButton: document.querySelector("#profileButton"),
  profileDialog: document.querySelector("#profileDialog"),
  profileError: document.querySelector("#profileError"),
  profileForm: document.querySelector("#profileForm"),
  profileId: document.querySelector("#profileId"),
  profilePhoneInput: document.querySelector("#profilePhoneInput"),
  profileUsername: document.querySelector("#profileUsername"),
  pushButton: document.querySelector("#pushButton"),
  pushDisableButton: document.querySelector("#pushDisableButton"),
  pushStatus: document.querySelector("#pushStatus"),
  registerModeButton: document.querySelector("#registerModeButton"),
  searchButton: document.querySelector("#searchButton"),
  searchDialog: document.querySelector("#searchDialog"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  searchResults: document.querySelector("#searchResults"),
  sendButton: document.querySelector("#sendButton"),
  status: document.querySelector("#status"),
  usernameInput: document.querySelector("#usernameInput")
};

let authMode = "register";
let session = loadJson_(SESSION_KEY, null);
let activeChat = { chatId: "general", recipientUserId: "", username: "" };
let messages = [];
let lastSequence = 0;
let nextSendAt = 0;
let serviceWorkerRegistration = null;
let pushRuntimePromise = null;
let pushRegistrationRequested = false;
let noticeChat = null;

const transport = API_URL ? createHttpTransport_() : createLocalTransport_();

function createHttpTransport_() {
  return {
    label: "Облачный режим",
    async call(action, payload = {}) {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, payload })
      });
      const result = await response.json();
      if (!result?.ok) throw apiError_(result?.code, result?.error);
      return result;
    }
  };
}

function createLocalTransport_() {
  return {
    label: "Локальный режим",
    async call(action, payload = {}) {
      const users = loadJson_(LOCAL_USERS_KEY, []);
      const sessions = loadJson_(LOCAL_SESSIONS_KEY, {});
      const storedMessages = loadJson_(LOCAL_MESSAGES_KEY, []);

      if (action === "register") {
        const username = validateUsername_(payload.username);
        const usernameKey = normalizeUsername_(username);
        validatePassword_(payload.password);
        if (users.some((user) => user.usernameKey === usernameKey)) {
          throw apiError_("USERNAME_TAKEN", "Этот username уже занят");
        }

        const passwordSalt = crypto.randomUUID();
        const user = {
          userId: `usr_${compactUuid_()}`,
          username,
          usernameKey,
          passwordSalt,
          passwordHash: await sha256_(`${passwordSalt}\n${payload.password}`),
          phone: validatePhone_(payload.phone),
          status: "active",
          lastMessageAt: 0
        };
        users.push(user);
        localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
        return issueLocalSession_(user, sessions);
      }

      if (action === "login") {
        const usernameKey = normalizeUsername_(validateUsername_(payload.username));
        validatePassword_(payload.password);
        const user = users.find((candidate) => candidate.usernameKey === usernameKey && candidate.status === "active");
        const hash = user ? await sha256_(`${user.passwordSalt}\n${payload.password}`) : "";
        if (!user || hash !== user.passwordHash) {
          throw apiError_("INVALID_CREDENTIALS", "Неверный username или пароль");
        }
        return issueLocalSession_(user, sessions);
      }

      const user = localAuthenticatedUser_(payload.sessionToken, users, sessions);

      if (action === "logout") {
        delete sessions[payload.sessionToken];
        localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(sessions));
        return { ok: true };
      }

      if (action === "me") return { ok: true, user: publicUser_(user) };

      if (action === "updatePhone") {
        user.phone = validatePhone_(payload.phone);
        localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
        return { ok: true, user: publicUser_(user) };
      }

      if (action === "registerPush") return { ok: true, enabled: true, configured: false };
      if (action === "disablePush") return { ok: true, enabled: false };

      if (action === "searchUsers") {
        const query = normalizeUsername_(payload.query);
        if (query.length < 2) throw apiError_("QUERY_TOO_SHORT", "Введите минимум два символа");
        return {
          ok: true,
          users: users
            .filter((candidate) => candidate.userId !== user.userId)
            .filter((candidate) => candidate.usernameKey.startsWith(query))
            .slice(0, 20)
            .map((candidate) => ({ userId: candidate.userId, username: candidate.username }))
        };
      }

      if (action === "send") {
        const now = Date.now();
        if (now - Number(user.lastMessageAt || 0) < SEND_INTERVAL_MS) {
          throw apiError_("RATE_LIMITED", "Можно отправлять не больше одного сообщения в секунду");
        }
        const text = String(payload.text || "").trim();
        if (!text) throw apiError_("EMPTY_MESSAGE", "Сообщение пустое");

        let recipient = null;
        let chatId = "general";
        if (payload.recipientUserId) {
          recipient = users.find((candidate) => candidate.userId === payload.recipientUserId && candidate.status === "active");
          if (!recipient || recipient.userId === user.userId) {
            throw apiError_("INVALID_RECIPIENT", "Пользователь не найден");
          }
          chatId = directChatId_(user.userId, recipient.userId);
        }

        user.lastMessageAt = now;
        localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
        const message = {
          seq: storedMessages.length + 1,
          id: `msg_${compactUuid_()}`,
          chatId,
          senderUserId: user.userId,
          senderUsername: user.username,
          recipientUserId: recipient?.userId || "",
          messageType: "text",
          content: { text },
          replyToMessageId: "",
          createdAt: new Date(now).toISOString(),
          editedAt: "",
          deletedAt: ""
        };
        storedMessages.push(message);
        localStorage.setItem(LOCAL_MESSAGES_KEY, JSON.stringify(storedMessages));
        return { ok: true, message, push: { sent: false } };
      }

      if (action === "sync") {
        const afterSeq = Number(payload.afterSeq || 0);
        return {
          ok: true,
          messages: storedMessages
            .filter((message) => message.chatId === String(payload.chatId || "general"))
            .filter((message) => message.seq > afterSeq)
            .slice(0, Number(payload.limit || 100)),
          cursor: storedMessages.length
        };
      }

      throw apiError_("UNKNOWN_ACTION", `Неизвестное действие: ${action}`);
    }
  };
}

function issueLocalSession_(user, sessions) {
  const sessionToken = compactUuid_() + compactUuid_();
  const deviceId = `dev_${compactUuid_()}`;
  sessions[sessionToken] = user.userId;
  localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(sessions));
  return { ok: true, user: publicUser_(user), session: { sessionToken, deviceId } };
}

function localAuthenticatedUser_(token, users, sessions) {
  const userId = sessions[String(token || "")];
  const user = users.find((candidate) => candidate.userId === userId && candidate.status === "active");
  if (!user) throw apiError_("INVALID_SESSION", "Сессия недействительна. Войдите снова");
  return user;
}

async function authenticatedCall_(action, payload = {}) {
  if (!session?.sessionToken) throw apiError_("AUTH_REQUIRED", "Требуется вход");
  return transport.call(action, { ...payload, sessionToken: session.sessionToken });
}

function setAuthMode_(mode) {
  authMode = mode;
  const isRegister = mode === "register";
  elements.registerModeButton.classList.toggle("active", isRegister);
  elements.loginModeButton.classList.toggle("active", !isRegister);
  elements.phoneField.hidden = !isRegister;
  elements.phoneInput.required = false;
  elements.passwordInput.autocomplete = isRegister ? "new-password" : "current-password";
  elements.authTitle.textContent = isRegister ? "Создать аккаунт" : "Войти";
  elements.authHint.textContent = isRegister
    ? "Username будет уникальным и станет вашим адресом для поиска."
    : "Введите username и пароль.";
  elements.authSubmitButton.textContent = isRegister ? "Зарегистрироваться" : "Войти";
  elements.authError.textContent = "";
}

function setSession_(result) {
  session = {
    sessionToken: result.session.sessionToken,
    deviceId: result.session.deviceId,
    user: result.user
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  restoreActiveChat_();
  updateAuthenticatedUi_();
}

function clearSession_() {
  session = null;
  messages = [];
  lastSequence = 0;
  activeChat = { chatId: "general", recipientUserId: "", username: "" };
  localStorage.removeItem(SESSION_KEY);
  updateAuthenticatedUi_();
  renderChatHeader_();
  renderMessages_();
}

function updateAuthenticatedUi_() {
  const isAuthenticated = Boolean(session?.sessionToken && session?.user);
  elements.input.disabled = !isAuthenticated;
  elements.sendButton.disabled = !isAuthenticated;
  elements.profileButton.disabled = !isAuthenticated;
  elements.searchButton.disabled = !isAuthenticated;
  elements.profileButton.textContent = isAuthenticated
    ? session.user.username.slice(0, 1).toUpperCase()
    : "?";
  elements.status.textContent = isAuthenticated
    ? `${transport.label} · @${session.user.username}`
    : transport.label;
}

function renderChatHeader_() {
  const isDirect = Boolean(activeChat.recipientUserId);
  elements.chatName.textContent = isDirect ? `@${activeChat.username || "личный чат"}` : "Общий чат";
  elements.chatSubtitle.textContent = isDirect
    ? "личная переписка · push включается в профиле"
    : "общий канал · без push · обновление каждые 5 секунд";
  elements.generalChatButton.hidden = !isDirect;
}

function renderMessages_() {
  if (!session) {
    elements.messages.innerHTML = '<p class="empty">Войдите или зарегистрируйтесь.</p>';
    return;
  }
  if (!messages.length) {
    elements.messages.innerHTML = '<p class="empty">Пока сообщений нет.<br>Напишите первое.</p>';
    return;
  }

  elements.messages.innerHTML = messages.map((message) => {
    const mine = message.senderUserId === session.user.userId;
    const time = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" })
      .format(new Date(message.createdAt));
    return `
      <article class="message${mine ? " mine" : ""}">
        <div class="message-meta">
          <strong>@${escapeHtml_(message.senderUsername || "user")}</strong>
          <time datetime="${escapeHtml_(message.createdAt)}">${time}</time>
        </div>
        <div class="message-text">${escapeHtml_(messageContentText_(message))}</div>
      </article>`;
  }).join("");
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function messageContentText_(message) {
  if (message.messageType === "photo") return `Фото${message.content?.caption ? ` — ${message.content.caption}` : ""}`;
  if (message.messageType === "video") return `Видео${message.content?.caption ? ` — ${message.content.caption}` : ""}`;
  return String(message.content?.text || "");
}

async function syncMessages_() {
  if (!session) return;
  try {
    const result = await authenticatedCall_("sync", {
      chatId: activeChat.chatId,
      afterSeq: lastSequence,
      limit: 100
    });
    if (result.messages?.length) {
      messages.push(...result.messages);
      if (activeChat.recipientUserId && !activeChat.username) {
        const peerMessage = messages.find((message) => message.senderUserId === activeChat.recipientUserId);
        if (peerMessage?.senderUsername) {
          activeChat.username = peerMessage.senderUsername;
          saveActiveChat_();
          renderChatHeader_();
        }
      }
    }
    lastSequence = Math.max(lastSequence, Number(result.cursor || 0));
    renderMessages_();
  } catch (error) {
    if (error.code === "INVALID_SESSION" || error.code === "AUTH_REQUIRED") {
      clearSession_();
      showAuthDialog_();
      return;
    }
    elements.status.textContent = "Нет соединения";
    console.error(error);
  }
}

async function selectChat_(chat) {
  activeChat = chat;
  messages = [];
  lastSequence = 0;
  saveActiveChat_();
  renderChatHeader_();
  renderMessages_();
  await syncMessages_();
}

function saveActiveChat_() {
  localStorage.setItem(ACTIVE_CHAT_KEY, JSON.stringify(activeChat));
  const url = new URL(window.location.href);
  if (activeChat.chatId === "general") url.searchParams.delete("chat");
  else url.searchParams.set("chat", activeChat.chatId);
  history.replaceState(null, "", url);
}

function restoreActiveChat_() {
  if (!session?.user?.userId) return;
  const queryChatId = new URL(window.location.href).searchParams.get("chat");
  const stored = loadJson_(ACTIVE_CHAT_KEY, null);
  const requested = queryChatId || stored?.chatId || "general";
  activeChat = chatFromId_(requested, queryChatId ? "" : stored?.username)
    || { chatId: "general", recipientUserId: "", username: "" };
  renderChatHeader_();
}

function chatFromId_(chatId, username = "") {
  if (chatId === "general") return { chatId: "general", recipientUserId: "", username: "" };
  const parts = String(chatId || "").split(":");
  if (parts.length !== 3 || parts[0] !== "dm" || !parts.includes(session.user.userId)) return null;
  const recipientUserId = parts[1] === session.user.userId ? parts[2] : parts[1];
  return { chatId, recipientUserId, username: String(username || "") };
}

function directChatId_(firstUserId, secondUserId) {
  return `dm:${[String(firstUserId), String(secondUserId)].sort().join(":")}`;
}

function showAuthDialog_() {
  if (!elements.authDialog.open) elements.authDialog.showModal();
}

function hasFirebaseConfig_() {
  return Boolean(
    API_URL
    && FIREBASE_CONFIG?.apiKey
    && FIREBASE_CONFIG?.projectId
    && FIREBASE_CONFIG?.messagingSenderId
    && FIREBASE_CONFIG?.appId
    && FIREBASE_VAPID_KEY
  );
}

function isIos_() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone_() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

async function ensureServiceWorker_() {
  if (!("serviceWorker" in navigator)) throw apiError_("PUSH_UNSUPPORTED", "Этот браузер не поддерживает уведомления");
  if (!serviceWorkerRegistration) {
    serviceWorkerRegistration = await navigator.serviceWorker.register("./sw.js");
  }
  return serviceWorkerRegistration;
}

async function getPushRuntime_() {
  if (pushRuntimePromise) return pushRuntimePromise;
  pushRuntimePromise = (async () => {
    if (!hasFirebaseConfig_()) throw apiError_("PUSH_NOT_CONFIGURED", "Push ещё не настроен владельцем проекта");
    const [{ initializeApp }, messagingSdk] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-messaging.js`)
    ]);
    if (!(await messagingSdk.isSupported())) {
      throw apiError_("PUSH_UNSUPPORTED", "Этот браузер не поддерживает push-уведомления");
    }
    const registration = await ensureServiceWorker_();
    const firebaseApp = initializeApp(FIREBASE_CONFIG);
    const messaging = messagingSdk.getMessaging(firebaseApp);

    messagingSdk.onRegistered(messaging, async (fid) => {
      if (!session?.sessionToken) return;
      try {
        const result = await authenticatedCall_("registerPush", { fid });
        pushRegistrationRequested = true;
        elements.pushStatus.textContent = result.configured
          ? "Уведомления включены на этом устройстве."
          : "Телефон подключён; серверный ключ Firebase ещё не добавлен.";
        refreshPushButtons_();
      } catch (error) {
        elements.pushStatus.textContent = error.message;
      }
    });

    messagingSdk.onMessage(messaging, (payload) => {
      const data = payload?.data || {};
      if (data.chatId === activeChat.chatId) {
        syncMessages_();
        return;
      }
      noticeChat = chatFromId_(data.chatId, data.senderUsername);
      elements.inAppNotice.textContent = data.senderUsername
        ? `Новое сообщение от @${data.senderUsername}`
        : "Новое сообщение";
      elements.inAppNotice.hidden = false;
    });

    return { messaging, messagingSdk, registration };
  })().catch((error) => {
    pushRuntimePromise = null;
    throw error;
  });
  return pushRuntimePromise;
}

async function registerCurrentDeviceForPush_() {
  const runtime = await getPushRuntime_();
  await runtime.messagingSdk.register(runtime.messaging, {
    vapidKey: FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: runtime.registration
  });
}

function refreshPushButtons_() {
  const supported = "Notification" in window && "serviceWorker" in navigator;
  const enabled = globalThis.Notification?.permission === "granted"
    && pushRegistrationRequested
    && localStorage.getItem(PUSH_OPT_OUT_KEY) !== "1";
  elements.pushButton.hidden = enabled;
  elements.pushDisableButton.hidden = !enabled;
  elements.pushButton.disabled = !session || !supported || !hasFirebaseConfig_();
}

async function initializePush_() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    elements.pushStatus.textContent = "Уведомления не поддерживаются этим браузером.";
    refreshPushButtons_();
    return;
  }
  if (!hasFirebaseConfig_()) {
    elements.pushStatus.textContent = API_URL
      ? "Push-код готов; осталось добавить настройки Firebase."
      : "Push станет доступен после подключения облачного сервера.";
    refreshPushButtons_();
    return;
  }
  if (isIos_() && !isStandalone_()) {
    elements.pushStatus.textContent = "На iPhone сначала добавьте сайт на экран «Домой».";
    refreshPushButtons_();
    return;
  }
  if (Notification.permission === "denied") {
    elements.pushStatus.textContent = "Уведомления запрещены в настройках устройства.";
    refreshPushButtons_();
    return;
  }
  if (localStorage.getItem(PUSH_OPT_OUT_KEY) === "1") {
    elements.pushStatus.textContent = "Уведомления выключены для этого аккаунта.";
    refreshPushButtons_();
    return;
  }
  if (Notification.permission === "granted") {
    elements.pushStatus.textContent = "Подключаем уведомления…";
    try {
      await registerCurrentDeviceForPush_();
    } catch (error) {
      elements.pushStatus.textContent = error.message;
    }
  } else {
    elements.pushStatus.textContent = "Уведомления пока выключены.";
  }
  refreshPushButtons_();
}

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.authError.textContent = "";
  elements.authSubmitButton.disabled = true;
  try {
    const result = await transport.call(authMode, {
      username: elements.usernameInput.value,
      password: elements.passwordInput.value,
      phone: authMode === "register" ? elements.phoneInput.value : "",
      deviceName: navigator.userAgentData?.platform || navigator.platform || "Браузер",
      platform: "web",
      isPrimary: true
    });
    setSession_(result);
    elements.authForm.reset();
    elements.authDialog.close();
    await syncMessages_();
    await initializePush_();
  } catch (error) {
    elements.authError.textContent = error.message;
  } finally {
    elements.authSubmitButton.disabled = false;
  }
});

elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.input.value.trim();
  if (!text || !session) return;
  if (Date.now() < nextSendAt) {
    elements.status.textContent = "Подождите одну секунду";
    return;
  }

  nextSendAt = Date.now() + SEND_INTERVAL_MS;
  elements.input.value = "";
  elements.sendButton.disabled = true;
  try {
    await authenticatedCall_("send", {
      chatId: activeChat.chatId,
      recipientUserId: activeChat.recipientUserId,
      messageType: "text",
      text
    });
    await syncMessages_();
  } catch (error) {
    elements.input.value = text;
    elements.status.textContent = error.message;
  } finally {
    const delay = Math.max(0, nextSendAt - Date.now());
    window.setTimeout(() => {
      elements.sendButton.disabled = !session;
      updateAuthenticatedUi_();
    }, delay);
  }
});

elements.profileButton.addEventListener("click", () => {
  if (!session) return;
  elements.profileUsername.textContent = `@${session.user.username}`;
  elements.profileId.textContent = `ID: ${session.user.userId}`;
  elements.profilePhoneInput.value = session.user.phone || "";
  elements.profileError.textContent = "";
  refreshPushButtons_();
  elements.profileDialog.showModal();
});

elements.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.profileError.textContent = "";
  try {
    const result = await authenticatedCall_("updatePhone", { phone: elements.profilePhoneInput.value });
    session.user = result.user;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    elements.profileDialog.close();
  } catch (error) {
    elements.profileError.textContent = error.message;
  }
});

elements.pushButton.addEventListener("click", async () => {
  elements.pushButton.disabled = true;
  try {
    if (isIos_() && !isStandalone_()) {
      throw apiError_("IOS_INSTALL_REQUIRED", "На iPhone: Поделиться → На экран «Домой», затем откройте приложение со значка.");
    }
    if (!("Notification" in window)) {
      throw apiError_("PUSH_UNSUPPORTED", "Этот браузер не поддерживает уведомления");
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw apiError_("PUSH_DENIED", "Разрешение на уведомления не выдано");
    localStorage.removeItem(PUSH_OPT_OUT_KEY);
    elements.pushStatus.textContent = "Подключаем уведомления…";
    await registerCurrentDeviceForPush_();
  } catch (error) {
    elements.pushStatus.textContent = error.message;
  } finally {
    refreshPushButtons_();
  }
});

elements.pushDisableButton.addEventListener("click", async () => {
  elements.pushDisableButton.disabled = true;
  try {
    await authenticatedCall_("disablePush");
    localStorage.setItem(PUSH_OPT_OUT_KEY, "1");
    pushRegistrationRequested = false;
    elements.pushStatus.textContent = "Уведомления выключены для этого аккаунта.";
  } catch (error) {
    elements.pushStatus.textContent = error.message;
  } finally {
    elements.pushDisableButton.disabled = false;
    refreshPushButtons_();
  }
});

elements.logoutButton.addEventListener("click", async () => {
  try {
    await authenticatedCall_("logout");
  } catch (error) {
    console.error(error);
  }
  elements.profileDialog.close();
  clearSession_();
  showAuthDialog_();
});

elements.searchButton.addEventListener("click", () => {
  elements.searchInput.value = "";
  elements.searchResults.textContent = "";
  elements.searchDialog.showModal();
});

elements.searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.searchResults.textContent = "Поиск…";
  try {
    const result = await authenticatedCall_("searchUsers", { query: elements.searchInput.value });
    elements.searchResults.textContent = "";
    if (!result.users.length) {
      elements.searchResults.textContent = "Никого не найдено";
      return;
    }
    result.users.forEach((user) => {
      const item = document.createElement("button");
      item.className = "search-result";
      item.type = "button";
      item.textContent = `@${user.username}`;
      item.addEventListener("click", async () => {
        elements.searchDialog.close();
        await selectChat_({
          chatId: directChatId_(session.user.userId, user.userId),
          recipientUserId: user.userId,
          username: user.username
        });
      });
      elements.searchResults.append(item);
    });
  } catch (error) {
    elements.searchResults.textContent = error.message;
  }
});

elements.generalChatButton.addEventListener("click", () => {
  selectChat_({ chatId: "general", recipientUserId: "", username: "" });
});

elements.inAppNotice.addEventListener("click", () => {
  elements.inAppNotice.hidden = true;
  if (noticeChat) selectChat_(noticeChat);
  noticeChat = null;
});

elements.registerModeButton.addEventListener("click", () => setAuthMode_("register"));
elements.loginModeButton.addEventListener("click", () => setAuthMode_("login"));
elements.authDialog.addEventListener("cancel", (event) => {
  if (!session) event.preventDefault();
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.close}`).close());
});

function validateUsername_(value) {
  const username = String(value || "").trim().normalize("NFKC");
  if (!USERNAME_PATTERN.test(username)) {
    throw apiError_("INVALID_USERNAME", "Username: 3–32 символа, только буквы, цифры, точка и подчёркивание");
  }
  return username;
}

function normalizeUsername_(value) {
  return String(value || "").trim().normalize("NFKC").toLocaleLowerCase("ru-RU");
}

function validatePassword_(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 128) {
    throw apiError_("INVALID_PASSWORD", "Пароль должен содержать от 8 до 128 символов");
  }
  return password;
}

function validatePhone_(value) {
  const phone = String(value || "").trim();
  if (phone.length > 32 || (phone && !/^[+\d()\s-]+$/.test(phone))) {
    throw apiError_("INVALID_PHONE", "Некорректный номер телефона");
  }
  return phone;
}

function publicUser_(user) {
  return { userId: user.userId, username: user.username, phone: user.phone || "" };
}

function apiError_(code = "ERROR", message = "Ошибка") {
  const error = new Error(message || "Ошибка");
  error.code = code;
  return error;
}

function compactUuid_() {
  return crypto.randomUUID().replaceAll("-", "");
}

async function sha256_(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function loadJson_(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function escapeHtml_(value) {
  const node = document.createElement("div");
  node.textContent = String(value || "");
  return node.innerHTML;
}

async function initialize_() {
  setAuthMode_("register");
  updateAuthenticatedUi_();
  renderChatHeader_();
  renderMessages_();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => ensureServiceWorker_().catch(console.error));
  }

  if (session?.sessionToken) {
    try {
      const result = await authenticatedCall_("me");
      session.user = result.user;
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      restoreActiveChat_();
      updateAuthenticatedUi_();
      await syncMessages_();
      await initializePush_();
    } catch (error) {
      clearSession_();
      showAuthDialog_();
    }
  } else {
    showAuthDialog_();
  }

  window.setInterval(syncMessages_, POLL_INTERVAL_MS);
}

initialize_();

