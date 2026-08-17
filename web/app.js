const STORAGE_KEY = "sheet-messenger-demo-v1";
const PROFILE_KEY = "sheet-messenger-profile-v1";
const POLL_INTERVAL_MS = 5000;

const elements = {
  composer: document.querySelector("#composer"),
  input: document.querySelector("#messageInput"),
  messages: document.querySelector("#messages"),
  nameDialog: document.querySelector("#nameDialog"),
  nameForm: document.querySelector("#nameForm"),
  nameInput: document.querySelector("#nameInput"),
  profileButton: document.querySelector("#profileButton"),
  status: document.querySelector("#status")
};

let profile = loadProfile();
let messages = [];
let lastSequence = 0;

const transport = createTransport();

function createTransport() {
  if (window.google?.script?.run) {
    elements.status.textContent = "Google Apps Script";
    return {
      call(action, payload) {
        return new Promise((resolve, reject) => {
          window.google.script.run
            .withSuccessHandler(resolve)
            .withFailureHandler(reject)
            .api(action, payload);
        });
      }
    };
  }

  elements.status.textContent = "Локальный режим";
  return {
    async call(action, payload = {}) {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

      if (action === "send") {
        const message = {
          seq: stored.length + 1,
          id: crypto.randomUUID(),
          chatId: "general",
          userId: payload.userId,
          displayName: payload.displayName,
          text: payload.text,
          createdAt: new Date().toISOString()
        };
        stored.push(message);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        return { ok: true, message };
      }

      if (action === "sync") {
        return {
          ok: true,
          messages: stored.filter((message) => message.seq > Number(payload.afterSeq || 0))
        };
      }

      throw new Error(`Неизвестное действие: ${action}`);
    }
  };
}

function loadProfile() {
  const stored = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
  return stored || { userId: crypto.randomUUID(), displayName: "" };
}

function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  elements.profileButton.textContent = profile.displayName.slice(0, 1).toUpperCase() || "?";
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

function renderMessages() {
  if (!messages.length) {
    elements.messages.innerHTML = '<p class="empty">Пока сообщений нет.<br>Напишите первое.</p>';
    return;
  }

  elements.messages.innerHTML = messages.map((message) => {
    const mine = message.userId === profile.userId;
    const time = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" })
      .format(new Date(message.createdAt));

    return `
      <article class="message${mine ? " mine" : ""}">
        <div class="message-meta">
          <strong>${escapeHtml(message.displayName)}</strong>
          <time datetime="${message.createdAt}">${time}</time>
        </div>
        <div class="message-text">${escapeHtml(message.text)}</div>
      </article>`;
  }).join("");

  elements.messages.scrollTop = elements.messages.scrollHeight;
}

async function syncMessages() {
  try {
    const result = await transport.call("sync", { chatId: "general", afterSeq: lastSequence, limit: 100 });
    if (!result?.ok) throw new Error(result?.error || "Ошибка синхронизации");

    if (result.messages?.length) {
      messages.push(...result.messages);
      lastSequence = Math.max(lastSequence, ...result.messages.map((message) => Number(message.seq)));
      renderMessages();
    } else if (!messages.length) {
      renderMessages();
    }
  } catch (error) {
    elements.status.textContent = "Нет соединения";
    console.error(error);
  }
}

elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.input.value.trim();
  if (!text || !profile.displayName) return;

  elements.input.value = "";
  try {
    await transport.call("send", {
      chatId: "general",
      userId: profile.userId,
      displayName: profile.displayName,
      text
    });
    await syncMessages();
  } catch (error) {
    elements.input.value = text;
    elements.status.textContent = "Не отправлено";
    console.error(error);
  }
});

elements.nameForm.addEventListener("submit", () => {
  profile.displayName = elements.nameInput.value.trim();
  saveProfile();
});

elements.profileButton.addEventListener("click", () => {
  elements.nameInput.value = profile.displayName;
  elements.nameDialog.showModal();
});

if (!profile.displayName) {
  elements.nameDialog.showModal();
} else {
  saveProfile();
}

syncMessages();
setInterval(syncMessages, POLL_INTERVAL_MS);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

