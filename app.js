// ===================================================
// GLOBAL MESSENGER — FULL ENGINE WITH SEARCH & DIALOGS
// ===================================================

class GlobalMessenger {
  constructor() {
    this.config = window.GLOBAL_CONFIG || window.GM_CONFIG || {
      PRIMARY_ENDPOINT: 'https://script.google.com/macros/s/AKfycbzq1QJHelEdQ-H-XO7jAF2dBe73hxegP320C0kH80dsw76n4_hfygGnh0nWFRo_ufQJIw/exec',
      SYNC_INTERVAL_MS: 1500,
      LEGACY_UPLOAD_LIMIT_BYTES: 25 * 1024 * 1024,
      RESUMABLE_CHUNK_SIZE_BYTES: 8 * 1024 * 1024,
      MAX_FILE_SIZE_BYTES: 1024 * 1024 * 1024
    };

    this.user = null;
    this.session = null;
    this.currentChatId = 'dm:general';
    this.chatSeqs = {}; // per-chat sequence: { [chatId]: number }
    this.activeRequestId = 0; // token to cancel stale sync responses on fast switching
    this.syncAbortController = null;
    this.pollTimer = null;
    this.chatPollTimer = null;
    this.renderedMessageIds = new Set();
    this.activeLightboxData = null;
    this.profiles = new Map();
    this.activeProfileUsername = null;
    this.recorder = null;
    this.recordingStream = null;
    this.recordingChunks = [];
    this.recordingKind = null;
    this.recordingStartedAt = 0;
    this.recordingTimer = null;

    // Chat list, search & contact architecture
    this.chats = [];
    this.frequentUsers = [];
    this.recentSearches = [];
    this.knownUsers = new Set();
    this.searchMode = false;
    this.searchQuery = '';
    this.searchTimer = null;
    this.searchRequestId = 0;

    this.clearOldCaches();
    this.initElements();
    this.initEvents();
    this.restoreSession();
  }

