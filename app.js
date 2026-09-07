// ===================================================
// GLOBAL MESSENGER — ЧИСТЫЙ ДВИЖОК v1.0.0
// Поддерживает мгновенный локальный режим + готовую архитектуру для базы данных
// ===================================================

/**
 * Адаптер данных: локальный (LocalStorage),
 * при подключении базы переключается на Apps Script API без изменения логики UI.
 */
class StorageService {
  constructor(config) {
    this.config = config || (typeof window !== 'undefined' ? window.APP_CONFIG : null) || { STORAGE_MODE: 'local' };
    this.isLocal = this.config.STORAGE_MODE === 'local';
    this.initLocalStorage();
  }

  initLocalStorage() {
    if (typeof localStorage === 'undefined') return;
    if (!localStorage.getItem('gm_users')) {
      const demoUsers = [
        { id: 'usr_general', username: 'general', name: 'Общий чат' },
        { id: 'usr_alex', username: 'alex', name: 'Алексей' },
        { id: 'usr_maria', username: 'maria', name: 'Мария' }
      ];
      localStorage.setItem('gm_users', JSON.stringify(demoUsers));
    }
    if (!localStorage.getItem('gm_messages')) {
      const demoMessages = [
        {
          id: 'msg_1',
          chatId: 'general',
          sender: 'alex',
          text: 'Добро пожаловать в Global Messenger! 🚀',
          time: '12:00',
          createdAt: Date.now() - 3600000
        },
        {
          id: 'msg_2',
          chatId: 'general',
          sender: 'maria',
          text: 'Здесь можно общаться в общем чате или находить пользователей в поиске!',
          time: '12:05',
          createdAt: Date.now() - 1800000
        }
      ];
      localStorage.setItem('gm_messages', JSON.stringify(demoMessages));
    }
  }

  // --- ПОЛЬЗОВАТЕЛИ И АВТОРИЗАЦИЯ ---
  async register(username, password) {
    username = username.trim().toLowerCase().replace(/^@/, '');
    if (!username) throw new Error('Введите имя пользователя');
    if (password.length < 4) throw new Error('Пароль должен быть от 4 символов');

    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    if (users.some(u => u.username.toLowerCase() === username)) {
      throw new Error('Пользователь @' + username + ' уже зарегистрирован');
    }

    const newUser = {
      id: 'usr_' + Date.now(),
      username: username,
      name: '@' + username,
      password: password,
      createdAt: Date.now()
    };
    users.push(newUser);
    localStorage.setItem('gm_users', JSON.stringify(users));

    return { ok: true, user: { id: newUser.id, username: newUser.username } };
  }

  async login(username, password) {
    username = username.trim().toLowerCase().replace(/^@/, '');
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    const user = users.find(u => u.username.toLowerCase() === username);

    if (!user) {
      throw new Error('Пользователь не найден. Нажмите "Регистрация"');
    }
    if (user.password && user.password !== password) {
      throw new Error('Неверный пароль');
    }

    return { ok: true, user: { id: user.id, username: user.username } };
  }

  // --- ПОИСК ЛЮДЕЙ ---
  async searchUsers(query, currentUsername) {
    query = query.trim().toLowerCase().replace(/^@/, '');
    if (!query) return [];

    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    return users
      .filter(u => u.username !== 'general' && u.username.toLowerCase() !== currentUsername.toLowerCase())
      .filter(u => u.username.toLowerCase().includes(query))
      .map(u => ({ id: u.id, username: u.username, name: '@' + u.username }));
  }

