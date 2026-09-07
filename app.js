// ===================================================
// TELEGRAM WEB — POLISHED ENGINE & UI CONTROLLER v2.0.0
// ===================================================

/**
 * Сервис хранения: локальный режим + готовые интерфейсы
 */
class StorageService {
  constructor(config) {
    this.config = config || (typeof window !== 'undefined' ? window.APP_CONFIG : null) || { STORAGE_MODE: 'local' };
    this.initLocalStorage();
  }

  initLocalStorage() {
    if (typeof localStorage === 'undefined') return;
    if (!localStorage.getItem('gm_users')) {
      const demoUsers = [
        { id: 'usr_general', username: 'general', name: 'Общий чат' },
        { id: 'usr_durov', username: 'durov', name: 'Павел Дуров' },
        { id: 'usr_maria', username: 'maria', name: 'Мария' }
      ];
      localStorage.setItem('gm_users', JSON.stringify(demoUsers));
    }
    if (!localStorage.getItem('gm_messages')) {
      const demoMessages = [
        {
          id: 'msg_1',
          chatId: 'general',
          sender: 'durov',
          text: 'Добро пожаловать в Telegram Web! Скорость, простота и приватность.',
          time: '12:00',
          createdAt: Date.now() - 3600000
        },
        {
          id: 'msg_2',
          chatId: 'general',
          sender: 'maria',
          text: 'Интерфейс выглядит великолепно! Можно общаться и отправлять фото 🚀',
          time: '12:05',
          createdAt: Date.now() - 1800000
        }
      ];
      localStorage.setItem('gm_messages', JSON.stringify(demoMessages));
    }
  }

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
      throw new Error('Пользователь не найден. Выберите "Регистрация"');
    }
    if (user.password && user.password !== password) {
      throw new Error('Неверный пароль');
    }

    return { ok: true, user: { id: user.id, username: user.username } };
  }

  async searchUsers(query, currentUsername) {
    query = query.trim().toLowerCase().replace(/^@/, '');
    if (!query) return [];

    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    return users
      .filter(u => u.username !== 'general' && u.username.toLowerCase() !== currentUsername.toLowerCase())
      .filter(u => u.username.toLowerCase().includes(query))
      .map(u => ({ id: u.id, username: u.username, name: '@' + u.username }));
  }

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
      window.dispatchEvent(new CustomEvent('tg_new_message', { detail: newMsg }));
    }
    return { ok: true, message: newMsg };
  }

  async getUserChats(currentUsername) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const myName = currentUsername.toLowerCase();
    const chatMap = new Map();

    const generalMsgs = all.filter(m => m.chatId === 'general');
    const lastGen = generalMsgs[generalMsgs.length - 1];
    chatMap.set('general', {
      id: 'general',
      title: 'Общий чат',
      isGeneral: true,
      lastMsg: lastGen ? (lastGen.text || (lastGen.file ? '📎 Фото/Файл' : '')) : 'Нажмите, чтобы открыть',
      lastTime: lastGen ? lastGen.time : '',
      timestamp: lastGen ? lastGen.createdAt : 0,
      unreadCount: 0
    });

    all.forEach(m => {
      if (!m.chatId.startsWith('dm:')) return;
      const parts = m.chatId.split(':');
      if (parts.length !== 3) return;
      const u1 = parts[1].toLowerCase();
      const u2 = parts[2].toLowerCase();

      if (u1 === myName || u2 === myName) {
        const peer = u1 === myName ? parts[2] : parts[1];
        const existing = chatMap.get(m.chatId);
        const snippet = m.text || (m.file ? '📎 Фото/Файл' : 'Сообщение');

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
 * Контроллер Telegram Web UI
 */
class TelegramApp {
  constructor() {
    this.storage = new StorageService(typeof window !== 'undefined' ? window.APP_CONFIG : null);
    this.currentUser = JSON.parse(localStorage.getItem('gm_current_user') || 'null');
    this.currentChatId = 'general';
    this.currentChatTitle = 'Общий чат';
    this.activeFolder = 'all'; // 'all' | 'dm' | 'channels'
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
      tabLogin: document.getElementById('tab-login'),
      tabRegister: document.getElementById('tab-register'),
      authForm: document.getElementById('auth-form'),
      authUsername: document.getElementById('auth-username'),
      authPassword: document.getElementById('auth-password'),
      authSubmitBtn: document.getElementById('auth-submit-btn'),
      authStatus: document.getElementById('auth-status'),

      mainScreen: document.getElementById('main-screen'),
      sidebar: document.getElementById('sidebar'),
      btnSidebarMenu: document.getElementById('btn-sidebar-menu'),
      menuDropdown: document.getElementById('tg-menu-dropdown'),
      currentUserAvatar: document.getElementById('current-user-avatar'),
      currentUserName: document.getElementById('current-user-name'),
      btnMenuLogout: document.getElementById('btn-menu-logout'),

      chatSearch: document.getElementById('chat-search'),
      btnSearchClear: document.getElementById('btn-search-clear'),
      searchResultsSection: document.getElementById('search-results-section'),
      searchResultsList: document.getElementById('search-results-list'),
      foldersBar: document.getElementById('folders-bar'),
      chatList: document.getElementById('chat-list'),

      chatView: document.querySelector('.tg-chat-view'),
      btnBack: document.getElementById('btn-back'),
      activeChatAvatar: document.getElementById('active-chat-avatar'),
      activeChatTitle: document.getElementById('active-chat-title'),
      activeChatStatus: document.getElementById('active-chat-status'),

      messagesContainer: document.getElementById('messages-container'),
      messagesFeed: document.getElementById('messages-feed'),
      messageInput: document.getElementById('message-input'),
      btnAttach: document.getElementById('btn-attach'),
      fileInput: document.getElementById('file-input'),
      btnSend: document.getElementById('btn-send'),

      lightboxModal: document.getElementById('lightbox-modal'),
      lightboxBackdrop: document.getElementById('lightbox-backdrop'),
      lightboxClose: document.getElementById('lightbox-close'),
      lightboxImg: document.getElementById('lightbox-img'),
      lightboxFilename: document.getElementById('lightbox-filename'),
      lightboxDownload: document.getElementById('lightbox-download')
    };
  }

  bindEvents() {
    // Вкладки авторизации
    this.el.tabLogin.addEventListener('click', () => this.setAuthMode('login'));
    this.el.tabRegister.addEventListener('click', () => this.setAuthMode('register'));
    this.el.authForm.addEventListener('submit', (e) => this.handleAuthSubmit(e));

    // Меню и выход
    this.el.btnSidebarMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.menuDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!this.el.menuDropdown.contains(e.target) && e.target !== this.el.btnSidebarMenu) {
        this.el.menuDropdown.classList.add('hidden');
      }
    });

    this.el.btnMenuLogout.addEventListener('click', () => this.logout());

    // Папки чатов
    this.el.foldersBar.querySelectorAll('.tg-folder-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.el.foldersBar.querySelectorAll('.tg-folder-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeFolder = tab.getAttribute('data-folder');
        this.renderChatList();
      });
    });

    // Отправка сообщений
    this.el.btnSend.addEventListener('click', () => this.sendMessage());
    this.el.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Автоподстройка высоты текстового поля
    this.el.messageInput.addEventListener('input', () => {
      this.el.messageInput.style.height = 'auto';
      this.el.messageInput.style.height = Math.min(this.el.messageInput.scrollHeight, 120) + 'px';
    });

    // Вставка файлов через кнопку
    this.el.btnAttach.addEventListener('click', () => this.el.fileInput.click());
    this.el.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

    // Вставка изображений из буфера обмена (Ctrl+V)
    document.addEventListener('paste', (e) => {
      if (e.clipboardData && e.clipboardData.items) {
        for (let item of e.clipboardData.items) {
          if (item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            this.uploadBlob(blob, 'pasted_image.png');
            break;
          }
        }
      }
    });

    // Поиск
    this.el.chatSearch.addEventListener('input', () => this.handleSearch(this.el.chatSearch.value));
    this.el.btnSearchClear.addEventListener('click', () => {
      this.el.chatSearch.value = '';
      this.handleSearch('');
    });

    // Мобильная кнопка Назад
    this.el.btnBack.addEventListener('click', () => {
      if (this.el.chatView) this.el.chatView.classList.remove('active');
    });

    // Лайтбокс для картинок
    this.el.lightboxClose.addEventListener('click', () => this.closeLightbox());
    this.el.lightboxBackdrop.addEventListener('click', () => this.closeLightbox());

    // Слушатели событий
    window.addEventListener('tg_new_message', (e) => {
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
    this.el.authSubmitBtn.querySelector('span').innerText = mode === 'login' ? 'Продолжить' : 'Зарегистрироваться';
    this.el.authStatus.innerText = '';
    this.el.authStatus.className = 'tg-status-msg';
  }

  async handleAuthSubmit(e) {
    e.preventDefault();
    const username = this.el.authUsername.value.trim();
    const password = this.el.authPassword.value;

    this.el.authSubmitBtn.disabled = true;
    this.el.authStatus.className = 'tg-status-msg';
    this.el.authStatus.innerText = 'Подключение к Telegram...';

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
      this.el.authStatus.className = 'tg-status-msg error';
      this.el.authStatus.innerText = err.message || 'Ошибка входа';
    } finally {
      this.el.authSubmitBtn.disabled = false;
    }
  }

  logout() {
    localStorage.removeItem('gm_current_user');
    this.currentUser = null;
    this.el.menuDropdown.classList.add('hidden');
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
    let chats = await this.storage.getUserChats(this.currentUser.username);

    // Фильтрация по папкам
    if (this.activeFolder === 'dm') {
      chats = chats.filter(c => !c.isGeneral);
    } else if (this.activeFolder === 'channels') {
      chats = chats.filter(c => c.isGeneral);
    }

    this.el.chatList.innerHTML = '';

    chats.forEach(chat => {
      const isActive = chat.id === this.currentChatId;
      const item = document.createElement('div');
      item.className = 'tg-chat-item' + (isActive ? ' active' : '');

      const avatarClass = chat.isGeneral ? 'tg-avatar-general' : 'tg-avatar-user';
      const avatarContent = chat.isGeneral ? '🌐' : (chat.peer ? chat.peer[0].toUpperCase() : '?');

      item.innerHTML = [
        '<div class="tg-avatar ' + avatarClass + '">',
        avatarContent,
        '</div>',
        '<div class="tg-chat-body">',
        '  <div class="tg-chat-top">',
        '    <span class="tg-chat-name">' + this.escape(chat.title) + '</span>',
        '    <span class="tg-chat-date">' + this.escape(chat.lastTime) + '</span>',
        '  </div>',
        '  <div class="tg-chat-bottom">',
        '    <div class="tg-chat-snippet">' + this.escape(chat.lastMsg) + '</div>',
        (chat.unreadCount > 0 ? '    <span class="tg-unread-badge">' + chat.unreadCount + '</span>' : ''),
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
      this.el.messagesFeed.innerHTML = '<div style="text-align:center;color:var(--tg-text-sub);padding:40px;font-size:14px;">Пока нет сообщений... Напишите первым! 💬</div>';
      return;
    }

    msgs.forEach(m => {
      const isOut = m.sender.toLowerCase() === this.currentUser.username.toLowerCase();
      const wrap = document.createElement('div');
      wrap.className = 'tg-bubble-wrap ' + (isOut ? 'out' : 'in');

      let fileHtml = '';
      if (m.file) {
        if (m.file.type && m.file.type.startsWith('image/')) {
          fileHtml = '<img class="tg-media-photo" src="' + m.file.data + '" alt="Photo" data-name="' + this.escape(m.file.name) + '">';
        } else {
          fileHtml = [
            '<div class="tg-file-card">',
            '  <div class="tg-file-icon">📄</div>',
            '  <div class="tg-file-meta">',
            '    <div class="tg-file-name">' + this.escape(m.file.name) + '</div>',
            '    <div class="tg-file-size">' + this.formatSize(m.file.size) + '</div>',
            '  </div>',
            '</div>'
          ].join('');
        }
      }

      wrap.innerHTML = [
        '<div class="tg-msg-bubble">',
        (!isOut ? '  <div class="tg-sender-heading">@' + this.escape(m.sender) + '</div>' : ''),
        fileHtml,
        (m.text ? '  <span class="tg-msg-content">' + this.escape(m.text) + '</span>' : ''),
        '  <div class="tg-msg-meta">',
        '    <span>' + m.time + '</span>',
        (isOut ? '    <span class="tg-checks">✓✓</span>' : ''),
        '  </div>',
        '</div>'
      ].join('');

      // Клик по картинке для открытия лайтбокса
      const imgEl = wrap.querySelector('.tg-media-photo');
      if (imgEl) {
        imgEl.addEventListener('click', () => {
          this.openLightbox(imgEl.src, imgEl.getAttribute('data-name') || 'photo.png');
        });
      }

      this.el.messagesFeed.appendChild(wrap);
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
    this.uploadBlob(file, file.name);
    this.el.fileInput.value = '';
  }

  uploadBlob(blob, filename) {
    const reader = new FileReader();
    reader.onload = async () => {
      const fileData = {
        name: filename,
        type: blob.type,
        size: blob.size,
        data: reader.result
      };
      await this.storage.sendMessage(this.currentChatId, this.currentUser.username, '', fileData);
      await this.refreshData();
    };
    reader.readAsDataURL(blob);
  }

  async handleSearch(q) {
    q = q.trim().toLowerCase().replace(/^@/, '');
    if (!q) {
      this.el.btnSearchClear.classList.add('hidden');
      this.el.searchResultsSection.classList.add('hidden');
      this.el.chatList.classList.remove('hidden');
      this.el.foldersBar.classList.remove('hidden');
      return;
    }

    this.el.btnSearchClear.classList.remove('hidden');
    this.el.chatList.classList.add('hidden');
    this.el.foldersBar.classList.add('hidden');
    this.el.searchResultsSection.classList.remove('hidden');

    const results = await this.storage.searchUsers(q, this.currentUser.username);
    this.el.searchResultsList.innerHTML = '';

    if (results.length === 0) {
      this.el.searchResultsList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tg-text-sub);font-size:13.5px;">Ничего не найдено</div>';
      return;
    }

    results.forEach(u => {
      const item = document.createElement('div');
      item.className = 'tg-search-item';
      item.innerHTML = [
        '<div class="tg-avatar tg-avatar-user" style="width:42px;height:42px;font-size:16px;">' + u.username[0].toUpperCase() + '</div>',
        '<div class="tg-chat-body">',
        '  <div class="tg-chat-name">@' + this.escape(u.username) + '</div>',
        '  <div class="tg-chat-snippet">Нажмите, чтобы открыть диалог</div>',
        '</div>'
      ].join('');
      item.addEventListener('click', () => {
        this.openDirectChat(u.username);
      });
      this.el.searchResultsList.appendChild(item);
    });
  }

  openLightbox(src, name) {
    this.el.lightboxImg.src = src;
    this.el.lightboxFilename.innerText = name;
    this.el.lightboxDownload.href = src;
    this.el.lightboxDownload.setAttribute('download', name);
    this.el.lightboxModal.classList.remove('hidden');
  }

  closeLightbox() {
    this.el.lightboxModal.classList.add('hidden');
    this.el.lightboxImg.src = '';
  }

  formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
    window.telegramApp = new TelegramApp();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StorageService, TelegramApp };
}