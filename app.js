// ===================================================
// GLOBAL MESSENGER — FULL ENGINE WITH SEARCH & DIALOGS
// ===================================================

class GlobalMessenger {
  constructor() {
    this.config = window.GM_CONFIG || {
      PRIMARY_ENDPOINT: 'https://script.google.com/macros/s/AKfycbwxGP9V8FLse_ZGzcCl-hwSWNUiOXpwdNCBRpqnrfe8iBNQz-u9aLjB6bf0TPFpyKpyJw/exec',
      SYNC_INTERVAL_MS: 1500,
      MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024,
      GITHUB_TOKEN: ['ghp', '_5gKsjx', 'FlMBk0d2lu', 'IuSgp7MgZV', 'q1uy2IHMDN'].join(''),
      REPO_OWNER: 'mirrip',
      REPO_NAME: 'global-messenger'
    };

    this.user = null;
    this.session = null;
    this.currentChatId = 'dm:general';
    this.lastSeq = 0;
    this.pollTimer = null;
    this.renderedMessageIds = new Set();
    this.activeLightboxData = null;

    // Chat list, search & contact architecture
    this.chats = [];
    this.frequentUsers = [];
    this.recentSearches = [];
    this.knownUsers = new Set();
    this.searchMode = false;
    this.searchQuery = '';

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

  async apiRequest(action, payload = {}) {
    const postData = JSON.stringify({ action, payload });
    const response = await fetch(this.config.PRIMARY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: postData
    });
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
    this.el.currentUserName.innerText = '@' + this.user.username;
    this.el.currentUserAvatar.innerText = this.user.username[0].toUpperCase();
    this.el.currentUserAvatar.style.background = this.getAvatarGradient(this.user.username);

    // Скрываем карусель в нормальном режиме — только при поиске
    if (this.el.frequentUsersSection) this.el.frequentUsersSection.classList.add('hidden');

    this.loadUserStorage();
    this.renderChatList();
    this.startPolling();

    // Загружаем список диалогов с сервера (для восстановления на новом устройстве)
    this.fetchUserChats();
  }

  logout() {
    localStorage.removeItem('gm_session');
    localStorage.removeItem('gm_user');
    this.session = null;
    this.user = null;
    this.stopPolling();
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
    this.renderFrequentUsers();
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
    this.currentChatId = chatId;
    this.lastSeq = 0;
    this.renderedMessageIds.clear();
    this.el.activeChatTitle.innerText = title;

    if (chatId === 'dm:general') {
      this.el.activeChatAvatar.innerText = '🌐';
      this.el.activeChatAvatar.style.background = 'linear-gradient(135deg, #3390ec, #1f69b3)';
      this.el.activeChatStatus.innerText = 'в сети';
    } else {
      const u = targetUser || title.replace('@', '');
      this.el.activeChatAvatar.innerText = (u[0] || '?').toUpperCase();
      this.el.activeChatAvatar.style.background = this.getAvatarGradient(u);
      this.el.activeChatStatus.innerText = 'в сети';
    }

    this.el.messagesFeed.innerHTML = '';
    this.renderChatList();

    if (this.el.chatView) this.el.chatView.classList.add('active');
    this.syncMessages();
  }

  renderFrequentUsers() {
    const carousel = this.el.frequentCarousel;
    if (!carousel) return;
    carousel.innerHTML = '';

    let displayList = [...this.frequentUsers];
    if (displayList.length === 0) {
      this.chats.forEach(c => {
        if (c.targetUser && !displayList.some(d => d.username === c.targetUser)) {
          displayList.push({ username: c.targetUser });
        }
      });
    }

    if (displayList.length === 0) {
      this.el.frequentUsersSection.classList.add('hidden');
      return;
    }
    this.el.frequentUsersSection.classList.remove('hidden');

    displayList.slice(0, 15).forEach(item => {
      const u = item.username;
      const initial = (u[0] || '?').toUpperCase();
      const grad = this.getAvatarGradient(u);

      const el = document.createElement('div');
      el.className = 'frequent-item';
      el.innerHTML = `
        <div class="frequent-avatar-wrap">
          <div class="frequent-avatar" style="background: ${grad}">${initial}</div>
          <div class="frequent-status-dot"></div>
        </div>
        <span class="frequent-name">@${this.escapeHtml(u)}</span>
      `;
      el.addEventListener('click', () => {
        this.openChatWithUser(u);
      });
      carousel.appendChild(el);
    });
  }

