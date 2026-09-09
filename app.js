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

  async deleteMediaBlob(id) {
    if (!this.mediaDB) await this.initMediaDB();
    if (!this.mediaDB || !id) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.mediaDB.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
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
      .filter(u => u.username.toLowerCase().includes(query) || (u.name && u.name.toLowerCase().includes(query)))
      .map(u => ({ id: u.id, username: u.username, name: u.name || ('@' + u.username), bio: u.bio, avatar: u.avatar }));
  }

  async getUserProfile(username) {
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (user) {
      return {
        id: user.id,
        username: user.username,
        name: user.name || ('@' + user.username),
        bio: user.bio || '',
        avatar: user.avatar || null
      };
    }
    return {
      id: 'usr_' + username,
      username: username,
      name: '@' + username,
      bio: '',
      avatar: null
    };
  }

  async updateUserProfile(username, data) {
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
      user = { id: 'usr_' + Date.now(), username: username };
      users.push(user);
    }
    if (data.name !== undefined) user.name = data.name;
    if (data.bio !== undefined) user.bio = data.bio;
    if (data.avatar !== undefined) user.avatar = data.avatar;

    localStorage.setItem('gm_users', JSON.stringify(users));

    const cur = JSON.parse(localStorage.getItem('gm_current_user') || '{}');
    if (cur.username && cur.username.toLowerCase() === username.toLowerCase()) {
      if (data.name !== undefined) cur.name = data.name;
      if (data.bio !== undefined) cur.bio = data.bio;
      if (data.avatar !== undefined) cur.avatar = data.avatar;
      localStorage.setItem('gm_current_user', JSON.stringify(cur));
    }
    return { ok: true, user };
  }

  getContacts(username) {
    if (!username) return [];
    const key = 'gm_contacts_' + username.toLowerCase();
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    if (list.length === 0) {
      const demo = [
        { username: 'durov', name: 'Павел Дуров', addedAt: Date.now() - 86400000 },
        { username: 'maria', name: 'Мария', addedAt: Date.now() - 43200000 }
      ];
      localStorage.setItem(key, JSON.stringify(demo));
      return demo;
    }
    return list;
  }

  saveContact(currentUsername, contact) {
    if (!currentUsername || !contact || !contact.username) return false;
    const key = 'gm_contacts_' + currentUsername.toLowerCase();
    const list = this.getContacts(currentUsername);
    const targetU = contact.username.toLowerCase().replace(/^@/, '');
    const idx = list.findIndex(c => c.username.toLowerCase() === targetU);
    if (idx !== -1) {
      list[idx].name = contact.name || list[idx].name;
    } else {
      list.push({
        username: targetU,
        name: contact.name || ('@' + targetU),
        addedAt: Date.now()
      });
    }
    localStorage.setItem(key, JSON.stringify(list));
    return true;
  }

  deleteContact(currentUsername, targetUsername) {
    if (!currentUsername || !targetUsername) return false;
    const key = 'gm_contacts_' + currentUsername.toLowerCase();
    const list = this.getContacts(currentUsername);
    const targetU = targetUsername.toLowerCase().replace(/^@/, '');
    const updated = list.filter(c => c.username.toLowerCase() !== targetU);
    localStorage.setItem(key, JSON.stringify(updated));
    return true;
  }

  getBlacklist(currentUsername) {
    if (!currentUsername) return [];
    const key = 'gm_blacklist_' + currentUsername.toLowerCase();
    return JSON.parse(localStorage.getItem(key) || '[]');
  }

  toggleBlacklist(currentUsername, targetUsername) {
    if (!currentUsername || !targetUsername) return false;
    const key = 'gm_blacklist_' + currentUsername.toLowerCase();
    let list = this.getBlacklist(currentUsername);
    const targetU = targetUsername.toLowerCase().replace(/^@/, '');
    const idx = list.indexOf(targetU);
    let isBlocked = false;
    if (idx !== -1) {
      list.splice(idx, 1);
      isBlocked = false;
    } else {
      list.push(targetU);
      isBlocked = true;
    }
    localStorage.setItem(key, JSON.stringify(list));
    return isBlocked;
  }

  async getAllUserMedia(username) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const myName = (username || '').toLowerCase();
    const userMsgs = all.filter(m => {
      if (m.chatId === 'general') return true;
      if (m.chatId.startsWith('dm:')) {
        const parts = m.chatId.split(':');
        return parts[1] === myName || parts[2] === myName;
      }
      return false;
    });

    const media = [];
    const files = [];
    const voice = [];

    userMsgs.forEach(m => {
      if (m.files && Array.isArray(m.files)) {
        m.files.forEach(f => {
          const type = (f.type || '').toLowerCase();
          const isPhoto = type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(f.name || '');
          const isVideo = type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(f.name || '');
          if (isPhoto || isVideo) {
            media.push({ msgId: m.id, file: f, time: m.time, sender: m.sender, isVideo, chatId: m.chatId });
          } else {
            files.push({ msgId: m.id, file: f, time: m.time, sender: m.sender, chatId: m.chatId });
          }
        });
      } else if (m.file) {
        const type = (m.file.type || '').toLowerCase();
        const isPhoto = type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(m.file.name || '');
        const isVideo = type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(m.file.name || '');
        if (isPhoto || isVideo) {
          media.push({ msgId: m.id, file: m.file, time: m.time, sender: m.sender, isVideo, chatId: m.chatId });
        } else {
          files.push({ msgId: m.id, file: m.file, time: m.time, sender: m.sender, chatId: m.chatId });
        }
      }

      if (m.voice) {
        voice.push({ msgId: m.id, type: 'voice', voice: m.voice, time: m.time, sender: m.sender, chatId: m.chatId });
      }
      if (m.circleVideo) {
        voice.push({ msgId: m.id, type: 'circle', circleVideo: m.circleVideo, time: m.time, sender: m.sender, chatId: m.chatId });
      }
    });

    return { media, files, voice, totalCount: media.length + files.length + voice.length };
  }

  async getChatMedia(chatId) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const chatMsgs = all.filter(m => m.chatId === chatId);
    const media = [];
    const files = [];
    const voice = [];

    chatMsgs.forEach(m => {
      // Фото и видео
      if (m.files && Array.isArray(m.files)) {
        m.files.forEach(f => {
          const type = (f.type || '').toLowerCase();
          const isPhoto = type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(f.name || '');
          const isVideo = type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(f.name || '');
          if (isPhoto || isVideo) {
            media.push({ msgId: m.id, file: f, time: m.time, sender: m.sender, isVideo });
          } else {
            files.push({ msgId: m.id, file: f, time: m.time, sender: m.sender });
          }
        });
      } else if (m.file) {
        const type = (m.file.type || '').toLowerCase();
        const isPhoto = type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(m.file.name || '');
        const isVideo = type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(m.file.name || '');
        if (isPhoto || isVideo) {
          media.push({ msgId: m.id, file: m.file, time: m.time, sender: m.sender, isVideo });
        } else {
          files.push({ msgId: m.id, file: m.file, time: m.time, sender: m.sender });
        }
      }

      // Голосовые и кружочки
      if (m.voice) {
        voice.push({ msgId: m.id, type: 'voice', voice: m.voice, time: m.time, sender: m.sender });
      }
      if (m.circleVideo) {
        voice.push({ msgId: m.id, type: 'circle', circleVideo: m.circleVideo, time: m.time, sender: m.sender });
      }
    });

    return { media, files, voice };
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
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    const userMap = new Map();
    users.forEach(u => userMap.set((u.username || '').toLowerCase(), u));

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
        const peerProfile = userMap.get(peer.toLowerCase());

        if (!existing || m.createdAt > existing.timestamp) {
          const isFromOther = m.sender.toLowerCase() !== myName;
          chatMap.set(m.chatId, {
            id: m.chatId,
            peer: peer,
            title: (peerProfile && peerProfile.name) ? peerProfile.name : ('@' + peer),
            avatar: peerProfile ? peerProfile.avatar : null,
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
    this.activeSidebarView = 'chats'; // 'chats' | 'contacts' | 'profile' | 'settings'
    this.contactsSortMode = 'name'; // 'name' | 'date'
    this.myfilesFilter = 'all'; // 'all' | 'media' | 'voice' | 'docs'
    this.feedActiveTab = 'media'; // 'media' | 'files' | 'voice'
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
    this._pendingCirclePosterBlobPromise = null;
    const savedPlaybackRate = Number(localStorage.getItem('gm_media_playback_rate'));
    this.mediaPlaybackRate = [1, 1.5, 2].includes(savedPlaybackRate) ? savedPlaybackRate : 1;
    this.activeMediaSession = null;
    this.messageSearchResults = [];
    this.messageSearchIndex = -1;

    // Инициализация IndexedDB для медиа (async, не блокирует UI)
    this.storage.initMediaDB();

    this.initElements();
    this.bindEvents();
    this.updateMainActionButtonState();

    const savedAccent = localStorage.getItem('tg_accent_color');
    if (savedAccent) {
      document.documentElement.style.setProperty('--tg-primary', savedAccent);
      document.documentElement.style.setProperty('--tg-bubble-out', savedAccent);
    }

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

  async captureVideoPosterBlob(video, seekToFirstFrame = false) {
    if (!video) return null;

    const waitForFrame = () => new Promise((resolve) => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        video.removeEventListener('loadeddata', finish);
        video.removeEventListener('canplay', finish);
        resolve();
      };
      const timeoutId = setTimeout(finish, 2200);
      video.addEventListener('loadeddata', finish, { once: true });
      video.addEventListener('canplay', finish, { once: true });
    });

    await waitForFrame();
    if (!video.videoWidth || !video.videoHeight) return null;

    if (seekToFirstFrame && Number.isFinite(video.duration) && video.duration > 0.08) {
      const targetTime = Math.min(0.16, video.duration / 4);
      if (Math.abs((video.currentTime || 0) - targetTime) > 0.03) {
        await new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            video.removeEventListener('seeked', finish);
            resolve();
          };
          const timeoutId = setTimeout(finish, 1400);
          video.addEventListener('seeked', finish, { once: true });
          try { video.currentTime = targetTime; } catch (_) { finish(); }
        });
      }
    }

    try {
      const size = 360;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return null;

      const sourceSize = Math.min(video.videoWidth, video.videoHeight);
      const sourceX = Math.max(0, (video.videoWidth - sourceSize) / 2);
      const sourceY = Math.max(0, (video.videoHeight - sourceSize) / 2);
      ctx.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);

      return await new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob || null), 'image/jpeg', 0.84);
      });
    } catch (err) {
      console.warn('Circle poster capture error:', err);
      return null;
    }
  }

  applyCirclePoster(video, circleCard, posterUrl) {
    if (!video || !circleCard || !posterUrl) return;
    const image = new Image();
    image.onload = () => {
      video.poster = posterUrl;
      circleCard.classList.add('poster-ready');
    };
    image.onerror = () => circleCard.classList.remove('poster-ready');
    image.src = posterUrl;
  }

  async ensureCirclePoster(video, circleCard, posterId) {
    if (!video || !circleCard || !posterId || circleCard.classList.contains('poster-ready')) return;
    const cachedPoster = this._mediaBlobUrlCache.get(posterId);
    if (cachedPoster) {
      this.applyCirclePoster(video, circleCard, cachedPoster);
      return;
    }

    const savedPoster = await this.storage.getMediaBlob(posterId);
    if (savedPoster) {
      const savedPosterUrl = URL.createObjectURL(savedPoster);
      this._mediaBlobUrlCache.set(posterId, savedPosterUrl);
      this.applyCirclePoster(video, circleCard, savedPosterUrl);
      return;
    }

    const posterBlob = await this.captureVideoPosterBlob(video, true);
    if (!posterBlob) return;
    await this.storage.saveMediaBlob(posterId, posterBlob);
    const posterUrl = URL.createObjectURL(posterBlob);
    this._mediaBlobUrlCache.set(posterId, posterUrl);
    this.applyCirclePoster(video, circleCard, posterUrl);
    try { video.currentTime = 0; } catch (_) {}
  }

  formatPlaybackRate(rate) {
    return '×' + String(rate || 1).replace('.', ',');
  }

  updateMediaPlayerPanel(media = null) {
    const session = this.activeMediaSession;
    if (!session || (media && session.media !== media)) return;

    const duration = Number.isFinite(session.media.duration) && session.media.duration > 0
      ? session.media.duration
      : (session.duration || 0);
    const remaining = Math.max(0, duration - (session.media.currentTime || 0));
    const typeLabel = session.type === 'circle' ? 'Кружок' : 'Голосовое';

    if (this.el.mediaPlayerUser) this.el.mediaPlayerUser.innerText = '@' + session.sender;
    if (this.el.mediaPlayerStatus) {
      this.el.mediaPlayerStatus.innerText = typeLabel + ' · осталось ' + this.formatDuration(Math.ceil(remaining));
    }
    if (this.el.mediaPlayerAvatar) {
      this.el.mediaPlayerAvatar.innerText = String(session.sender || '?').charAt(0).toUpperCase();
    }
    if (this.el.mediaPlayerSpeed) this.el.mediaPlayerSpeed.innerText = this.formatPlaybackRate(this.mediaPlaybackRate);

    const paused = session.media.paused || session.media.ended;
    if (this.el.mediaPlayerIconPlay) this.el.mediaPlayerIconPlay.classList.toggle('hidden', !paused);
    if (this.el.mediaPlayerIconPause) this.el.mediaPlayerIconPause.classList.toggle('hidden', paused);
    if (this.el.mediaPlayerToggle) this.el.mediaPlayerToggle.title = paused ? 'Продолжить' : 'Пауза';
  }

  openMediaPlayerPanel(session) {
    if (!session || !session.media) return;
    if (this.activeMediaSession && this.activeMediaSession.media !== session.media) {
      this.closeActiveMediaSession(true);
    }

    this.activeMediaSession = session;
    session.media.playbackRate = this.mediaPlaybackRate;
    if (this.el.mediaPlayerPanel) this.el.mediaPlayerPanel.classList.remove('hidden');
    this.updateMediaPlayerPanel(session.media);
  }

  finishActiveMediaSession(media) {
    if (!this.activeMediaSession || this.activeMediaSession.media !== media) return;
    this.activeMediaSession = null;
    if (this.el.mediaPlayerPanel) this.el.mediaPlayerPanel.classList.add('hidden');
  }

  closeActiveMediaSession(reset = true) {
    const session = this.activeMediaSession;
    if (!session) {
      if (this.el.mediaPlayerPanel) this.el.mediaPlayerPanel.classList.add('hidden');
      return;
    }

    this.activeMediaSession = null;
    if (this.el.mediaPlayerPanel) this.el.mediaPlayerPanel.classList.add('hidden');
    if (typeof session.onClose === 'function') session.onClose(reset);
    else {
      try { session.media.pause(); } catch (_) {}
      if (reset) {
        try { session.media.currentTime = 0; } catch (_) {}
      }
    }
    if (this.currentPlayingCircle === session.media) this.currentPlayingCircle = null;
    if (this.currentPlayingAudio === session.media) {
      this.currentPlayingAudio = null;
      this.currentPlayingAudioBtn = null;
    }
  }

  stopAllPlayingMedia(exceptMedia = null) {
    if (this.activeMediaSession && this.activeMediaSession.media !== exceptMedia) {
      this.closeActiveMediaSession(true);
    }

    if (this.currentPlayingCircle && this.currentPlayingCircle !== exceptMedia) {
      try { this.currentPlayingCircle.pause(); } catch (_) {}
      const parent = this.currentPlayingCircle.closest('.tg-circle-card');
      if (parent) {
        parent.classList.remove('playing', 'expanded', 'progress-visible');
      }
      this.currentPlayingCircle = null;
    }
    if (this.currentPlayingAudio && this.currentPlayingAudio !== exceptMedia) {
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

      navRail: document.getElementById('nav-rail'),
      btnRailToggle: document.getElementById('btn-rail-toggle'),
      railNavChats: document.getElementById('rail-nav-chats'),
      railNavContacts: document.getElementById('rail-nav-contacts'),
      railNavProfile: document.getElementById('rail-nav-profile'),
      railNavSettings: document.getElementById('rail-nav-settings'),
      railUserAvatar: document.getElementById('rail-user-avatar'),
      railUserName: document.getElementById('rail-user-name'),
      railBtnNightmode: document.getElementById('rail-btn-nightmode'),
      railBtnLogout: document.getElementById('rail-btn-logout'),

      mobileNav: document.getElementById('mobile-nav'),
      mobNavChats: document.getElementById('mob-nav-chats'),
      mobNavContacts: document.getElementById('mob-nav-contacts'),
      mobNavProfile: document.getElementById('mob-nav-profile'),
      mobNavSettings: document.getElementById('mob-nav-settings'),
      mobUserAvatar: document.getElementById('mob-user-avatar'),

      sidebarViewChats: document.getElementById('sidebar-view-chats'),
      sidebarViewContacts: document.getElementById('sidebar-view-contacts'),
      sidebarViewProfile: document.getElementById('sidebar-view-profile'),
      sidebarViewSettings: document.getElementById('sidebar-view-settings'),

      // Contacts View
      contactsCountLabel: document.getElementById('contacts-count-label'),
      btnSortContacts: document.getElementById('btn-sort-contacts'),
      btnAddContactOpen: document.getElementById('btn-add-contact-open'),
      contactsSearch: document.getElementById('contacts-search'),
      contactsList: document.getElementById('contacts-list'),
      modalAddContact: document.getElementById('modal-add-contact'),
      formAddContact: document.getElementById('form-add-contact'),
      addContactUsername: document.getElementById('add-contact-username'),
      addContactName: document.getElementById('add-contact-name'),
      btnCancelAddContact: document.getElementById('btn-cancel-add-contact'),
      btnCloseAddContactModal: document.getElementById('btn-close-add-contact-modal'),

      // Profile Feed View
      feedSaveStatus: document.getElementById('feed-save-status'),
      profileFeedScroll: document.getElementById('profile-feed-scroll'),
      feedUserAvatar: document.getElementById('feed-user-avatar'),
      btnFeedChangePhoto: document.getElementById('btn-feed-change-photo'),
      btnFeedUploadPhoto: document.getElementById('btn-feed-upload-photo'),
      btnFeedDeletePhoto: document.getElementById('btn-feed-delete-photo'),
      feedHeroName: document.getElementById('feed-hero-name'),
      feedProfileForm: document.getElementById('feed-profile-form'),
      feedProfileDisplayName: document.getElementById('feed-profile-displayname'),
      feedProfileUsername: document.getElementById('feed-profile-username'),
      feedProfileBio: document.getElementById('feed-profile-bio'),
      feedBioCounter: document.getElementById('feed-bio-counter'),
      btnFeedSaveProfile: document.getElementById('btn-feed-save-profile'),
      statChatsCount: document.getElementById('stat-chats-count'),
      statMediaCount: document.getElementById('stat-media-count'),
      statContactsCount: document.getElementById('stat-contacts-count'),
      feedTabMedia: document.getElementById('feed-tab-media'),
      feedTabFiles: document.getElementById('feed-tab-files'),
      feedTabVoice: document.getElementById('feed-tab-voice'),
      feedBadgeMedia: document.getElementById('feed-badge-media'),
      feedBadgeFiles: document.getElementById('feed-badge-files'),
      feedBadgeVoice: document.getElementById('feed-badge-voice'),
      feedPaneMedia: document.getElementById('feed-pane-media'),
      feedPaneFiles: document.getElementById('feed-pane-files'),
      feedPaneVoice: document.getElementById('feed-pane-voice'),
      feedMediaGrid: document.getElementById('feed-media-grid'),
      feedFilesList: document.getElementById('feed-files-list'),
      feedVoiceList: document.getElementById('feed-voice-list'),
      feedEmptyMedia: document.getElementById('feed-empty-media'),
      feedEmptyFiles: document.getElementById('feed-empty-files'),
      feedEmptyVoice: document.getElementById('feed-empty-voice'),

      // Settings View
      settingsToggleNight: document.getElementById('settings-toggle-night'),
      themePalette: document.getElementById('theme-palette'),
      btnSettingsOpenMyFiles: document.getElementById('btn-settings-open-myfiles'),
      settingsFilesSummary: document.getElementById('settings-files-summary'),
      btnSettingsBlacklist: document.getElementById('btn-settings-blacklist'),
      settingsBlacklistCount: document.getElementById('settings-blacklist-count'),
      settingsToggleLastseen: document.getElementById('settings-toggle-lastseen'),
      settingsToggleSounds: document.getElementById('settings-toggle-sounds'),
      settingsStorageUsage: document.getElementById('settings-storage-usage'),
      btnSettingsClearCache: document.getElementById('btn-settings-clear-cache'),
      btnSettingsLogout: document.getElementById('btn-settings-logout'),

      // My Files Modal
      modalMyFiles: document.getElementById('modal-my-files'),
      btnCloseMyFiles: document.getElementById('btn-close-my-files'),
      myfilesSearch: document.getElementById('myfiles-search'),
      myfilesItemsContainer: document.getElementById('myfiles-items-container'),
      myfilesEmptyState: document.getElementById('myfiles-empty-state'),

      // Blacklist Modal
      modalBlacklist: document.getElementById('modal-blacklist'),
      btnCloseBlacklist: document.getElementById('btn-close-blacklist'),
      blacklistAddInput: document.getElementById('blacklist-add-input'),
      btnBlacklistAdd: document.getElementById('btn-blacklist-add'),
      blacklistItemsList: document.getElementById('blacklist-items-list'),
      blacklistEmptyState: document.getElementById('blacklist-empty-state'),

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
      mediaPlayerPanel: document.getElementById('media-player-panel'),
      mediaPlayerAvatar: document.getElementById('media-player-avatar'),
      mediaPlayerUser: document.getElementById('media-player-user'),
      mediaPlayerStatus: document.getElementById('media-player-status'),
      mediaPlayerSpeed: document.getElementById('media-player-speed'),
      mediaPlayerToggle: document.getElementById('media-player-toggle'),
      mediaPlayerClose: document.getElementById('media-player-close'),
      mediaPlayerIconPlay: document.getElementById('media-player-icon-play'),
      mediaPlayerIconPause: document.getElementById('media-player-icon-pause'),
      btnChatSearch: document.getElementById('btn-chat-search'),
      messageSearchPanel: document.getElementById('message-search-panel'),
      messageSearchInput: document.getElementById('message-search-input'),
      messageSearchCount: document.getElementById('message-search-count'),
      messageSearchPrev: document.getElementById('message-search-prev'),
      messageSearchNext: document.getElementById('message-search-next'),
      messageSearchClose: document.getElementById('message-search-close'),

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
      lightboxVideo: document.getElementById('lightbox-video'),
      lightboxFilename: document.getElementById('lightbox-filename'),
      lightboxCounter: document.getElementById('lightbox-counter'),
      lightboxDownload: document.getElementById('lightbox-download'),
      lightboxPrev: document.getElementById('lightbox-prev'),
      lightboxNext: document.getElementById('lightbox-next'),
      lightboxImgwrap: document.getElementById('lightbox-imgwrap'),

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

      searchFilters: document.getElementById('search-filters'),
      filterChips: document.querySelectorAll('.tg-filter-chip'),
      searchResultsCaption: document.getElementById('search-results-caption'),
      btnMenuNightMode: document.getElementById('btn-menu-nightmode'),
      toggleNightMode: document.getElementById('toggle-night-mode'),
      btnMenuNotifications: document.getElementById('btn-menu-notifications'),
      btnMenuAbout: document.getElementById('btn-menu-about'),
      currentUserHandle: document.getElementById('current-user-handle'),

      profileModalOverlay: document.getElementById('profile-modal-overlay'),
      profileBackdrop: document.getElementById('profile-backdrop'),
      profilePanel: document.getElementById('profile-panel'),
      btnCloseProfile: document.getElementById('btn-close-profile'),
      profilePanelHeaderTitle: document.getElementById('profile-panel-header-title'),
      btnHeaderEditProfile: document.getElementById('btn-header-edit-profile'),
      profileAvatarLarge: document.getElementById('profile-avatar-large'),
      profileName: document.getElementById('profile-name'),
      profileStatus: document.getElementById('profile-status'),
      profileActionsRow: document.getElementById('profile-actions-row'),
      btnProfileActionMsg: document.getElementById('btn-profile-action-msg'),
      btnProfileActionMute: document.getElementById('btn-profile-action-mute'),
      profileMuteIconWrap: document.getElementById('profile-mute-icon-wrap'),
      profileMuteText: document.getElementById('profile-mute-text'),
      btnProfileActionShare: document.getElementById('btn-profile-action-share'),
      profileUsernameVal: document.getElementById('profile-username-val'),
      btnCopyUsername: document.getElementById('btn-copy-username'),
      profileBioVal: document.getElementById('profile-bio-val'),
      toggleProfileNotifications: document.getElementById('toggle-profile-notifications'),
      profileNotificationsText: document.getElementById('profile-notifications-text'),
      profileTabs: document.querySelectorAll('.tg-profile-tab'),
      badgeCountMedia: document.getElementById('badge-count-media'),
      badgeCountFiles: document.getElementById('badge-count-files'),
      badgeCountVoice: document.getElementById('badge-count-voice'),
      paneProfileMedia: document.getElementById('pane-profile-media'),
      paneProfileFiles: document.getElementById('pane-profile-files'),
      paneProfileVoice: document.getElementById('pane-profile-voice'),
      profileMediaGrid: document.getElementById('profile-media-grid'),
      profileFilesList: document.getElementById('profile-files-list'),
      profileVoiceList: document.getElementById('profile-voice-list'),
      emptyProfileMedia: document.getElementById('empty-profile-media'),
      emptyProfileFiles: document.getElementById('empty-profile-files'),
      emptyProfileVoice: document.getElementById('empty-profile-voice'),
      btnEditProfile: document.getElementById('btn-edit-profile'),
      btnOpenMyProfile: document.getElementById('btn-open-my-profile'),
      btnMenuProfile: document.getElementById('btn-menu-profile'),
      btnOpenChatProfile: document.getElementById('btn-open-chat-profile'),
      btnChatInfoPanel: document.getElementById('btn-chat-info-panel'),

      btnChangeAvatar: document.getElementById('btn-change-avatar'),
      avatarFileInput: document.getElementById('avatar-file-input'),

      modalEditProfile: document.getElementById('modal-edit-profile'),
      formEditProfile: document.getElementById('form-edit-profile'),
      editAvatarPreview: document.getElementById('edit-avatar-preview'),
      btnModalChangePhoto: document.getElementById('btn-modal-change-photo'),
      btnModalRemovePhoto: document.getElementById('btn-modal-remove-photo'),
      editProfileDisplayName: document.getElementById('edit-profile-displayname'),
      editProfileUsername: document.getElementById('edit-profile-username'),
      editProfileBio: document.getElementById('edit-profile-bio'),
      editBioCounter: document.getElementById('edit-bio-counter'),
      btnCancelEditProfile: document.getElementById('btn-cancel-edit-profile'),
      btnCloseEditModal: document.getElementById('btn-close-edit-modal'),
      btnSaveEditProfile: document.getElementById('btn-save-edit-profile'),

      toastContainer: document.getElementById('tg-toast-container'),
      reactionsPopup: document.getElementById('reactions-popup')
    };
  }

  bindEvents() {
    // Вкладки авторизации
    this.el.tabLogin.addEventListener('click', () => this.setAuthMode('login'));
    this.el.tabRegister.addEventListener('click', () => this.setAuthMode('register'));
    this.el.authForm.addEventListener('submit', (e) => this.handleAuthSubmit(e));

    // Навигационная панель (Desktop Rail toggle)
    if (this.el.btnRailToggle && this.el.navRail) {
      this.el.btnRailToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.el.navRail.classList.toggle('expanded');
      });
    }

    // ПЕРЕКЛЮЧЕНИЕ ГЛАВНЫХ РАЗДЕЛОВ (ЧАТЫ, КОНТАКТЫ, ПРОФИЛЬ, НАСТРОЙКИ)
    if (this.el.railNavChats) this.el.railNavChats.addEventListener('click', () => this.switchSidebarView('chats'));
    if (this.el.railNavContacts) this.el.railNavContacts.addEventListener('click', () => this.switchSidebarView('contacts'));
    if (this.el.railNavProfile) this.el.railNavProfile.addEventListener('click', () => this.switchSidebarView('profile'));
    if (this.el.railNavSettings) this.el.railNavSettings.addEventListener('click', () => this.switchSidebarView('settings'));

    if (this.el.mobNavChats) this.el.mobNavChats.addEventListener('click', () => this.switchSidebarView('chats'));
    if (this.el.mobNavContacts) this.el.mobNavContacts.addEventListener('click', () => this.switchSidebarView('contacts'));
    if (this.el.mobNavProfile) this.el.mobNavProfile.addEventListener('click', () => this.switchSidebarView('profile'));
    if (this.el.mobNavSettings) this.el.mobNavSettings.addEventListener('click', () => this.switchSidebarView('settings'));

    // Переключение папок / разделов внутри чатов (Все, Личные, Каналы)
    const setFolder = (folder) => {
      this.activeFolder = folder;
      if (this.el.foldersBar) {
        this.el.foldersBar.querySelectorAll('.tg-folder-tab').forEach(tab => {
          tab.classList.toggle('active', tab.getAttribute('data-folder') === folder);
        });
      }
      this.renderChatList();
    };

    if (this.el.foldersBar) {
      this.el.foldersBar.querySelectorAll('.tg-folder-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          setFolder(tab.getAttribute('data-folder') || 'all');
        });
      });
    }

    // КОНТАКТЫ
    if (this.el.btnAddContactOpen) {
      this.el.btnAddContactOpen.addEventListener('click', () => this.openAddContactModal());
    }
    if (this.el.btnCancelAddContact) {
      this.el.btnCancelAddContact.addEventListener('click', () => this.closeAddContactModal());
    }
    if (this.el.btnCloseAddContactModal) {
      this.el.btnCloseAddContactModal.addEventListener('click', () => this.closeAddContactModal());
    }
    if (this.el.formAddContact) {
      this.el.formAddContact.addEventListener('submit', (e) => this.handleAddContactSubmit(e));
    }
    if (this.el.btnSortContacts) {
      this.el.btnSortContacts.addEventListener('click', () => this.toggleContactsSort());
    }
    if (this.el.contactsSearch) {
      this.el.contactsSearch.addEventListener('input', () => this.renderContactsList());
    }

    // ПРОФИЛЬ-ЛЕНТА
    if (this.el.btnFeedChangePhoto && this.el.avatarFileInput) {
      this.el.btnFeedChangePhoto.addEventListener('click', () => this.el.avatarFileInput.click());
    }
    if (this.el.btnFeedUploadPhoto && this.el.avatarFileInput) {
      this.el.btnFeedUploadPhoto.addEventListener('click', () => this.el.avatarFileInput.click());
    }
    if (this.el.btnFeedDeletePhoto) {
      this.el.btnFeedDeletePhoto.addEventListener('click', async () => {
        if (!this.currentUser) return;
        this.currentUser.avatar = null;
        await this.storage.updateUserAvatar(this.currentUser.username, null);
        this.renderAvatars();
        this.renderProfileFeed();
        this.showToast('Фото профиля удалено');
      });
    }
    if (this.el.feedProfileBio) {
      this.el.feedProfileBio.addEventListener('input', () => {
        if (this.el.feedBioCounter) {
          this.el.feedBioCounter.innerText = this.el.feedProfileBio.value.length + ' / 140';
        }
      });
    }
    if (this.el.feedProfileForm) {
      this.el.feedProfileForm.addEventListener('submit', (e) => this.handleFeedProfileSave(e));
    }
    if (this.el.feedTabMedia) this.el.feedTabMedia.addEventListener('click', () => this.switchFeedMediaTab('media'));
    if (this.el.feedTabFiles) this.el.feedTabFiles.addEventListener('click', () => this.switchFeedMediaTab('files'));
    if (this.el.feedTabVoice) this.el.feedTabVoice.addEventListener('click', () => this.switchFeedMediaTab('voice'));

    // НАСТРОЙКИ
    if (this.el.settingsToggleNight) {
      this.el.settingsToggleNight.addEventListener('change', (e) => {
        const isDark = e.target.checked;
        document.body.className = isDark ? 'tg-theme-dark' : 'tg-theme-light';
        localStorage.setItem('tg_theme', isDark ? 'dark' : 'light');
        if (this.el.toggleNightMode) this.el.toggleNightMode.checked = isDark;
        this.showToast(isDark ? 'Ночной режим включен' : 'Дневной режим включен');
      });
    }

    if (this.el.themePalette) {
      this.el.themePalette.querySelectorAll('.tg-palette-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          this.el.themePalette.querySelectorAll('.tg-palette-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          const color = chip.getAttribute('data-color') || 'blue';
          this.setThemeAccent(color);
        });
      });
    }

    if (this.el.btnSettingsOpenMyFiles) {
      this.el.btnSettingsOpenMyFiles.addEventListener('click', () => this.openMyFilesModal());
    }
    if (this.el.btnSettingsBlacklist) {
      this.el.btnSettingsBlacklist.addEventListener('click', () => this.openBlacklistModal());
    }
    if (this.el.btnSettingsClearCache) {
      this.el.btnSettingsClearCache.addEventListener('click', () => this.clearMediaCache());
    }
    if (this.el.btnSettingsLogout) {
      this.el.btnSettingsLogout.addEventListener('click', () => this.logout());
    }

    // МОДАЛЬНОЕ ОКНО «МОИ ФАЙЛЫ»
    if (this.el.btnCloseMyFiles) {
      this.el.btnCloseMyFiles.addEventListener('click', () => this.closeMyFilesModal());
    }
    if (this.el.myfilesSearch) {
      this.el.myfilesSearch.addEventListener('input', () => this.renderMyFilesList());
    }
    if (this.el.modalMyFiles) {
      this.el.modalMyFiles.querySelectorAll('[data-myfiles-filter]').forEach(chip => {
        chip.addEventListener('click', () => {
          this.el.modalMyFiles.querySelectorAll('[data-myfiles-filter]').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.myfilesFilter = chip.getAttribute('data-myfiles-filter') || 'all';
          this.renderMyFilesList();
        });
      });
    }

    // МОДАЛЬНОЕ ОКНО «ЧЁРНЫЙ СПИСОК»
    if (this.el.btnCloseBlacklist) {
      this.el.btnCloseBlacklist.addEventListener('click', () => this.closeBlacklistModal());
    }
    if (this.el.btnBlacklistAdd) {
      this.el.btnBlacklistAdd.addEventListener('click', () => this.handleBlacklistAdd());
    }

    // Переключение темы из Desktop Rail
    if (this.el.railBtnNightmode) {
      this.el.railBtnNightmode.addEventListener('click', () => {
        const currentTheme = localStorage.getItem('tg_theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.body.className = newTheme === 'dark' ? 'tg-theme-dark' : 'tg-theme-light';
        localStorage.setItem('tg_theme', newTheme);
        if (this.el.toggleNightMode) this.el.toggleNightMode.checked = newTheme === 'dark';
        if (this.el.settingsToggleNight) this.el.settingsToggleNight.checked = newTheme === 'dark';
        this.showToast(newTheme === 'dark' ? 'Ночной режим включен' : 'Дневной режим включен');
      });
    }

    // Выход из Desktop Rail
    if (this.el.railBtnLogout) {
      this.el.railBtnLogout.addEventListener('click', () => this.logout());
    }

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

    // Переключатель темы (Ночной режим)
    if (this.el.toggleNightMode) {
      this.el.toggleNightMode.addEventListener('change', (e) => {
        const isDark = e.target.checked;
        document.body.className = isDark ? 'tg-theme-dark' : 'tg-theme-light';
        localStorage.setItem('tg_theme', isDark ? 'dark' : 'light');
        this.showToast(isDark ? 'Ночной режим включен' : 'Дневной режим включен');
      });
    }

    // Уведомления в меню
    if (this.el.btnMenuNotifications) {
      this.el.btnMenuNotifications.addEventListener('click', () => {
        this.el.menuDropdown.classList.add('hidden');
        this.showToast('Уведомления и звуки включены');
      });
    }

    // О приложении
    if (this.el.btnMenuAbout) {
      this.el.btnMenuAbout.addEventListener('click', () => {
        this.el.menuDropdown.classList.add('hidden');
        this.showToast('⚡ Telegram Web v3.13.0\nПолноценный мессенджер с кружочками, аудио и профилями');
      });
    }

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
    if (this.el.btnHeaderEditProfile) {
      this.el.btnHeaderEditProfile.addEventListener('click', () => this.openEditProfileModal());
    }
    if (this.el.btnEditProfile) {
      this.el.btnEditProfile.addEventListener('click', () => this.openEditProfileModal());
    }

    // Закрытие профиля
    if (this.el.btnCloseProfile) {
      this.el.btnCloseProfile.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeUserProfile();
      });
    }
    if (this.el.profileBackdrop) {
      this.el.profileBackdrop.addEventListener('click', () => this.closeUserProfile());
    }

    // Действия в профиле: Написать, Звук, Поделиться, Копировать @username
    if (this.el.btnProfileActionMsg) {
      this.el.btnProfileActionMsg.addEventListener('click', () => {
        const u = this.activeProfileUser && this.activeProfileUser.username ? this.activeProfileUser.username : null;
        this.closeUserProfile();
        if (u) {
          this.openDirectChat(u);
        }
        if (this.el.messageInput) this.el.messageInput.focus();
      });
    }

    if (this.el.btnProfileActionMute) {
      this.el.btnProfileActionMute.addEventListener('click', () => {
        const isMuted = this.toggleChatMute(this.currentChatId);
        this.updateMuteUI(isMuted);
        this.showToast(isMuted ? 'Уведомления отключены' : 'Уведомления включены');
      });
    }

    if (this.el.toggleProfileNotifications) {
      this.el.toggleProfileNotifications.addEventListener('change', (e) => {
        const isMuted = !e.target.checked;
        this.setChatMute(this.currentChatId, isMuted);
        this.updateMuteUI(isMuted);
        this.showToast(isMuted ? 'Уведомления отключены' : 'Уведомления включены');
      });
    }

    if (this.el.btnCopyUsername) {
      this.el.btnCopyUsername.addEventListener('click', () => {
        const u = this.activeProfileUser ? this.activeProfileUser.username : this.currentUser.username;
        const text = '@' + u.replace(/^@/, '');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
        this.showToast('Имя пользователя ' + text + ' скопировано');
      });
    }

    if (this.el.btnProfileActionShare) {
      this.el.btnProfileActionShare.addEventListener('click', () => {
        const u = this.activeProfileUser ? this.activeProfileUser.username : this.currentUser.username;
        const text = 'https://t.me/' + u.replace(/^@/, '');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
        this.showToast('Ссылка ' + text + ' скопирована');
      });
    }

    // Вкладки профиля (Медиа / Файлы / Голосовые)
    if (this.el.profileTabs) {
      this.el.profileTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          this.el.profileTabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const target = tab.getAttribute('data-tab');
          ['media', 'files', 'voice'].forEach(type => {
            const pane = document.getElementById('pane-profile-' + type);
            if (pane) pane.classList.toggle('hidden', type !== target);
          });
        });
      });
    }

    // Модальное окно редактирования профиля
    if (this.el.btnCloseEditModal) {
      this.el.btnCloseEditModal.addEventListener('click', () => this.closeEditProfileModal());
    }
    if (this.el.btnCancelEditProfile) {
      this.el.btnCancelEditProfile.addEventListener('click', () => this.closeEditProfileModal());
    }
    if (this.el.editProfileBio) {
      this.el.editProfileBio.addEventListener('input', () => {
        if (this.el.editBioCounter) {
          this.el.editBioCounter.innerText = this.el.editProfileBio.value.length + ' / 140';
        }
      });
    }
    if (this.el.btnModalChangePhoto && this.el.avatarFileInput) {
      this.el.btnModalChangePhoto.addEventListener('click', () => this.el.avatarFileInput.click());
    }
    if (this.el.btnModalRemovePhoto) {
      this.el.btnModalRemovePhoto.addEventListener('click', () => {
        this.pendingEditAvatar = null;
        if (this.el.editAvatarPreview) {
          this.el.editAvatarPreview.innerHTML = this.currentUser.username[0].toUpperCase();
        }
      });
    }
    if (this.el.formEditProfile) {
      this.el.formEditProfile.addEventListener('submit', (e) => this.saveEditedProfile(e));
    }

    // Отмена записи из строки сообщения
    if (this.el.btnCancelRecording) {
      this.el.btnCancelRecording.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stopRecording(false);
      });
    }

    if (this.el.mediaPlayerToggle) {
      this.el.mediaPlayerToggle.addEventListener('click', () => {
        const session = this.activeMediaSession;
        if (session && typeof session.toggle === 'function') session.toggle();
      });
    }
    if (this.el.mediaPlayerClose) {
      this.el.mediaPlayerClose.addEventListener('click', () => this.closeActiveMediaSession(true));
    }
    if (this.el.mediaPlayerSpeed) {
      this.el.mediaPlayerSpeed.addEventListener('click', () => {
        const rates = [1, 1.5, 2];
        const currentIndex = rates.indexOf(this.mediaPlaybackRate);
        this.mediaPlaybackRate = rates[(currentIndex + 1) % rates.length];
        localStorage.setItem('gm_media_playback_rate', String(this.mediaPlaybackRate));
        if (this.activeMediaSession && this.activeMediaSession.media) {
          this.activeMediaSession.media.playbackRate = this.mediaPlaybackRate;
        }
        this.updateMediaPlayerPanel();
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

        isPointerDown = true;
        isHoldRecording = false;
        startY = e.clientY;

        if (holdTimer) clearTimeout(holdTimer);

        // Порог зажатия — 180 мс для моментального и четкого старта
        holdTimer = setTimeout(() => {
          if (!isPointerDown) return;
          isHoldRecording = true;
          this.isHoldingMainAction = true;

          // Легкий виброотклик на смартфонах
          if (navigator.vibrate) {
            try { navigator.vibrate(30); } catch (_) {}
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
        }, 180);
      };

      const onPointerMove = (e) => {
        if (!isHoldRecording || this.isRecordingLocked) return;
        if (!startY) return;

        const deltaY = startY - e.clientY;
        // Свайп вверх от 35px фиксирует запись (Lock)
        if (deltaY > 35) {
          this.isRecordingLocked = true;
          isPointerDown = false;

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
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }

        // Если запись зафиксирована свайпом вверх — не останавливаем при отпускании пальца
        if (this.isRecordingLocked) return;

        if (!isPointerDown) return;
        const wasRecording = isHoldRecording;
        isPointerDown = false;
        this.isHoldingMainAction = false;

        if (this.el.recordLock) this.el.recordLock.classList.add('hidden');

        if (wasRecording) {
          // Шла запись по зажатию — останавливаем и отправляем!
          isHoldRecording = false;
          this.stopRecording(true);
        } else {
          // Палец/кнопка отпущены до порога — ЭТО ЧИСТЫЙ КОРОТКИЙ КЛИК!
          // Переключаем режим: микрофон <-> видеокамера
          this.toggleRecordMode();
        }
      };

      const onPointerCancel = (e) => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        if (this.isRecordingLocked) return;
        const wasRecording = isHoldRecording;
        isPointerDown = false;
        this.isHoldingMainAction = false;

        if (this.el.recordLock) this.el.recordLock.classList.add('hidden');

        if (wasRecording) {
          isHoldRecording = false;
          this.stopRecording(false);
        }
      };

      // Pointer Events для современных браузеров и мобильных
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

    // Фильтры поиска
    this.activeSearchFilter = 'all';
    if (this.el.filterChips) {
      this.el.filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
          this.el.filterChips.forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.activeSearchFilter = chip.getAttribute('data-filter') || 'all';
          this.handleSearch(this.el.chatSearch.value, this.activeSearchFilter);
        });
      });
    }

    // Поиск
    this.el.chatSearch.addEventListener('focus', () => {
      if (this.el.searchFilters) this.el.searchFilters.classList.remove('hidden');
    });

    this.el.chatSearch.addEventListener('input', () => {
      this.handleSearch(this.el.chatSearch.value, this.activeSearchFilter);
    });

    this.el.btnSearchClear.addEventListener('click', () => {
      this.el.chatSearch.value = '';
      if (this.el.searchFilters) this.el.searchFilters.classList.add('hidden');
      this.handleSearch('', 'all');
    });

    // Мобильная кнопка Назад
    this.el.btnBack.addEventListener('click', () => {
      this.closeActiveMediaSession(true);
      this.closeMessageSearch(false);
      sessionStorage.setItem('gm_active_chat_open', '0');
      if (this.el.chatView) this.el.chatView.classList.remove('active');
      if (window.history && window.history.state && window.history.state.chatId) {
        window.history.back();
      }
    });

    // Обработка кнопки «Назад» на смартфонах Android/iOS
    window.addEventListener('popstate', (e) => {
      if (this.el.chatView && this.el.chatView.classList.contains('active')) {
        if (!e.state || !e.state.chatId) {
          this.closeActiveMediaSession(true);
          this.closeMessageSearch(false);
          sessionStorage.setItem('gm_active_chat_open', '0');
          this.el.chatView.classList.remove('active');
        } else if (e.state.chatId !== this.currentChatId) {
          this.openChat(e.state.chatId, e.state.title || '');
        }
      }
    });

    // Полноэкранный просмотр фото и видео (галерея Lightbox)
    if (this.el.lightboxClose) this.el.lightboxClose.addEventListener('click', () => this.closeLightbox());
    if (this.el.lightboxBackdrop) this.el.lightboxBackdrop.addEventListener('click', () => this.closeLightbox());
    if (this.el.lightboxPrev) this.el.lightboxPrev.addEventListener('click', () => this.lightboxPrev());
    if (this.el.lightboxNext) this.el.lightboxNext.addEventListener('click', () => this.lightboxNext());

    // Клавиатурная навигация (Escape, ArrowLeft, ArrowRight)
    document.addEventListener('keydown', (e) => {
      if (this.el.lightboxModal && !this.el.lightboxModal.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          this.closeLightbox();
        } else if (e.key === 'ArrowLeft') {
          this.lightboxPrev();
        } else if (e.key === 'ArrowRight') {
          this.lightboxNext();
        }
      } else if (this.el.profileModalOverlay && !this.el.profileModalOverlay.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          this.closeUserProfile();
        }
      } else if (this.el.modalEditProfile && !this.el.modalEditProfile.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          this.closeEditProfileModal();
        }
      }
    });

    // Сенсорные свайпы для галереи Lightbox
    if (this.el.lightboxModal) {
      let touchStartX = 0;
      let touchStartY = 0;
      this.el.lightboxModal.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches[0]) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      this.el.lightboxModal.addEventListener('touchend', (e) => {
        if (e.changedTouches && e.changedTouches[0]) {
          const deltaX = e.changedTouches[0].clientX - touchStartX;
          const deltaY = e.changedTouches[0].clientY - touchStartY;
          if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            if (deltaX > 0) this.lightboxPrev();
            else this.lightboxNext();
          }
        }
      }, { passive: true });
    }

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
      this.openChat('general', 'Общий чат');
    } catch (err) {
      this.el.authStatus.className = 'tg-status-msg error';
      this.el.authStatus.innerText = err.message || 'Ошибка входа';
    } finally {
      this.el.authSubmitBtn.disabled = false;
    }
  }

  logout() {
    this.closeActiveMediaSession(true);
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

    const openState = sessionStorage.getItem('gm_active_chat_open');
    const savedChatId = sessionStorage.getItem('gm_active_chat_id') || 'general';
    const savedChatTitle = sessionStorage.getItem('gm_active_chat_title') || 'Общий чат';

    this.currentChatId = savedChatId;
    if (this.el.activeChatTitle) {
      this.el.activeChatTitle.innerText = savedChatTitle;
    }

    // Если на смартфоне зашли первый раз или чат был открыт — сразу показываем чат
    if (this.el.chatView && window.innerWidth <= 768) {
      if (openState === null || openState === '1') {
        sessionStorage.setItem('gm_active_chat_open', '1');
        sessionStorage.setItem('gm_active_chat_id', savedChatId);
        sessionStorage.setItem('gm_active_chat_title', savedChatTitle);
        this.el.chatView.classList.add('active');
      } else {
        this.el.chatView.classList.remove('active');
      }
    }

    this.el.currentUserName.innerText = '@' + this.currentUser.username;
    this.renderAvatars();
    this.switchSidebarView('chats');
    this.renderProfileFeed();

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
    if (this.activeMediaSession && this.activeMediaSession.chatId !== chatId) {
      this.closeActiveMediaSession(true);
    }
    if (chatId !== this.currentChatId) this.closeMessageSearch(false);
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
    this.el.activeChatStatus.innerText = isGeneral ? 'канал общения' : 'в сети';

    if (isGeneral) {
      this.el.activeChatAvatar.innerHTML = '🌐';
      this.el.activeChatAvatar.style.cursor = 'default';
      this.el.activeChatAvatar.onclick = null;
    } else {
      const peerUsername = (chatId.startsWith('dm:') ? (chatId.split(':')[1] === this.currentUser.username.toLowerCase() ? chatId.split(':')[2] : chatId.split(':')[1]) : title.replace('@', '')).toLowerCase();
      this.storage.getUserProfile(peerUsername).then(profile => {
        if (profile && profile.avatar) {
          this.el.activeChatAvatar.innerHTML = '<img src="' + profile.avatar + '" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
          this.el.activeChatAvatar.style.cursor = 'pointer';
          this.el.activeChatAvatar.onclick = (e) => {
            e.stopPropagation();
            this.openLightbox(profile.avatar, (profile.name || ('@' + peerUsername)) + ' — Фото профиля', 'image');
          };
        } else {
          this.el.activeChatAvatar.innerText = peerUsername[0] ? peerUsername[0].toUpperCase() : '?';
          this.el.activeChatAvatar.style.cursor = 'pointer';
          this.el.activeChatAvatar.onclick = (e) => {
            e.stopPropagation();
            this.openUserProfile(peerUsername, false);
          };
        }
      });
    }

    if (this.isRecordingAudio || this.isRecordingVideo) {
      this.stopRecording(false);
    }
    if (this.el.messageInput) {
      this.el.messageInput.classList.remove('hidden');
    }

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
      const avatarContent = chat.isGeneral
        ? '🌐'
        : (chat.avatar ? '<img src="' + chat.avatar + '" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : (chat.peer ? chat.peer[0].toUpperCase() : '?'));

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
      this.updateMessageSearch(false);
      return;
    }

    // Предзагрузка всех Blob URL для мгновенного и надежного старта видео и аудио
    for (const m of msgs) {
      if (m.circleVideo && m.circleVideo.mediaId && !this._mediaBlobUrlCache.has(m.circleVideo.mediaId)) {
        const b = await this.storage.getMediaBlob(m.circleVideo.mediaId);
        if (b) {
          this._mediaBlobUrlCache.set(m.circleVideo.mediaId, URL.createObjectURL(b));
        }
        const posterId = m.circleVideo.posterId || (m.circleVideo.mediaId + '_poster');
        if (!this._mediaBlobUrlCache.has(posterId)) {
          const posterBlob = await this.storage.getMediaBlob(posterId);
          if (posterBlob) this._mediaBlobUrlCache.set(posterId, URL.createObjectURL(posterBlob));
        }
      }
      if (m.voice && m.voice.mediaId && !this._mediaBlobUrlCache.has(m.voice.mediaId)) {
        const b = await this.storage.getMediaBlob(m.voice.mediaId);
        if (b) {
          this._mediaBlobUrlCache.set(m.voice.mediaId, URL.createObjectURL(b));
        }
      }
      const attachments = m.files && m.files.length ? m.files : (m.file ? [m.file] : []);
      for (const file of attachments) {
        if (file.mediaId && !this._mediaBlobUrlCache.has(file.mediaId)) {
          const blob = await this.storage.getMediaBlob(file.mediaId);
          if (blob) this._mediaBlobUrlCache.set(file.mediaId, URL.createObjectURL(blob));
        }
      }
    }

    const usersList = JSON.parse(localStorage.getItem('gm_users') || '[]');
    const userMap = new Map();
    usersList.forEach(u => userMap.set((u.username || '').toLowerCase(), u));

    // Сбор всех медиа-элементов чата для непрерывной галереи (Playlist)
    const chatMediaPlaylist = [];
    msgs.forEach(m => {
      const attachments = m.files && m.files.length ? m.files : (m.file ? [m.file] : []);
      attachments.forEach(file => {
        const kind = this.getAttachmentKind(file);
        if (kind === 'image' || kind === 'video') {
          const src = this.getAttachmentSrc(file);
          if (src) {
            chatMediaPlaylist.push({
              src,
              name: file.name || (kind === 'video' ? 'video.mp4' : 'photo.png'),
              kind
            });
          }
        }
      });
    });

    msgs.forEach(m => {
      const isOut = m.sender.toLowerCase() === this.currentUser.username.toLowerCase();
      const wrap = document.createElement('div');
      wrap.className = 'tg-bubble-wrap ' + (isOut ? 'out' : 'in');

      let specialContent = '';

      const isCircle = Boolean(m.circleVideo);

      // 1. ВИДЕОКРУЖОЧЕК TELEGRAM (по умолчанию на паузе, увеличивается при включении)
      if (m.circleVideo) {
        const dur = m.circleVideo.duration || 0;
        const mediaId = m.circleVideo.mediaId || '';
        const posterId = m.circleVideo.posterId || (mediaId ? mediaId + '_poster' : (m.id + '_poster'));
        const circleSrc = this._mediaBlobUrlCache.get(mediaId) || m.circleVideo.data || '';
        specialContent = [
          '<div class="tg-circle-message">',
          '  <div class="tg-circle-card" data-media-id="' + mediaId + '" data-poster-id="' + posterId + '">',
          '    <svg class="tg-circle-progress" viewBox="0 0 100 100" aria-hidden="true">',
          '      <circle class="tg-circle-progress-value" cx="50" cy="50" r="47"></circle>',
          '    </svg>',
          '    <div class="tg-circle-media">',
          '      <div class="tg-circle-poster-fallback" aria-hidden="true">',
          '        <svg viewBox="0 0 24 24" width="42" height="42" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
          '      </div>',
          '      <video src="' + circleSrc + '" playsinline webkit-playsinline preload="auto" muted></video>',
          '      <div class="tg-circle-play-overlay">',
          '        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
          '      </div>',
          '  </div>',
          '  </div>',
          '  <div class="tg-circle-meta">',
          '    <span class="tg-circle-duration">' + this.formatDuration(dur) + '</span>',
          '    <span class="tg-circle-sent-time">' + this.escape(m.time || '') + (isOut ? ' <span class="tg-checks">✓✓</span>' : '') + '</span>',
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
      // 3. ФОТО, ВИДЕО И ПРОИЗВОЛЬНЫЕ ДОКУМЕНТЫ
      else if (m.files && m.files.length > 0) {
        specialContent = this.buildAttachmentsHtml(m.files);
      } else if (m.file) {
        specialContent = this.buildAttachmentsHtml([m.file]);
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
      const messageAttachments = m.files && m.files.length ? m.files : (m.file ? [m.file] : []);
      const messageSearchText = [m.sender || '', m.text || '']
        .concat(messageAttachments.map(file => file.name || ''))
        .join(' ');

      // Аватар отправителя для входящих сообщений (Telegram Style)
      let avatarHtml = '';
      if (!isOut) {
        const senderProfile = userMap.get((m.sender || '').toLowerCase()) || {};
        const senderAvatarSrc = senderProfile.avatar || null;
        const senderInitial = (m.sender || '?')[0].toUpperCase();
        avatarHtml = senderAvatarSrc
          ? '<div class="tg-msg-avatar" data-sender="' + this.escapeAttr(m.sender) + '" title="@' + this.escapeAttr(m.sender) + '"><img src="' + senderAvatarSrc + '" alt="' + this.escapeAttr(m.sender) + '"></div>'
          : '<div class="tg-msg-avatar" data-sender="' + this.escapeAttr(m.sender) + '" title="@' + this.escapeAttr(m.sender) + '">' + senderInitial + '</div>';
      }

      wrap.innerHTML = [
        '<div class="tg-bubble-row">',
        (!isOut ? avatarHtml : ''),
        '  <div class="tg-msg-bubble ' + (isCircle ? 'is-circle' : '') + '" data-msg-id="' + m.id + '" data-search-text="' + this.escapeAttr(messageSearchText) + '">',
        (!isOut && !isCircle ? '    <div class="tg-sender-heading">@' + this.escape(m.sender) + '</div>' : ''),
        specialContent,
        (m.text ? '    <span class="tg-msg-content">' + this.escape(m.text) + '</span>' : ''),
        bubbleMetaHtml,
        reactionsHtml,
        '  </div>',
        '</div>'
      ].join('');

      // Интерактив для видеокружка
      const circleCard = wrap.querySelector('.tg-circle-card');
      if (circleCard) {
        const vid = circleCard.querySelector('video');
        const progressValue = circleCard.querySelector('.tg-circle-progress-value');
        const mediaId = circleCard.getAttribute('data-media-id');
        const posterId = circleCard.getAttribute('data-poster-id');
        const totalDur = (m.circleVideo && m.circleVideo.duration) || 0;
        const initialPosterUrl = this._mediaBlobUrlCache.get(posterId) || (m.circleVideo && m.circleVideo.poster) || '';
        const progressCircumference = 2 * Math.PI * 47;
        let progressFrameId = null;

        if (initialPosterUrl) this.applyCirclePoster(vid, circleCard, initialPosterUrl);
        else this.ensureCirclePoster(vid, circleCard, posterId);

        const updateCircleProgress = () => {
          const duration = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : totalDur;
          const progress = duration > 0 ? Math.min(1, Math.max(0, vid.currentTime / duration)) : 0;
          if (progressValue) progressValue.style.strokeDashoffset = String(progressCircumference * (1 - progress));
          this.updateMediaPlayerPanel(vid);
        };

        const stopProgressLoop = () => {
          if (progressFrameId !== null) {
            cancelAnimationFrame(progressFrameId);
            progressFrameId = null;
          }
        };

        const runProgressLoop = () => {
          stopProgressLoop();
          const tick = () => {
            updateCircleProgress();
            if (!vid.paused && !vid.ended) progressFrameId = requestAnimationFrame(tick);
            else progressFrameId = null;
          };
          progressFrameId = requestAnimationFrame(tick);
        };

        // timeupdate служит запасным обновлением, а requestAnimationFrame даёт
        // плавное движение кольца без рывков, строго по позиции видео.
        vid.addEventListener('timeupdate', updateCircleProgress);
        vid.addEventListener('playing', () => {
          circleCard.classList.add('playing', 'expanded', 'progress-visible');
          this.updateMediaPlayerPanel(vid);
          runProgressLoop();
        });
        vid.addEventListener('pause', () => {
          stopProgressLoop();
          updateCircleProgress();
          if (!vid.ended) circleCard.classList.remove('playing');
          this.updateMediaPlayerPanel(vid);
        });

        const closeCirclePlayback = (reset = true) => {
          stopProgressLoop();
          try { vid.pause(); } catch (_) {}
          if (reset) {
            try { vid.currentTime = 0; } catch (_) {}
            if (progressValue) progressValue.style.strokeDashoffset = String(progressCircumference);
          }
          circleCard.classList.remove('playing', 'expanded', 'progress-visible');
          if (this.currentPlayingCircle === vid) this.currentPlayingCircle = null;
        };

        // Как в Telegram: после завершения видео возвращается на начало,
        // а линия прогресса обнуляется и исчезает.
        vid.addEventListener('ended', () => {
          stopProgressLoop();
          circleCard.classList.remove('playing', 'expanded');
          circleCard.classList.remove('progress-visible');
          try { vid.currentTime = 0; } catch (_) {}
          if (progressValue) progressValue.style.strokeDashoffset = String(progressCircumference);
          if (this.currentPlayingCircle === vid) {
            this.currentPlayingCircle = null;
          }
          this.finishActiveMediaSession(vid);
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
            this.stopAllPlayingMedia(vid);
            this.currentPlayingCircle = vid;

            if (vid.ended || (vid.duration && vid.currentTime >= vid.duration)) {
              try { vid.currentTime = 0; } catch (_) {}
              if (progressValue) progressValue.style.strokeDashoffset = String(progressCircumference);
            }

            circleCard.classList.add('playing', 'expanded', 'progress-visible');
            this.openMediaPlayerPanel({
              media: vid,
              type: 'circle',
              sender: m.sender,
              chatId: this.currentChatId,
              duration: totalDur,
              toggle: startCirclePlay,
              onClose: closeCirclePlayback
            });
            vid.muted = false;

            const playPromise = vid.play();
            if (playPromise !== undefined) {
              playPromise.catch(err => {
                console.warn('Play unmuted blocked on mobile, retrying muted:', err);
                vid.muted = true;
                vid.play().then(() => {
                  vid.muted = false;
                }).catch(e2 => {
                  this.closeActiveMediaSession(true);
                  console.error('Play circle fallback error:', e2);
                });
              });
            }
          } else {
            vid.pause();
            circleCard.classList.remove('playing');
            circleCard.classList.add('expanded');
            circleCard.classList.add('progress-visible');
            updateCircleProgress();
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
            this.updateMediaPlayerPanel(audioObj);
          });

          audioObj.addEventListener('play', () => this.updateMediaPlayerPanel(audioObj));
          audioObj.addEventListener('pause', () => this.updateMediaPlayerPanel(audioObj));
          audioObj.addEventListener('loadedmetadata', () => this.updateMediaPlayerPanel(audioObj));

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
            this.finishActiveMediaSession(audioObj);
          });
        };

        if (voiceSrc) {
          audio = new Audio(voiceSrc);
          setupAudio(audio);
        }

        const closeVoicePlayback = (reset = true) => {
          if (!audio) return;
          try { audio.pause(); } catch (_) {}
          if (reset) {
            try { audio.currentTime = 0; } catch (_) {}
            if (waveformFg) waveformFg.style.width = '0%';
            if (timeEl) timeEl.innerText = this.formatDuration(totalDur);
          }
          const playIcon = voicePlayBtn.querySelector('.tg-icon-play');
          const pauseIcon = voicePlayBtn.querySelector('.tg-icon-pause');
          if (playIcon) playIcon.classList.remove('hidden');
          if (pauseIcon) pauseIcon.classList.add('hidden');
          if (this.currentPlayingAudio === audio) {
            this.currentPlayingAudio = null;
            this.currentPlayingAudioBtn = null;
          }
        };

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
            this.stopAllPlayingMedia(audio);

            this.currentPlayingAudio = audio;
            this.currentPlayingAudioBtn = voicePlayBtn;

            if (audio.ended || (audio.duration && audio.currentTime >= audio.duration)) {
              try { audio.currentTime = 0; } catch (_) {}
            }

            this.openMediaPlayerPanel({
              media: audio,
              type: 'voice',
              sender: m.sender,
              chatId: this.currentChatId,
              duration: totalDur,
              toggle: toggleVoicePlay,
              onClose: closeVoicePlayback
            });

            audio.play().then(() => {
              if (playIcon) playIcon.classList.add('hidden');
              if (pauseIcon) pauseIcon.classList.remove('hidden');
            }).catch(err => {
              console.warn('Audio play error:', err);
              if (playIcon) playIcon.classList.remove('hidden');
              if (pauseIcon) pauseIcon.classList.add('hidden');
              this.closeActiveMediaSession(true);
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

      // Клик по аватару отправителя: просмотр фото профиля или открытие информации
      const msgAvatar = wrap.querySelector('.tg-msg-avatar');
      if (msgAvatar) {
        msgAvatar.addEventListener('click', (e) => {
          e.stopPropagation();
          const sender = msgAvatar.getAttribute('data-sender');
          const uProfile = userMap.get((sender || '').toLowerCase());
          if (uProfile && uProfile.avatar) {
            this.openLightbox(uProfile.avatar, (uProfile.name || ('@' + sender)) + ' — Фото профиля', 'image');
          } else {
            this.openUserProfile(sender, false);
          }
        });
      }

      // Полноэкранный просмотр фото и видео с непрерывной галереей (Telegram Lightbox)
      wrap.querySelectorAll('.tg-media-open').forEach(mediaEl => {
        mediaEl.addEventListener('click', () => {
          const src = mediaEl.getAttribute('data-src') || '';
          const name = mediaEl.getAttribute('data-name') || 'media';
          const kind = mediaEl.getAttribute('data-media-kind') || 'image';
          let idx = chatMediaPlaylist.findIndex(p => p.src === src);
          if (idx === -1) idx = 0;
          this.openLightbox(src, name, kind, chatMediaPlaylist.length ? chatMediaPlaylist : [{ src, name, kind }], idx);
        });
      });
      wrap.querySelectorAll('.tg-attachment-download').forEach(downloadEl => {
        downloadEl.addEventListener('click', (e) => e.stopPropagation());
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
    if (this.el.messageSearchPanel && !this.el.messageSearchPanel.classList.contains('hidden')) {
      this.updateMessageSearch(false);
    }
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
    if (!this.pendingFiles) this.pendingFiles = [];
    let failed = 0;
    for (const file of files) {
      const mediaId = this.createAttachmentId();
      const saved = await this.storage.saveMediaBlob(mediaId, file);
      if (!saved) {
        failed += 1;
        continue;
      }
      this._mediaBlobUrlCache.set(mediaId, URL.createObjectURL(file));
      this.pendingFiles.push({
        mediaId,
        name: file.name || 'document',
        type: file.type || '',
        size: file.size || 0
      });
    }
    this.renderPendingAttachments();
    this.el.fileInput.value = '';
    if (failed) {
      window.alert('Не удалось прикрепить ' + failed + ' файл(а). Проверьте свободное место на устройстве и повторите попытку.');
    }
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

  async uploadBlob(blob, filename) {
    if (!blob) return;
    const mediaId = this.createAttachmentId();
    const saved = await this.storage.saveMediaBlob(mediaId, blob);
    if (!saved) {
      window.alert('Не удалось прикрепить файл. Проверьте свободное место на устройстве.');
      return;
    }
    this._mediaBlobUrlCache.set(mediaId, URL.createObjectURL(blob));
    if (!this.pendingFiles) this.pendingFiles = [];
    this.pendingFiles.push({
      mediaId,
      name: filename || 'document',
      type: blob.type || '',
      size: blob.size || 0
    });
    this.renderPendingAttachments();
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

  createAttachmentId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'file_' + window.crypto.randomUUID();
    }
    return 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
  }

  getFileExtension(name) {
    const clean = String(name || '').split(/[?#]/)[0];
    const lastDot = clean.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === clean.length - 1) return '';
    return clean.slice(lastDot + 1).toLowerCase();
  }

  getAttachmentKind(file) {
    const type = String((file && file.type) || '').toLowerCase();
    const ext = this.getFileExtension(file && file.name);
    if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg', 'heic', 'heif'].includes(ext)) return 'image';
    if (type.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv', '3gp'].includes(ext)) return 'video';
    return 'document';
  }

  getFileTypeLabel(file) {
    const ext = this.getFileExtension(file && file.name);
    if (ext) return ext.toUpperCase();
    const type = String((file && file.type) || '');
    if (type && type.includes('/')) return type.split('/').pop().toUpperCase();
    return 'FILE';
  }

  truncateFileName(name) {
    const original = String(name || 'document');
    if (original.length <= 25) return original;
    const ext = this.getFileExtension(original);
    const suffix = ext ? '.' + ext : '';
    const base = suffix ? original.slice(0, -suffix.length) : original;
    return base.slice(0, 23) + '…' + suffix;
  }

  getAttachmentSrc(file) {
    return this._mediaBlobUrlCache.get(file.mediaId) || file.data || '';
  }

  buildAttachmentsHtml(files) {
    const normalized = (files || []).filter(Boolean);
    const mediaFiles = normalized.filter(file => this.getAttachmentKind(file) !== 'document');
    const documentFiles = normalized.filter(file => this.getAttachmentKind(file) === 'document');
    let mediaHtml = '';

    if (mediaFiles.length) {
      const gridClass = mediaFiles.length === 1 ? 'grid-1' : (mediaFiles.length === 2 ? 'grid-2' : (mediaFiles.length === 3 ? 'grid-3' : 'grid-more'));
      mediaHtml = '<div class="tg-photo-grid ' + gridClass + '">' + mediaFiles.map(file => {
        const kind = this.getAttachmentKind(file);
        const src = this.getAttachmentSrc(file);
        const safeSrc = this.escapeAttr(src);
        const safeName = this.escapeAttr(file.name || (kind === 'video' ? 'video.mp4' : 'photo.png'));
        const content = kind === 'video'
          ? '<video class="tg-media-photo tg-media-video" src="' + safeSrc + '" muted playsinline preload="metadata"></video><span class="tg-media-play" aria-hidden="true">▶</span>'
          : '<img class="tg-media-photo" src="' + safeSrc + '" alt="' + safeName + '">';
        return [
          '<div class="tg-media-tile tg-media-' + kind + '-tile tg-media-open" role="button" tabindex="0" data-src="' + safeSrc + '" data-name="' + safeName + '" data-media-kind="' + kind + '">',
          content,
          '  <a class="tg-attachment-download tg-media-download" href="' + safeSrc + '" download="' + safeName + '" title="Скачать" aria-label="Скачать ' + safeName + '">',
          '    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
          '  </a>',
          '</div>'
        ].join('');
      }).join('') + '</div>';
    }

    const documentsHtml = documentFiles.map(file => {
      const src = this.getAttachmentSrc(file);
      const safeSrc = this.escapeAttr(src);
      const safeName = this.escapeAttr(file.name || 'document');
      const typeLabel = this.getFileTypeLabel(file);
      const displayName = this.truncateFileName(file.name || 'document');
      return [
        '<div class="tg-file-card">',
        '  <a class="tg-attachment-download tg-file-icon tg-file-download" href="' + safeSrc + '" download="' + safeName + '" title="Скачать ' + safeName + '" aria-label="Скачать ' + safeName + '">',
        '    <svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
        '  </a>',
        '  <div class="tg-file-meta">',
        '    <div class="tg-file-name" title="' + safeName + '">' + this.escape(displayName) + '</div>',
        '    <div class="tg-file-size">' + this.escape(typeLabel) + (file.size ? ' · ' + this.formatSize(file.size) : '') + '</div>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    return mediaHtml + documentsHtml;
  }

  openMessageSearch() {
    if (!this.el.messageSearchPanel || !this.el.messageSearchInput) return;
    this.el.messageSearchPanel.classList.remove('hidden');
    if (this.el.btnChatSearch) this.el.btnChatSearch.classList.add('active');
    window.setTimeout(() => {
      this.el.messageSearchInput.focus();
      this.el.messageSearchInput.select();
    }, 0);
    this.updateMessageSearch(false);
  }

  closeMessageSearch(restoreFocus = true) {
    if (!this.el.messageSearchPanel) return;
    this.el.messageSearchPanel.classList.add('hidden');
    if (this.el.btnChatSearch) this.el.btnChatSearch.classList.remove('active');
    if (this.el.messageSearchInput) this.el.messageSearchInput.value = '';
    this.clearMessageSearchHighlights();
    this.messageSearchResults = [];
    this.messageSearchIndex = -1;
    if (this.el.messageSearchCount) this.el.messageSearchCount.innerText = '0 из 0';
    this.setMessageSearchNavigationDisabled(true);
    if (restoreFocus && this.el.messageInput) this.el.messageInput.focus();
  }

  clearMessageSearchHighlights() {
    if (!this.el.messagesFeed) return;
    this.el.messagesFeed.querySelectorAll('.tg-message-search-match, .tg-message-search-current').forEach(el => {
      el.classList.remove('tg-message-search-match', 'tg-message-search-current');
    });
  }

  setMessageSearchNavigationDisabled(disabled) {
    if (this.el.messageSearchPrev) this.el.messageSearchPrev.disabled = disabled;
    if (this.el.messageSearchNext) this.el.messageSearchNext.disabled = disabled;
  }

  updateMessageSearch(shouldScroll = true) {
    if (!this.el.messageSearchInput || !this.el.messagesFeed) return;
    const query = this.el.messageSearchInput.value.trim().toLocaleLowerCase();
    this.clearMessageSearchHighlights();
    this.messageSearchResults = [];
    this.messageSearchIndex = -1;

    if (query) {
      this.messageSearchResults = Array.from(this.el.messagesFeed.querySelectorAll('.tg-msg-bubble')).filter(bubble => {
        const searchText = bubble.getAttribute('data-search-text') || bubble.innerText || '';
        return searchText.toLocaleLowerCase().includes(query);
      });
      this.messageSearchResults.forEach(bubble => bubble.classList.add('tg-message-search-match'));
      if (this.messageSearchResults.length) this.messageSearchIndex = this.messageSearchResults.length - 1;
    }

    this.setMessageSearchNavigationDisabled(this.messageSearchResults.length === 0);
    this.renderMessageSearchPosition(shouldScroll);
  }

  moveMessageSearch(direction) {
    const total = this.messageSearchResults.length;
    if (!total) return;
    this.messageSearchIndex = (this.messageSearchIndex + direction + total) % total;
    this.renderMessageSearchPosition(true);
  }

  renderMessageSearchPosition(shouldScroll) {
    const total = this.messageSearchResults.length;
    this.messageSearchResults.forEach((bubble, index) => {
      bubble.classList.toggle('tg-message-search-current', index === this.messageSearchIndex);
    });
    if (this.el.messageSearchCount) {
      this.el.messageSearchCount.innerText = total ? (this.messageSearchIndex + 1) + ' из ' + total : '0 из 0';
    }
    if (shouldScroll && total) {
      this.messageSearchResults[this.messageSearchIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  openLightbox(src, name, kind = 'image', playlist = null, index = 0) {
    if (!src && (!playlist || !playlist.length)) return;
    this.lightboxPlaylist = (playlist && playlist.length) ? playlist : [{ src, name, kind }];
    this.lightboxIndex = typeof index === 'number' && index >= 0 && index < this.lightboxPlaylist.length ? index : 0;
    this.lightboxShowCurrent();
    if (this.el.lightboxModal) this.el.lightboxModal.classList.remove('hidden');
    document.body.classList.add('tg-media-viewer-open');
  }

  lightboxShowCurrent() {
    if (!this.lightboxPlaylist || !this.lightboxPlaylist.length) return;
    const item = this.lightboxPlaylist[this.lightboxIndex];
    if (!item) return;

    const isVideo = item.kind === 'video';
    if (this.el.lightboxImg) {
      this.el.lightboxImg.classList.toggle('hidden', isVideo);
      this.el.lightboxImg.src = isVideo ? '' : item.src;
    }
    if (this.el.lightboxVideo) {
      this.el.lightboxVideo.classList.toggle('hidden', !isVideo);
      this.el.lightboxVideo.pause();
      this.el.lightboxVideo.src = isVideo ? item.src : '';
      if (isVideo) {
        this.el.lightboxVideo.load();
        this.el.lightboxVideo.play().catch(() => {});
      }
    }
    if (this.el.lightboxFilename) {
      this.el.lightboxFilename.innerText = item.name || (isVideo ? 'Видео' : 'Фото');
    }
    if (this.el.lightboxDownload) {
      this.el.lightboxDownload.href = item.src;
      this.el.lightboxDownload.setAttribute('download', item.name || (isVideo ? 'video.mp4' : 'photo.png'));
    }

    const total = this.lightboxPlaylist.length;
    if (total > 1) {
      if (this.el.lightboxPrev) this.el.lightboxPrev.classList.remove('hidden');
      if (this.el.lightboxNext) this.el.lightboxNext.classList.remove('hidden');
      if (this.el.lightboxCounter) {
        this.el.lightboxCounter.classList.remove('hidden');
        this.el.lightboxCounter.innerText = (this.lightboxIndex + 1) + ' из ' + total;
      }
    } else {
      if (this.el.lightboxPrev) this.el.lightboxPrev.classList.add('hidden');
      if (this.el.lightboxNext) this.el.lightboxNext.classList.add('hidden');
      if (this.el.lightboxCounter) this.el.lightboxCounter.classList.add('hidden');
    }
  }

  lightboxNext() {
    if (!this.lightboxPlaylist || this.lightboxPlaylist.length <= 1) return;
    this.lightboxIndex = (this.lightboxIndex + 1) % this.lightboxPlaylist.length;
    this.lightboxShowCurrent();
  }

  lightboxPrev() {
    if (!this.lightboxPlaylist || this.lightboxPlaylist.length <= 1) return;
    this.lightboxIndex = (this.lightboxIndex - 1 + this.lightboxPlaylist.length) % this.lightboxPlaylist.length;
    this.lightboxShowCurrent();
  }

  closeLightbox() {
    if (this.el.lightboxModal) this.el.lightboxModal.classList.add('hidden');
    if (this.el.lightboxVideo) {
      this.el.lightboxVideo.pause();
      this.el.lightboxVideo.removeAttribute('src');
      this.el.lightboxVideo.load();
    }
    if (this.el.lightboxImg) this.el.lightboxImg.src = '';
    this.lightboxPlaylist = [];
    this.lightboxIndex = 0;
    document.body.classList.remove('tg-media-viewer-open');
  }

  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
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
      const kind = this.getAttachmentKind(f);
      const icon = kind === 'image' ? '🖼️' : (kind === 'video' ? '🎬' : '📄');
      const displayName = this.truncateFileName(f.name || 'document');
      return [
        '<div class="tg-attach-pill">',
        '  <span>' + icon + '</span>',
        '  <span class="tg-attach-pill-name" title="' + this.escapeAttr(f.name) + '">' + this.escape(displayName) + '</span>',
        '  <button type="button" class="tg-attach-pill-remove" data-idx="' + idx + '" title="Удалить">✕</button>',
        '</div>'
      ].join('');
    }).join('');

    this.el.composerAttachments.querySelectorAll('.tg-attach-pill-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const removed = this.pendingFiles.splice(idx, 1)[0];
        if (removed && removed.mediaId) {
          const cachedUrl = this._mediaBlobUrlCache.get(removed.mediaId);
          if (cachedUrl) URL.revokeObjectURL(cachedUrl);
          this._mediaBlobUrlCache.delete(removed.mediaId);
          await this.storage.deleteMediaBlob(removed.mediaId);
        }
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
          const posterId = mediaId + '_poster';
          const pendingPosterPromise = this._pendingCirclePosterBlobPromise;
          const posterBlob = pendingPosterPromise
            ? await pendingPosterPromise
            : await this.captureVideoPosterBlob(this.el.videoStreamPreview, false);
          if (this._pendingCirclePosterBlobPromise === pendingPosterPromise) {
            this._pendingCirclePosterBlobPromise = null;
          }
          await this.storage.saveMediaBlob(mediaId, blob);
          this._mediaBlobUrlCache.set(mediaId, URL.createObjectURL(blob));
          if (posterBlob) {
            await this.storage.saveMediaBlob(posterId, posterBlob);
            this._mediaBlobUrlCache.set(posterId, URL.createObjectURL(posterBlob));
          }
          await this.storage.sendMessage(this.currentChatId, this.currentUser.username, '', null, null, {
            mediaId: mediaId,
            posterId: posterId,
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

    // Захватываем кадр до скрытия превью и остановки камеры: это особенно
    // важно для Android WebView, который часто не рисует кадр у paused video.
    if (send && this.recordMode === 'video' && this.el.videoStreamPreview && this.el.videoStreamPreview.srcObject) {
      this._pendingCirclePosterBlobPromise = this.captureVideoPosterBlob(this.el.videoStreamPreview, false);
    } else if (!send) {
      this._pendingCirclePosterBlobPromise = null;
    }
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

  showToast(msg) {
    if (!this.el.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'tg-toast';
    toast.innerText = msg;
    this.el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  isChatMuted(chatId) {
    const muted = JSON.parse(localStorage.getItem('gm_muted_chats') || '[]');
    return muted.includes(chatId);
  }

  setChatMute(chatId, isMuted) {
    let muted = JSON.parse(localStorage.getItem('gm_muted_chats') || '[]');
    if (isMuted) {
      if (!muted.includes(chatId)) muted.push(chatId);
    } else {
      muted = muted.filter(id => id !== chatId);
    }
    localStorage.setItem('gm_muted_chats', JSON.stringify(muted));
  }

  toggleChatMute(chatId) {
    const isMuted = !this.isChatMuted(chatId);
    this.setChatMute(chatId, isMuted);
    return isMuted;
  }

  updateMuteUI(isMuted) {
    if (this.el.profileMuteText) {
      this.el.profileMuteText.innerText = isMuted ? 'Без звука' : 'Звук';
    }
    if (this.el.toggleProfileNotifications) {
      this.el.toggleProfileNotifications.checked = !isMuted;
    }
    if (this.el.profileNotificationsText) {
      this.el.profileNotificationsText.innerText = isMuted ? 'Отключены' : 'Включены';
    }
  }

  closeUserProfile() {
    if (this.el.profileModalOverlay) this.el.profileModalOverlay.classList.add('hidden');
    if (this.el.profilePanel) this.el.profilePanel.classList.add('hidden');
  }

  async openUserProfile(username, isOwn = false) {
    username = (username || '').replace(/^@/, '').toLowerCase();
    const myUsername = (this.currentUser && this.currentUser.username ? this.currentUser.username : '').toLowerCase();
    const isReallyOwn = Boolean(isOwn || (myUsername && myUsername === username));

    this.activeProfileUser = await this.storage.getUserProfile(username);
    const isMuted = this.isChatMuted(this.currentChatId);

    // Заголовок и кнопка редактирования
    if (this.el.profilePanelHeaderTitle) {
      this.el.profilePanelHeaderTitle.innerText = isReallyOwn ? 'Мой профиль' : 'Информация';
    }
    if (this.el.btnHeaderEditProfile) {
      this.el.btnHeaderEditProfile.classList.toggle('hidden', !isReallyOwn);
      this.el.btnHeaderEditProfile.style.display = isReallyOwn ? '' : 'none';
    }
    if (this.el.btnEditProfile) {
      this.el.btnEditProfile.classList.toggle('hidden', !isReallyOwn);
      this.el.btnEditProfile.style.display = isReallyOwn ? '' : 'none';
    }
    const profileEditBox = document.getElementById('profile-edit-box');
    if (profileEditBox) {
      profileEditBox.classList.toggle('hidden', !isReallyOwn);
      profileEditBox.style.display = isReallyOwn ? '' : 'none';
    }
    if (this.el.btnChangeAvatar) {
      this.el.btnChangeAvatar.classList.toggle('hidden', !isReallyOwn);
      this.el.btnChangeAvatar.style.display = isReallyOwn ? '' : 'none';
    }

    // Аватар (клик открывает фото на весь экран в Lightbox)
    if (this.activeProfileUser && this.activeProfileUser.avatar) {
      this.el.profileAvatarLarge.innerHTML = '<img src="' + this.activeProfileUser.avatar + '" alt="Avatar" style="cursor:pointer;">';
      this.el.profileAvatarLarge.style.cursor = 'pointer';
      this.el.profileAvatarLarge.onclick = () => {
        this.openLightbox(this.activeProfileUser.avatar, (this.activeProfileUser.name || ('@' + username)) + ' — Фото профиля', 'image');
      };
    } else {
      this.el.profileAvatarLarge.innerText = username === 'general' ? '🌐' : (username[0] ? username[0].toUpperCase() : '?');
      this.el.profileAvatarLarge.style.cursor = 'default';
      this.el.profileAvatarLarge.onclick = null;
    }

    // Имя и статус
    this.el.profileName.innerText = (this.activeProfileUser && this.activeProfileUser.name) || ('@' + username);
    this.el.profileStatus.innerText = isOwn ? 'в сети' : 'был(а) недавно';

    // Поля информации
    if (this.el.profileUsernameVal) {
      this.el.profileUsernameVal.innerText = '@' + username;
    }
    if (this.el.profileBioVal) {
      this.el.profileBioVal.innerText = (this.activeProfileUser && this.activeProfileUser.bio) || (isOwn ? 'Пользуюсь Telegram Web ✨' : 'О себе пока ничего не написано');
    }

    // Звук / Уведомления
    this.updateMuteUI(isMuted);

    // Вкладки медиа, файлов, голосовых
    const targetChatId = isOwn ? 'general' : (this.currentChatId || 'general');
    await this.renderProfileMediaTabs(targetChatId);

    if (this.el.profileModalOverlay) this.el.profileModalOverlay.classList.remove('hidden');
    if (this.el.profilePanel) this.el.profilePanel.classList.remove('hidden');
  }

  async renderProfileMediaTabs(chatId) {
    const { media, files, voice } = await this.storage.getChatMedia(chatId);

    // Обновляем бейджи счетчиков
    if (this.el.badgeCountMedia) this.el.badgeCountMedia.innerText = media.length;
    if (this.el.badgeCountFiles) this.el.badgeCountFiles.innerText = files.length;
    if (this.el.badgeCountVoice) this.el.badgeCountVoice.innerText = voice.length;

    // Рендер Медиа
    if (this.el.profileMediaGrid && this.el.emptyProfileMedia) {
      this.el.profileMediaGrid.innerHTML = '';
      if (media.length === 0) {
        this.el.emptyProfileMedia.classList.remove('hidden');
      } else {
        this.el.emptyProfileMedia.classList.add('hidden');
        media.forEach(item => {
          const thumb = document.createElement('div');
          thumb.className = 'tg-profile-media-thumb';
          const src = this._mediaBlobUrlCache.get(item.file.mediaId) || item.file.data || '';
          if (item.isVideo) {
            thumb.innerHTML = '<video src="' + this.escapeAttr(src) + '" preload="metadata"></video><span class="tg-profile-media-video-badge">▶ ' + item.time + '</span>';
          } else {
            thumb.innerHTML = '<img src="' + this.escapeAttr(src) + '" alt="Photo">';
          }
          thumb.addEventListener('click', () => {
            this.openLightbox(src, item.file.name || 'media');
          });
          this.el.profileMediaGrid.appendChild(thumb);
        });
      }
    }

    // Рендер Файлов
    if (this.el.profileFilesList && this.el.emptyProfileFiles) {
      this.el.profileFilesList.innerHTML = '';
      if (files.length === 0) {
        this.el.emptyProfileFiles.classList.remove('hidden');
      } else {
        this.el.emptyProfileFiles.classList.add('hidden');
        files.forEach(item => {
          const fileEl = document.createElement('div');
          fileEl.className = 'tg-profile-file-item';
          const src = this._mediaBlobUrlCache.get(item.file.mediaId) || item.file.data || '';
          const ext = this.getFileExtension(item.file.name);
          fileEl.innerHTML = [
            '<div class="tg-profile-file-icon">📄</div>',
            '<div class="tg-profile-file-info">',
            '  <div class="tg-profile-file-name">' + this.escape(item.file.name || 'document') + '</div>',
            '  <div class="tg-profile-file-meta">' + this.formatSize(item.file.size) + ' · ' + item.time + '</div>',
            '</div>',
            '<a class="tg-icon-btn" href="' + this.escapeAttr(src) + '" download="' + this.escapeAttr(item.file.name || 'document') + '" title="Скачать">',
            '  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
            '</a>'
          ].join('');
          this.el.profileFilesList.appendChild(fileEl);
        });
      }
    }

    // Рендер Голосовых / Кружков
    if (this.el.profileVoiceList && this.el.emptyProfileVoice) {
      this.el.profileVoiceList.innerHTML = '';
      if (voice.length === 0) {
        this.el.emptyProfileVoice.classList.remove('hidden');
      } else {
        this.el.emptyProfileVoice.classList.add('hidden');
        voice.forEach(item => {
          const voiceEl = document.createElement('div');
          voiceEl.className = 'tg-profile-file-item';
          const isCircle = item.type === 'circle';
          const icon = isCircle ? '📹' : '🎙️';
          const title = isCircle ? 'Видеокружок' : 'Голосовое сообщение';
          const dur = (item.voice && item.voice.duration) || (item.circleVideo && item.circleVideo.duration) || 0;
          voiceEl.innerHTML = [
            '<div class="tg-profile-file-icon" style="background: ' + (isCircle ? '#0284c7' : '#3390ec') + '">' + icon + '</div>',
            '<div class="tg-profile-file-info">',
            '  <div class="tg-profile-file-name">' + title + ' (' + this.formatDuration(dur) + ')</div>',
            '  <div class="tg-profile-file-meta">от @' + this.escape(item.sender) + ' · ' + item.time + '</div>',
            '</div>'
          ].join('');
          this.el.profileVoiceList.appendChild(voiceEl);
        });
      }
    }
  }

  openEditProfileModal() {
    if (!this.el.modalEditProfile) return;
    this.pendingEditAvatar = this.currentUser.avatar || null;

    if (this.el.editProfileDisplayName) {
      this.el.editProfileDisplayName.value = this.currentUser.name || ('@' + this.currentUser.username);
    }
    if (this.el.editProfileUsername) {
      this.el.editProfileUsername.value = '@' + this.currentUser.username;
    }
    if (this.el.editProfileBio) {
      this.el.editProfileBio.value = this.currentUser.bio || '';
      if (this.el.editBioCounter) {
        this.el.editBioCounter.innerText = (this.currentUser.bio || '').length + ' / 140';
      }
    }
    if (this.el.editAvatarPreview) {
      if (this.currentUser.avatar) {
        this.el.editAvatarPreview.innerHTML = '<img src="' + this.currentUser.avatar + '" alt="Avatar">';
      } else {
        this.el.editAvatarPreview.innerText = this.currentUser.username[0].toUpperCase();
      }
    }

    this.el.modalEditProfile.classList.remove('hidden');
    if (this.el.editProfileDisplayName) this.el.editProfileDisplayName.focus();
  }

  closeEditProfileModal() {
    if (this.el.modalEditProfile) {
      this.el.modalEditProfile.classList.add('hidden');
    }
  }

  async saveEditedProfile(e) {
    if (e) e.preventDefault();
    const newName = this.el.editProfileDisplayName.value.trim() || ('@' + this.currentUser.username);
    const newBio = this.el.editProfileBio.value.trim();

    await this.storage.updateUserProfile(this.currentUser.username, {
      name: newName,
      bio: newBio,
      avatar: this.pendingEditAvatar
    });

    this.currentUser.name = newName;
    this.currentUser.bio = newBio;
    this.currentUser.avatar = this.pendingEditAvatar;

    this.renderAvatars();
    if (this.el.currentUserName) this.el.currentUserName.innerText = this.currentUser.name;
    if (this.el.currentUserHandle) this.el.currentUserHandle.innerText = '@' + this.currentUser.username;

    this.closeEditProfileModal();
    await this.openUserProfile(this.currentUser.username, true);
    await this.renderChatList();
    this.showToast('Профиль успешно обновлен ✨');
  }

  renderAvatars() {
    const avatarSrc = this.currentUser ? this.currentUser.avatar : null;
    const initial = this.currentUser ? this.currentUser.username[0].toUpperCase() : '?';

    if (this.el.currentUserAvatar) {
      if (avatarSrc) {
        this.el.currentUserAvatar.innerHTML = '<img src="' + avatarSrc + '" alt="Avatar">';
      } else {
        this.el.currentUserAvatar.innerText = initial;
      }
    }
    if (this.el.railUserAvatar) {
      if (avatarSrc) {
        this.el.railUserAvatar.innerHTML = '<img src="' + avatarSrc + '" alt="Avatar">';
      } else {
        this.el.railUserAvatar.innerText = initial;
      }
    }
    if (this.el.mobUserAvatar) {
      if (avatarSrc) {
        this.el.mobUserAvatar.innerHTML = '<img src="' + avatarSrc + '" alt="Avatar">';
      } else {
        this.el.mobUserAvatar.innerText = initial;
      }
    }
    if (this.el.railUserName && this.currentUser) {
      this.el.railUserName.innerText = this.currentUser.name || ('@' + this.currentUser.username);
    }
    if (this.el.currentUserName && this.currentUser) {
      this.el.currentUserName.innerText = this.currentUser.name || ('@' + this.currentUser.username);
    }
    if (this.el.currentUserHandle && this.currentUser) {
      this.el.currentUserHandle.innerText = '@' + this.currentUser.username;
    }
  }

  async handleSearch(q, filter = 'all') {
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

    const users = await this.storage.searchUsers(q, this.currentUser.username);
    const allMsgs = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const matchingMsgs = allMsgs.filter(m => (m.text || '').toLowerCase().includes(q));

    this.el.searchResultsList.innerHTML = '';

    let itemsCount = 0;

    // 1. Контакты / Пользователи (если фильтр all или chats)
    if (filter === 'all' || filter === 'chats') {
      if (users.length > 0) {
        const usersHeader = document.createElement('div');
        usersHeader.className = 'tg-section-caption';
        usersHeader.innerText = 'Люди и контакты (' + users.length + ')';
        this.el.searchResultsList.appendChild(usersHeader);

        users.forEach(u => {
          itemsCount++;
          const item = document.createElement('div');
          item.className = 'tg-search-item';
          const avatarContent = u.avatar ? '<img src="' + u.avatar + '" alt="Avatar">' : u.username[0].toUpperCase();
          item.innerHTML = [
            '<div class="tg-avatar tg-avatar-user" style="width:42px;height:42px;font-size:16px;">' + avatarContent + '</div>',
            '<div class="tg-chat-body">',
            '  <div class="tg-chat-name">' + this.escape(u.name || ('@' + u.username)) + '</div>',
            '  <div class="tg-chat-snippet">@' + this.escape(u.username) + (u.bio ? ' · ' + this.escape(u.bio) : '') + '</div>',
            '</div>'
          ].join('');
          item.addEventListener('click', () => {
            this.openDirectChat(u.username);
          });
          this.el.searchResultsList.appendChild(item);
        });
      }
    }

    // 2. Сообщения
    if (filter === 'all' || filter === 'chats') {
      if (matchingMsgs.length > 0) {
        const msgsHeader = document.createElement('div');
        msgsHeader.className = 'tg-section-caption';
        msgsHeader.style.marginTop = '12px';
        msgsHeader.innerText = 'Найденные сообщения (' + matchingMsgs.length + ')';
        this.el.searchResultsList.appendChild(msgsHeader);

        matchingMsgs.slice(0, 20).forEach(m => {
          itemsCount++;
          const item = document.createElement('div');
          item.className = 'tg-search-item';
          const senderInitial = (m.sender || '?')[0].toUpperCase();
          item.innerHTML = [
            '<div class="tg-avatar tg-avatar-user" style="width:38px;height:38px;font-size:15px;background:#2b5278;">' + senderInitial + '</div>',
            '<div class="tg-chat-body">',
            '  <div class="tg-chat-top">',
            '    <div class="tg-chat-name">@' + this.escape(m.sender) + '</div>',
            '    <div class="tg-chat-date">' + m.time + '</div>',
            '  </div>',
            '  <div class="tg-chat-snippet">' + this.escape(m.text) + '</div>',
            '</div>'
          ].join('');
          item.addEventListener('click', () => {
            this.openChat(m.chatId, m.chatId === 'general' ? 'Общий чат' : '@' + m.sender);
          });
          this.el.searchResultsList.appendChild(item);
        });
      }
    }

    // 3. Медиа / Файлы (если выбран фильтр media или files)
    if (filter === 'media' || filter === 'files') {
      const mediaResults = allMsgs.filter(m => {
        if (!m.files && !m.file) return false;
        const list = m.files || [m.file];
        return list.some(f => (f.name || '').toLowerCase().includes(q));
      });

      if (mediaResults.length > 0) {
        mediaResults.forEach(m => {
          itemsCount++;
          const item = document.createElement('div');
          item.className = 'tg-search-item';
          item.innerHTML = [
            '<div class="tg-avatar tg-avatar-user" style="width:38px;height:38px;font-size:15px;">📁</div>',
            '<div class="tg-chat-body">',
            '  <div class="tg-chat-name">' + this.escape(m.file ? m.file.name : 'Файл') + '</div>',
            '  <div class="tg-chat-snippet">в диалоге ' + m.chatId + ' · ' + m.time + '</div>',
            '</div>'
          ].join('');
          item.addEventListener('click', () => {
            this.openChat(m.chatId, m.chatId === 'general' ? 'Общий чат' : '@' + m.sender);
          });
          this.el.searchResultsList.appendChild(item);
        });
      }
    }

    if (itemsCount === 0) {
      this.el.searchResultsList.innerHTML = '<div style="padding:28px;text-align:center;color:var(--tg-text-sub);font-size:13.5px;">Ничего не найдено по запросу «' + this.escape(q) + '»</div>';
    }
  }

  // ==========================================
  // НАВИГАЦИЯ МЕЖДУ РАЗДЕЛАМИ (ЧАТЫ, КОНТАКТЫ, ПРОФИЛЬ, НАСТРОЙКИ)
  // ==========================================
  switchSidebarView(viewName) {
    this.activeSidebarView = viewName;

    const views = {
      chats: this.el.sidebarViewChats,
      contacts: this.el.sidebarViewContacts,
      profile: this.el.sidebarViewProfile,
      settings: this.el.sidebarViewSettings
    };

    Object.entries(views).forEach(([name, el]) => {
      if (el) el.classList.toggle('hidden', name !== viewName);
    });

    const railNavs = {
      chats: this.el.railNavChats,
      contacts: this.el.railNavContacts,
      profile: this.el.railNavProfile,
      settings: this.el.railNavSettings
    };
    Object.entries(railNavs).forEach(([name, el]) => {
      if (el) el.classList.toggle('active', name === viewName);
    });

    const mobNavs = {
      chats: this.el.mobNavChats,
      contacts: this.el.mobNavContacts,
      profile: this.el.mobNavProfile,
      settings: this.el.mobNavSettings
    };
    Object.entries(mobNavs).forEach(([name, el]) => {
      if (el) el.classList.toggle('active', name === viewName);
    });

    if (window.innerWidth <= 768 && this.el.chatView) {
      this.el.chatView.classList.remove('active');
    }

    if (viewName === 'chats') {
      this.renderChatList();
    } else if (viewName === 'contacts') {
      this.renderContactsList();
    } else if (viewName === 'profile') {
      this.renderProfileFeed();
    } else if (viewName === 'settings') {
      this.renderSettingsView();
    }
  }

  // ==========================================
  // РАЗДЕЛ: КОНТАКТЫ
  // ==========================================
  async renderContactsList() {
    if (!this.el.contactsList || !this.currentUser) return;
    const query = (this.el.contactsSearch ? this.el.contactsSearch.value : '').trim().toLowerCase().replace(/^@/, '');
    let contacts = await this.storage.getContacts(this.currentUser.username);

    if (query) {
      contacts = contacts.filter(c => 
        (c.username && c.username.toLowerCase().includes(query)) ||
        (c.name && c.name.toLowerCase().includes(query))
      );
    }

    if (this.contactsSortMode === 'name') {
      contacts.sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, 'ru'));
    } else {
      contacts.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    }

    if (this.el.contactsCountLabel) {
      const count = contacts.length;
      let word = 'контактов';
      if (count % 10 === 1 && count % 100 !== 11) word = 'контакт';
      else if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) word = 'контакта';
      this.el.contactsCountLabel.innerText = count + ' ' + word;
    }

    this.el.contactsList.innerHTML = '';

    if (contacts.length === 0) {
      this.el.contactsList.innerHTML = '<div style="padding:32px 16px;text-align:center;color:var(--tg-text-sub);font-size:13.5px;">Контакты не найдены</div>';
      return;
    }

    for (const c of contacts) {
      const profile = await this.storage.getUserProfile(c.username);
      const displayName = c.name || profile.name || ('@' + c.username);
      const initial = (c.username || '?')[0].toUpperCase();
      const avatarHtml = profile.avatar
        ? '<img src="' + profile.avatar + '" alt="' + this.escapeAttr(displayName) + '">'
        : initial;

      const item = document.createElement('div');
      item.className = 'tg-contact-item';
      item.innerHTML = [
        '<div class="tg-avatar tg-avatar-user" style="width:44px;height:44px;font-size:16px;">' + avatarHtml + '</div>',
        '<div class="tg-contact-info">',
        '  <div class="tg-contact-name">' + this.escape(displayName) + '</div>',
        '  <div class="tg-contact-handle">@' + this.escape(c.username) + (profile.bio ? ' · ' + this.escape(profile.bio) : '') + '</div>',
        '</div>',
        '<div class="tg-contact-actions">',
        '  <button type="button" class="tg-contact-action-btn btn-open-chat" title="Написать сообщение">',
        '    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>',
        '  </button>',
        '  <button type="button" class="tg-contact-action-btn btn-del-contact" title="Удалить из контактов">',
        '    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
        '  </button>',
        '</div>'
      ].join('');

      item.querySelector('.btn-open-chat').addEventListener('click', (e) => {
        e.stopPropagation();
        this.openDirectChat(c.username);
      });
      item.querySelector('.btn-del-contact').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteContact(c.username);
      });
      item.addEventListener('click', () => {
        this.openDirectChat(c.username);
      });

      this.el.contactsList.appendChild(item);
    }
  }

  toggleContactsSort() {
    this.contactsSortMode = this.contactsSortMode === 'name' ? 'date' : 'name';
    if (this.el.btnSortContacts) {
      this.el.btnSortContacts.title = this.contactsSortMode === 'name' ? 'Сортировка: По алфавиту (А-Я)' : 'Сортировка: По дате добавления';
    }
    this.showToast(this.contactsSortMode === 'name' ? 'Сортировка по алфавиту (А-Я)' : 'Сортировка по дате добавления');
    this.renderContactsList();
  }

  openAddContactModal(prefill = null) {
    if (!this.el.modalAddContact) return;
    if (this.el.addContactName) this.el.addContactName.value = prefill && prefill.name ? prefill.name : '';
    if (this.el.addContactUsername) this.el.addContactUsername.value = prefill && prefill.username ? prefill.username : '';
    if (this.el.addContactBio) this.el.addContactBio.value = prefill && prefill.bio ? prefill.bio : '';
    this.el.modalAddContact.classList.remove('hidden');
    if (this.el.addContactUsername) this.el.addContactUsername.focus();
  }

  closeAddContactModal() {
    if (this.el.modalAddContact) {
      this.el.modalAddContact.classList.add('hidden');
    }
  }

  async handleAddContactSubmit(e) {
    if (e) e.preventDefault();
    const rawUsername = (this.el.addContactUsername ? this.el.addContactUsername.value : '').trim().replace(/^@/, '');
    const name = (this.el.addContactName ? this.el.addContactName.value : '').trim();
    const bio = (this.el.addContactBio ? this.el.addContactBio.value : '').trim();

    if (!rawUsername) {
      alert('Укажите @username контакта');
      return;
    }
    if (rawUsername.toLowerCase() === this.currentUser.username.toLowerCase()) {
      alert('Нельзя добавить самого себя в контакты');
      return;
    }

    await this.storage.saveContact(this.currentUser.username, {
      username: rawUsername,
      name: name || ('@' + rawUsername),
      bio: bio
    });

    this.closeAddContactModal();
    await this.renderContactsList();
    this.showToast('Контакт @' + rawUsername + ' сохранен ✨');
  }

  async deleteContact(targetUsername) {
    if (!confirm('Удалить @' + targetUsername + ' из контактов?')) return;
    await this.storage.deleteContact(this.currentUser.username, targetUsername);
    await this.renderContactsList();
    this.showToast('Контакт удален');
  }

  // ==========================================
  // РАЗДЕЛ: ПРОФИЛЬ (ЖИВАЯ ЛЕНТА И ПРЯМОЕ РЕДАКТИРОВАНИЕ)
  // ==========================================
  async renderProfileFeed() {
    if (!this.currentUser) return;
    const profile = await this.storage.getUserProfile(this.currentUser.username);
    const initial = (this.currentUser.username || '?')[0].toUpperCase();

    if (this.el.feedUserAvatar) {
      if (profile.avatar) {
        this.el.feedUserAvatar.innerHTML = '<img src="' + profile.avatar + '" alt="Avatar">';
        this.el.feedUserAvatar.onclick = () => {
          this.openLightbox(profile.avatar, (profile.name || ('@' + this.currentUser.username)) + ' — Фото профиля', 'image');
        };
      } else {
        this.el.feedUserAvatar.innerText = initial;
        this.el.feedUserAvatar.onclick = null;
      }
    }

    if (this.el.feedHeroName) {
      this.el.feedHeroName.innerText = profile.name || ('@' + this.currentUser.username);
    }

    if (this.el.feedProfileDisplayName) {
      this.el.feedProfileDisplayName.value = profile.name || '';
    }
    if (this.el.feedProfileUsername) {
      this.el.feedProfileUsername.value = '@' + this.currentUser.username;
    }
    if (this.el.feedProfileBio) {
      this.el.feedProfileBio.value = profile.bio || '';
      if (this.el.feedBioCounter) {
        this.el.feedBioCounter.innerText = (profile.bio || '').length + ' / 140';
      }
    }

    const contacts = await this.storage.getContacts(this.currentUser.username);
    const userMedia = await this.storage.getAllUserMedia(this.currentUser.username);
    const allMsgs = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const userChats = new Set(allMsgs.filter(m => m.sender === this.currentUser.username || (m.chatId && m.chatId.includes(this.currentUser.username))).map(m => m.chatId));

    if (this.el.statChatsCount) this.el.statChatsCount.innerText = Math.max(1, userChats.size);
    if (this.el.statMediaCount) this.el.statMediaCount.innerText = userMedia.media.length + userMedia.files.length + userMedia.voice.length;
    if (this.el.statContactsCount) this.el.statContactsCount.innerText = contacts.length;

    await this.renderProfileFeedMedia();
  }

  switchFeedMediaTab(tab) {
    this.feedActiveTab = tab;
    if (this.el.feedTabs) {
      this.el.feedTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-feed-tab') === tab));
    }
    if (this.el.feedPaneMedia) this.el.feedPaneMedia.classList.toggle('hidden', tab !== 'media');
    if (this.el.feedPaneFiles) this.el.feedPaneFiles.classList.toggle('hidden', tab !== 'files');
    if (this.el.feedPaneVoice) this.el.feedPaneVoice.classList.toggle('hidden', tab !== 'voice');
    this.renderProfileFeedMedia();
  }

  async renderProfileFeedMedia() {
    if (!this.currentUser) return;
    const { media, files, voice } = await this.storage.getAllUserMedia(this.currentUser.username);

    if (this.el.feedPaneMedia) {
      const grid = this.el.feedPaneMedia.querySelector('.tg-profile-media-grid');
      const empty = this.el.feedPaneMedia.querySelector('.tg-empty-state');
      if (grid) {
        grid.innerHTML = '';
        if (media.length === 0) {
          if (empty) empty.classList.remove('hidden');
        } else {
          if (empty) empty.classList.add('hidden');
          media.forEach(item => {
            const thumb = document.createElement('div');
            thumb.className = 'tg-profile-media-thumb';
            const src = this._mediaBlobUrlCache.get(item.file.mediaId) || item.file.data || '';
            if (item.isVideo) {
              thumb.innerHTML = '<video src="' + this.escapeAttr(src) + '" preload="metadata"></video><span class="tg-profile-media-video-badge">▶ ' + item.time + '</span>';
            } else {
              thumb.innerHTML = '<img src="' + this.escapeAttr(src) + '" alt="Photo">';
            }
            thumb.addEventListener('click', () => {
              this.openLightbox(src, item.file.name || 'media');
            });
            grid.appendChild(thumb);
          });
        }
      }
    }

    if (this.el.feedPaneFiles) {
      const list = this.el.feedPaneFiles.querySelector('.tg-profile-files-list');
      const empty = this.el.feedPaneFiles.querySelector('.tg-empty-state');
      if (list) {
        list.innerHTML = '';
        if (files.length === 0) {
          if (empty) empty.classList.remove('hidden');
        } else {
          if (empty) empty.classList.add('hidden');
          files.forEach(item => {
            const fileEl = document.createElement('div');
            fileEl.className = 'tg-profile-file-item';
            const src = this._mediaBlobUrlCache.get(item.file.mediaId) || item.file.data || '';
            fileEl.innerHTML = [
              '<div class="tg-profile-file-icon">📄</div>',
              '<div class="tg-profile-file-info">',
              '  <div class="tg-profile-file-name">' + this.escape(item.file.name || 'document') + '</div>',
              '  <div class="tg-profile-file-meta">' + this.formatSize(item.file.size) + ' · ' + item.time + '</div>',
              '</div>',
              '<a class="tg-icon-btn" href="' + this.escapeAttr(src) + '" download="' + this.escapeAttr(item.file.name || 'document') + '" title="Скачать">',
              '  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
              '</a>'
            ].join('');
            list.appendChild(fileEl);
          });
        }
      }
    }

    if (this.el.feedPaneVoice) {
      const list = this.el.feedPaneVoice.querySelector('.tg-profile-files-list');
      const empty = this.el.feedPaneVoice.querySelector('.tg-empty-state');
      if (list) {
        list.innerHTML = '';
        if (voice.length === 0) {
          if (empty) empty.classList.remove('hidden');
        } else {
          if (empty) empty.classList.add('hidden');
          voice.forEach(item => {
            const voiceEl = document.createElement('div');
            voiceEl.className = 'tg-profile-file-item';
            const isCircle = item.type === 'circle';
            const icon = isCircle ? '📹' : '🎙️';
            const title = isCircle ? 'Видеокружок' : 'Голосовое сообщение';
            const dur = (item.voice && item.voice.duration) || (item.circleVideo && item.circleVideo.duration) || 0;
            voiceEl.innerHTML = [
              '<div class="tg-profile-file-icon" style="background: ' + (isCircle ? '#0284c7' : '#3390ec') + '">' + icon + '</div>',
              '<div class="tg-profile-file-info">',
              '  <div class="tg-profile-file-name">' + title + ' (' + this.formatDuration(dur) + ')</div>',
              '  <div class="tg-profile-file-meta">Диалог: ' + item.chatId + ' · ' + item.time + '</div>',
              '</div>'
            ].join('');
            list.appendChild(voiceEl);
          });
        }
      }
    }
  }

  async handleFeedProfileSave(e) {
    if (e) e.preventDefault();
    const newName = (this.el.feedProfileDisplayName ? this.el.feedProfileDisplayName.value : '').trim() || ('@' + this.currentUser.username);
    const newBio = (this.el.feedProfileBio ? this.el.feedProfileBio.value : '').trim();

    await this.storage.updateUserProfile(this.currentUser.username, {
      name: newName,
      bio: newBio
    });

    this.currentUser.name = newName;
    this.currentUser.bio = newBio;

    this.renderAvatars();
    if (this.el.feedHeroName) this.el.feedHeroName.innerText = newName;
    this.showToast('Изменения сохранены ✨');
  }

  // ==========================================
  // РАЗДЕЛ: НАСТРОЙКИ
  // ==========================================
  async renderSettingsView() {
    const currentAccent = localStorage.getItem('tg_accent_color') || '#3390ec';
    if (this.el.themePalette) {
      this.el.themePalette.querySelectorAll('.tg-palette-chip').forEach(chip => {
        chip.classList.toggle('active', chip.getAttribute('data-accent') === currentAccent);
      });
    }

    if (this.el.settingsStorageUsage) {
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          const usedMB = (estimate.usage / (1024 * 1024)).toFixed(1);
          this.el.settingsStorageUsage.innerText = usedMB + ' МБ';
        } catch (err) {
          this.el.settingsStorageUsage.innerText = 'IndexedDB активна';
        }
      } else {
        this.el.settingsStorageUsage.innerText = 'IndexedDB активна';
      }
    }
  }

  setThemeAccent(colorHex) {
    document.documentElement.style.setProperty('--tg-primary', colorHex);
    document.documentElement.style.setProperty('--tg-bubble-out', colorHex);
    localStorage.setItem('tg_accent_color', colorHex);
    if (this.el.themePalette) {
      this.el.themePalette.querySelectorAll('.tg-palette-chip').forEach(chip => {
        chip.classList.toggle('active', chip.getAttribute('data-accent') === colorHex);
      });
    }
    this.showToast('Цветовая тема применена');
  }

  async clearMediaCache() {
    if (!confirm('Очистить локальный кэш медиа? Сами сообщения и файлы сохранятся в базе данных.')) return;
    this._mediaBlobUrlCache.clear();
    this.showToast('Кэш медиа успешно очищен 🧹');
    this.renderSettingsView();
  }

  // ==========================================
  // МОДАЛЬНОЕ ОКНО: МОИ ФАЙЛЫ
  // ==========================================
  openMyFilesModal() {
    if (!this.el.modalMyFiles) return;
    this.myfilesFilter = 'all';
    this.el.modalMyFiles.classList.remove('hidden');
    this.renderMyFilesList();
  }

  closeMyFilesModal() {
    if (this.el.modalMyFiles) {
      this.el.modalMyFiles.classList.add('hidden');
    }
  }

  async renderMyFilesList() {
    if (!this.el.myfilesList || !this.currentUser) return;
    const query = (this.el.myfilesSearch ? this.el.myfilesSearch.value : '').trim().toLowerCase();
    const { media, files, voice } = await this.storage.getAllUserMedia(this.currentUser.username);

    let allItems = [];
    if (this.myfilesFilter === 'all' || this.myfilesFilter === 'media') {
      allItems = allItems.concat(media);
    }
    if (this.myfilesFilter === 'all' || this.myfilesFilter === 'docs') {
      allItems = allItems.concat(files);
    }
    if (this.myfilesFilter === 'all' || this.myfilesFilter === 'voice') {
      allItems = allItems.concat(voice);
    }

    if (query) {
      allItems = allItems.filter(item => {
        const name = (item.file && item.file.name) || (item.type === 'circle' ? 'видеокружок' : 'голосовое');
        return name.toLowerCase().includes(query) || item.chatId.toLowerCase().includes(query);
      });
    }

    this.el.myfilesList.innerHTML = '';

    if (allItems.length === 0) {
      this.el.myfilesList.innerHTML = '<div style="padding:36px 16px;text-align:center;color:var(--tg-text-sub);font-size:13.5px;">Файлы не найдены</div>';
      return;
    }

    allItems.forEach(item => {
      const row = document.createElement('div');
      row.className = 'tg-myfile-row';
      const isCircle = item.type === 'circle';
      const isVoice = item.type === 'voice';
      const isMedia = item.type === 'image' || item.type === 'video';

      let icon = '📄';
      let title = item.file ? (item.file.name || 'Файл') : (isCircle ? 'Видеокружок' : 'Голосовое сообщение');
      let meta = (item.file && item.file.size ? this.formatSize(item.file.size) + ' · ' : '') + item.chatId + ' · ' + item.time;
      let src = (item.file && item.file.mediaId && this._mediaBlobUrlCache.get(item.file.mediaId)) || (item.file && item.file.data) || '';

      if (isMedia) icon = item.type === 'video' ? '🎬' : '🖼️';
      else if (isCircle) icon = '📹';
      else if (isVoice) icon = '🎙️';

      row.innerHTML = [
        '<div class="tg-profile-file-icon">' + icon + '</div>',
        '<div class="tg-myfile-info">',
        '  <div class="tg-myfile-name">' + this.escape(title) + '</div>',
        '  <div class="tg-myfile-sub">' + this.escape(meta) + '</div>',
        '</div>',
        (src ? '<a class="tg-icon-btn" href="' + this.escapeAttr(src) + '" download="' + this.escapeAttr(title) + '" title="Скачать"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></a>' : '')
      ].join('');

      this.el.myfilesList.appendChild(row);
    });
  }

  // ==========================================
  // МОДАЛЬНОЕ ОКНО: ЧЕРНЫЙ СПИСОК (ЗАБЛОКИРОВАННЫЕ)
  // ==========================================
  openBlacklistModal() {
    if (!this.el.modalBlacklist) return;
    this.el.modalBlacklist.classList.remove('hidden');
    this.renderBlacklist();
  }

  closeBlacklistModal() {
    if (this.el.modalBlacklist) {
      this.el.modalBlacklist.classList.add('hidden');
    }
  }

  async renderBlacklist() {
    if (!this.el.blacklistItemsList || !this.currentUser) return;
    const list = this.storage.getBlacklist(this.currentUser.username);
    this.el.blacklistItemsList.innerHTML = '';

    if (list.length === 0) {
      this.el.blacklistItemsList.innerHTML = '<div style="padding:28px 16px;text-align:center;color:var(--tg-text-sub);font-size:13.5px;">Черный список пуст</div>';
      return;
    }

    for (const u of list) {
      const profile = await this.storage.getUserProfile(u);
      const row = document.createElement('div');
      row.className = 'tg-blacklist-row';
      const initial = u[0] ? u[0].toUpperCase() : '?';
      const avatarHtml = profile.avatar ? '<img src="' + profile.avatar + '" alt="' + u + '">' : initial;

      row.innerHTML = [
        '<div class="tg-avatar tg-avatar-user" style="width:38px;height:38px;font-size:15px;">' + avatarHtml + '</div>',
        '<div style="flex:1;min-width:0;">',
        '  <div style="font-weight:600;font-size:14px;color:var(--tg-text);">' + this.escape(profile.name || ('@' + u)) + '</div>',
        '  <div style="font-size:12.5px;color:var(--tg-text-sub);">@' + this.escape(u) + '</div>',
        '</div>',
        '<button type="button" class="tg-btn-unblock" style="padding:6px 12px;background:none;border:1px solid var(--tg-border);border-radius:16px;color:var(--tg-primary);cursor:pointer;font-size:12.5px;font-weight:600;">Разблокировать</button>'
      ].join('');

      row.querySelector('.tg-btn-unblock').addEventListener('click', () => {
        this.unblockUser(u);
      });

      this.el.blacklistItemsList.appendChild(row);
    }
  }

  async handleBlacklistAdd() {
    const raw = (this.el.blacklistInputUsername ? this.el.blacklistInputUsername.value : '').trim().replace(/^@/, '');
    if (!raw) return;
    if (raw.toLowerCase() === this.currentUser.username.toLowerCase()) {
      alert('Нельзя заблокировать самого себя');
      return;
    }
    this.storage.toggleBlacklist(this.currentUser.username, raw);
    if (this.el.blacklistInputUsername) this.el.blacklistInputUsername.value = '';
    await this.renderBlacklist();
    this.showToast('@' + raw + ' добавлен в черный список');
  }

  async unblockUser(targetUsername) {
    this.storage.toggleBlacklist(this.currentUser.username, targetUsername);
    await this.renderBlacklist();
    this.showToast('@' + targetUsername + ' разблокирован');
  }

  escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
  }

  escapeAttr(str) {
    return this.escape(String(str || '')).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