  clearOldCaches() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        for (const reg of regs) reg.unregister();
      });
    }
    if ('caches' in window) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
    }
  }

  initElements() {
    this.el = {
      authScreen: document.getElementById('auth-screen'),
      authForm: document.getElementById('auth-form'),
      tabLogin: document.getElementById('tab-login'),
      tabRegister: document.getElementById('tab-register'),
      authUsername: document.getElementById('auth-username'),
      authPassword: document.getElementById('auth-password'),
      authSubmitBtn: document.getElementById('auth-submit-btn'),
      authStatus: document.getElementById('auth-status'),

      mainScreen: document.getElementById('main-screen'),
      sidebar: document.getElementById('sidebar'),
      currentUserAvatar: document.getElementById('current-user-avatar'),
      currentUserName: document.getElementById('current-user-name'),
      btnLogout: document.getElementById('btn-logout'),
      btnNewChat: document.getElementById('btn-new-chat'),
      btnProfile: document.getElementById('btn-profile'),
      btnSettings: document.getElementById('btn-settings'),
      btnChatProfile: document.getElementById('btn-chat-profile'),
      chatListCount: document.getElementById('chat-list-count'),

      chatSearch: document.getElementById('chat-search'),
      btnSearchClear: document.getElementById('btn-search-clear'),
      frequentUsersSection: document.getElementById('frequent-users-section'),
      frequentCarousel: document.getElementById('frequent-carousel'),
      searchHistorySection: document.getElementById('search-history-section'),
      searchHistoryList: document.getElementById('search-history-list'),
      btnClearSearchHistory: document.getElementById('btn-clear-search-history'),
      searchResultsSection: document.getElementById('search-results-section'),
      localResultsList: document.getElementById('local-results-list'),
      globalResultsList: document.getElementById('global-results-list'),
      chatList: document.getElementById('chat-list'),

      chatView: document.querySelector('.chat-view'),
      btnBack: document.getElementById('btn-back'),
      activeChatAvatar: document.getElementById('active-chat-avatar'),
      activeChatTitle: document.getElementById('active-chat-title'),
      activeChatStatus: document.getElementById('active-chat-status'),
      messagesContainer: document.getElementById('messages-container'),
      messagesFeed: document.getElementById('messages-feed'),

      messageInput: document.getElementById('message-input'),
      btnSend: document.getElementById('btn-send'),
      btnAttach: document.getElementById('btn-attach'),
      fileInput: document.getElementById('file-input'),
      btnVoice: document.getElementById('btn-voice'),
      btnVideoNote: document.getElementById('btn-video-note'),

      profileModal: document.getElementById('profile-modal'),
      settingsModal: document.getElementById('settings-modal'),
      settingsProfileLink: document.getElementById('settings-profile-link'),
      profileAvatarPreview: document.getElementById('profile-avatar-preview'),
      profileDisplayTitle: document.getElementById('profile-display-title'),
      profileUsernameLabel: document.getElementById('profile-username-label'),
      profileEditFields: document.getElementById('profile-edit-fields'),
      profileDisplayName: document.getElementById('profile-display-name'),
      profileBio: document.getElementById('profile-bio'),
      profileBioReadonly: document.getElementById('profile-bio-readonly'),
      profileSave: document.getElementById('btn-profile-save'),
      profileAvatarInput: document.getElementById('profile-avatar-input'),
      btnAvatarChange: document.getElementById('btn-avatar-change'),

      recorderPanel: document.getElementById('recorder-panel'),
      recorderPreview: document.getElementById('recorder-preview'),
      recorderTitle: document.getElementById('recorder-title'),
      recorderTimer: document.getElementById('recorder-timer'),
      btnRecordCancel: document.getElementById('btn-record-cancel'),
      btnRecordStop: document.getElementById('btn-record-stop'),

      uploadCard: document.getElementById('upload-progress-card'),
      uploadFileName: document.getElementById('upload-file-name'),
      uploadFileStats: document.getElementById('upload-file-stats'),
      uploadProgressFill: document.getElementById('upload-progress-fill'),

      lightboxModal: document.getElementById('lightbox-modal'),
      lightboxImg: document.getElementById('lightbox-img'),
      lightboxTitle: document.getElementById('lightbox-title'),
      lightboxDownloadBtn: document.getElementById('lightbox-download-btn'),
      lightboxCloseBtn: document.getElementById('lightbox-close-btn')
    };
    this.authMode = 'login';
  }

  initEvents() {
    this.el.tabLogin.addEventListener('click', () => this.setAuthMode('login'));
    this.el.tabRegister.addEventListener('click', () => this.setAuthMode('register'));
    this.el.authForm.addEventListener('submit', (e) => this.handleAuthSubmit(e));
    this.el.btnLogout.addEventListener('click', () => this.logout());
    this.el.btnProfile.addEventListener('click', () => this.openProfile(this.user.username, true));
    this.el.btnSettings.addEventListener('click', () => this.openModal(this.el.settingsModal));
    this.el.settingsProfileLink.addEventListener('click', () => {
      this.closeModal(this.el.settingsModal);
      this.openProfile(this.user.username, true);
    });
    this.el.btnChatProfile.addEventListener('click', () => {
      const chat = this.chats.find(c => c.id === this.currentChatId);
      if (chat && chat.targetUser) this.openProfile(chat.targetUser, false);
    });

    this.el.btnSend.addEventListener('click', () => this.sendTextMessage());
    this.el.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendTextMessage();
      }
    });

    this.el.messageInput.addEventListener('input', () => {
      this.el.messageInput.style.height = 'auto';
      this.el.messageInput.style.height = Math.min(this.el.messageInput.scrollHeight, 120) + 'px';
    });

    this.el.btnAttach.addEventListener('click', () => this.el.fileInput.click());
    this.el.fileInput.addEventListener('change', (e) => this.handleFileSelection(e));
    this.el.btnVoice.addEventListener('click', () => this.startRecording('audio'));
    this.el.btnVideoNote.addEventListener('click', () => this.startRecording('videoNote'));
    this.el.btnRecordCancel.addEventListener('click', () => this.stopRecording(false));
    this.el.btnRecordStop.addEventListener('click', () => this.stopRecording(true));
    this.el.btnAvatarChange.addEventListener('click', () => this.el.profileAvatarInput.click());
    this.el.profileAvatarInput.addEventListener('change', (e) => this.changeProfileAvatar(e));
    this.el.profileSave.addEventListener('click', () => this.saveProfile());
    document.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', () => {
      const modal = document.getElementById(el.dataset.closeModal);
      if (modal) this.closeModal(modal);
    }));

    this.el.btnNewChat.addEventListener('click', () => {
      this.el.chatSearch.focus();
      this.handleSearchFocus();
    });

    // SEARCH EVENTS
    this.el.chatSearch.addEventListener('focus', () => this.handleSearchFocus());
    this.el.chatSearch.addEventListener('input', () => this.handleSearchInput(this.el.chatSearch.value));
    this.el.btnSearchClear.addEventListener('click', () => this.closeSearch());
    this.el.btnClearSearchHistory.addEventListener('click', () => {
      this.recentSearches = [];
      this.saveUserStorage();
      this.renderSearchHistory();
    });

    // MOBILE BACK BUTTON
    this.el.btnBack.addEventListener('click', () => {
      if (this.el.chatView) this.el.chatView.classList.remove('active');
    });

    // ESCAPE KEY
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!this.el.lightboxModal.classList.contains('hidden')) {
          this.closeLightbox();
        } else if (this.searchMode) {
          this.closeSearch();
        }
      }
    });

    // LIGHTBOX EVENTS
    this.el.lightboxCloseBtn.addEventListener('click', () => this.closeLightbox());
    this.el.lightboxModal.querySelector('.lightbox-backdrop').addEventListener('click', () => this.closeLightbox());
    this.el.lightboxDownloadBtn.addEventListener('click', () => {
      if (this.activeLightboxData) {
        this.downloadMedia(this.activeLightboxData.url, this.activeLightboxData.name);
      }
    });
  }

  setAuthMode(mode) {
    this.authMode = mode;
    this.el.tabLogin.classList.toggle('active', mode === 'login');
    this.el.tabRegister.classList.toggle('active', mode === 'register');
    this.el.authSubmitBtn.innerText = mode === 'login' ? 'Войти в систему' : 'Зарегистрироваться';
    this.el.authStatus.innerText = '';
  }

  async apiRequest(action, payload = {}, signal = null) {
    const postData = JSON.stringify({ action, payload });
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: postData
    };
    if (signal) options.signal = signal;
    const response = await fetch(this.config.PRIMARY_ENDPOINT, options);
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Ошибка запроса');
    return data; // backend returns { ok, messages, ... } directly
  }

  async handleAuthSubmit(e) {
    e.preventDefault();
    const username = this.el.authUsername.value.trim();
    const password = this.el.authPassword.value;

    this.el.authSubmitBtn.disabled = true;
    this.el.authStatus.className = 'status-msg';
    this.el.authStatus.innerText = 'Подключение к серверу...';

    try {
      const result = await this.apiRequest(this.authMode, {
        username,
        password,
        deviceName: navigator.userAgent.includes('Mobile') ? 'Телефон' : 'Компьютер'
      });

      this.session = result.session;
      this.user = result.user;
      localStorage.setItem('gm_session', JSON.stringify(this.session));
      localStorage.setItem('gm_user', JSON.stringify(this.user));

      this.showMainScreen();
    } catch (err) {
      this.el.authStatus.className = 'status-msg error';
      this.el.authStatus.innerText = err.message;
    } finally {
      this.el.authSubmitBtn.disabled = false;
    }
  }

  restoreSession() {
    const s = localStorage.getItem('gm_session');
    const u = localStorage.getItem('gm_user');
    if (s && u) {
      try {
        this.session = JSON.parse(s);
        this.user = JSON.parse(u);
        this.showMainScreen();
      } catch (e) {
        localStorage.removeItem('gm_session');
        localStorage.removeItem('gm_user');
      }
    }
  }

  showMainScreen() {
    this.el.authScreen.classList.add('hidden');
    this.el.mainScreen.classList.remove('hidden');
    this.el.currentUserName.innerText = this.user.displayName || ('@' + this.user.username);
    this.setAvatar(this.el.currentUserAvatar, this.user.username, this.user.avatarUrl);

    // Скрываем карусель в нормальном режиме — только при поиске
    if (this.el.frequentUsersSection) this.el.frequentUsersSection.classList.add('hidden');

    this.loadUserStorage();
    this.renderChatList();
    this.startPolling();

    // Загружаем список диалогов с сервера (для восстановления на новом устройстве)
    this.fetchUserChats();
    this.loadProfile(this.user.username).catch(() => {});
  }

  async logout() {
    const token = this.session && this.session.sessionToken;
    if (token) {
      try { await this.apiRequest('logout', { sessionToken: token }); } catch (error) {}
    }
    localStorage.removeItem('gm_session');
    localStorage.removeItem('gm_user');
    this.session = null;
    this.user = null;
    this.stopPolling();
    this.stopRecording(false);
    this.renderedMessageIds.clear();
    this.el.messagesFeed.innerHTML = '';
    this.el.mainScreen.classList.add('hidden');
    this.el.authScreen.classList.remove('hidden');
    this.el.authPassword.value = '';
  }

  // ===================================================
  // CHAT LIST, FREQUENT USERS & STORAGE ENGINE
  // ===================================================

  getDmChatId(u1, u2) {
    if (!u1 || !u2) return 'dm:general';
    const sorted = [u1.trim().toLowerCase(), u2.trim().toLowerCase()].sort();
    return 'dm:' + sorted.join(':');
  }

  getAvatarGradient(str) {
    if (!str || str === 'general' || str === 'Общий чат') return 'linear-gradient(135deg, #3390ec, #1f69b3)';
    const gradients = [
      'linear-gradient(135deg, #e17076, #ff885e)',
      'linear-gradient(135deg, #faa357, #f68136)',
      'linear-gradient(135deg, #3390ec, #0077d7)',
      'linear-gradient(135deg, #a695e7, #856be2)',
      'linear-gradient(135deg, #7bc862, #53a73c)',
      'linear-gradient(135deg, #6dc9cb, #3caab2)',
      'linear-gradient(135deg, #ee7aae, #d8508e)'
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash << 5) - hash + str.charCodeAt(i);
    return gradients[Math.abs(hash) % gradients.length];
  }

  setAvatar(element, username, avatarUrl = '') {
    if (!element) return;
    element.innerText = avatarUrl ? '' : ((username && username[0]) || '?').toUpperCase();
    element.style.background = avatarUrl
      ? `url("${String(avatarUrl).replace(/["\\]/g, '')}") center/cover no-repeat`
      : this.getAvatarGradient(username);
  }

  openModal(modal) {
    if (modal) modal.classList.remove('hidden');
  }

  closeModal(modal) {
    if (modal) modal.classList.add('hidden');
  }

  async loadProfile(username) {
    const clean = String(username || '').replace(/^@/, '').toLowerCase();
    if (!clean) return null;
    try {
      const res = await this.apiRequest('getProfile', {
        sessionToken: this.session.sessionToken,
        username: clean
      });
      const profile = res.profile || { username: clean, displayName: '@' + clean, bio: '', avatarUrl: '' };
      this.profiles.set(clean, profile);
      if (clean === this.user.username.toLowerCase()) {
        this.user = { ...this.user, ...profile };
        localStorage.setItem('gm_user', JSON.stringify(this.user));
        this.el.currentUserName.innerText = profile.displayName || ('@' + clean);
        this.setAvatar(this.el.currentUserAvatar, clean, profile.avatarUrl);
      }
      this.chats.forEach(chat => {
        if (chat.targetUser && chat.targetUser.toLowerCase() === clean) {
          chat.displayName = profile.displayName || ('@' + clean);
          chat.avatarUrl = profile.avatarUrl || '';
        }
      });
      this.renderChatList();
      return profile;
    } catch (error) {
      const fallback = { username: clean, displayName: '@' + clean, bio: '', avatarUrl: '' };
      this.profiles.set(clean, fallback);
      return fallback;
    }
  }

  async openProfile(username, editable) {
    const clean = String(username || '').replace(/^@/, '').toLowerCase();
    this.activeProfileUsername = clean;
    const cached = this.profiles.get(clean) || {
      username: clean,
      displayName: editable && this.user.displayName ? this.user.displayName : '@' + clean,
      bio: '',
      avatarUrl: editable && this.user.avatarUrl ? this.user.avatarUrl : ''
    };
    this.renderProfileModal(cached, editable);
    this.openModal(this.el.profileModal);
    const profile = await this.loadProfile(clean);
    if (this.activeProfileUsername === clean) this.renderProfileModal(profile, editable);
  }

  renderProfileModal(profile, editable) {
    this.setAvatar(this.el.profileAvatarPreview, profile.username, profile.avatarUrl);
    this.el.profileDisplayTitle.innerText = profile.displayName || ('@' + profile.username);
    this.el.profileUsernameLabel.innerText = '@' + profile.username;
    this.el.profileEditFields.classList.toggle('hidden', !editable);
    this.el.profileSave.classList.toggle('hidden', !editable);
    this.el.btnAvatarChange.classList.toggle('hidden', !editable);
    this.el.profileBioReadonly.classList.toggle('hidden', editable);
    if (editable) {
      this.el.profileDisplayName.value = profile.displayName && profile.displayName[0] !== '@' ? profile.displayName : '';
      this.el.profileBio.value = profile.bio || '';
    } else {
      this.el.profileBioReadonly.innerText = profile.bio || 'Пользователь пока ничего не рассказал о себе.';
    }
  }

  async changeProfileAvatar(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
      alert('Для аватара выберите изображение до 2 МБ');
      return;
    }
    this.el.btnAvatarChange.disabled = true;
    this.el.btnAvatarChange.innerText = 'Загрузка…';
    try {
      const uploaded = await this.uploadFileToServer(file, this.currentChatId, () => {});
      const avatarUrl = uploaded.mediaUrl;
      const profile = this.profiles.get(this.user.username.toLowerCase()) || {};
      profile.avatarUrl = avatarUrl;
      profile.username = this.user.username.toLowerCase();
      this.profiles.set(profile.username, profile);
      this.setAvatar(this.el.profileAvatarPreview, profile.username, avatarUrl);
    } catch (error) {
      alert('Не удалось загрузить аватар: ' + error.message);
    } finally {
      this.el.btnAvatarChange.disabled = false;
      this.el.btnAvatarChange.innerText = 'Сменить фото';
    }
  }

  async saveProfile() {
    const username = this.user.username.toLowerCase();
    const cached = this.profiles.get(username) || {};
    this.el.profileSave.disabled = true;
    try {
      const res = await this.apiRequest('updateProfile', {
        sessionToken: this.session.sessionToken,
        displayName: this.el.profileDisplayName.value.trim(),
        bio: this.el.profileBio.value.trim(),
        avatarUrl: cached.avatarUrl || ''
      });
      this.profiles.set(username, res.profile);
      this.user = { ...this.user, ...res.profile };
      localStorage.setItem('gm_user', JSON.stringify(this.user));
      this.el.currentUserName.innerText = res.profile.displayName || ('@' + username);
      this.setAvatar(this.el.currentUserAvatar, username, res.profile.avatarUrl);
      this.closeModal(this.el.profileModal);
      this.renderChatList();
    } catch (error) {
      alert('Не удалось сохранить профиль: ' + error.message);
    } finally {
      this.el.profileSave.disabled = false;
    }
  }

  loadUserStorage() {
    if (!this.user) return;
    const uid = this.user.username.toLowerCase();

    // 1. Chats
    try {
      const savedChats = localStorage.getItem('gm_chats_' + uid);
      this.chats = savedChats ? JSON.parse(savedChats) : [];
    } catch (e) {
      this.chats = [];
    }
    if (!this.chats.some(c => c.id === 'dm:general')) {
      this.chats.unshift({
        id: 'dm:general',
        title: 'Общий чат',
        isGeneral: true,
        lastMsg: 'Добро пожаловать в мессенджер',
        lastTime: '',
        lastTimestamp: 0
      });
    }

    // 2. Frequent users
    try {
      const savedFreq = localStorage.getItem('gm_frequent_' + uid);
      this.frequentUsers = savedFreq ? JSON.parse(savedFreq) : [];
    } catch (e) {
      this.frequentUsers = [];
    }

    // 3. Recent searches
    try {
      const savedRecents = localStorage.getItem('gm_recent_searches_' + uid);
      this.recentSearches = savedRecents ? JSON.parse(savedRecents) : [];
    } catch (e) {
      this.recentSearches = [];
    }

    // 4. Per-chat sequences
    try {
      const savedSeqs = localStorage.getItem('gm_seqs_' + uid);
      this.chatSeqs = savedSeqs ? JSON.parse(savedSeqs) : {};
    } catch (e) {
      this.chatSeqs = {};
    }

    // Populate known users registry
    this.knownUsers = new Set();
    this.frequentUsers.forEach(f => this.knownUsers.add(f.username.toLowerCase()));
    this.recentSearches.forEach(r => this.knownUsers.add(r.toLowerCase()));
    this.chats.forEach(c => {
      if (c.targetUser) this.knownUsers.add(c.targetUser.toLowerCase());
    });
  }

  saveUserStorage() {
    if (!this.user) return;
    const uid = this.user.username.toLowerCase();
    localStorage.setItem('gm_chats_' + uid, JSON.stringify(this.chats));
    localStorage.setItem('gm_frequent_' + uid, JSON.stringify(this.frequentUsers));
    localStorage.setItem('gm_recent_searches_' + uid, JSON.stringify(this.recentSearches));
    localStorage.setItem('gm_seqs_' + uid, JSON.stringify(this.chatSeqs));
  }

  getChatCacheKey(chatId) {
    if (!this.user) return null;
    const uid = this.user.username.toLowerCase();
    return `gm_msgs_${uid}_${chatId}`;
  }

  getChatMessages(chatId) {
    const key = this.getChatCacheKey(chatId);
    if (!key) return [];
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  saveChatMessages(chatId, messages) {
    const key = this.getChatCacheKey(chatId);
    if (!key) return;
    try {
      // Сохраняем последние 200 сообщений чата в кэше для быстрого открытия
      const toSave = (messages || []).slice(-200);
      localStorage.setItem(key, JSON.stringify(toSave));
    } catch (e) {
      console.warn('Ошибка сохранения сообщений чата в localStorage:', e);
    }
  }

  appendMessageToCache(chatId, msg) {
    if (!chatId || !msg) return;
    const list = this.getChatMessages(chatId);
    const msgId = msg.id || msg.messageId;
    if (msgId && list.some(m => (m.id || m.messageId) === msgId)) return;
    list.push(msg);
    this.saveChatMessages(chatId, list);
  }

  recordUserInteraction(targetUser) {
    if (!targetUser) return;
    const clean = targetUser.replace('@', '').trim().toLowerCase();
    if (!clean || (this.user && clean === this.user.username.toLowerCase())) return;

    this.knownUsers.add(clean);

    // Update frequent users
    const existing = this.frequentUsers.find(f => f.username.toLowerCase() === clean);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastTime = Date.now();
    } else {
      this.frequentUsers.push({ username: clean, count: 1, lastTime: Date.now() });
    }
    this.frequentUsers.sort((a, b) => (b.count * 1000 + b.lastTime) - (a.count * 1000 + a.lastTime));
    if (this.frequentUsers.length > 20) this.frequentUsers = this.frequentUsers.slice(0, 20);

    // Update recent searches
    this.recentSearches = [clean, ...this.recentSearches.filter(u => u.toLowerCase() !== clean)].slice(0, 15);

    this.saveUserStorage();
    if (this.searchMode) {
      this.renderFrequentUsers();
    }
  }

  openChatWithUser(targetUsername) {
    const clean = targetUsername.replace('@', '').trim().toLowerCase();
    if (!clean) return;
    const chatId = this.getDmChatId(this.user.username, clean);
    const title = '@' + clean;

    this.recordUserInteraction(clean);

    let chat = this.chats.find(c => c.id === chatId);
    if (!chat) {
      chat = {
        id: chatId,
        title,
        targetUser: clean,
        lastMsg: 'Диалог начат',
        lastTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        lastTimestamp: Date.now()
      };
      this.chats.splice(1, 0, chat);
    }

    this.saveUserStorage();
    this.closeSearch();
    this.renderChatList();
    this.openChat(chatId, title, clean);
  }

  openChat(chatId, title, targetUser = null) {
    // 1. Увеличиваем токен переключения, отменяем старый сетевой запрос
    this.activeRequestId++;
    if (this.syncAbortController) {
      try { this.syncAbortController.abort(); } catch (e) {}
      this.syncAbortController = null;
    }

    this.currentChatId = chatId;
    this.renderedMessageIds.clear();
    this.el.messagesFeed.innerHTML = '';
    this.el.activeChatTitle.innerText = title;

    if (chatId === 'dm:general') {
      this.el.activeChatAvatar.innerText = '🌐';
      this.el.activeChatAvatar.style.background = 'linear-gradient(135deg, #3390ec, #1f69b3)';
      this.el.activeChatStatus.innerHTML = '<span class="badge-tag-type general">Общий канал</span> • в сети';
    } else {
      const u = targetUser || title.replace('@', '');
      const profile = this.profiles.get(u.toLowerCase());
      this.setAvatar(this.el.activeChatAvatar, u, profile && profile.avatarUrl);
      if (profile && profile.displayName) this.el.activeChatTitle.innerText = profile.displayName;
      this.el.activeChatStatus.innerHTML = '<span class="badge-tag-type dm">Личный диалог</span> • в сети';
      if (!profile) this.loadProfile(u).then(loaded => {
        if (this.currentChatId === chatId && loaded) {
          this.setAvatar(this.el.activeChatAvatar, u, loaded.avatarUrl);
          this.el.activeChatTitle.innerText = loaded.displayName || ('@' + u);
        }
      }).catch(() => {});
    }

    // 2. Мгновенно отображаем сообщения из локального кэша для этого chatId
    const cachedMessages = this.getChatMessages(chatId);
    if (cachedMessages.length > 0) {
      cachedMessages.forEach(msg => {
        this.appendMessage(msg, false, chatId);
      });
    }

    this.renderChatList();

    if (this.el.chatView) this.el.chatView.classList.add('active');
    
    // 3. Запускаем досинхронизацию только свежих сообщений
    this.syncMessages();
  }

  renderFrequentUsers() {
    // Карусель частых контактов полностью отключена по требованию
    return;
  }

  renderChatList() {
    const list = this.el.chatList;
    if (!list) return;
    list.innerHTML = '';
    if (this.el.chatListCount) this.el.chatListCount.innerText = String(Math.max(0, this.chats.length - 1));

    this.chats.forEach((chat, index) => {
      if (index === 0 && chat.isGeneral) {
        const label = document.createElement('div');
        label.className = 'sidebar-section-header';
        label.innerHTML = '<span class="sidebar-section-title">Закреплено</span>';
        list.appendChild(label);
      }
      if (!chat.isGeneral && (index === 0 || this.chats[index - 1].isGeneral)) {
        const label = document.createElement('div');
        label.className = 'sidebar-section-header';
        label.innerHTML = '<span class="sidebar-section-title">Личные диалоги</span>';
        list.appendChild(label);
      }
      const isActive = chat.id === this.currentChatId;
      const item = document.createElement('div');
      item.className = 'chat-item' + (isActive ? ' active' : '');
      item.setAttribute('data-chat-id', chat.id);

      let avatarHtml = '';
      if (chat.isGeneral) {
        avatarHtml = '<div class="avatar general-avatar">🌐</div>';
      } else {
        const u = chat.targetUser || chat.title.replace('@', '');
        const initial = u ? u[0].toUpperCase() : '?';
        const avatarStyle = chat.avatarUrl
          ? `url(&quot;${this.escapeHtml(chat.avatarUrl)}&quot;) center/cover no-repeat`
          : this.getAvatarGradient(u);
        avatarHtml = `<div class="avatar" style="background:${avatarStyle}">${chat.avatarUrl ? '' : initial}</div>`;
      }

      const badgeHtml = chat.isGeneral
        ? '<span class="chat-type-badge general">Канал</span>'
        : '<span class="chat-type-badge dm">Диалог</span>';

      item.innerHTML = `
        ${avatarHtml}
        <div class="chat-item-meta">
          <div class="chat-item-top">
            <div class="chat-title-wrap">
              ${chat.isGeneral ? '<span class="chat-pin">◆</span>' : ''}
              <span class="chat-title">${this.escapeHtml(chat.displayName || chat.title)}</span>
              ${badgeHtml}
            </div>
            <span class="chat-time">${this.escapeHtml(chat.lastTime || '')}</span>
          </div>
          <div class="chat-preview">${this.escapeHtml(chat.lastMsg || 'Нажмите, чтобы начать общение')}</div>
        </div>
        ${chat.unread ? `<span class="unread-badge">${Math.min(99, chat.unread)}</span>` : ''}
      `;

      item.addEventListener('click', () => {
        chat.unread = 0;
        this.saveUserStorage();
        this.openChat(chat.id, chat.displayName || chat.title, chat.targetUser);
      });

      list.appendChild(item);
    });
  }

  // ===================================================
  // 2-TIER SEARCH & RECENT SEARCH HISTORY
  // ===================================================

  handleSearchFocus() {
    this.searchMode = true;
    if (!this.el.chatSearch.value.trim()) {
      this.el.btnSearchClear.classList.remove('hidden');
      if (this.el.frequentUsersSection) this.el.frequentUsersSection.classList.add('hidden');
      this.el.searchHistorySection.classList.remove('hidden');
      this.el.searchResultsSection.classList.add('hidden');
      this.el.chatList.classList.add('hidden');
      this.renderSearchHistory();
    } else {
      this.handleSearchInput(this.el.chatSearch.value);
    }
  }

  renderSearchHistory() {
    const list = this.el.searchHistoryList;
    if (!list) return;
    list.innerHTML = '';

    if (this.recentSearches.length === 0) {
      list.innerHTML = '<div class="empty-search-hint">Нет недавних поисков</div>';
      return;
    }

    this.recentSearches.forEach(u => {
      const initial = (u[0] || '?').toUpperCase();
      const grad = this.getAvatarGradient(u);

      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <div class="avatar" style="width:38px;height:38px;font-size:15px;background:${grad}">${initial}</div>
        <div class="history-item-meta">
          <div class="history-title">@${this.escapeHtml(u)}</div>
          <div class="history-subtitle">Недавний контакт</div>
        </div>
        <button class="history-remove-btn" title="Удалить из истории">✕</button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.history-remove-btn')) return;
        this.openChatWithUser(u);
      });

      item.querySelector('.history-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.recentSearches = this.recentSearches.filter(x => x.toLowerCase() !== u.toLowerCase());
        this.saveUserStorage();
        this.renderSearchHistory();
      });

      list.appendChild(item);
    });
  }

  createSearchResultElement(username, subtitle) {
    const clean = username.replace('@', '');
    const initial = (clean[0] || '?').toUpperCase();
    const grad = this.getAvatarGradient(clean);

    const el = document.createElement('div');
    el.className = 'search-result-item';
    el.innerHTML = `
      <div class="avatar" style="width:38px;height:38px;font-size:15px;background:${grad}">${initial}</div>
      <div class="search-item-meta">
        <div class="search-item-title">@${this.escapeHtml(clean)}</div>
        <div class="search-item-sub">${this.escapeHtml(subtitle)}</div>
      </div>
    `;
    el.addEventListener('click', () => {
      this.openChatWithUser(clean);
    });
    return el;
  }

  handleSearchInput(q) {
    q = q.trim().toLowerCase().replace(/^@/, '');
    this.searchQuery = q;
    this.searchMode = true;

    if (!q) {
      this.handleSearchFocus();
      return;
    }

    this.el.btnSearchClear.classList.remove('hidden');
    if (this.el.frequentUsersSection) this.el.frequentUsersSection.classList.add('hidden');
    this.el.searchHistorySection.classList.add('hidden');
    this.el.searchResultsSection.classList.remove('hidden');
    this.el.chatList.classList.add('hidden');

    const seenUsers = new Set();
    const localMatches = [];

    // Tier 1: Search among close contacts & active chats
    this.frequentUsers.forEach(f => {
      const u = f.username.toLowerCase();
      if (u.includes(q) && !seenUsers.has(u)) {
        seenUsers.add(u);
        localMatches.push({ username: f.username, type: 'Близкий контакт' });
      }
    });

    this.chats.forEach(c => {
      if (c.targetUser) {
        const u = c.targetUser.toLowerCase();
        if (u.includes(q) && !seenUsers.has(u)) {
          seenUsers.add(u);
          localMatches.push({ username: c.targetUser, type: 'Существующий чат' });
        }
      }
    });

    this.recentSearches.forEach(r => {
      const u = r.toLowerCase();
      if (u.includes(q) && !seenUsers.has(u)) {
        seenUsers.add(u);
        localMatches.push({ username: r, type: 'Недавний контакт' });
      }
    });

    const localList = this.el.localResultsList;
    localList.innerHTML = '';
    const localGroup = document.getElementById('local-results-group');
    if (localMatches.length > 0) {
      localGroup.classList.remove('hidden');
      localMatches.forEach(m => {
        localList.appendChild(this.createSearchResultElement(m.username, m.type));
      });
    } else {
      localGroup.classList.add('hidden');
    }

    // Tier 2: Global Search (known users & direct chat option)
    const globalMatches = [];
    this.knownUsers.forEach(u => {
      if (u.includes(q) && !seenUsers.has(u)) {
        seenUsers.add(u);
        globalMatches.push(u);
      }
    });

    const globalList = this.el.globalResultsList;
    globalList.innerHTML = '';

    // If query >= 2 characters, offer direct message
    if (!seenUsers.has(q) && q.length >= 2) {
      const directEl = document.createElement('div');
      directEl.className = 'search-result-item';
      directEl.innerHTML = `
        <div class="avatar" style="width:38px;height:38px;font-size:15px;background:${this.getAvatarGradient(q)}">@</div>
        <div class="search-item-meta">
          <div class="search-item-title">@${this.escapeHtml(q)}</div>
          <div class="search-item-sub" style="color:var(--accent);font-weight:600;">Начать новый диалог</div>
        </div>
      `;
      directEl.addEventListener('click', () => {
        this.openChatWithUser(q);
      });
      globalList.appendChild(directEl);
    }

    globalMatches.forEach(u => {
      globalList.appendChild(this.createSearchResultElement(u, 'Пользователь сети'));
    });

    if (globalList.children.length === 0 && localMatches.length === 0) {
      globalList.innerHTML = `<div class="empty-search-hint">По запросу «${this.escapeHtml(q)}» ничего не найдено</div>`;
    }

    // Серверный поиск с защитой от устаревших ответов.
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const requestId = ++this.searchRequestId;
    if (q.length >= 2) {
      this.searchTimer = setTimeout(async () => {
        try {
          const res = await this.apiRequest('searchUsers', {
            sessionToken: this.session.sessionToken,
            query: q
          });
          if (requestId !== this.searchRequestId || q !== this.searchQuery || !this.searchMode) return;
          (res.users || []).forEach(user => {
            const username = String(user.username || '').toLowerCase();
            if (!username || seenUsers.has(username)) return;
            seenUsers.add(username);
            globalList.appendChild(this.createSearchResultElement(username, 'Пользователь Global'));
          });
          const empty = globalList.querySelector('.empty-search-hint');
          if (empty && globalList.children.length > 1) empty.remove();
        } catch (error) {
          // Локальные результаты остаются доступными даже при временной ошибке сети.
        }
      }, 260);
    }
  }

  closeSearch() {
    this.searchMode = false;
    this.searchRequestId++;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchQuery = '';
    this.el.chatSearch.value = '';
    this.el.btnSearchClear.classList.add('hidden');
    this.el.searchHistorySection.classList.add('hidden');
    this.el.searchResultsSection.classList.add('hidden');
    if (this.el.frequentUsersSection) this.el.frequentUsersSection.classList.add('hidden');
    this.el.chatList.classList.remove('hidden');
    this.renderChatList();
  }

  // ===================================================
  // MESSAGING & EXACT FORMAT STORAGE
  // ===================================================

  async sendTextMessage() {
    const text = this.el.messageInput.value.trim();
    if (!text) return;

    this.el.messageInput.value = '';
    this.el.messageInput.style.height = 'auto';

    const targetChatId = this.currentChatId;
    const tempId = 'tmp_' + Date.now();
    const optimisticMsg = {
      id: tempId,
      messageId: tempId,
      chatId: targetChatId,
      senderUsername: this.user.username,
      content: { text },
      createdAt: new Date().toISOString()
    };

    this.appendMessage(optimisticMsg, true, targetChatId);

    try {
      const sendPayload = {
        sessionToken: this.session.sessionToken,
        chatId: targetChatId,
        messageType: 'text',
        text
      };
      const res = await this.apiRequest('send', sendPayload);
      if (res && res.message) {
        const currentSeq = this.chatSeqs[targetChatId] || 0;
        this.chatSeqs[targetChatId] = Math.max(currentSeq, res.message.seq);
        this.saveUserStorage();
        // Сохраняем подтвержденное сообщение в локальный кэш этого чата
        this.appendMessageToCache(targetChatId, this.normalizeServerMsg(res.message));
      }
    } catch (err) {
      console.error('Ошибка отправки:', err);
    }
  }

  readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const base64 = result.substring(result.indexOf(',') + 1);
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });
  }

  async uploadFileToServer(file, chatId, onProgress) {
    const legacyLimit = this.config.LEGACY_UPLOAD_LIMIT_BYTES || (25 * 1024 * 1024);
    if (file.size > legacyLimit) {
      return this.uploadFileResumable(file, chatId, onProgress);
    }

    onProgress(25, 'Подготовка файла к отправке...');
    const base64Content = await this.readFileAsBase64(file);

    onProgress(60, 'Сохранение файла в облачном хранилище...');

    const uploadRes = await this.apiRequest('uploadMedia', {
      sessionToken: this.session.sessionToken,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64: base64Content
    });

    if (!uploadRes || !uploadRes.ok) {
      throw new Error(uploadRes && uploadRes.error ? uploadRes.error : 'Не удалось загрузить файл');
    }

    onProgress(100, 'Готово!');
    return {
      fileId: uploadRes.fileId || '',
      mediaUrl: uploadRes.mediaUrl,
      downloadUrl: uploadRes.downloadUrl || uploadRes.mediaUrl,
      checksum: uploadRes.checksum || ''
    };
  }

  async uploadFileResumable(file, chatId, onProgress) {
    const chunkSize = this.config.RESUMABLE_CHUNK_SIZE_BYTES || (8 * 1024 * 1024);
    onProgress(1, 'Создание защищённой сессии загрузки...');
    const start = await this.apiRequest('uploadMedia', {
      sessionToken: this.session.sessionToken,
      operation: 'startResumable',
      chatId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size
    });
    if (!start || !start.ok || !start.sessionUrl) {
      throw new Error(start && start.error ? start.error : 'Не удалось создать сессию загрузки');
    }

    let offset = 0;
    let driveFile = null;
    while (offset < file.size) {
      const endExclusive = Math.min(file.size, offset + chunkSize);
      const response = await this.putResumableChunkWithRetry(
        start.sessionUrl,
        file.slice(offset, endExclusive),
        offset,
        endExclusive,
        file.size,
        file.type || 'application/octet-stream'
      );
      if (response.status === 200 || response.status === 201) {
        driveFile = await response.json();
        offset = file.size;
      } else if (response.status === 308) {
        const range = response.headers.get('Range');
        const match = range && range.match(/bytes=0-(\d+)/i);
        offset = match ? Number(match[1]) + 1 : endExclusive;
      } else {
        throw new Error('Хранилище отклонило часть файла: HTTP ' + response.status);
      }
      onProgress(
        Math.min(98, Math.max(2, Math.round((offset / file.size) * 98))),
        `Передано ${this.formatBytes(offset)} из ${this.formatBytes(file.size)}...`
      );
    }

    if (!driveFile || !driveFile.id) throw new Error('Хранилище не подтвердило завершение загрузки');
    const finished = await this.apiRequest('uploadMedia', {
      sessionToken: this.session.sessionToken,
      operation: 'finishResumable',
      chatId,
      fileId: driveFile.id,
      expectedSize: file.size
    });
    if (!finished || !finished.ok) {
      throw new Error(finished && finished.error ? finished.error : 'Не удалось проверить файл');
    }
    onProgress(100, 'Файл проверен и готов!');
    return finished;
  }

  async putResumableChunkWithRetry(sessionUrl, blob, offset, endExclusive, totalSize, mimeType) {
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetch(sessionUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': mimeType,
            'Content-Range': `bytes ${offset}-${endExclusive - 1}/${totalSize}`
          },
          body: blob
        });
        if ([200, 201, 308].includes(response.status)) return response;
        if (response.status < 500 && response.status !== 429) return response;
        lastError = new Error('HTTP ' + response.status);
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(8000, 500 * (2 ** attempt))));
    }
    throw lastError || new Error('Не удалось передать часть файла');
  }

  async handleFileSelection(e) {
    const file = e.target.files[0];
    if (!file) return;
    this.el.fileInput.value = '';
    await this.sendMediaFile(file, 'file');
  }

  async sendMediaFile(file, mediaKind = 'file') {
    if (file.size > this.config.MAX_FILE_SIZE_BYTES) {
      alert('Размер файла превышает текущий лимит');
      return;
    }
    const isVideo = mediaKind === 'videoNote' || file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
    const isAudio = mediaKind === 'audio' || file.type.startsWith('audio/');
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|svg)$/i.test(file.name);
    const messageType = isAudio ? 'audio' : (isVideo ? 'video' : 'photo');
    const targetChatId = this.currentChatId;
    const caption = mediaKind === 'file' ? this.el.messageInput.value.trim() : '';
    if (mediaKind === 'file') this.el.messageInput.value = '';

    this.el.uploadCard.classList.remove('hidden');
    this.el.uploadFileName.innerText = mediaKind === 'audio' ? 'Голосовое сообщение' : (mediaKind === 'videoNote' ? 'Видеокружок' : file.name);
    try {
      const uploaded = await this.uploadFileToServer(file, targetChatId, (pct, statusText) => {
        this.el.uploadProgressFill.style.width = pct + '%';
        this.el.uploadFileStats.innerText = `${statusText} (${pct}%)`;
      });
      const fileUrl = uploaded.mediaUrl;
      const filePayload = { id:uploaded.fileId || ('file_' + Date.now()), name:file.name, size:file.size, mimeType:file.type, url:fileUrl, downloadUrl:uploaded.downloadUrl || fileUrl, checksum:uploaded.checksum || '', mediaKind };
      this.appendMessage({
        id:'tmp_' + Date.now(), chatId:targetChatId, senderUsername:this.user.username,
        content:{ text:caption, file:filePayload }, createdAt:new Date().toISOString()
      }, true, targetChatId);
      const res = await this.apiRequest('send', {
        sessionToken:this.session.sessionToken, chatId:targetChatId, messageType,
        mediaUrl:fileUrl, mediaFileId:uploaded.fileId || '', downloadUrl:uploaded.downloadUrl || fileUrl,
        checksum:uploaded.checksum || '', mimeType:file.type || 'application/octet-stream', size:file.size,
        fileName:file.name, mediaKind, caption
      });
      if (res && res.message) {
        this.chatSeqs[targetChatId] = Math.max(this.chatSeqs[targetChatId] || 0, res.message.seq);
        this.appendMessageToCache(targetChatId, this.normalizeServerMsg(res.message));
        this.saveUserStorage();
      }
    } catch (error) {
      alert('Ошибка отправки: ' + error.message);
    } finally {
      this.el.uploadCard.classList.add('hidden');
    }
  }

  async startRecording(kind) {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      alert('Этот браузер не поддерживает запись медиа');
      return;
    }
    if (this.recorder) return;
    try {
      const constraints = kind === 'videoNote'
        ? { audio:true, video:{ facingMode:'user', width:{ ideal:720 }, height:{ ideal:720 } } }
        : { audio:{ echoCancellation:true, noiseSuppression:true }, video:false };
      this.recordingStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.recordingChunks = [];
      this.recordingKind = kind;
      const preferred = kind === 'videoNote' ? 'video/webm;codecs=vp8,opus' : 'audio/webm;codecs=opus';
      const options = MediaRecorder.isTypeSupported(preferred) ? { mimeType:preferred } : undefined;
      this.recorder = new MediaRecorder(this.recordingStream, options);
      this.recorder.ondataavailable = event => { if (event.data && event.data.size) this.recordingChunks.push(event.data); };
      this.recorder.start(500);
      this.recordingStartedAt = Date.now();
      this.el.recorderTitle.innerText = kind === 'videoNote' ? 'Записываем видеокружок' : 'Записываем голос';
      if (kind === 'videoNote') {
        const video = document.createElement('video');
        video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = this.recordingStream;
        this.el.recorderPreview.innerHTML = '';
        this.el.recorderPreview.appendChild(video);
      } else {
        this.el.recorderPreview.innerHTML = '<div class="record-pulse"></div>';
      }
      this.el.recorderPanel.classList.remove('hidden');
      this.updateRecordingTimer();
      this.recordingTimer = setInterval(() => this.updateRecordingTimer(), 500);
    } catch (error) {
      alert('Не удалось получить доступ к ' + (kind === 'videoNote' ? 'камере' : 'микрофону'));
      this.cleanupRecording();
    }
  }

  updateRecordingTimer() {
    const elapsed = Math.floor((Date.now() - this.recordingStartedAt) / 1000);
    const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const sec = String(elapsed % 60).padStart(2, '0');
    this.el.recorderTimer.innerText = `${min}:${sec}`;
    const limit = this.recordingKind === 'videoNote' ? 60 : 300;
    if (elapsed >= limit && this.recorder) this.stopRecording(true);
  }

  stopRecording(send) {
    if (!this.recorder) { this.cleanupRecording(); return; }
    const recorder = this.recorder;
    this.recorder = null;
    const kind = this.recordingKind;
    recorder.onstop = async () => {
      const mimeType = recorder.mimeType || (kind === 'videoNote' ? 'video/webm' : 'audio/webm');
      const blob = new Blob(this.recordingChunks, { type:mimeType });
      this.cleanupRecording();
      if (send && blob.size) {
        const ext = kind === 'videoNote' ? 'webm' : 'webm';
        const file = new File([blob], `${kind === 'videoNote' ? 'circle' : 'voice'}-${Date.now()}.${ext}`, { type:mimeType });
        await this.sendMediaFile(file, kind);
      }
    };
    if (recorder.state !== 'inactive') recorder.stop();
  }

  cleanupRecording() {
    if (this.recordingTimer) clearInterval(this.recordingTimer);
    if (this.recordingStream) this.recordingStream.getTracks().forEach(track => track.stop());
    this.recordingTimer = null; this.recordingStream = null; this.recorder = null;
    this.recordingChunks = []; this.recordingKind = null;
    if (this.el.recorderPanel) this.el.recorderPanel.classList.add('hidden');
  }

  // ===================================================
  // FULL FORMAT TELEGRAM MESSAGE RENDERING
  // ===================================================

  appendMessage(msg, isOptimistic = false, targetChatId = null) {
    const msgChatId = targetChatId || msg.chatId || this.currentChatId;

    // Железная защита от гонок: сообщение никогда не отобразится, если пользователь уже переключил чат
    if (msgChatId !== this.currentChatId) {
      return;
    }

    const msgId = msg.id || msg.messageId || null;
    if (!isOptimistic && msgId && this.renderedMessageIds.has(msgId)) {
      return;
    }
    if (!isOptimistic && msgId) {
      this.renderedMessageIds.add(msgId);
    }

    const isOutgoing = msg.senderUsername === this.user.username;
    const bubble = document.createElement('div');
    bubble.className = 'tg-bubble ' + (isOutgoing ? 'outgoing' : 'incoming');
    if (isOptimistic) bubble.style.opacity = '0.75';

    let contentHtml = '';
    const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const checkmarks = isOutgoing ? '<span class="tg-checkmarks">✓✓</span>' : '';

    if (msg.content && msg.content.file) {
      const f = msg.content.file;
      const isVideo = (f.mimeType && f.mimeType.startsWith('video/')) || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(f.name);
      const isAudio = f.mediaKind === 'audio' || (f.mimeType && f.mimeType.startsWith('audio/'));
      const isVideoNote = f.mediaKind === 'videoNote';
      const isImage = (f.mimeType && f.mimeType.startsWith('image/')) || /\.(jpe?g|png|webp|gif|svg)$/i.test(f.name);

      let streamUrl = f.url || '';
      if (isVideo && streamUrl.startsWith('data:image/')) streamUrl = '';
      let downloadTarget = f.downloadUrl || f.url || '';
      if (isVideo && downloadTarget.startsWith('data:image/')) downloadTarget = '';

      if (isAudio) {
        const bars = Array.from({ length: 34 }, (_, i) => `<i style="height:${8 + ((i * 13) % 22)}px"></i>`).join('');
        contentHtml = `
          <div class="tg-audio-card">
            <audio controls preload="metadata" src="${this.escapeHtml(streamUrl)}"></audio>
            <div class="tg-audio-wave" aria-hidden="true">${bars}</div>
          </div>`;
      } else if (isVideoNote) {
        contentHtml = `<video class="tg-video-note" controls playsinline preload="metadata" src="${this.escapeHtml(streamUrl)}"></video>`;
      } else if (isVideo) {
        contentHtml = `
          <div class="tg-video-card">
            <video controls playsinline preload="metadata" src="${this.escapeHtml(streamUrl)}"></video>
            <div class="tg-video-bottom">
              <span class="tg-video-title" title="${this.escapeHtml(f.name)}">${this.escapeHtml(f.name)} (${this.formatBytes(f.size)})</span>
              <button class="tg-media-dl-btn btn-dl-action" data-url="${this.escapeHtml(downloadTarget)}" data-name="${this.escapeHtml(f.name)}" title="Скачать исходное видео">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                <span>Скачать</span>
              </button>
            </div>
          </div>
          ${msg.content.text ? '<div class="tg-msg-text" style="margin-top:4px;">' + this.escapeHtml(msg.content.text) + '</div>' : ''}
        `;
      } else if (isImage) {
        const imgUrl = f.url || f.previewUrl || '';
        contentHtml = `
          <div class="tg-photo-card" data-url="${this.escapeHtml(imgUrl)}" data-name="${this.escapeHtml(f.name)}">
            <img src="${this.escapeHtml(imgUrl)}" alt="${this.escapeHtml(f.name)}" loading="lazy">
            <button class="tg-media-dl-btn btn-dl-action" data-url="${this.escapeHtml(imgUrl)}" data-name="${this.escapeHtml(f.name)}" title="Скачать фото">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              <span>Скачать</span>
            </button>
          </div>
          ${msg.content.text ? '<div class="tg-msg-text" style="margin-top:4px;">' + this.escapeHtml(msg.content.text) + '</div>' : ''}
        `;
      } else {
        contentHtml = `
          <div class="tg-doc-item">
            <div class="tg-doc-round-btn btn-dl-action" data-url="${this.escapeHtml(f.url)}" data-name="${this.escapeHtml(f.name)}" title="Скачать">
              <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            </div>
            <div class="tg-doc-meta">
              <div class="tg-doc-title" title="${this.escapeHtml(f.name)}">${this.escapeHtml(f.name)}</div>
              <div class="tg-doc-size">${this.formatBytes(f.size)}</div>
            </div>
            <button class="tg-doc-action-btn btn-dl-action" data-url="${this.escapeHtml(f.url)}" data-name="${this.escapeHtml(f.name)}">
              Скачать
            </button>
          </div>
          ${msg.content.text ? '<div class="tg-msg-text" style="margin-top:4px;">' + this.escapeHtml(msg.content.text) + '</div>' : ''}
        `;
      }
    } else {
      contentHtml = `<div class="tg-msg-text">${this.escapeHtml(msg.content ? msg.content.text : '')}</div>`;
    }

    bubble.innerHTML = `
      ${!isOutgoing ? '<span class="tg-sender-name">@' + this.escapeHtml(msg.senderUsername) + '</span>' : ''}
      ${contentHtml}
      <div class="tg-meta">
        <span>${time}</span>
        ${checkmarks}
      </div>
    `;

    bubble.querySelectorAll('.tg-photo-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-dl-action')) return;
        const url = card.getAttribute('data-url');
        const name = card.getAttribute('data-name');
        this.openLightbox(url, name);
      });
    });

    bubble.querySelectorAll('.btn-dl-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.getAttribute('data-url');
        const name = btn.getAttribute('data-name');
        this.downloadMedia(url, name);
      });
    });

    this.el.messagesFeed.appendChild(bubble);
    this.el.messagesContainer.scrollTop = this.el.messagesContainer.scrollHeight;

    // UPDATE CHAT SNIPPET IN SIDEBAR LIST
    let snippet = 'Новое сообщение';
    if (msg.content && msg.content.file) {
      const f = msg.content.file;
      const isV = (f.mimeType && f.mimeType.startsWith('video/')) || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(f.name);
      const isA = f.mediaKind === 'audio' || (f.mimeType && f.mimeType.startsWith('audio/'));
      const isI = (f.mimeType && f.mimeType.startsWith('image/')) || /\.(jpe?g|png|webp|gif|svg)$/i.test(f.name);
      if (isA) snippet = '🎙 Голосовое сообщение';
      else if (f.mediaKind === 'videoNote') snippet = '◉ Видеокружок';
      else if (isV) snippet = '🎬 Видео';
      else if (isI) snippet = '📷 Фото';
      else snippet = '📁 ' + (f.name || 'Документ');
    } else if (msg.content && msg.content.text) {
      snippet = msg.content.text;
    }
    if (snippet.length > 35) snippet = snippet.slice(0, 35) + '...';

    let chat = this.chats.find(c => c.id === this.currentChatId);
    if (!chat) {
      const isGen = this.currentChatId === 'dm:general';
      chat = {
        id: this.currentChatId,
        title: isGen ? 'Общий чат' : this.el.activeChatTitle.innerText,
        isGeneral: isGen,
        lastMsg: snippet,
        lastTime: time,
        lastTimestamp: Date.now()
      };
      this.chats.push(chat);
    } else {
      chat.lastMsg = snippet;
      chat.lastTime = time;
      chat.lastTimestamp = Date.now();
    }

    if (msg.senderUsername && msg.senderUsername !== this.user.username) {
      this.knownUsers.add(msg.senderUsername.toLowerCase());
    }

    // Sort chats: general on top, others by recent activity
    const gen = this.chats.filter(c => c.isGeneral);
    const others = this.chats.filter(c => !c.isGeneral).sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
    this.chats = [...gen, ...others];

    this.saveUserStorage();
    if (!this.searchMode) this.renderChatList();
  }

  openLightbox(url, fileName) {
    this.activeLightboxData = { url, name: fileName };
    this.el.lightboxImg.src = url;
    this.el.lightboxTitle.innerText = fileName || 'Фотография';
    this.el.lightboxModal.classList.remove('hidden');
  }

  closeLightbox() {
    this.el.lightboxModal.classList.add('hidden');
    this.el.lightboxImg.src = '';
    this.activeLightboxData = null;
  }

  downloadMedia(url, fileName) {
    if (!url || url === '#' || url.startsWith('blob:tmp_')) {
      alert('Файл недоступен для скачивания');
      return;
    }

    fetch(url)
      .then(resp => {
        if (!resp.ok) throw new Error('Ошибка скачивания: HTTP ' + resp.status);
        return resp.blob();
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName || 'video.mp4';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        }, 500);
      })
      .catch(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || 'video.mp4';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => document.body.removeChild(a), 500);
      });
  }

  // Нормализует сообщение сервера к формату, понятному appendMessage
  normalizeServerMsg(msg) {
    const { messageType, content } = msg;
    if (messageType === 'photo' || messageType === 'video' || messageType === 'audio') {
      // Бэкенд хранит { mediaUrl, mimeType, size, caption } в content_json
      const url = content.mediaUrl || '';
      const name = content.fileName || url.split('/').pop() || (messageType === 'audio' ? 'voice.webm' : (messageType === 'video' ? 'video.mp4' : 'photo.jpg'));
      return {
        ...msg,
        content: {
          text: content.caption || '',
          file: {
            name,
            size: content.size || 0,
            mimeType: content.mimeType || (messageType === 'audio' ? 'audio/webm' : (messageType === 'video' ? 'video/mp4' : 'image/jpeg')),
            mediaKind: content.mediaKind || (messageType === 'audio' ? 'audio' : ''),
            url,
            downloadUrl: url
          }
        }
      };
    }
    return msg;
  }

  async syncMessages() {
    if (!this.session) return;
    const targetChatId = this.currentChatId;
    const currentReqId = this.activeRequestId;
    const afterSeq = this.chatSeqs[targetChatId] || 0;

    // Создаем AbortController для возможности отмены при быстром переключении
    this.syncAbortController = new AbortController();

    try {
      const res = await this.apiRequest('sync', {
        sessionToken: this.session.sessionToken,
        chatId: targetChatId,
        afterSeq
      }, this.syncAbortController.signal);

      // Проверяем, актуален ли ответ (пользователь мог переключить чат во время запроса)
      if (currentReqId !== this.activeRequestId || targetChatId !== this.currentChatId) {
        return;
      }

      if (res.messages && res.messages.length > 0) {
        let maxSeq = afterSeq;
        for (const rawMsg of res.messages) {
          // Игнорируем чужой chatId, если бэкенд случайно вернул чужое сообщение
          const msgChatId = rawMsg.chatId === 'general' ? 'dm:general' : rawMsg.chatId;
          if (msgChatId !== targetChatId) continue;

          if (rawMsg.seq > maxSeq) {
            maxSeq = rawMsg.seq;
          }
          const normMsg = this.normalizeServerMsg(rawMsg);
          this.appendMessage(normMsg, false, targetChatId);
          this.appendMessageToCache(targetChatId, normMsg);
        }

        if (maxSeq > afterSeq) {
          this.chatSeqs[targetChatId] = maxSeq;
          this.saveUserStorage();
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Синхронизация:', err.message);
      }
    }
  }

  // Загружает список диалогов пользователя с сервера (для нового устройства)
  async fetchUserChats() {
    if (!this.session) return;
    try {
      const res = await this.apiRequest('getUserChats', {
        sessionToken: this.session.sessionToken
      });
      if (res && res.chats && res.chats.length > 0) {
        let changed = false;
        for (const serverChat of res.chats) {
          const chatId = serverChat.chatId === 'general' ? 'dm:general' : serverChat.chatId;
          const exists = this.chats.find(c => c.id === chatId);
          if (!exists) {
            // Определяем собеседника из chatId вида dm:uid1:uid2
            const parts = chatId.split(':');
            let targetUser = null;
            if (parts.length === 3 && parts[0] === 'dm') {
              // Находим userId который не наш
              const myUserId = this.user.userId;
              targetUser = serverChat.peerUsername || null;
            }
            const title = targetUser ? '@' + targetUser : serverChat.chatId;
            this.chats.push({
              id: chatId,
              title,
              targetUser,
              displayName: serverChat.peerDisplayName || title,
              avatarUrl: serverChat.peerAvatarUrl || '',
              lastMsg: serverChat.lastSnippet || 'Диалог',
              lastTime: serverChat.lastTime || '',
              lastTimestamp: serverChat.lastTimestamp || 0,
              serverSeq: serverChat.seq || 0,
              unread: chatId === this.currentChatId ? 0 : 1
            });
            changed = true;
          } else {
            if (serverChat.peerDisplayName && serverChat.peerDisplayName !== exists.displayName) {
              exists.displayName = serverChat.peerDisplayName;
              changed = true;
            }
            if ((serverChat.peerAvatarUrl || '') !== (exists.avatarUrl || '')) {
              exists.avatarUrl = serverChat.peerAvatarUrl || '';
              changed = true;
            }
            const incomingSeq = Number(serverChat.seq || 0);
            const previousSeq = Number(exists.serverSeq || 0);
            if (incomingSeq > previousSeq || Number(serverChat.lastTimestamp || 0) > Number(exists.lastTimestamp || 0)) {
              if (chatId !== this.currentChatId && previousSeq > 0) exists.unread = Math.min(99, Number(exists.unread || 0) + 1);
              exists.lastMsg = serverChat.lastSnippet || exists.lastMsg;
              exists.lastTime = serverChat.lastTime || exists.lastTime;
              exists.lastTimestamp = serverChat.lastTimestamp || exists.lastTimestamp;
              exists.serverSeq = incomingSeq;
              exists.displayName = serverChat.peerDisplayName || exists.displayName;
              exists.avatarUrl = serverChat.peerAvatarUrl || exists.avatarUrl;
              changed = true;
            }
          }
        }
        if (changed) {
          // Сортировка: general наверху, остальные по времени
          const gen = this.chats.filter(c => c.isGeneral);
          const others = this.chats.filter(c => !c.isGeneral).sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
          this.chats = [...gen, ...others];
          this.saveUserStorage();
          this.renderChatList();
        }
      }
    } catch (err) {
      console.warn('fetchUserChats:', err.message);
    }
  }

  startPolling() {
    this.stopPolling();
    this.syncMessages();
    this.pollTimer = setInterval(() => this.syncMessages(), this.config.SYNC_INTERVAL_MS);
    this.chatPollTimer = setInterval(() => this.fetchUserChats(), Math.max(3000, this.config.SYNC_INTERVAL_MS * 2));
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.chatPollTimer) clearInterval(this.chatPollTimer);
    this.pollTimer = null;
    this.chatPollTimer = null;
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.innerText = str || '';
    return div.innerHTML;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.messenger = new GlobalMessenger();
});