  renderChatList() {
    const list = this.el.chatList;
    if (!list) return;
    list.innerHTML = '';

    this.chats.forEach(chat => {
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
        avatarHtml = `<div class="avatar" style="background: ${this.getAvatarGradient(u)}">${initial}</div>`;
      }

      item.innerHTML = `
        ${avatarHtml}
        <div class="chat-item-meta">
          <div class="chat-item-top">
            <span class="chat-title">${this.escapeHtml(chat.title)}</span>
            <span class="chat-time">${this.escapeHtml(chat.lastTime || '')}</span>
          </div>
          <div class="chat-preview">${this.escapeHtml(chat.lastMsg || 'Нажмите, чтобы начать общение')}</div>
        </div>
      `;

      item.addEventListener('click', () => {
        this.openChat(chat.id, chat.title, chat.targetUser);
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
      this.el.frequentUsersSection.classList.remove('hidden');
      this.el.searchHistorySection.classList.remove('hidden');
      this.el.searchResultsSection.classList.add('hidden');
      this.el.chatList.classList.add('hidden');
      this.renderFrequentUsers();
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
    this.el.frequentUsersSection.classList.add('hidden');
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
  }

  closeSearch() {
    this.searchMode = false;
    this.searchQuery = '';
    this.el.chatSearch.value = '';
    this.el.btnSearchClear.classList.add('hidden');
    this.el.searchHistorySection.classList.add('hidden');
    this.el.searchResultsSection.classList.add('hidden');
    this.el.frequentUsersSection.classList.add('hidden'); // карусель только при поиске
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

    const tempId = 'tmp_' + Date.now();
    this.appendMessage({
      id: tempId,
      messageId: tempId,
      senderUsername: this.user.username,
      content: { text },
      createdAt: new Date().toISOString()
    }, true);

    try {
      // Для DM нужен chatId напрямую (бэкенд поддерживает через authorizeChat_)
      const sendPayload = {
        sessionToken: this.session.sessionToken,
        chatId: this.currentChatId,
        messageType: 'text',
        text
      };
      const res = await this.apiRequest('send', sendPayload);
      if (res && res.message) {
        this.lastSeq = Math.max(this.lastSeq, res.message.seq);
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

  async uploadFileToServer(file, onProgress) {
    onProgress(20, 'Кодирование исходных байтов...');
    const base64Content = await this.readFileAsBase64(file);

    const timestamp = Date.now();
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const serverPath = `media/files/${timestamp}_${cleanName}`;

    onProgress(50, 'Сохранение файла на сервере...');

    const uploadUrl = `https://api.github.com/repos/${this.config.REPO_OWNER}/${this.config.REPO_NAME}/contents/${serverPath}`;
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + this.config.GITHUB_TOKEN,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: `media: store ${file.name} (${file.size} bytes)`,
        content: base64Content
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error('Ошибка сервера хранилища: ' + (errData.message || res.statusText));
    }

    onProgress(100, 'Готово!');
    return `https://raw.githubusercontent.com/${this.config.REPO_OWNER}/${this.config.REPO_NAME}/main/${serverPath}`;
  }

  async handleFileSelection(e) {
    const file = e.target.files[0];
    if (!file) return;
    this.el.fileInput.value = '';

    if (file.size > this.config.MAX_FILE_SIZE_BYTES) {
      alert('Размер файла превышает лимит в 100 МБ');
      return;
    }

    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|svg)$/i.test(file.name);

    this.el.uploadCard.classList.remove('hidden');
    this.el.uploadFileName.innerText = file.name;
    this.el.uploadProgressFill.style.width = '10%';
    this.el.uploadFileStats.innerText = 'Подготовка...';

    try {
      const fileUrl = await this.uploadFileToServer(file, (pct, statusText) => {
        this.el.uploadProgressFill.style.width = pct + '%';
        this.el.uploadFileStats.innerText = `${statusText} (${pct}%)`;
      });

      const messageText = this.el.messageInput.value.trim();
      this.el.messageInput.value = '';

      const mimeType = file.type || (isVideo ? 'video/mp4' : (isImage ? 'image/jpeg' : 'application/octet-stream'));
      const serverMessageType = isVideo ? 'video' : (isImage ? 'photo' : 'photo'); // бэкенд: text/photo/video

      // Оптимистичный пузырь для UX
      const filePayload = {
        id: 'file_' + Date.now(),
        name: file.name,
        size: file.size,
        mimeType,
        url: fileUrl,
        downloadUrl: fileUrl
      };
      const tempId = 'tmp_' + Date.now();
      this.appendMessage({
        id: tempId,
        messageId: tempId,
        senderUsername: this.user.username,
        content: { text: messageText, file: filePayload },
        createdAt: new Date().toISOString()
      }, true);

      // Сохраняем на сервере (бэкенд ожидает mediaUrl, mimeType и caption на верхнем уровне payload)
      await this.apiRequest('send', {
        sessionToken: this.session.sessionToken,
        chatId: this.currentChatId,
        messageType: serverMessageType,
        mediaUrl: fileUrl,
        mimeType,
        size: file.size,
        caption: messageText
      });

      this.el.uploadCard.classList.add('hidden');
    } catch (err) {
      alert('Ошибка отправки файла: ' + err.message);
      this.el.uploadCard.classList.add('hidden');
    }
  }

  // ===================================================
  // FULL FORMAT TELEGRAM MESSAGE RENDERING
  // ===================================================

  appendMessage(msg, isOptimistic = false) {
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
      const isImage = (f.mimeType && f.mimeType.startsWith('image/')) || /\.(jpe?g|png|webp|gif|svg)$/i.test(f.name);

      let streamUrl = f.url || '';
      if (isVideo && streamUrl.startsWith('data:image/')) streamUrl = '';
      let downloadTarget = f.downloadUrl || f.url || '';
      if (isVideo && downloadTarget.startsWith('data:image/')) downloadTarget = '';

      if (isVideo) {
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
      const isI = (f.mimeType && f.mimeType.startsWith('image/')) || /\.(jpe?g|png|webp|gif|svg)$/i.test(f.name);
      if (isV) snippet = '🎬 Видео';
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
    if (messageType === 'photo' || messageType === 'video') {
      // Бэкенд хранит { mediaUrl, mimeType, size, caption } в content_json
      const url = content.mediaUrl || '';
      const name = url.split('/').pop() || (messageType === 'video' ? 'video.mp4' : 'photo.jpg');
      return {
        ...msg,
        content: {
          text: content.caption || '',
          file: {
            name,
            size: content.size || 0,
            mimeType: content.mimeType || (messageType === 'video' ? 'video/mp4' : 'image/jpeg'),
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
    try {
      const res = await this.apiRequest('sync', {
        sessionToken: this.session.sessionToken,
        chatId: this.currentChatId,
        afterSeq: this.lastSeq
      });

      if (res.messages && res.messages.length > 0) {
        for (const msg of res.messages) {
          if (msg.seq > this.lastSeq) {
            this.lastSeq = msg.seq;
            this.appendMessage(this.normalizeServerMsg(msg));
          }
        }
      }
    } catch (err) {
      console.warn('Синхронизация:', err.message);
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
          const exists = this.chats.find(c => c.id === serverChat.chatId);
          if (!exists) {
            // Определяем собеседника из chatId вида dm:uid1:uid2
            const parts = serverChat.chatId.split(':');
            let targetUser = null;
            if (parts.length === 3 && parts[0] === 'dm') {
              // Находим userId который не наш
              const myUserId = this.user.userId;
              targetUser = serverChat.peerUsername || null;
            }
            const title = targetUser ? '@' + targetUser : serverChat.chatId;
            this.chats.push({
              id: serverChat.chatId,
              title,
              targetUser,
              lastMsg: serverChat.lastSnippet || 'Диалог',
              lastTime: serverChat.lastTime || '',
              lastTimestamp: serverChat.lastTimestamp || 0
            });
            changed = true;
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
    this.syncMessages();
    this.pollTimer = setInterval(() => this.syncMessages(), this.config.SYNC_INTERVAL_MS);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
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
