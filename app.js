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

    return { ok: true, user: { id: user.id, username: user.username, bio: user.bio, avatar: user.avatar } };
  }

  async updateUserAvatar(username, avatarBase64) {
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (user) {
      user.avatar = avatarBase64;
      localStorage.setItem('gm_users', JSON.stringify(users));
      const cur = JSON.parse(localStorage.getItem('gm_current_user') || '{}');
      if (cur.username && cur.username.toLowerCase() === username.toLowerCase()) {
        cur.avatar = avatarBase64;
        localStorage.setItem('gm_current_user', JSON.stringify(cur));
      }
    }
    return { ok: true };
  }

  async toggleReaction(msgId, emoji, username) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const msg = all.find(m => m.id === msgId);
    if (!msg) return { ok: false };
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

    const idx = msg.reactions[emoji].indexOf(username);
    if (idx !== -1) {
      msg.reactions[emoji].splice(idx, 1);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    } else {
      msg.reactions[emoji].push(username);
    }

    localStorage.setItem('gm_messages', JSON.stringify(all));
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('tg_new_message', { detail: msg }));
    }
    return { ok: true, reactions: msg.reactions };
  }

  async searchUsers(query, currentUsername) {
    query = query.trim().toLowerCase().replace(/^@/, '');
    if (!query) return [];

    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    return users
      .filter(u => u.username !== 'general' && u.username.toLowerCase() !== currentUsername.toLowerCase())
      .filter(u => u.username.toLowerCase().includes(query))
      .map(u => ({ id: u.id, username: u.username, name: '@' + u.username, bio: u.bio, avatar: u.avatar }));
  }

  async getMessages(chatId) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    return all.filter(m => m.chatId === chatId);
  }

  async sendMessage(chatId, sender, text, file = null, voice = null, circleVideo = null, files = null) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newMsg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      chatId,
      sender,
      text: text || '',
      file: file || null,
      files: files || (file ? [file] : null),
      voice: voice || null,
      circleVideo: circleVideo || null,
      reactions: {},
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
        const snippet = m.voice ? '🎤 Голосовое сообщение' : (m.circleVideo ? '📹 Видеокружок' : (m.file ? (m.file.type && m.file.type.startsWith('image/') ? '📷 Фото' : '📎 ' + m.file.name) : (m.text || 'Сообщение')));

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
    this.recordMode = 'mic'; // 'mic' | 'video'

    // Media recording state
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recInterval = null;
    this.recStartTime = null;
    this.mediaStream = null;
    this.shouldSendRecorded = false;

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
      lightboxDownload: document.getElementById('lightbox-download'),

      btnModeToggle: document.getElementById('btn-mode-toggle'),
      iconModeMic: document.getElementById('icon-mode-mic'),
      iconModeVideo: document.getElementById('icon-mode-video'),

      audioRecordingPanel: document.getElementById('audio-recording-panel'),
      audioRecordTimer: document.getElementById('audio-record-timer'),
      btnCancelVoice: document.getElementById('btn-cancel-voice'),
      btnSendVoice: document.getElementById('btn-send-voice'),

      videoRecordingPanel: document.getElementById('video-recording-panel'),
      videoStreamPreview: document.getElementById('video-stream-preview'),
      recordTimer: document.getElementById('record-timer'),
      btnCancelVideoNote: document.getElementById('btn-cancel-video-note'),
      btnSendVideoNote: document.getElementById('btn-send-video-note'),

      profilePanel: document.getElementById('profile-panel'),
      btnCloseProfile: document.getElementById('btn-close-profile'),
      profileAvatarLarge: document.getElementById('profile-avatar-large'),
      profileName: document.getElementById('profile-name'),
      profileStatus: document.getElementById('profile-status'),
      profileUsernameVal: document.getElementById('profile-username-val'),
      profileBioVal: document.getElementById('profile-bio-val'),
      btnEditBio: document.getElementById('btn-edit-bio'),
      btnOpenMyProfile: document.getElementById('btn-open-my-profile'),
      btnMenuProfile: document.getElementById('btn-menu-profile'),
      btnOpenChatProfile: document.getElementById('btn-open-chat-profile'),
      btnChatInfoPanel: document.getElementById('btn-chat-info-panel'),

      btnChangeAvatar: document.getElementById('btn-change-avatar'),
      avatarFileInput: document.getElementById('avatar-file-input'),
      reactionsPopup: document.getElementById('reactions-popup')
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

    // Профиль (открытие информации)
    if (this.el.btnOpenMyProfile) {
      this.el.btnOpenMyProfile.addEventListener('click', () => {
        this.el.menuDropdown.classList.add('hidden');
        this.openUserProfile(this.currentUser.username, true);
      });
    }
    if (this.el.btnMenuProfile) {
      this.el.btnMenuProfile.addEventListener('click', () => {
        this.el.menuDropdown.classList.add('hidden');
        this.openUserProfile(this.currentUser.username, true);
      });
    }
    if (this.el.btnOpenChatProfile) {
      this.el.btnOpenChatProfile.addEventListener('click', () => {
        const u = this.currentChatTitle.replace('@', '');
        this.openUserProfile(u, u.toLowerCase() === this.currentUser.username.toLowerCase());
      });
    }
    if (this.el.btnChatInfoPanel) {
      this.el.btnChatInfoPanel.addEventListener('click', () => {
        const u = this.currentChatTitle.replace('@', '');
        this.openUserProfile(u, u.toLowerCase() === this.currentUser.username.toLowerCase());
      });
    }
    if (this.el.btnCloseProfile) {
      this.el.btnCloseProfile.addEventListener('click', () => {
        this.el.profilePanel.classList.add('hidden');
      });
    }
    if (this.el.btnEditBio) {
      this.el.btnEditBio.addEventListener('click', () => this.editBio());
    }

    // Переключение Микрофон / Видеокружок
    if (this.el.btnModeToggle) {
      this.el.btnModeToggle.addEventListener('click', () => this.toggleRecordMode());
    }
    if (this.el.btnCancelVoice) {
      this.el.btnCancelVoice.addEventListener('click', () => this.stopRecording(false));
    }
    if (this.el.btnSendVoice) {
      this.el.btnSendVoice.addEventListener('click', () => this.stopRecording(true));
    }
    if (this.el.btnCancelVideoNote) {
      this.el.btnCancelVideoNote.addEventListener('click', () => this.stopRecording(false));
    }
    if (this.el.btnSendVideoNote) {
      this.el.btnSendVideoNote.addEventListener('click', () => this.stopRecording(true));
    }

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

    // Смена аватара
    if (this.el.btnChangeAvatar && this.el.avatarFileInput) {
      this.el.btnChangeAvatar.addEventListener('click', () => this.el.avatarFileInput.click());
      this.el.avatarFileInput.addEventListener('change', (e) => this.handleAvatarUpload(e));
    }

    // Реакции: клик по смайлику в поп-апе
    if (this.el.reactionsPopup) {
      this.el.reactionsPopup.querySelectorAll('.tg-react-emoji').forEach(span => {
        span.addEventListener('click', async (e) => {
          e.stopPropagation();
          const emoji = span.getAttribute('data-emoji');
          if (this.activeReactionMsgId) {
            await this.storage.toggleReaction(this.activeReactionMsgId, emoji, this.currentUser.username);
            this.hideReactionsPopup();
            await this.renderMessages();
          }
        });
      });

      document.addEventListener('click', () => this.hideReactionsPopup());
    }

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
    this.renderAvatars();

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

      let specialContent = '';

      // 1. ВИДЕОКРУЖОЧЕК TELEGRAM
      if (m.circleVideo) {
        specialContent = [
          '<div class="tg-circle-card" data-video-src="' + m.circleVideo.data + '">',
          '  <video src="' + m.circleVideo.data + '" playsinline loop></video>',
          '  <div class="tg-circle-play-overlay">▶</div>',
          '</div>'
        ].join('');
      }
      // 2. ГОЛОСОВОЕ СООБЩЕНИЕ TELEGRAM
      else if (m.voice) {
        specialContent = [
          '<div class="tg-voice-card">',
          '  <button class="tg-voice-play-btn" data-audio-src="' + m.voice.data + '">▶</button>',
          '  <div class="tg-voice-meta">',
          '    <div class="tg-voice-waveform">',
          '      <span class="tg-wave-bar" style="height: 6px;"></span>',
          '      <span class="tg-wave-bar" style="height: 14px;"></span>',
          '      <span class="tg-wave-bar" style="height: 18px;"></span>',
          '      <span class="tg-wave-bar" style="height: 10px;"></span>',
          '      <span class="tg-wave-bar" style="height: 22px;"></span>',
          '      <span class="tg-wave-bar" style="height: 16px;"></span>',
          '      <span class="tg-wave-bar" style="height: 8px;"></span>',
          '      <span class="tg-wave-bar" style="height: 20px;"></span>',
          '      <span class="tg-wave-bar" style="height: 12px;"></span>',
          '      <span class="tg-wave-bar" style="height: 18px;"></span>',
          '    </div>',
          '    <span class="tg-voice-time">00:' + String(m.voice.duration || '00').padStart(2, '0') + '</span>',
          '  </div>',
          '</div>'
        ].join('');
      }
      // 3. ФОТОГРАФИИ (ОДИНОЧНЫЕ И СЕТКА ГАЛЕРЕИ) ИЛИ ФАЙЛЫ
      else if (m.files && m.files.length > 0) {
        const photoFiles = m.files.filter(f => f.type && f.type.startsWith('image/'));
        const otherFiles = m.files.filter(f => !f.type || !f.type.startsWith('image/'));

        let gridHtml = '';
        if (photoFiles.length > 0) {
          const gridClass = photoFiles.length === 1 ? 'grid-1' : (photoFiles.length === 2 ? 'grid-2' : (photoFiles.length === 3 ? 'grid-3' : 'grid-more'));
          gridHtml = '<div class="tg-photo-grid ' + gridClass + '">' +
            photoFiles.map(f => '<img class="tg-media-photo" src="' + f.data + '" alt="Photo" data-name="' + this.escape(f.name) + '">').join('') +
            '</div>';
        }

        const filesHtml = otherFiles.map(f => [
          '<div class="tg-file-card">',
          '  <div class="tg-file-icon">📄</div>',
          '  <div class="tg-file-meta">',
          '    <div class="tg-file-name">' + this.escape(f.name) + '</div>',
          '    <div class="tg-file-size">' + this.formatSize(f.size) + '</div>',
          '  </div>',
          '</div>'
        ].join('')).join('');

        specialContent = gridHtml + filesHtml;
      } else if (m.file) {
        if (m.file.type && m.file.type.startsWith('image/')) {
          specialContent = '<div class="tg-photo-grid grid-1"><img class="tg-media-photo" src="' + m.file.data + '" alt="Photo" data-name="' + this.escape(m.file.name) + '"></div>';
        } else {
          specialContent = [
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

      // Блок реакций
      let reactionsHtml = '';
      if (m.reactions && Object.keys(m.reactions).length > 0) {
        reactionsHtml = '<div class="tg-msg-reactions">' +
          Object.entries(m.reactions).map(([emoji, users]) => {
            const hasMine = users.includes(this.currentUser.username);
            return '<span class="tg-reaction-badge ' + (hasMine ? 'active' : '') + '" data-msg-id="' + m.id + '" data-emoji="' + emoji + '">' +
              emoji + ' ' + users.length + '</span>';
          }).join('') +
          '</div>';
      }

      wrap.innerHTML = [
        '<div class="tg-msg-bubble" data-msg-id="' + m.id + '">',
        (!isOut ? '  <div class="tg-sender-heading">@' + this.escape(m.sender) + '</div>' : ''),
        specialContent,
        (m.text ? '  <span class="tg-msg-content">' + this.escape(m.text) + '</span>' : ''),
        '  <div class="tg-msg-meta">',
        '    <span>' + m.time + '</span>',
        (isOut ? '    <span class="tg-checks">✓✓</span>' : ''),
        '  </div>',
        reactionsHtml,
        '</div>'
      ].join('');

      // Интерактив для видеокружка
      const circleCard = wrap.querySelector('.tg-circle-card');
      if (circleCard) {
        const vid = circleCard.querySelector('video');
        circleCard.addEventListener('click', () => {
          if (vid.paused) {
            vid.play();
            circleCard.classList.add('playing');
          } else {
            vid.pause();
            circleCard.classList.remove('playing');
          }
        });
      }

      // Интерактив для голосового
      const voicePlayBtn = wrap.querySelector('.tg-voice-play-btn');
      if (voicePlayBtn) {
        const audio = new Audio(voicePlayBtn.getAttribute('data-audio-src'));
        voicePlayBtn.addEventListener('click', () => {
          if (audio.paused) {
            audio.play();
            voicePlayBtn.innerText = '❚❚';
            audio.onended = () => { voicePlayBtn.innerText = '▶'; };
          } else {
            audio.pause();
            voicePlayBtn.innerText = '▶';
          }
        });
      }

      // Лайтбокс для картинок галереи
      wrap.querySelectorAll('.tg-media-photo').forEach(imgEl => {
        imgEl.addEventListener('click', () => {
          this.openLightbox(imgEl.src, imgEl.getAttribute('data-name') || 'photo.png');
        });
      });

      // Клик по реакции на сообщении
      wrap.querySelectorAll('.tg-reaction-badge').forEach(badge => {
        badge.addEventListener('click', async (e) => {
          e.stopPropagation();
          const emoji = badge.getAttribute('data-emoji');
          await this.storage.toggleReaction(m.id, emoji, this.currentUser.username);
          await this.renderMessages();
        });
      });

      // Контекстное меню / зажатие (Long Press) для реакций
      const bubbleEl = wrap.querySelector('.tg-msg-bubble');
      if (bubbleEl) {
        // ПК: Правый клик
        bubbleEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showReactionsPopup(e.clientX, e.clientY, m.id);
        });

        // Мобильные: Долгое зажатие (Touch Long Press)
        let touchTimer = null;
        bubbleEl.addEventListener('touchstart', (e) => {
          const touch = e.touches[0];
          touchTimer = setTimeout(() => {
            this.showReactionsPopup(touch.clientX, touch.clientY, m.id);
          }, 450);
        }, { passive: true });

        bubbleEl.addEventListener('touchend', () => {
          if (touchTimer) clearTimeout(touchTimer);
        });
        bubbleEl.addEventListener('touchmove', () => {
          if (touchTimer) clearTimeout(touchTimer);
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
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const filePromises = files.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            name: file.name,
            type: file.type,
            size: file.size,
            data: reader.result
          });
        };
        reader.readAsDataURL(file);
      });
    });

    const fileObjects = await Promise.all(filePromises);
    await this.storage.sendMessage(this.currentChatId, this.currentUser.username, '', fileObjects[0], null, null, fileObjects);
    await this.refreshData();
    this.el.fileInput.value = '';
  }

  async handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      await this.storage.updateUserAvatar(this.currentUser.username, base64);
      this.currentUser.avatar = base64;
      this.renderAvatars();
      this.openUserProfile(this.currentUser.username, true);
    };
    reader.readAsDataURL(file);
    this.el.avatarFileInput.value = '';
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
      await this.storage.sendMessage(this.currentChatId, this.currentUser.username, '', fileData, null, null, [fileData]);
      await this.refreshData();
    };
    reader.readAsDataURL(blob);
  }

  showReactionsPopup(x, y, msgId) {
    this.activeReactionMsgId = msgId;
    if (!this.el.reactionsPopup) return;

    // Ограничиваем координаты границами экрана
    const popupWidth = 260;
    const posX = Math.min(Math.max(10, x - 120), window.innerWidth - popupWidth - 10);
    const posY = Math.max(10, y - 55);

    this.el.reactionsPopup.style.left = posX + 'px';
    this.el.reactionsPopup.style.top = posY + 'px';
    this.el.reactionsPopup.classList.remove('hidden');
  }

  hideReactionsPopup() {
    if (this.el.reactionsPopup) {
      this.el.reactionsPopup.classList.add('hidden');
    }
    this.activeReactionMsgId = null;
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

  toggleRecordMode() {
    if (this.recordMode === 'mic') {
      this.recordMode = 'video';
      this.el.iconModeMic.classList.add('hidden');
      this.el.iconModeVideo.classList.remove('hidden');
      this.startVideoCircleRecording();
    } else {
      this.recordMode = 'mic';
      this.el.iconModeVideo.classList.add('hidden');
      this.el.iconModeMic.classList.remove('hidden');
      this.startVoiceRecording();
    }
  }

  async startVoiceRecording() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        if (this.shouldSendRecorded) {
          const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
          const base64 = await this.blobToBase64(blob);
          await this.storage.sendMessage(this.currentChatId, this.currentUser.username, '', null, {
            data: base64,
            duration: this.getElapsedSeconds()
          });
          await this.refreshData();
        }
        this.cleanupStream();
      };

      this.mediaRecorder.start();
      this.el.audioRecordingPanel.classList.remove('hidden');
      this.startTimer(this.el.audioRecordTimer);
    } catch (err) {
      alert('Не удалось получить доступ к микрофону: ' + err.message);
      this.cleanupStream();
    }
  }

  async startVideoCircleRecording() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 400, height: 400, facingMode: 'user' },
        audio: true
      });
      this.el.videoStreamPreview.srcObject = this.mediaStream;
      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        if (this.shouldSendRecorded) {
          const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
          const base64 = await this.blobToBase64(blob);
          await this.storage.sendMessage(this.currentChatId, this.currentUser.username, '', null, null, {
            data: base64,
            duration: this.getElapsedSeconds()
          });
          await this.refreshData();
        }
        this.cleanupStream();
      };

      this.mediaRecorder.start();
      this.el.videoRecordingPanel.classList.remove('hidden');
      this.startTimer(this.el.recordTimer);
    } catch (err) {
      alert('Не удалось получить доступ к камере: ' + err.message);
      this.cleanupStream();
    }
  }

  stopRecording(send = true) {
    this.shouldSendRecorded = send;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    } else {
      this.cleanupStream();
    }
    this.el.audioRecordingPanel.classList.add('hidden');
    this.el.videoRecordingPanel.classList.add('hidden');
    clearInterval(this.recInterval);
  }

  cleanupStream() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.el.videoStreamPreview) {
      this.el.videoStreamPreview.srcObject = null;
    }
  }

  startTimer(timerEl) {
    this.recStartTime = Date.now();
    timerEl.innerText = '00:00';
    clearInterval(this.recInterval);
    this.recInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.recStartTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      timerEl.innerText = m + ':' + s;
    }, 1000);
  }

  getElapsedSeconds() {
    return Math.floor((Date.now() - (this.recStartTime || Date.now())) / 1000);
  }

  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async openUserProfile(username, isOwn = false) {
    username = username.toLowerCase();
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    const user = users.find(u => u.username.toLowerCase() === username) || {
      username: username,
      avatar: isOwn ? this.currentUser.avatar : null,
      bio: isOwn ? (this.currentUser.bio || 'Пользуюсь Telegram Web ✨') : 'Пользователь Telegram Web'
    };

    if (user.avatar) {
      this.el.profileAvatarLarge.innerHTML = '<img src="' + user.avatar + '" alt="Avatar">';
    } else {
      this.el.profileAvatarLarge.innerText = username === 'general' ? '🌐' : username[0].toUpperCase();
    }

    this.el.profileName.innerText = '@' + username;
    this.el.profileStatus.innerText = 'в сети';
    this.el.profileUsernameVal.innerText = '@' + username;
    this.el.profileBioVal.innerText = user.bio || 'О себе пока ничего не написано';

    if (this.el.btnChangeAvatar) {
      this.el.btnChangeAvatar.style.display = isOwn ? 'flex' : 'none';
    }
    this.el.btnEditBio.style.display = isOwn ? 'block' : 'none';
    this.el.profilePanel.classList.remove('hidden');
  }

  renderAvatars() {
    if (this.currentUser && this.currentUser.avatar) {
      if (this.el.currentUserAvatar) {
        this.el.currentUserAvatar.innerHTML = '<img src="' + this.currentUser.avatar + '" alt="Avatar">';
      }
    } else if (this.currentUser) {
      if (this.el.currentUserAvatar) {
        this.el.currentUserAvatar.innerText = this.currentUser.username[0].toUpperCase();
      }
    }
  }

  async editBio() {
    const currentBio = this.currentUser.bio || '';
    const newBio = prompt('Введите новый статус "О себе":', currentBio);
    if (newBio !== null) {
      const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
      const user = users.find(u => u.username.toLowerCase() === this.currentUser.username.toLowerCase());
      if (user) {
        user.bio = newBio;
        localStorage.setItem('gm_users', JSON.stringify(users));
      }
      this.currentUser.bio = newBio;
      localStorage.setItem('gm_current_user', JSON.stringify(this.currentUser));
      this.el.profileBioVal.innerText = newBio;
    }
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