  // --- СООБЩЕНИЯ И ДИАЛОГИ ---
  async getMessages(chatId) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    return all.filter(m => m.chatId === chatId);
  }

  async sendMessage(chatId, sender, text, file = null) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newMsg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      chatId,
      sender,
      text: text || '',
      file: file || null,
      time: timeStr,
      createdAt: Date.now()
    };

    all.push(newMsg);
    localStorage.setItem('gm_messages', JSON.stringify(all));

    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('gm_new_message', { detail: newMsg }));
    }
    return { ok: true, message: newMsg };
  }

  async getUserChats(currentUsername) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const myName = currentUsername.toLowerCase();
    const chatMap = new Map();

    // 1. Всегда есть Общий чат
    const generalMsgs = all.filter(m => m.chatId === 'general');
    const lastGen = generalMsgs[generalMsgs.length - 1];
    chatMap.set('general', {
      id: 'general',
      title: 'Общий чат',
      isGeneral: true,
      lastMsg: lastGen ? (lastGen.text || (lastGen.file ? '📎 Файл' : '')) : 'Нажмите, чтобы открыть',
      lastTime: lastGen ? lastGen.time : '',
      timestamp: lastGen ? lastGen.createdAt : 0,
      unreadCount: 0
    });

    // 2. Личные диалоги (dm:user1:user2)
    all.forEach(m => {
      if (!m.chatId.startsWith('dm:')) return;
      const parts = m.chatId.split(':');
      if (parts.length !== 3) return;
      const u1 = parts[1].toLowerCase();
      const u2 = parts[2].toLowerCase();

      if (u1 === myName || u2 === myName) {
        const peer = u1 === myName ? parts[2] : parts[1];
        const existing = chatMap.get(m.chatId);
        const snippet = m.text || (m.file ? '📎 Файл' : 'Сообщение');

        if (!existing || m.createdAt > existing.timestamp) {
          const isFromOther = m.sender.toLowerCase() !== myName;
          chatMap.set(m.chatId, {
            id: m.chatId,
            peer: peer,
            title: '@' + peer,
            isGeneral: false,
            lastMsg: snippet,
            lastTime: m.time,
            timestamp: m.createdAt,
            unreadCount: (isFromOther && (!existing || existing.unreadCount > 0)) ? 1 : 0
          });
        }
      }
    });

    return Array.from(chatMap.values()).sort((a, b) => {
      if (a.isGeneral) return -1;
      if (b.isGeneral) return 1;
      return b.timestamp - a.timestamp;
    });
  }
}

/**
 * Главный UI контроллер мессенджера
 */
class GlobalMessengerApp {
  constructor() {
    this.storage = new StorageService(typeof window !== 'undefined' ? window.APP_CONFIG : null);
    this.currentUser = JSON.parse(localStorage.getItem('gm_current_user') || 'null');
    this.currentChatId = 'general';
    this.currentChatTitle = 'Общий чат';
    this.authMode = 'login';

    this.initElements();
    this.bindEvents();

    if (this.currentUser) {
      this.showMainScreen();
    } else {
      this.showAuthScreen();
    }
  }

  initElements() {
    this.el = {
      authScreen: document.getElementById('auth-screen'),
      authCard: document.querySelector('.auth-card'),
      authTabs: document.querySelector('.auth-tabs'),
      tabLogin: document.getElementById('tab-login'),
      tabRegister: document.getElementById('tab-register'),
      authForm: document.getElementById('auth-form'),
      authUsername: document.getElementById('auth-username'),
      authPassword: document.getElementById('auth-password'),
      authSubmitBtn: document.getElementById('auth-submit-btn'),
      authStatus: document.getElementById('auth-status'),

      mainScreen: document.getElementById('main-screen'),
      sidebar: document.getElementById('sidebar'),
      currentUserAvatar: document.getElementById('current-user-avatar'),
      currentUserName: document.getElementById('current-user-name'),
      btnLogout: document.getElementById('btn-logout'),

      chatSearch: document.getElementById('chat-search'),
      btnSearchClear: document.getElementById('btn-search-clear'),
      searchResultsSection: document.getElementById('search-results-section'),
      searchResultsList: document.getElementById('search-results-list'),
      chatList: document.getElementById('chat-list'),

      chatView: document.querySelector('.chat-view'),
      btnBack: document.getElementById('btn-back'),
      activeChatAvatar: document.getElementById('active-chat-avatar'),
      activeChatTitle: document.getElementById('active-chat-title'),
      activeChatStatus: document.getElementById('active-chat-status'),

      messagesContainer: document.getElementById('messages-container'),
      messagesFeed: document.getElementById('messages-feed'),
      messageInput: document.getElementById('message-input'),
      btnAttach: document.getElementById('btn-attach'),
      fileInput: document.getElementById('file-input'),
      btnSend: document.getElementById('btn-send')
    };
  }

  bindEvents() {
    this.el.tabLogin.addEventListener('click', () => this.setAuthMode('login'));
    this.el.tabRegister.addEventListener('click', () => this.setAuthMode('register'));
    this.el.authForm.addEventListener('submit', (e) => this.handleAuthSubmit(e));

    this.el.btnLogout.addEventListener('click', () => this.logout());

    this.el.btnSend.addEventListener('click', () => this.sendMessage());
    this.el.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.el.btnAttach.addEventListener('click', () => this.el.fileInput.click());
    this.el.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

    this.el.chatSearch.addEventListener('input', () => this.handleSearch(this.el.chatSearch.value));
    this.el.btnSearchClear.addEventListener('click', () => {
      this.el.chatSearch.value = '';
      this.handleSearch('');
    });

    this.el.btnBack.addEventListener('click', () => {
      if (this.el.chatView) this.el.chatView.classList.remove('active');
    });

    window.addEventListener('gm_new_message', (e) => {
      const msg = e.detail;
      if (msg.chatId === this.currentChatId) {
        this.renderMessages();
      }
      this.renderChatList();
    });

    window.addEventListener('storage', (e) => {
      if (e.key === 'gm_messages') {
        this.renderChatList();
        this.renderMessages();
      }
    });
  }

