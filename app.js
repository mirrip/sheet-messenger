// ===================================================
// TELEGRAM WEB — POLISHED ENGINE & UI CONTROLLER v3.0.0
// ===================================================

/**
 * Сервис хранения: localStorage для метаданных, IndexedDB для медиа-блобов
 */
class StorageService {
  constructor(config) {
    this.config = config || (typeof window !== 'undefined' ? window.APP_CONFIG : null) || { STORAGE_MODE: 'local' };
    this.mediaDB = null;
    this.initLocalStorage();
  }

  // --- IndexedDB для медиа (голос, видеокружки) ---
  async initMediaDB() {
    if (this.mediaDB) return;
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('gm_media_store', 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('blobs')) {
            db.createObjectStore('blobs', { keyPath: 'id' });
          }
        };
        req.onsuccess = (e) => { this.mediaDB = e.target.result; resolve(); };
        req.onerror = () => resolve(); // не блокируем приложение
      } catch (e) { resolve(); }
    });
  }

  async saveMediaBlob(id, blob) {
    if (!this.mediaDB) await this.initMediaDB();
    if (!this.mediaDB) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.mediaDB.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put({ id, blob, ts: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => {
          try {
            blob.arrayBuffer().then(buf => {
              const tx2 = this.mediaDB.transaction('blobs', 'readwrite');
              tx2.objectStore('blobs').put({ id, buf, type: blob.type, ts: Date.now() });
              tx2.oncomplete = () => resolve(true);
              tx2.onerror = () => resolve(false);
            }).catch(() => resolve(false));
          } catch (_) { resolve(false); }
        };
      } catch (e) { resolve(false); }
    });
  }

  async getMediaBlob(id) {
    if (!this.mediaDB) await this.initMediaDB();
    if (!this.mediaDB || !id) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.mediaDB.transaction('blobs', 'readonly');
        const r = tx.objectStore('blobs').get(id);
        r.onsuccess = () => {
          if (!r.result) return resolve(null);
          if (r.result.blob) return resolve(r.result.blob);
          if (r.result.buf) return resolve(new Blob([r.result.buf], { type: r.result.type || 'video/webm' }));
          resolve(null);
        };
        r.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
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
      voice: voice || null,        // { mediaId, duration } — блоб в IDB
      circleVideo: circleVideo || null, // { mediaId, duration } — блоб в IDB
      reactions: {},
      time: timeStr,
      createdAt: Date.now()
    };

    all.push(newMsg);
    try {
      localStorage.setItem('gm_messages', JSON.stringify(all));
    } catch (e) {
      // Квота: убираем самое старое сообщение и повторяем
      console.warn('localStorage quota, removing oldest message');
      all.shift();
      try { localStorage.setItem('gm_messages', JSON.stringify(all)); } catch (e2) { /* ignore */ }
    }

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
    this.pendingFiles = []; // Вложения перед отправкой
    this._activeObjectURLs = []; // Для очистки Blob URL при ререндере
    this.isHoldingMainAction = false;
    this.holdStartTime = 0;
    this.holdStartY = 0;
    this.isRecordingLocked = false;

    // Воспроизведение кружков и голосовых (единовременно играет только 1 медиа)
    this.currentPlayingCircle = null;
    this.currentPlayingAudio = null;
    this.currentPlayingAudioBtn = null;
    this._mediaBlobUrlCache = new Map(); // mediaId -> blobUrl (стабильный кэш)

    // Инициализация IndexedDB для медиа (async, не блокирует UI)
    this.storage.initMediaDB();

    this.initElements();
    this.bindEvents();
    this.updateMainActionButtonState();

    if (this.currentUser) {
      this.showMainScreen();
    } else {
      this.showAuthScreen();
    }
  }

  generateWaveformBars(seedStr, count = 30) {
    let hash = 0;
    const str = String(seedStr || 'tg_voice');
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    const heights = [];
    for (let i = 0; i < count; i++) {
      hash = Math.sin(hash + i * 2.3 + 1) * 10000;
      const rand = hash - Math.floor(hash);
      const envelope = Math.sin((i / (count - 1)) * Math.PI);
      // Реалистичная огибающая человеческой речи: колебания от 4px до 22px
      const h = Math.max(4, Math.min(22, Math.round(4 + rand * 14 * (0.35 + 0.65 * envelope))));
      heights.push(h);
    }
    return heights.map(h => '<span class="tg-wave-bar" style="height:' + h + 'px"></span>').join('');
  }

  formatDuration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  stopAllPlayingMedia() {
    if (this.currentPlayingCircle) {
      try { this.currentPlayingCircle.pause(); } catch (_) {}
      const parent = this.currentPlayingCircle.closest('.tg-circle-card');
      if (parent) {
        parent.classList.remove('playing', 'expanded');
      }
      this.currentPlayingCircle = null;
    }
    if (this.currentPlayingAudio) {
      try { this.currentPlayingAudio.pause(); } catch (_) {}
      if (this.currentPlayingAudioBtn) {
        const playIcon = this.currentPlayingAudioBtn.querySelector('.tg-icon-play');
        const pauseIcon = this.currentPlayingAudioBtn.querySelector('.tg-icon-pause');
        if (playIcon) playIcon.classList.remove('hidden');
        if (pauseIcon) pauseIcon.classList.add('hidden');
      }
      this.currentPlayingAudio = null;
      this.currentPlayingAudioBtn = null;
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
      composerAttachments: document.getElementById('composer-attachments'),
      btnSend: document.getElementById('btn-send'),

      lightboxModal: document.getElementById('lightbox-modal'),
      lightboxBackdrop: document.getElementById('lightbox-backdrop'),
      lightboxClose: document.getElementById('lightbox-close'),
      lightboxImg: document.getElementById('lightbox-img'),
      lightboxFilename: document.getElementById('lightbox-filename'),
      lightboxDownload: document.getElementById('lightbox-download'),

      btnMainAction: document.getElementById('btn-main-action'),
      recordLock: document.getElementById('tg-record-lock'),
      iconActionMic: document.getElementById('icon-action-mic'),
      iconActionVideo: document.getElementById('icon-action-video'),
      iconActionSend: document.getElementById('icon-action-send'),

      composerRecordingBar: document.getElementById('composer-recording-bar'),
      composerRecTimer: document.getElementById('composer-rec-timer'),
      composerRecHint: document.getElementById('composer-rec-hint'),
      btnCancelRecording: document.getElementById('btn-cancel-recording'),

      videoRecordingPanel: document.getElementById('video-recording-panel'),
      videoStreamPreview: document.getElementById('video-stream-preview'),

      profilePanel: document.getElementById('profile-panel'),
      btnCloseProfile: document.getElementById('btn-close-profile'),
      profileAvatarLarge: document.getElementById('profile-avatar-large'),
      profileName: document.getElementById('profile-name'),
      profileStatus: document.getElementById('profile-status'),
      profileDisplaynameVal: document.getElementById('profile-displayname-val'),
      profileUsernameVal: document.getElementById('profile-username-val'),
      profileBioVal: document.getElementById('profile-bio-val'),
      btnEditProfile: document.getElementById('btn-edit-profile'),
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
    if (this.el.btnEditProfile) {
      this.el.btnEditProfile.addEventListener('click', () => this.editProfile());
    }

    // Отмена записи из строки сообщения
    if (this.el.btnCancelRecording) {
      this.el.btnCancelRecording.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stopRecording(false);
      });
    }

    // ЕДИНАЯ ГЛАВНАЯ КНОПКА TELEGRAM (ПОДДЕРЖКА СЕНСОРНЫХ ЭКРАНОВ И МЫШИ)
    if (this.el.btnMainAction) {
      let holdTimer = null;
      let isHoldRecording = false;
      let startY = 0;
      let isPointerDown = false;

      const onPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return; // только левая кнопка мыши
        if (this.isRecordingLocked) return; // если уже зафиксирована запись — сработает click для отправки

        const hasText = Boolean(this.el.messageInput && this.el.messageInput.value && this.el.messageInput.value.trim().length > 0);
        const hasFiles = Boolean(this.pendingFiles && this.pendingFiles.length > 0);
        if (hasText || hasFiles) return; // если есть текст или файлы — обычная отправка, не запись

        // Блокируем нативные жесты браузера (жест «назад» с края экрана, скролл страницы)
        if (e.cancelable) e.preventDefault();
        try {
          if (e.pointerId !== undefined && this.el.btnMainAction.setPointerCapture) {
            this.el.btnMainAction.setPointerCapture(e.pointerId);
          }
        } catch (_) {}

        isPointerDown = true;
        isHoldRecording = false;
        startY = e.clientY;

        if (holdTimer) clearTimeout(holdTimer);

        // Порог зажатия — 280 мс
        // Если палец/мышь отпущены раньше 280 мс — ЭТО ЧИСТЫЙ КЛИК ДЛЯ СМЕНЫ РЕЖИМА!
        // Запись вообще не запускается, микрофон не дергается!
        holdTimer = setTimeout(() => {
          if (!isPointerDown) return;
          isHoldRecording = true;
          this.isHoldingMainAction = true;

          // Легкий виброотклик на смартфонах
          if (navigator.vibrate) {
            try { navigator.vibrate(25); } catch (_) {}
          }

          // Показываем замочек для свайпа вверх
          if (this.el.recordLock) {
            this.el.recordLock.classList.remove('hidden', 'locked');
          }

          // Запускаем запись
          if (this.recordMode === 'mic') {
            this.startVoiceRecording();
          } else {
            this.startVideoCircleRecording();
          }
        }, 280);
      };

      const onPointerMove = (e) => {
        if (!isHoldRecording || this.isRecordingLocked) return;
        if (!startY) return;

        const deltaY = startY - e.clientY;
        // Свайп вверх от 45px фиксирует запись (Lock)
        if (deltaY > 45) {
          this.isRecordingLocked = true;
          isPointerDown = false; // Палец свободен, отпускание не остановит запись!

          try {
            if (e.pointerId !== undefined && this.el.btnMainAction.releasePointerCapture) {
              this.el.btnMainAction.releasePointerCapture(e.pointerId);
            }
          } catch (_) {}

          if (this.el.recordLock) {
            this.el.recordLock.classList.add('locked');
            setTimeout(() => {
              if (this.el.recordLock) this.el.recordLock.classList.add('hidden');
            }, 500);
          }

          // Кнопка становится кнопкой отправки (синий самолётик)
          this.el.btnMainAction.className = 'tg-send-btn state-send';
          this.el.btnMainAction.title = 'Отправить запись';
        }
      };

      const onPointerUp = (e) => {
        try {
          if (e.pointerId !== undefined && this.el.btnMainAction.releasePointerCapture) {
            this.el.btnMainAction.releasePointerCapture(e.pointerId);
          }
        } catch (_) {}

        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }

        // Если запись зафиксирована свайпом вверх — не останавливаем при отпускании пальца
        if (this.isRecordingLocked) return;

        if (!isPointerDown) return;
        isPointerDown = false;
        this.isHoldingMainAction = false;

        if (this.el.recordLock) this.el.recordLock.classList.add('hidden');

        if (isHoldRecording) {
          // Реально шла запись по зажатию — останавливаем и отправляем!
          isHoldRecording = false;
          this.stopRecording(true);
        } else {
          // Палец/кнопка отпущены до 280 мс — ЭТО ЧИСТЫЙ КОРОТКИЙ КЛИК!
          // Мгновенное и чёткое переключение микрофон <-> видеокамера!
          this.toggleRecordMode();
        }
      };

      const onPointerCancel = (e) => {
        try {
          if (e && e.pointerId !== undefined && this.el.btnMainAction.releasePointerCapture) {
            this.el.btnMainAction.releasePointerCapture(e.pointerId);
          }
        } catch (_) {}

        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        if (this.isRecordingLocked) return;
        isPointerDown = false;
        this.isHoldingMainAction = false;

        if (this.el.recordLock) this.el.recordLock.classList.add('hidden');

        if (isHoldRecording) {
          isHoldRecording = false;
          this.stopRecording(false);
        }
      };

      // Pointer Events — идеальная работа на ПК и сенсорных смартфонах без багов эмуляции
      this.el.btnMainAction.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);

      // Клик по кнопке: отправка зафиксированной записи или текста
      this.el.btnMainAction.addEventListener('click', (e) => {
        // 1. Если запись была зафиксирована свайпом вверх — отправляем её!
        if (this.isRecordingLocked) {
          this.isRecordingLocked = false;
          this.stopRecording(true);
          return;
        }

        // 2. Обычная отправка текста или файлов
        const hasText = Boolean(this.el.messageInput && this.el.messageInput.value && this.el.messageInput.value.trim().length > 0);
        const hasFiles = Boolean(this.pendingFiles && this.pendingFiles.length > 0);

        if (hasText || hasFiles) {
          this.sendMessage();
        }
      });
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

    this.el.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Автоподстройка высоты + МГНОВЕННАЯ СМЕНА КНОПКИ ПРИ ПОЯВЛЕНИИ ПЕРВОГО СИМВОЛА
    ['input', 'keyup', 'paste', 'change'].forEach(evt => {
      this.el.messageInput.addEventListener(evt, () => {
        this.el.messageInput.style.height = 'auto';
        this.el.messageInput.style.height = Math.min(this.el.messageInput.scrollHeight, 120) + 'px';
        this.updateMainActionButtonState();
      });
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
      sessionStorage.removeItem('gm_active_chat_open');
      sessionStorage.removeItem('gm_active_chat_id');
      sessionStorage.removeItem('gm_active_chat_title');
      if (this.el.chatView) this.el.chatView.classList.remove('active');
      if (window.history && window.history.state && window.history.state.chatId) {
        window.history.back();
      }
    });

    // Обработка кнопки «Назад» на смартфонах Android/iOS
    window.addEventListener('popstate', (e) => {
      if (this.el.chatView && this.el.chatView.classList.contains('active')) {
        if (!e.state || !e.state.chatId) {
          sessionStorage.removeItem('gm_active_chat_open');
          sessionStorage.removeItem('gm_active_chat_id');
          sessionStorage.removeItem('gm_active_chat_title');
          this.el.chatView.classList.remove('active');
        } else if (e.state.chatId !== this.currentChatId) {
          this.openChat(e.state.chatId, e.state.title || '');
        }
      }
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

    const hasOpenChat = sessionStorage.getItem('gm_active_chat_open') === '1';
    const savedChatId = sessionStorage.getItem('gm_active_chat_id');
    const savedChatTitle = sessionStorage.getItem('gm_active_chat_title');

    if (savedChatId) {
      this.currentChatId = savedChatId;
      if (savedChatTitle && this.el.activeChatTitle) {
        this.el.activeChatTitle.innerText = savedChatTitle;
      }
    }

    // Если на смартфоне чат был открыт — остаёмся в нём и не вылетаем в список чатов!
    if (this.el.chatView && window.innerWidth <= 768) {
      if (hasOpenChat) {
        this.el.chatView.classList.add('active');
      } else {
        this.el.chatView.classList.remove('active');
      }
    }

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
    sessionStorage.setItem('gm_active_chat_open', '1');
    sessionStorage.setItem('gm_active_chat_id', chatId);
    sessionStorage.setItem('gm_active_chat_title', title);

    if (window.history && window.history.pushState) {
      if (!window.history.state || window.history.state.chatId !== chatId) {
        window.history.pushState({ chatId, title }, '', '#chat=' + encodeURIComponent(chatId));
      }
    }

    const isGeneral = chatId === 'general';
    this.el.activeChatTitle.innerText = title;
    this.el.activeChatAvatar.innerText = isGeneral ? '🌐' : title.replace('@', '')[0].toUpperCase();
    this.el.activeChatStatus.innerText = isGeneral ? 'канал общения' : 'в сети';

    if (this.el.chatView) {
      this.el.chatView.classList.add('active');
    }

    this.updateMainActionButtonState();
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

    // Предзагрузка всех Blob URL для мгновенного и надежного старта видео и аудио
    for (const m of msgs) {
      if (m.circleVideo && m.circleVideo.mediaId && !this._mediaBlobUrlCache.has(m.circleVideo.mediaId)) {
        const b = await this.storage.getMediaBlob(m.circleVideo.mediaId);
        if (b) {
          this._mediaBlobUrlCache.set(m.circleVideo.mediaId, URL.createObjectURL(b));
        }
      }
      if (m.voice && m.voice.mediaId && !this._mediaBlobUrlCache.has(m.voice.mediaId)) {
        const b = await this.storage.getMediaBlob(m.voice.mediaId);
        if (b) {
          this._mediaBlobUrlCache.set(m.voice.mediaId, URL.createObjectURL(b));
        }
      }
    }

    msgs.forEach(m => {
      const isOut = m.sender.toLowerCase() === this.currentUser.username.toLowerCase();
      const wrap = document.createElement('div');
      wrap.className = 'tg-bubble-wrap ' + (isOut ? 'out' : 'in');

      let specialContent = '';

      const isCircle = Boolean(m.circleVideo);

      // 1. ВИДЕОКРУЖОЧЕК TELEGRAM (по умолчанию на паузе, увеличивается при включении)
      if (m.circleVideo) {
        const dur = m.circleVideo.duration ? String(m.circleVideo.duration).padStart(2, '0') : '00';
        const mediaId = m.circleVideo.mediaId || '';
        const circleSrc = this._mediaBlobUrlCache.get(mediaId) || m.circleVideo.data || '';
        specialContent = [
          '<div class="tg-circle-card" data-media-id="' + mediaId + '">',
          '  <video src="' + circleSrc + '" playsinline webkit-playsinline preload="auto"></video>',
          '  <div class="tg-circle-time-badge">00:' + dur + ' • ' + m.time + '</div>',
          '  <div class="tg-circle-play-overlay">',
          '    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
          '  </div>',
          '</div>'
        ].join('');
      }
      // 2. ГОЛОСОВОЕ СООБЩЕНИЕ TELEGRAM С ВОЛНОГРАММОЙ (полосочки как в TG)
      else if (m.voice) {
        const voiceMediaId = m.voice.mediaId || '';
        const dur = m.voice.duration || 0;
        const voiceSrc = this._mediaBlobUrlCache.get(voiceMediaId) || m.voice.data || '';
        const seed = (m.id || '') + '_' + voiceMediaId + '_' + dur;
        const barsHtml = this.generateWaveformBars(seed, 30);
        specialContent = [
          '<div class="tg-voice-card" data-media-id="' + voiceMediaId + '" data-src="' + voiceSrc + '">',
          '  <button type="button" class="tg-voice-play-btn" title="Слушать">',
          '    <svg class="tg-icon-play" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
          '    <svg class="tg-icon-pause hidden" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
          '  </button>',
          '  <div class="tg-voice-meta">',
          '    <div class="tg-voice-waveform" title="Перемотка">',
          '      <div class="tg-waveform-bars tg-waveform-bg">' + barsHtml + '</div>',
          '      <div class="tg-waveform-bars tg-waveform-fg" style="width: 0%;">' + barsHtml + '</div>',
          '    </div>',
          '    <div class="tg-voice-time-row">',
          '      <span class="tg-voice-time">' + this.formatDuration(dur) + '</span>',
          '    </div>',
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

      const bubbleMetaHtml = isCircle ? '' : [
        '  <div class="tg-msg-meta">',
        '    <span>' + m.time + '</span>',
        (isOut ? '    <span class="tg-checks">✓✓</span>' : ''),
        '  </div>'
      ].join('');

      wrap.innerHTML = [
        '<div class="tg-msg-bubble ' + (isCircle ? 'is-circle' : '') + '" data-msg-id="' + m.id + '">',
        (!isOut && !isCircle ? '  <div class="tg-sender-heading">@' + this.escape(m.sender) + '</div>' : ''),
        specialContent,
        (m.text ? '  <span class="tg-msg-content">' + this.escape(m.text) + '</span>' : ''),
        bubbleMetaHtml,
        reactionsHtml,
        '</div>'
      ].join('');

      // Интерактив для видеокружка
      const circleCard = wrap.querySelector('.tg-circle-card');
      if (circleCard) {
        const vid = circleCard.querySelector('video');
        const timeBadge = circleCard.querySelector('.tg-circle-time-badge');
        const mediaId = circleCard.getAttribute('data-media-id');
        const totalDur = (m.circleVideo && m.circleVideo.duration) || 0;
        const totalDurStr = String(totalDur).padStart(2, '0');

        // Динамический таймер проигрывания кружочка
        vid.addEventListener('timeupdate', () => {
          if (!vid.paused && timeBadge && !isNaN(vid.currentTime)) {
            const cur = Math.floor(vid.currentTime);
            const curStr = String(cur).padStart(2, '0');
            timeBadge.innerText = '00:' + curStr + ' / 00:' + totalDurStr;
          }
        });

        // По окончании видео: возврат в исходное состояние (пауза и компактный размер)
        vid.addEventListener('ended', () => {
          vid.pause();
          circleCard.classList.remove('playing', 'expanded');
          try { vid.currentTime = 0; } catch (_) {}
          if (timeBadge) timeBadge.innerText = '00:' + totalDurStr + ' • ' + m.time;
          if (this.currentPlayingCircle === vid) {
            this.currentPlayingCircle = null;
          }
        });

        // Запуск / пауза видеокружка (как в Telegram: увеличение при проигрывании)
        const startCirclePlay = async () => {
          if (!vid.src || vid.src === '' || vid.src === window.location.href) {
            let url = this._mediaBlobUrlCache.get(mediaId);
            if (!url && mediaId) {
              const b = await this.storage.getMediaBlob(mediaId);
              if (b) {
                url = URL.createObjectURL(b);
                this._mediaBlobUrlCache.set(mediaId, url);
              }
            }
            if (url) vid.src = url;
          }
          if (!vid.src) return;

          if (vid.paused) {
            this.stopAllPlayingMedia();
            this.currentPlayingCircle = vid;

            if (vid.ended || (vid.duration && vid.currentTime >= vid.duration)) {
              try { vid.currentTime = 0; } catch (_) {}
            }

            circleCard.classList.add('playing', 'expanded');
            vid.muted = false;

            const playPromise = vid.play();
            if (playPromise !== undefined) {
              playPromise.catch(err => {
                console.warn('Play unmuted blocked on mobile, retrying muted:', err);
                vid.muted = true;
                vid.play().then(() => {
                  vid.muted = false;
                }).catch(e2 => console.error('Play circle fallback error:', e2));
              });
            }
          } else {
            vid.pause();
            circleCard.classList.remove('playing', 'expanded');
            if (this.currentPlayingCircle === vid) {
              this.currentPlayingCircle = null;
            }
          }
        };

        circleCard.addEventListener('click', (e) => {
          e.stopPropagation();
          startCirclePlay();
        });
      }

      // Интерактив для голосового сообщения с живой волнограммой (Telegram Waveform)
      const voiceCard = wrap.querySelector('.tg-voice-card');
      if (voiceCard) {
        const voicePlayBtn = voiceCard.querySelector('.tg-voice-play-btn');
        const waveformEl = voiceCard.querySelector('.tg-voice-waveform');
        const waveformFg = voiceCard.querySelector('.tg-waveform-fg');
        const timeEl = voiceCard.querySelector('.tg-voice-time');
        const voiceMediaId = voiceCard.getAttribute('data-media-id');
        const totalDur = (m.voice && m.voice.duration) || 0;
        let voiceSrc = voiceCard.getAttribute('data-src') || '';
        let audio = null;

        const setupAudio = (audioObj) => {
          audioObj.addEventListener('timeupdate', () => {
            const dur = audioObj.duration || totalDur || 1;
            const cur = audioObj.currentTime || 0;
            const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
            if (waveformFg) waveformFg.style.width = pct + '%';
            if (timeEl) timeEl.innerText = this.formatDuration(Math.floor(cur)) + ' / ' + this.formatDuration(Math.floor(dur));
          });

          audioObj.addEventListener('ended', () => {
            if (waveformFg) waveformFg.style.width = '0%';
            if (timeEl) timeEl.innerText = this.formatDuration(totalDur);
            const playIcon = voicePlayBtn.querySelector('.tg-icon-play');
            const pauseIcon = voicePlayBtn.querySelector('.tg-icon-pause');
            if (playIcon) playIcon.classList.remove('hidden');
            if (pauseIcon) pauseIcon.classList.add('hidden');
            if (this.currentPlayingAudio === audioObj) {
              this.currentPlayingAudio = null;
              this.currentPlayingAudioBtn = null;
            }
          });
        };

        if (voiceSrc) {
          audio = new Audio(voiceSrc);
          setupAudio(audio);
        }

        const toggleVoicePlay = async () => {
          if (!audio) {
            if (!voiceSrc && voiceMediaId) {
              let url = this._mediaBlobUrlCache.get(voiceMediaId);
              if (!url) {
                const b = await this.storage.getMediaBlob(voiceMediaId);
                if (b) {
                  url = URL.createObjectURL(b);
                  this._mediaBlobUrlCache.set(voiceMediaId, url);
                }
              }
              if (url) voiceSrc = url;
            }
            if (voiceSrc) {
              audio = new Audio(voiceSrc);
              setupAudio(audio);
            }
          }
          if (!audio) return;

          const playIcon = voicePlayBtn.querySelector('.tg-icon-play');
          const pauseIcon = voicePlayBtn.querySelector('.tg-icon-pause');

          if (audio.paused) {
            this.stopAllPlayingMedia();

            this.currentPlayingAudio = audio;
            this.currentPlayingAudioBtn = voicePlayBtn;

            if (audio.ended || (audio.duration && audio.currentTime >= audio.duration)) {
              try { audio.currentTime = 0; } catch (_) {}
            }

            audio.play().then(() => {
              if (playIcon) playIcon.classList.add('hidden');
              if (pauseIcon) pauseIcon.classList.remove('hidden');
            }).catch(err => {
              console.warn('Audio play error:', err);
              if (playIcon) playIcon.classList.remove('hidden');
              if (pauseIcon) pauseIcon.classList.add('hidden');
            });
          } else {
            audio.pause();
            if (playIcon) playIcon.classList.remove('hidden');
            if (pauseIcon) pauseIcon.classList.add('hidden');
            if (this.currentPlayingAudio === audio) {
              this.currentPlayingAudio = null;
              this.currentPlayingAudioBtn = null;
            }
          }
        };

        voicePlayBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleVoicePlay();
        });

        // Клик по волнограмме для мгновенной перемотки (seek)
        waveformEl.addEventListener('click', async (e) => {
          e.stopPropagation();
          const rect = waveformEl.getBoundingClientRect();
          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

          if (!audio && voiceSrc) {
            audio = new Audio(voiceSrc);
            setupAudio(audio);
          }
          if (!audio) return;

          const dur = audio.duration || totalDur || 1;
          try { audio.currentTime = pct * dur; } catch (_) {}
          if (waveformFg) waveformFg.style.width = (pct * 100) + '%';
          if (timeEl) timeEl.innerText = this.formatDuration(Math.floor(audio.currentTime)) + ' / ' + this.formatDuration(Math.floor(dur));

          if (audio.paused) {
            toggleVoicePlay();
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
    const hasFiles = this.pendingFiles && this.pendingFiles.length > 0;

    if (!text && !hasFiles) return;

    const filesToSend = this.pendingFiles ? [...this.pendingFiles] : [];
    this.pendingFiles = [];
    this.renderPendingAttachments();

    this.el.messageInput.value = '';
    this.el.messageInput.style.height = 'auto';
    this.updateMainActionButtonState();

    if (filesToSend.length > 0) {
      await this.storage.sendMessage(
        this.currentChatId,
        this.currentUser.username,
        text,
        filesToSend[0],
        null,
        null,
        filesToSend
      );
    } else {
      await this.storage.sendMessage(this.currentChatId, this.currentUser.username, text);
    }
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
    if (!this.pendingFiles) this.pendingFiles = [];
    this.pendingFiles.push(...fileObjects);
    this.renderPendingAttachments();
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
    reader.onload = () => {
      const fileData = {
        name: filename,
        type: blob.type,
        size: blob.size,
        data: reader.result
      };
      if (!this.pendingFiles) this.pendingFiles = [];
      this.pendingFiles.push(fileData);
      this.renderPendingAttachments();
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

  updateMainActionButtonState() {
    if (!this.el.btnMainAction) return;
    const hasText = Boolean(this.el.messageInput && this.el.messageInput.value && this.el.messageInput.value.trim().length > 0);
    const hasFiles = Boolean(this.pendingFiles && this.pendingFiles.length > 0);
    const hasContent = hasText || hasFiles;

    if (hasContent) {
      // Есть текст или прикрепленные файлы: кнопка отправки (самолетик)
      this.el.btnMainAction.className = 'tg-send-btn state-send';
      this.el.btnMainAction.title = 'Отправить сообщение';
    } else {
      // Нет текста и нет файлов: микрофон или видеокружок
      if (this.recordMode === 'video') {
        this.el.btnMainAction.className = 'tg-send-btn state-video';
        this.el.btnMainAction.title = 'Видеокружок (клик — микрофон, зажатие — запись)';
      } else {
        this.el.btnMainAction.className = 'tg-send-btn state-mic';
        this.el.btnMainAction.title = 'Голосовое (клик — кружочек, зажатие — запись)';
      }
    }
  }

  renderPendingAttachments() {
    if (!this.el.composerAttachments) return;
    if (!this.pendingFiles || this.pendingFiles.length === 0) {
      this.el.composerAttachments.innerHTML = '';
      this.el.composerAttachments.classList.add('hidden');
      this.updateMainActionButtonState();
      return;
    }

    this.el.composerAttachments.classList.remove('hidden');
    this.el.composerAttachments.innerHTML = this.pendingFiles.map((f, idx) => {
      const isImg = f.type && f.type.startsWith('image/');
      const icon = isImg ? '🖼️' : '📄';
      return [
        '<div class="tg-attach-pill">',
        '  <span>' + icon + '</span>',
        '  <span class="tg-attach-pill-name" title="' + this.escape(f.name) + '">' + this.escape(f.name) + '</span>',
        '  <button type="button" class="tg-attach-pill-remove" data-idx="' + idx + '" title="Удалить">✕</button>',
        '</div>'
      ].join('');
    }).join('');

    this.el.composerAttachments.querySelectorAll('.tg-attach-pill-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        this.pendingFiles.splice(idx, 1);
        this.renderPendingAttachments();
      });
    });

    this.updateMainActionButtonState();
  }

  toggleRecordMode() {
    // Короткий клик переключает микрофон <-> видеокамера
    this.recordMode = this.recordMode === 'mic' ? 'video' : 'mic';
    this.updateMainActionButtonState();
  }

  async startVoiceRecording() {
    this.stopAllPlayingMedia();
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (e1) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      this.mediaStream = stream;

      // Если к моменту открытия микрофона пользователь уже отменил кнопку (и не зафиксировал запись)
      if (!this.isHoldingMainAction && !this.isRecordingLocked) {
        this.cleanupStream();
        return;
      }

      this.recordedChunks = [];

      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      const supportedVoiceTypes = isSafari ? [
        'audio/mp4',
        'audio/aac',
        'audio/webm;codecs=opus',
        'audio/webm'
      ] : [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus'
      ];
      let selectedAudioMime = '';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        selectedAudioMime = supportedVoiceTypes.find(t => MediaRecorder.isTypeSupported(t)) || '';
      }
      const recOptions = selectedAudioMime ? { mimeType: selectedAudioMime } : {};

      this.mediaRecorder = new MediaRecorder(this.mediaStream, recOptions);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        if (this.shouldSendRecorded && this.recordedChunks.length > 0) {
          const finalMime = selectedAudioMime || (this.recordedChunks[0] && this.recordedChunks[0].type) || 'audio/webm';
          const blob = new Blob(this.recordedChunks, { type: finalMime });
          const mediaId = 'voice_' + Date.now();
          await this.storage.saveMediaBlob(mediaId, blob);
          this._mediaBlobUrlCache.set(mediaId, URL.createObjectURL(blob));
          await this.storage.sendMessage(this.currentChatId, this.currentUser.username, '', null, {
            mediaId: mediaId,
            duration: Math.max(1, this.getElapsedSeconds())
          });
          await this.refreshData();
        }
        this.cleanupStream();
      };

      // timeslice 100мс — поток отдаётся непрерывно, первые слова пишутся моментально
      this.mediaRecorder.start(100);

      // Встраиваем таймер в строку сообщения (переписка свободна!)
      if (this.el.messageInput) this.el.messageInput.classList.add('hidden');
      if (this.el.composerRecordingBar) this.el.composerRecordingBar.classList.remove('hidden');
      if (this.el.composerRecHint) this.el.composerRecHint.innerText = 'Запись аудио...';
      this.startTimer(this.el.composerRecTimer);
    } catch (err) {
      console.warn('Microphone error:', err);
      this.cleanupStream();
      this.stopRecording(false);
    }
  }

  async startVideoCircleRecording() {
    this.stopAllPlayingMedia();
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 360 }, height: { ideal: 360 }, facingMode: 'user' },
          audio: true
        });
      } catch (e1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
            audio: true
          });
        } catch (e2) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
          });
        }
      }
      this.mediaStream = stream;

      // Если к моменту открытия камеры пользователь уже отменил кнопку (и не зафиксировал запись)
      if (!this.isHoldingMainAction && !this.isRecordingLocked) {
        this.cleanupStream();
        return;
      }

      this.el.videoStreamPreview.srcObject = this.mediaStream;
      this.recordedChunks = [];

      // Кросс-браузерный выбор MIME-типа (Safari предпочитает mp4, Chrome/Firefox - webm)
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      const supportedTypes = isSafari ? [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ] : [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4'
      ];
      let selectedMime = '';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        selectedMime = supportedTypes.find(t => MediaRecorder.isTypeSupported(t)) || '';
      }

      // Битрейт 350 kbps: кружочек получается сверхлегким (всего 150-250 КБ) и моментально сохраняется
      const recorderOptions = {
        videoBitsPerSecond: 350000
      };
      if (selectedMime) recorderOptions.mimeType = selectedMime;

      this.mediaRecorder = new MediaRecorder(this.mediaStream, recorderOptions);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        if (this.shouldSendRecorded && this.recordedChunks.length > 0) {
          const finalType = selectedMime || (this.recordedChunks[0] && this.recordedChunks[0].type) || 'video/webm';
          const blob = new Blob(this.recordedChunks, { type: finalType });
          const mediaId = 'circle_' + Date.now();
          await this.storage.saveMediaBlob(mediaId, blob);
          this._mediaBlobUrlCache.set(mediaId, URL.createObjectURL(blob));
          await this.storage.sendMessage(this.currentChatId, this.currentUser.username, '', null, null, {
            mediaId: mediaId,
            duration: Math.max(1, this.getElapsedSeconds())
          });
          await this.refreshData();
        }
        this.cleanupStream();
      };

      this.mediaRecorder.start(100);

      // Встраиваем таймер в строку сообщения, а кружок центрируем по экрану!
      if (this.el.messageInput) this.el.messageInput.classList.add('hidden');
      if (this.el.composerRecordingBar) this.el.composerRecordingBar.classList.remove('hidden');
      if (this.el.composerRecHint) this.el.composerRecHint.innerText = 'Запись кружочка...';
      if (this.el.videoRecordingPanel) this.el.videoRecordingPanel.classList.remove('hidden');
      this.startTimer(this.el.composerRecTimer);
    } catch (err) {
      console.warn('Camera error or blocked:', err);
      // Никогда не вызываем блокирующий confirm на смартфонах!
      this.cleanupStream();
      this.stopRecording(false);
    }
  }

  async sendDemoVideoCircle() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(25);

      // Находим поддерживаемый mime
      let demoMime = '';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        demoMime = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      }
      const recOpts = { videoBitsPerSecond: 250000 };
      if (demoMime) recOpts.mimeType = demoMime;

      const rec = new MediaRecorder(stream, recOpts);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: demoMime || 'video/webm' });
        const mediaId = 'circle_demo_' + Date.now();
        await this.storage.saveMediaBlob(mediaId, blob);
        this._mediaBlobUrlCache.set(mediaId, URL.createObjectURL(blob));
        await this.storage.sendMessage(this.currentChatId, this.currentUser.username, '', null, null, {
          mediaId: mediaId,
          duration: 3
        });
        await this.refreshData();
      };

      rec.start();
      let frame = 0;
      const animInterval = setInterval(() => {
        frame++;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 240, 240);

        // Пульсирующий круг
        const rad = 60 + Math.sin(frame * 0.2) * 20;
        const grad = ctx.createRadialGradient(120, 120, 10, 120, 120, rad);
        grad.addColorStop(0, '#38bdf8');
        grad.addColorStop(1, '#0284c7');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(120, 120, rad, 0, Math.PI * 2);
        ctx.fill();

        // Иконка камеры
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📹', 120, 115);

        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('@' + this.currentUser.username, 120, 155);

        if (frame >= 75) { // 3 секунды при 25 fps
          clearInterval(animInterval);
          if (rec.state !== 'inactive') rec.stop();
        }
      }, 40);
    } catch (demoErr) {
      console.error('Demo circle error:', demoErr);
    }
  }

  stopRecording(send = true) {
    this.shouldSendRecorded = send;
    this.isRecordingLocked = false;
    this.isHoldingMainAction = false;
    if (this.el.recordLock) {
      this.el.recordLock.classList.add('hidden');
      this.el.recordLock.classList.remove('locked');
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        if (typeof this.mediaRecorder.requestData === 'function') {
          this.mediaRecorder.requestData();
        }
      } catch (e) {}
      this.mediaRecorder.stop();
    } else {
      this.cleanupStream();
    }

    // Возвращаем поле ввода текста и скрываем панель записи
    if (this.el.messageInput) this.el.messageInput.classList.remove('hidden');
    if (this.el.composerRecordingBar) this.el.composerRecordingBar.classList.add('hidden');
    if (this.el.videoRecordingPanel) this.el.videoRecordingPanel.classList.add('hidden');
    clearInterval(this.recInterval);
    this.updateMainActionButtonState();
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
    if (timerEl) timerEl.innerText = '00:00';
    clearInterval(this.recInterval);
    this.recInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.recStartTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      if (timerEl) timerEl.innerText = m + ':' + s;

      // Максимальная длительность кружка — 59 секунд (авто-отправка)
      if (elapsed >= 59) {
        this.stopRecording(true);
      }
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
    if (this.el.profileDisplaynameVal) {
      this.el.profileDisplaynameVal.innerText = user.name || ('@' + username);
    }
    this.el.profileUsernameVal.innerText = '@' + username;
    this.el.profileBioVal.innerText = user.bio || 'О себе пока ничего не написано';

    if (this.el.btnChangeAvatar) {
      this.el.btnChangeAvatar.style.display = isOwn ? 'flex' : 'none';
    }
    if (this.el.btnEditProfile) {
      this.el.btnEditProfile.style.display = isOwn ? 'block' : 'none';
    }
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

  async editProfile() {
    const currentName = this.currentUser.name || ('@' + this.currentUser.username);
    const currentBio = this.currentUser.bio || '';

    const newName = prompt('Введите ваше имя:', currentName);
    if (newName === null) return;

    const newBio = prompt('Введите статус "О себе":', currentBio);
    if (newBio === null) return;

    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    const user = users.find(u => u.username.toLowerCase() === this.currentUser.username.toLowerCase());
    if (user) {
      user.name = newName.trim() || ('@' + this.currentUser.username);
      user.bio = newBio.trim();
      localStorage.setItem('gm_users', JSON.stringify(users));
    }

    this.currentUser.name = newName.trim() || ('@' + this.currentUser.username);
    this.currentUser.bio = newBio.trim();
    localStorage.setItem('gm_current_user', JSON.stringify(this.currentUser));

    if (this.el.profileDisplaynameVal) this.el.profileDisplaynameVal.innerText = this.currentUser.name;
    if (this.el.profileBioVal) this.el.profileBioVal.innerText = this.currentUser.bio;
    if (this.el.currentUserName) this.el.currentUserName.innerText = this.currentUser.name;
    await this.renderChatList();
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