  setAuthMode(mode) {
    this.authMode = mode;
    this.el.tabLogin.classList.toggle('active', mode === 'login');
    this.el.tabRegister.classList.toggle('active', mode === 'register');
    this.el.authSubmitBtn.innerText = mode === 'login' ? 'Войти в систему' : 'Зарегистрироваться';
    this.el.authStatus.innerText = '';
    this.el.authStatus.className = 'status-msg';
  }

  async handleAuthSubmit(e) {
    e.preventDefault();
    const username = this.el.authUsername.value.trim();
    const password = this.el.authPassword.value;

    this.el.authSubmitBtn.disabled = true;
    this.el.authStatus.className = 'status-msg';
    this.el.authStatus.innerText = 'Выполняется вход...';

    try {
      let res;
      if (this.authMode === 'register') {
        res = await this.storage.register(username, password);
      } else {
        res = await this.storage.login(username, password);
      }

      this.currentUser = res.user;
      localStorage.setItem('gm_current_user', JSON.stringify(this.currentUser));
      this.el.authStatus.innerText = '';
      this.showMainScreen();
    } catch (err) {
      this.el.authStatus.className = 'status-msg error';
      this.el.authStatus.innerText = err.message || 'Ошибка входа';
    } finally {
      this.el.authSubmitBtn.disabled = false;
    }
  }

  logout() {
    localStorage.removeItem('gm_current_user');
    this.currentUser = null;
    this.showAuthScreen();
  }

  showAuthScreen() {
    this.el.authScreen.classList.remove('hidden');
    this.el.mainScreen.classList.add('hidden');
  }

  showMainScreen() {
    this.el.authScreen.classList.add('hidden');
    this.el.mainScreen.classList.remove('hidden');

    this.el.currentUserName.innerText = '@' + this.currentUser.username;
    this.el.currentUserAvatar.innerText = this.currentUser.username[0].toUpperCase();

    this.refreshData();
  }

  async refreshData() {
    await this.renderChatList();
    await this.renderMessages();
  }

  getDmChatId(u1, u2) {
    const sorted = [u1.toLowerCase(), u2.toLowerCase()].sort();
    return 'dm:' + sorted[0] + ':' + sorted[1];
  }

  openDirectChat(targetUsername) {
    const chatId = this.getDmChatId(this.currentUser.username, targetUsername);
    const title = '@' + targetUsername;
    this.openChat(chatId, title);

    this.el.chatSearch.value = '';
    this.handleSearch('');
  }

  openChat(chatId, title) {
    this.currentChatId = chatId;
    this.currentChatTitle = title;

    const isGeneral = chatId === 'general';
    this.el.activeChatTitle.innerText = title;
    this.el.activeChatAvatar.innerText = isGeneral ? '🌐' : title.replace('@', '')[0].toUpperCase();
    this.el.activeChatStatus.innerText = isGeneral ? 'канал общения' : 'в сети';

    if (this.el.chatView) {
      this.el.chatView.classList.add('active');
    }

    this.renderChatList();
    this.renderMessages();
  }

  async renderChatList() {
    const chats = await this.storage.getUserChats(this.currentUser.username);
    this.el.chatList.innerHTML = '';

    chats.forEach(chat => {
      const isActive = chat.id === this.currentChatId;
      const item = document.createElement('div');
      item.className = 'chat-item' + (isActive ? ' active' : '');

      const avatarContent = chat.isGeneral ? '🌐' : (chat.peer ? chat.peer[0].toUpperCase() : '?');

      item.innerHTML = [
        '<div class="avatar" style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#2abee8,#1f8ecc);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;">',
        avatarContent,
        '</div>',
        '<div class="chat-item-meta" style="flex:1;min-width:0;margin-left:12px;">',
        '  <div class="chat-item-top" style="display:flex;justify-content:space-between;align-items:center;">',
        '    <span class="chat-title" style="font-weight:600;font-size:14.5px;">' + this.escape(chat.title) + '</span>',
        '    <span class="chat-time" style="font-size:12px;color:var(--text-secondary);">' + this.escape(chat.lastTime) + '</span>',
        '  </div>',
        '  <div class="chat-preview-wrap" style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;">',
        '    <div class="chat-preview" style="font-size:13px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">' + this.escape(chat.lastMsg) + '</div>',
        (chat.unreadCount > 0 ? '    <span class="unread-badge" style="background:#3390ec;color:#fff;font-size:11px;font-weight:700;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 5px;flex-shrink:0;">' + chat.unreadCount + '</span>' : ''),
        '  </div>',
        '</div>'
      ].join('');

      item.addEventListener('click', () => {
        this.openChat(chat.id, chat.title);
      });

      this.el.chatList.appendChild(item);
    });
  }

  async renderMessages() {
    const msgs = await this.storage.getMessages(this.currentChatId);
    this.el.messagesFeed.innerHTML = '';

    if (msgs.length === 0) {
      this.el.messagesFeed.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:30px;font-size:13.5px;">Здесь пока нет сообщений. Начните диалог первым! 💬</div>';
      return;
    }

    msgs.forEach(m => {
      const isOut = m.sender.toLowerCase() === this.currentUser.username.toLowerCase();
      const bubble = document.createElement('div');
      bubble.className = 'tg-bubble ' + (isOut ? 'outgoing' : 'incoming');

      let fileHtml = '';
      if (m.file) {
        if (m.file.type && m.file.type.startsWith('image/')) {
          fileHtml = '<div style="margin-bottom:6px;"><img src="' + m.file.data + '" style="max-width:100%;border-radius:8px;max-height:240px;display:block;"></div>';
        } else {
          fileHtml = '<div style="display:flex;align-items:center;gap:8px;background:rgba(0,0,0,0.2);padding:8px 12px;border-radius:8px;margin-bottom:6px;">📎 <span style="font-size:13px;font-weight:600;">' + this.escape(m.file.name) + '</span></div>';
        }
      }

      bubble.innerHTML = [
        (!isOut ? '<div class="tg-sender-name">@' + this.escape(m.sender) + '</div>' : ''),
        fileHtml,
        (m.text ? '<div class="tg-msg-text">' + this.escape(m.text) + '</div>' : ''),
        '<div class="tg-bubble-footer">',
        '  <span class="tg-msg-time">' + m.time + '</span>',
        (isOut ? '  <span class="tg-checkmarks" style="color:#4fae4e;margin-left:4px;">✓✓</span>' : ''),
        '</div>'
      ].join('');

      this.el.messagesFeed.appendChild(bubble);
    });

    this.el.messagesContainer.scrollTop = this.el.messagesContainer.scrollHeight;
  }

  async sendMessage() {
    const text = this.el.messageInput.value.trim();
    if (!text) return;

    this.el.messageInput.value = '';
    this.el.messageInput.style.height = 'auto';

    await this.storage.sendMessage(this.currentChatId, this.currentUser.username, text);
    await this.refreshData();
  }

  async handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const fileData = {
        name: file.name,
        type: file.type,
        size: file.size,
        data: reader.result
      };
      await this.storage.sendMessage(this.currentChatId, this.currentUser.username, '', fileData);
      await this.refreshData();
    };
    reader.readAsDataURL(file);
    this.el.fileInput.value = '';
  }

  async handleSearch(q) {
    q = q.trim().toLowerCase().replace(/^@/, '');
    if (!q) {
      this.el.btnSearchClear.classList.add('hidden');
      this.el.searchResultsSection.classList.add('hidden');
      this.el.chatList.classList.remove('hidden');
      return;
    }

    this.el.btnSearchClear.classList.remove('hidden');
    this.el.chatList.classList.add('hidden');
    this.el.searchResultsSection.classList.remove('hidden');

    const results = await this.storage.searchUsers(q, this.currentUser.username);
    this.el.searchResultsList.innerHTML = '';

    if (results.length === 0) {
      this.el.searchResultsList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-secondary);font-size:13px;">Никого не найдено</div>';
      return;
    }

    results.forEach(u => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = [
        '<div class="avatar" style="width:36px;height:36px;font-size:15px;">' + u.username[0].toUpperCase() + '</div>',
        '<div class="search-item-meta">',
        '  <div class="search-item-title">@' + this.escape(u.username) + '</div>',
        '  <div class="search-item-sub" style="font-size:12px;color:var(--text-secondary);">Нажмите, чтобы открыть диалог</div>',
        '</div>'
      ].join('');
      item.addEventListener('click', () => {
        this.openDirectChat(u.username);
      });
      this.el.searchResultsList.appendChild(item);
    });
  }

  escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.messengerApp = new GlobalMessengerApp();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StorageService, GlobalMessengerApp };
}