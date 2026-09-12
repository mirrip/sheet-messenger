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
        { id: 'usr_durov', username: 'durov', name: 'Павел Дуров' },
        { id: 'usr_maria', username: 'maria', name: 'Мария' }
      ];
      localStorage.setItem('gm_users', JSON.stringify(demoUsers));
    }
    if (!localStorage.getItem('gm_messages')) {
      const demoMessages = [];
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

    return { ok: true, user: { id: user.id, username: user.username, name: user.name, bio: user.bio, phone: user.phone || '', avatar: user.avatar } };
  }


  renameUsername(oldUsername, proposed) {
    if (this.config.STORAGE_MODE !== 'local') throw new Error('Смена username пока доступна только в локальном режиме');
    const oldName = oldUsername.toLowerCase();
    const next = proposed.trim().replace(/^@/, '').toLowerCase();
    if (next === oldName) return next;
    if (!/^[a-z][a-z0-9_]{4,31}$/.test(next)) throw new Error('Username: 5–32 символа, латинская буква в начале, затем буквы, цифры или _');
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    if (users.some(u => u.username.toLowerCase() === next)) throw new Error('Этот username уже занят');
    const user = users.find(u => u.username.toLowerCase() === oldName);
    if (!user) throw new Error('Профиль не найден');
    const remap = value => value === oldName ? next : value;
    const chatId = id => {
      if (typeof id !== 'string') return id;
      if (id.startsWith('dm:')) return 'dm:' + id.slice(3).split(':').map(remap).sort().join(':');
      if (id === 'saved:' + oldName) return 'saved:' + next;
      return id;
    };
    const before = new Map(), after = new Map();
    const put = (key, value) => { if (!before.has(key)) before.set(key, localStorage.getItem(key)); after.set(key, value === null ? null : JSON.stringify(value)); };
    user.username = next;
    put('gm_users', users);
    const messages = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    messages.forEach(m => {
      m.sender = remap(m.sender); m.chatId = chatId(m.chatId);
      if (m.reactions) Object.keys(m.reactions).forEach(r => { m.reactions[r] = m.reactions[r].map(remap); });
    });
    put('gm_messages', messages);
    const spaces = JSON.parse(localStorage.getItem('gm_spaces') || '[]');
    spaces.forEach(space => {
      space.owner = remap(space.owner);
      space.admins = (space.admins || []).map(remap);
      space.members = (space.members || []).map(remap);
    });
    put('gm_spaces', spaces);
    const current = JSON.parse(localStorage.getItem('gm_current_user') || 'null');
    if (current?.username === oldName) { current.username = next; put('gm_current_user', current); }
    put('gm_muted_chats', JSON.parse(localStorage.getItem('gm_muted_chats') || '[]').map(chatId));
    const keys = Array.from({length:localStorage.length}, (_,i) => localStorage.key(i));
    for (const key of keys) {
      const match = /^(gm_contacts_|gm_blacklist_|gm_recent_search_|gm_appearance_)(.+)$/.exec(key);
      if (!match) continue;
      const destination = match[1] + remap(match[2]);
      if (destination !== key && localStorage.getItem(destination) !== null) throw new Error('Для этого имени уже есть локальные данные. Выберите другое имя.');
      const storedValue = JSON.parse(localStorage.getItem(key) || (match[1] === 'gm_appearance_' ? '{}' : '[]'));
      const values = Array.isArray(storedValue) ? storedValue.map(v => {
        if (typeof v === 'string') return remap(v);
        const item = {...v};
        if (item.username) item.username = remap(item.username);
        if (item.peer) item.peer = remap(item.peer);
        if (item.id) item.id = chatId(item.id);
        return item;
      }) : storedValue;
      put(destination, values);
      if (destination !== key) put(key, null);
    }
    try {
      for (const [key, value] of after) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
    } catch (error) {
      for (const [key, value] of before) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      throw error;
    }
    return next;
  }

  async updateUserAvatar(username, avatarBase64) {
    return this.addProfilePhoto(username, avatarBase64);
  }

  getProfilePhotos(username) {
    if (!username) return [];
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return [];
    if (Array.isArray(user.avatars) && user.avatars.length > 0) return user.avatars;
    if (user.avatar) return [user.avatar];
    return [];
  }

  async addProfilePhoto(username, photoBase64) {
    if (!username || !photoBase64) return [];
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
      user = { id: 'usr_' + Date.now(), username: username };
      users.push(user);
    }
    let avatars = Array.isArray(user.avatars) ? user.avatars : (user.avatar ? [user.avatar] : []);
    avatars = avatars.filter(a => a !== photoBase64);
    avatars.unshift(photoBase64);
    user.avatars = avatars;
    user.avatar = avatars[0];
    localStorage.setItem('gm_users', JSON.stringify(users));

    const cur = JSON.parse(localStorage.getItem('gm_current_user') || '{}');
    if (cur.username && cur.username.toLowerCase() === username.toLowerCase()) {
      cur.avatar = avatars[0];
      cur.avatars = avatars;
      localStorage.setItem('gm_current_user', JSON.stringify(cur));
    }
    return avatars;
  }

  async deleteProfilePhoto(username, photoIndex = 0) {
    if (!username) return [];
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return [];
    let avatars = Array.isArray(user.avatars) ? user.avatars : (user.avatar ? [user.avatar] : []);
    if (photoIndex >= 0 && photoIndex < avatars.length) {
      avatars.splice(photoIndex, 1);
    }
    user.avatars = avatars;
    user.avatar = avatars[0] || null;
    localStorage.setItem('gm_users', JSON.stringify(users));

    const cur = JSON.parse(localStorage.getItem('gm_current_user') || '{}');
    if (cur.username && cur.username.toLowerCase() === username.toLowerCase()) {
      cur.avatar = user.avatar;
      cur.avatars = avatars;
      localStorage.setItem('gm_current_user', JSON.stringify(cur));
    }
    return avatars;
  }

  async setMainProfilePhoto(username, photoIndex) {
    if (!username) return [];
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return [];
    let avatars = Array.isArray(user.avatars) ? user.avatars : (user.avatar ? [user.avatar] : []);
    if (photoIndex > 0 && photoIndex < avatars.length) {
      const selected = avatars.splice(photoIndex, 1)[0];
      avatars.unshift(selected);
    }
    user.avatars = avatars;
    user.avatar = avatars[0] || null;
    localStorage.setItem('gm_users', JSON.stringify(users));

    const cur = JSON.parse(localStorage.getItem('gm_current_user') || '{}');
    if (cur.username && cur.username.toLowerCase() === username.toLowerCase()) {
      cur.avatar = user.avatar;
      cur.avatars = avatars;
      localStorage.setItem('gm_current_user', JSON.stringify(cur));
    }
    return avatars;
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
    if (!username) return null;
    const clean = String(username).replace(/^@/, '').toLowerCase().trim();
    if (clean === 'general' || clean === 'общий чат' || clean === 'общий') {
      return {
        id: 'usr_general',
        username: 'general',
        name: 'Общий чат',
        bio: 'Официальный публичный канал сообщений',
        phone: '',
        avatar: null,
        avatars: []
      };
    }
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    let user = users.find(u => (u.username && u.username.toLowerCase() === clean) || (u.name && u.name.toLowerCase() === clean));
    if (user) {
      const avatars = Array.isArray(user.avatars) && user.avatars.length > 0
        ? user.avatars
        : (user.avatar ? [user.avatar] : []);
      return {
        id: user.id,
        username: user.username,
        name: user.name || ('@' + user.username),
        bio: user.bio || '',
        phone: user.phone || '',
        avatar: avatars[0] || user.avatar || null,
        avatars: avatars
      };
    }
    return {
      id: 'usr_' + clean,
      username: clean,
      name: '@' + clean,
      bio: '',
      phone: '',
      avatar: null,
      avatars: []
    };
  }

  async updateUserProfile(username, dataOrName, maybeBio = undefined) {
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
      user = { id: 'usr_' + Date.now(), username: username };
      users.push(user);
    }

    const data = typeof dataOrName === 'string'
      ? { name: dataOrName, bio: maybeBio }
      : (dataOrName || {});

    if (data.name !== undefined) user.name = data.name;
    if (data.bio !== undefined) user.bio = data.bio;
    if (data.phone !== undefined) user.phone = data.phone;
    if (data.avatar !== undefined) user.avatar = data.avatar;
    if (data.avatars !== undefined) user.avatars = data.avatars;

    localStorage.setItem('gm_users', JSON.stringify(users));

    const cur = JSON.parse(localStorage.getItem('gm_current_user') || '{}');
    if (cur.username && cur.username.toLowerCase() === username.toLowerCase()) {
      if (data.name !== undefined) cur.name = data.name;
      if (data.bio !== undefined) cur.bio = data.bio;
      if (data.phone !== undefined) cur.phone = data.phone;
      if (data.avatar !== undefined) cur.avatar = data.avatar;
      if (data.avatars !== undefined) cur.avatars = data.avatars;
      localStorage.setItem('gm_current_user', JSON.stringify(cur));
    }
    return { ok: true, user };
  }

  async getUserSharedMedia(currentUsername, targetUsername) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const u1 = (currentUsername || '').toLowerCase().trim();
    let u2 = (targetUsername || '').toLowerCase().replace(/^@/, '').trim();
    if (u2 === 'общий чат' || u2 === 'общий') u2 = 'general';

    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    const matchedUser = users.find(u => (u.name && u.name.toLowerCase() === u2) || (u.username && u.username.toLowerCase() === u2));
    if (matchedUser && matchedUser.username) {
      u2 = matchedUser.username.toLowerCase();
    }

    const sorted = [u1, u2].sort();
    const dmChatId = 'dm:' + sorted[0] + ':' + sorted[1];

    const chatMsgs = all.filter(m => {
      const chatId = (m.chatId || '').toLowerCase();
      const sender = (m.sender || '').toLowerCase();

      // 1. Личный диалог
      if (chatId === dmChatId) return true;
      // 2. Общий чат
      if (u2 === 'general' && chatId === 'general') return true;
      // 3. Сообщения, адресованные в диалог с u2
      if (chatId.includes(u2) && (chatId.includes(u1) || chatId === 'general')) return true;
      // 4. Отправитель - собеседник
      if (sender === u2) {
        if (chatId === 'general' || chatId.includes(u1) || chatId === dmChatId) return true;
      }
      // 5. Отправитель - текущий пользователь в диалоге с u2 или упоминанием
      if (sender === u1) {
        if (chatId === dmChatId || (m.text && m.text.toLowerCase().includes('@' + u2))) return true;
      }
      return false;
    });

    const media = [];
    const files = [];
    const voice = [];

    chatMsgs.forEach(m => {
      // Фото и видео
      if (m.files && Array.isArray(m.files) && m.files.length > 0) {
        m.files.forEach(f => {
          if (!f) return;
          const type = (f.type || '').toLowerCase();
          const name = f.name || '';
          const isPhoto = type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg|bmp|ico)$/i.test(name);
          const isVideo = type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(name);
          if (isPhoto || isVideo) {
            media.push({ msgId: m.id, file: f, time: m.time, sender: m.sender, isVideo, chatId: m.chatId });
          } else {
            files.push({ msgId: m.id, file: f, time: m.time, sender: m.sender, chatId: m.chatId });
          }
        });
      } else if (m.file) {
        const f = m.file;
        const type = (f.type || '').toLowerCase();
        const name = f.name || '';
        const isPhoto = type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg|bmp|ico)$/i.test(name);
        const isVideo = type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(name);
        if (isPhoto || isVideo) {
          media.push({ msgId: m.id, file: m.file, time: m.time, sender: m.sender, isVideo, chatId: m.chatId });
        } else {
          files.push({ msgId: m.id, file: m.file, time: m.time, sender: m.sender, chatId: m.chatId });
        }
      }

      // Голосовые и кружочки
      if (m.voice) {
        voice.push({ msgId: m.id, type: 'voice', voice: m.voice, time: m.time, sender: m.sender, chatId: m.chatId });
      }
      if (m.circleVideo) {
        voice.push({ msgId: m.id, type: 'circle', circleVideo: m.circleVideo, time: m.time, sender: m.sender, chatId: m.chatId });
      }
    });

    return { media, files, voice };
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

  getSpaces() {
    return JSON.parse(localStorage.getItem('gm_spaces') || '[]');
  }

  getSpace(chatId) {
    return this.getSpaces().find(space => space.id === chatId) || null;
  }

  isSpaceUsernameAvailable(username) {
    const clean = String(username || '').toLowerCase().replace(/^@/, '');
    if (!clean) return false;
    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    return !users.some(user => String(user.username || '').toLowerCase() === clean)
      && !this.getSpaces().some(space => String(space.username || '').toLowerCase() === clean);
  }

  createSpace(data) {
    const type = data && data.type === 'channel' ? 'channel' : 'group';
    const title = String(data && data.title || '').trim();
    const username = String(data && data.username || '').trim().toLowerCase().replace(/^@/, '');
    const owner = String(data && data.owner || '').trim().toLowerCase().replace(/^@/, '');
    if (!title) throw new Error('Введите название');
    if (!/^[a-z][a-z0-9_]{4,31}$/.test(username)) throw new Error('Username: 5–32 символа, латинская буква в начале');
    if (!this.isSpaceUsernameAvailable(username)) throw new Error('Этот username уже занят');
    if (!owner) throw new Error('Не указан создатель');
    const members = Array.from(new Set([owner].concat(data.members || []).map(value => String(value || '').toLowerCase().replace(/^@/, '')).filter(Boolean)));
    const space = {
      id: 'space_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
      type,
      title,
      username,
      avatar: data.avatar || '',
      owner,
      admins: [owner],
      members,
      createdAt: Date.now()
    };
    const spaces = this.getSpaces();
    spaces.push(space);
    localStorage.setItem('gm_spaces', JSON.stringify(spaces));
    return space;
  }

  updateSpace(chatId, actorUsername, patch = {}) {
    const actor = String(actorUsername || '').toLowerCase().replace(/^@/, '');
    const spaces = this.getSpaces();
    const index = spaces.findIndex(space => space.id === chatId);
    if (index < 0) throw new Error('Сообщество не найдено');
    const space = spaces[index];
    if (!(space.admins || []).includes(actor)) throw new Error('Редактировать сообщество могут только администраторы');
    const title = patch.title === undefined ? space.title : String(patch.title || '').trim();
    const username = patch.username === undefined ? space.username : String(patch.username || '').trim().toLowerCase().replace(/^@/, '');
    if (!title) throw new Error('Введите название');
    if (!/^[a-z][a-z0-9_]{4,31}$/.test(username)) throw new Error('Username: 5–32 символа, латинская буква в начале');
    const occupied = JSON.parse(localStorage.getItem('gm_users') || '[]').some(user => String(user.username || '').toLowerCase() === username)
      || spaces.some((item, itemIndex) => itemIndex !== index && String(item.username || '').toLowerCase() === username);
    if (occupied) throw new Error('Этот username уже занят');
    spaces[index] = { ...space, title, username, avatar: patch.avatar === undefined ? space.avatar : (patch.avatar || ''), updatedAt: Date.now() };
    localStorage.setItem('gm_spaces', JSON.stringify(spaces));
    return spaces[index];
  }

  setSpaceAdmin(chatId, actorUsername, targetUsername, enabled) {
    const actor = String(actorUsername || '').toLowerCase().replace(/^@/, '');
    const target = String(targetUsername || '').toLowerCase().replace(/^@/, '');
    const spaces = this.getSpaces();
    const index = spaces.findIndex(space => space.id === chatId);
    if (index < 0) throw new Error('Сообщество не найдено');
    const space = spaces[index];
    if (!(space.admins || []).includes(actor)) throw new Error('Недостаточно прав');
    if (!(space.members || []).includes(target)) throw new Error('Пользователь не состоит в сообществе');
    if (target === space.owner && !enabled) throw new Error('Создателя нельзя снять с должности администратора');
    const admins = new Set(space.admins || []);
    if (enabled) admins.add(target); else admins.delete(target);
    spaces[index] = { ...space, admins: Array.from(admins), updatedAt: Date.now() };
    localStorage.setItem('gm_spaces', JSON.stringify(spaces));
    return spaces[index];
  }

  leaveSpace(chatId, username) {
    const user = String(username || '').toLowerCase().replace(/^@/, '');
    const spaces = this.getSpaces();
    const index = spaces.findIndex(space => space.id === chatId);
    if (index < 0) throw new Error('Сообщество не найдено');
    const space = spaces[index];
    if (space.owner === user) throw new Error('Создатель должен сначала передать права');
    spaces[index] = {
      ...space,
      members: (space.members || []).filter(member => member !== user),
      admins: (space.admins || []).filter(admin => admin !== user),
      updatedAt: Date.now()
    };
    localStorage.setItem('gm_spaces', JSON.stringify(spaces));
    return spaces[index];
  }

  saveContact(currentUsername, contact) {
    if (!currentUsername || !contact || !contact.username) return false;
    const key = 'gm_contacts_' + currentUsername.toLowerCase();
    const list = this.getContacts(currentUsername);
    const targetU = contact.username.toLowerCase().replace(/^@/, '');
    const idx = list.findIndex(c => c.username.toLowerCase() === targetU);
    if (idx !== -1) {
      list[idx].name = contact.name || list[idx].name;
      if (contact.phone !== undefined) list[idx].phone = contact.phone;
      if (contact.avatar !== undefined) list[idx].avatar = contact.avatar;
      if (contact.bio !== undefined) list[idx].bio = contact.bio;
    } else {
      list.push({
        username: targetU,
        name: contact.name || ('@' + targetU),
        phone: contact.phone || '',
        avatar: contact.avatar || '',
        bio: contact.bio || '',
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

  clearChat(chatId) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    const removed = all.filter(message => message.chatId === chatId);
    localStorage.setItem('gm_messages', JSON.stringify(all.filter(message => message.chatId !== chatId)));
    return removed;
  }

  deleteChat(currentUsername, chatId) {
    const removed = this.clearChat(chatId);
    const recentKey = 'gm_recent_search_' + currentUsername.toLowerCase();
    const recent = JSON.parse(localStorage.getItem(recentKey) || '[]').filter(chat => chat.id !== chatId);
    localStorage.setItem(recentKey, JSON.stringify(recent));
    this.setMutedChatsWithout(chatId);
    return removed;
  }

  setMutedChatsWithout(chatId) {
    const muted = JSON.parse(localStorage.getItem('gm_muted_chats') || '[]').filter(id => id !== chatId);
    localStorage.setItem('gm_muted_chats', JSON.stringify(muted));
  }

  getBlacklist(currentUsername) {
    if (!currentUsername) return [];
    const key = 'gm_blacklist_' + currentUsername.toLowerCase();
    return JSON.parse(localStorage.getItem(key) || '[]');
  }

  getChatBlockState(currentUsername, chatId) {
    const me = String(currentUsername || '').toLowerCase().replace(/^@/, '');
    const parts = String(chatId || '').toLowerCase().split(':');
    if (!me || parts[0] !== 'dm' || parts.length !== 3 || !parts.includes(me)) {
      return { blocked: false, blockedByMe: false, blockedByPeer: false, peer: '' };
    }
    const peer = parts[1] === me ? parts[2] : parts[1];
    const blockedByMe = this.getBlacklist(me).includes(peer);
    const blockedByPeer = this.getBlacklist(peer).includes(me);
    return { blocked: blockedByMe || blockedByPeer, blockedByMe, blockedByPeer, peer };
  }

  getChatPostingState(currentUsername, chatId) {
    const blockState = this.getChatBlockState(currentUsername, chatId);
    if (blockState.blocked) return { ...blockState, restricted: true, reason: 'blacklist' };
    const space = this.getSpace(chatId);
    if (!space) return { ...blockState, restricted: false, reason: '' };
    const me = String(currentUsername || '').toLowerCase().replace(/^@/, '');
    const isMember = (space.members || []).includes(me);
    const isAdmin = (space.admins || []).includes(me);
    if (!isMember) return { ...blockState, restricted: true, reason: 'not-member', space, isAdmin };
    if (space.type === 'channel' && !isAdmin) return { ...blockState, restricted: true, reason: 'channel-readonly', space, isAdmin };
    return { ...blockState, restricted: false, reason: '', space, isAdmin };
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
    const spaceIds = new Set(this.getSpaces().filter(space => (space.members || []).includes(myName)).map(space => space.id));
    const userMsgs = all.filter(m => {
      const sender = (m.sender || '').toLowerCase();
      const chatId = (m.chatId || '').toLowerCase();
      return sender === myName || chatId.includes(myName) || chatId === this.getSavedChatId(myName) || spaceIds.has(m.chatId);
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

    return { media, files, voice };
  }

  async getMessages(chatId) {
    const all = JSON.parse(localStorage.getItem('gm_messages') || '[]');
    return all.filter(m => m.chatId === chatId);
  }

  getSavedChatId(username) {
    return 'saved:' + String(username || '').toLowerCase().replace(/^@/, '');
  }

  async sendMessage(chatId, sender, text, file = null, voice = null, circleVideo = null, files = null) {
    const postingState = this.getChatPostingState(sender, chatId);
    if (postingState.restricted) {
      if (postingState.reason === 'blacklist') throw new Error(postingState.blockedByMe ? 'Сначала разблокируйте пользователя' : 'Пользователь ограничил переписку');
      if (postingState.reason === 'channel-readonly') throw new Error('В канале публикуют только администраторы');
      throw new Error('Вы не состоите в этом сообществе');
    }
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

    const savedChatId = this.getSavedChatId(myName);
    const savedMessages = all.filter(m => m.chatId === savedChatId);
    const lastSaved = savedMessages[savedMessages.length - 1];
    chatMap.set(savedChatId, {
      id: savedChatId,
      title: 'Избранное',
      isSaved: true,
      isGeneral: false,
      lastMsg: lastSaved ? (lastSaved.text || (lastSaved.voice ? 'Голосовое сообщение' : (lastSaved.circleVideo ? 'Видеокружок' : (lastSaved.file ? 'Файл' : 'Сообщение')))) : 'Личное облако для сообщений и файлов',
      lastTime: lastSaved ? lastSaved.time : '',
      timestamp: lastSaved ? lastSaved.createdAt : 0,
      unreadCount: 0
    });

    this.getSpaces().filter(space => (space.members || []).includes(myName)).forEach(space => {
      const spaceMessages = all.filter(message => message.chatId === space.id);
      const last = spaceMessages[spaceMessages.length - 1];
      const lastText = last ? (last.text || (last.voice ? 'Голосовое сообщение' : (last.circleVideo ? 'Видеокружок' : (last.file ? 'Файл' : 'Сообщение')))) : (space.type === 'channel' ? 'Новый канал' : 'Новая группа');
      chatMap.set(space.id, {
        id: space.id,
        title: space.title,
        username: space.username,
        avatar: space.avatar || '',
        isCommunity: true,
        isChannel: space.type === 'channel',
        isGroup: space.type === 'group',
        memberCount: (space.members || []).length,
        lastMsg: lastText,
        lastTime: last ? last.time : '',
        timestamp: last ? last.createdAt : space.createdAt,
        unreadCount: 0
      });
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
        const snippet = m.voice ? 'Голосовое сообщение' : (m.circleVideo ? 'Видеокружок' : (m.file ? (m.file.type && m.file.type.startsWith('image/') ? 'Фото' : m.file.name) : (m.text || 'Сообщение')));
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
      if (a.isSaved) return -1;
      if (b.isSaved) return 1;
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
    this.currentChatId = this.currentUser ? this.storage.getSavedChatId(this.currentUser.username) : 'saved:guest';
    this.currentChatTitle = 'Избранное';
    this.activeFolder = 'all'; // 'all' | 'dm' | 'channels'
    this.authMode = 'login';
    this.recordMode = 'mic'; // 'mic' | 'video'

    // Media recording state
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recInterval = null;
    this.recStartTime = null;
    this.mediaStream = null;
    this.cameraInputStream = null;
    this.circleCanvasStream = null;
    this.circleDrawFrame = 0;
    this.circleCameraFacing = 'user';
    this.switchingCircleCamera = false;
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
    this.chatMediaPlaybackQueue = [];
    this.downloadTasks = new Map();
    this.messageSearchResults = [];
    this.messageSearchIndex = -1;
    this.chatBackgroundObjectUrl = '';
    this.appearanceLoadRequest = 0;

    // 4-Tab Navigation & Sidebar States
    this.activeSidebarView = 'chats';
    this.contactsSortMode = 'name'; // 'name' | 'date'
    this.myfilesFilter = 'all';
    this.feedActiveTab = 'media';
    this.feedAvatarIndex = 0;
    this.modalAvatarIndex = 0;
    this.spaceDraftAvatar = '';
    this.spaceDraftMembers = new Set();
    this.spaceWizardStep = 1;
    this.spaceMemberCandidates = [];
    this.activeSpaceId = '';
    this.spaceProfileEditAvatar = '';

    // Инициализация IndexedDB для медиа (async, не блокирует UI)
    this.storage.initMediaDB();

    this.initElements();
    this.applyAppearanceSettings(false);
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

  playNextChatMedia(messageId) {
    const queue = Array.isArray(this.chatMediaPlaybackQueue) ? this.chatMediaPlaybackQueue : [];
    const currentIndex = queue.findIndex(item => item.messageId === messageId);
    const next = currentIndex >= 0 ? queue[currentIndex + 1] : null;
    if (!next || typeof next.start !== 'function') return false;
    const session = this.activeMediaSession;
    if (!session || session.messageId !== messageId || session.chatId !== this.currentChatId) return false;

    window.setTimeout(() => {
      if (this.activeMediaSession !== session || this.currentChatId !== session.chatId) return;
      Promise.resolve(next.start(true)).catch(err => {
        console.warn('Next media playback error:', err);
        if (this.activeMediaSession && this.activeMediaSession.messageId === messageId) {
          this.finishActiveMediaSession(this.activeMediaSession.media);
        }
      });
    }, 40);
    return true;
  }

  async revealMediaSource() {
    const session = this.activeMediaSession;
    if (!session || !session.messageId) return;
    this.closeUserProfile();
    if (this.el.modalMyFiles) this.el.modalMyFiles.classList.add('hidden');
    if (session.chatId && session.chatId !== this.currentChatId) {
      let title = String(session.chatId || '').startsWith('saved:') ? 'Избранное' : (session.chatId === 'general' ? 'Общий чат' : '@' + this.getPeerUsernameFromChatId(session.chatId));
      const peer = this.getPeerUsernameFromChatId(session.chatId);
      const profile = await this.storage.getUserProfile(peer);
      if (profile?.name) title = profile.name;
      this.openChat(session.chatId, title);
    }
    if (window.innerWidth <= 768) this.el.chatView.classList.add('active');
    window.setTimeout(() => {
      const message = this.el.messagesFeed.querySelector('[data-msg-id="' + CSS.escape(session.messageId) + '"]');
      if (!message) {
        this.showToast('Сообщение уже не находится в этом чате');
        return;
      }
      message.scrollIntoView({ behavior: 'smooth', block: 'center' });
      message.classList.remove('tg-media-source-pulse');
      requestAnimationFrame(() => message.classList.add('tg-media-source-pulse'));
      window.setTimeout(() => message.classList.remove('tg-media-source-pulse'), 1800);
    }, 80);
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
      messageComposer: document.getElementById('message-composer'),
      blockedComposer: document.getElementById('blocked-composer'),
      blockedComposerText: document.getElementById('blocked-composer-text'),
      btnComposerUnblock: document.getElementById('btn-composer-unblock'),
      fileInput: document.getElementById('file-input'),
      mediaInput: document.getElementById('media-input'),
      attachmentPicker: document.getElementById('attachment-picker'),
      attachmentPickerBackdrop: document.getElementById('attachment-picker-backdrop'),
      attachmentPickerClose: document.getElementById('attachment-picker-close'),
      attachmentPickerMedia: document.getElementById('attachment-picker-media'),
      attachmentPickerFile: document.getElementById('attachment-picker-file'),
      attachmentPickerGrid: document.getElementById('attachment-picker-grid'),
      attachmentPickerEmpty: document.getElementById('attachment-picker-empty'),
      attachmentPickerCount: document.getElementById('attachment-picker-count'),
      attachmentPickerClear: document.getElementById('attachment-picker-clear'),
      attachmentPickerDone: document.getElementById('attachment-picker-done'),
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
      downloadsPanel: document.getElementById('downloads-panel'),
      downloadsList: document.getElementById('downloads-list'),
      downloadsClose: document.getElementById('downloads-close'),

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
      profileAvatarCounter: document.getElementById('profile-avatar-counter'),
      btnProfileAvatarPrev: document.getElementById('btn-profile-avatar-prev'),
      btnProfileAvatarNext: document.getElementById('btn-profile-avatar-next'),
      profileName: document.getElementById('profile-name'),
      profileStatus: document.getElementById('profile-status'),
      profileActionsRow: document.getElementById('profile-actions-row'),
      btnProfileActionMsg: document.getElementById('btn-profile-action-msg'),
      btnProfileActionContact: document.getElementById('btn-profile-action-contact'),
      profileContactText: document.getElementById('profile-contact-text'),
      btnProfileActionCall: document.getElementById('btn-profile-action-call'),
      profileUsernameVal: document.getElementById('profile-username-val'),
      btnCopyUsername: document.getElementById('btn-copy-username'),
      profileBioVal: document.getElementById('profile-bio-val'),
      profilePhoneVal: document.getElementById('profile-phone-val'),
      profilePhoneItem: document.getElementById('item-profile-phone'),
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
      chatActionsMenu: document.getElementById('chat-actions-menu'),

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
      editProfilePhone: document.getElementById('edit-profile-phone'),
      editBioCounter: document.getElementById('edit-bio-counter'),
      btnCancelEditProfile: document.getElementById('btn-cancel-edit-profile'),
      btnCloseEditModal: document.getElementById('btn-close-edit-modal'),
      btnSaveEditProfile: document.getElementById('btn-save-edit-profile'),

      toastContainer: document.getElementById('tg-toast-container'),
      reactionsPopup: document.getElementById('reactions-popup'),

      // НАВИГАЦИЯ (DESKTOP RAIL И MOBILE BOTTOM NAV)
      railNavChats: document.getElementById('rail-nav-chats'),
      railNavContacts: document.getElementById('rail-nav-contacts'),
      railNavProfile: document.getElementById('rail-nav-profile'),
      railNavSettings: document.getElementById('rail-nav-settings'),
      railBtnLogout: document.getElementById('rail-btn-logout'),

      mobNavChats: document.getElementById('mob-nav-chats'),
      mobNavContacts: document.getElementById('mob-nav-contacts'),
      mobNavProfile: document.getElementById('mob-nav-profile'),
      mobNavSettings: document.getElementById('mob-nav-settings'),

      // РАЗДЕЛЫ САЙДБАРА
      sidebarViewChats: document.getElementById('sidebar-view-chats'),
      sidebarViewContacts: document.getElementById('sidebar-view-contacts'),
      sidebarViewProfile: document.getElementById('sidebar-view-profile'),
      sidebarViewSettings: document.getElementById('sidebar-view-settings'),

      // КОНТАКТЫ
      contactsCountLabel: document.getElementById('contacts-count-label'),
      btnSortContacts: document.getElementById('btn-sort-contacts'),
      btnAddContactOpen: document.getElementById('btn-add-contact-open'),
      contactsSearch: document.getElementById('contacts-search'),
      contactsList: document.getElementById('contacts-list'),

      // ПРОФИЛЬ (ЖИВАЯ ЛЕНТА В САЙДБАРЕ)
      feedUserAvatar: document.getElementById('feed-user-avatar'),
      feedAvatarCounter: document.getElementById('feed-avatar-counter'),
      btnFeedAvatarPrev: document.getElementById('btn-feed-avatar-prev'),
      btnFeedAvatarNext: document.getElementById('btn-feed-avatar-next'),
      btnFeedChangePhoto: document.getElementById('btn-feed-change-photo'),
      btnFeedSetMainPhoto: document.getElementById('btn-feed-set-main-photo'),
      btnFeedRemovePhoto: document.getElementById('btn-feed-remove-photo'),
      feedHeroName: document.getElementById('feed-hero-name'),
      feedProfileForm: document.getElementById('feed-profile-form'),
      feedProfileDisplayName: document.getElementById('feed-profile-displayname'),
      feedProfileUsername: document.getElementById('feed-profile-username'),
      feedProfileBio: document.getElementById('feed-profile-bio'),
      feedProfilePhone: document.getElementById('feed-profile-phone'),
      feedBioCounter: document.getElementById('feed-bio-counter'),
      statChatsCount: document.getElementById('stat-chats-count'),
      statMediaCount: document.getElementById('stat-media-count'),
      statContactsCount: document.getElementById('stat-contacts-count'),
      feedTabs: document.querySelectorAll('.tg-feed-tab'),
      feedPaneMedia: document.getElementById('feed-pane-media'),
      feedPaneFiles: document.getElementById('feed-pane-files'),
      feedPaneVoice: document.getElementById('feed-pane-voice'),

      // НАСТРОЙКИ
      btnSettingsOpenMyFiles: document.getElementById('btn-settings-open-myfiles'),
      btnSettingsProfile: document.getElementById('btn-settings-profile'),
      settingsProfileAvatar: document.getElementById('settings-profile-avatar'),
      settingsProfileName: document.getElementById('settings-profile-name'),
      settingsProfileHandle: document.getElementById('settings-profile-handle'),
      settingsStorageUsage: document.getElementById('settings-storage-usage'),
      btnSettingsClearCache: document.getElementById('btn-settings-clear-cache'),
      btnSettingsBlacklist: document.getElementById('btn-settings-blacklist'),
      btnSettingsCreateSpace: document.getElementById('btn-settings-create-space'),
      btnCreateSpaceChats: document.getElementById('btn-create-space-chats'),
      btnCreateSpaceContacts: document.getElementById('btn-create-space-contacts'),
      themeChoices: document.querySelectorAll('[data-theme-choice]'),
      settingsThemeLabel: document.getElementById('settings-theme-label'),
      backgroundChoices: document.querySelectorAll('[data-chat-background-choice]'),
      chatBackgroundFile: document.getElementById('chat-background-file'),
      chatBackgroundDim: document.getElementById('chat-background-dim'),
      chatBackgroundDimValue: document.getElementById('chat-background-dim-value'),
      btnResetChatBackground: document.getElementById('btn-reset-chat-background'),
      customChatBackgroundPreview: document.querySelector('.tg-background-custom'),

      // МОДАЛЬНЫЕ ОКНА
      modalAddContact: document.getElementById('modal-add-contact'),
      formAddContact: document.getElementById('form-add-contact'),
      addContactUsername: document.getElementById('add-contact-username'),
      addContactName: document.getElementById('add-contact-name'),
      addContactBio: document.getElementById('add-contact-bio'),
      addContactPhone: document.getElementById('add-contact-phone'),
      addContactAvatar: document.getElementById('add-contact-avatar'),
      addContactPreviewName: document.getElementById('add-contact-preview-name'),
      btnCloseAddContact: document.getElementById('btn-close-add-contact'),
      btnCancelAddContact: document.getElementById('btn-cancel-add-contact'),

      modalMyFiles: document.getElementById('modal-my-files'),
      btnCloseMyFiles: document.getElementById('btn-close-myfiles'),
      myfilesSearch: document.getElementById('myfiles-search'),
      myfilesFilters: document.querySelectorAll('[data-myfiles-filter]'),
      myfilesList: document.getElementById('myfiles-list'),

      modalBlacklist: document.getElementById('modal-blacklist'),
      btnCloseBlacklist: document.getElementById('btn-close-blacklist'),
      blacklistInputUsername: document.getElementById('blacklist-input-username'),
      btnAddToBlacklist: document.getElementById('btn-add-to-blacklist'),
      blacklistItemsList: document.getElementById('blacklist-items-list')
      ,spaceCreator: document.getElementById('space-creator')
      ,spaceCreatorClose: document.getElementById('space-creator-close')
      ,spaceCreatorBack: document.getElementById('space-creator-back')
      ,spaceCreatorNext: document.getElementById('space-creator-next')
      ,spaceCreatorSave: document.getElementById('space-creator-save')
      ,spaceCreatorTitle: document.getElementById('space-creator-heading')
      ,spaceCreatorStepLabel: document.getElementById('space-creator-step-label')
      ,spaceCreatorStepOne: document.getElementById('space-creator-step-one')
      ,spaceCreatorStepTwo: document.getElementById('space-creator-step-two')
      ,spaceTypeChoices: document.querySelectorAll('[data-space-type]')
      ,spaceAvatarButton: document.getElementById('space-avatar-button')
      ,spaceAvatarInput: document.getElementById('space-avatar-input')
      ,spaceAvatarPreview: document.getElementById('space-avatar-preview')
      ,spaceTitleInput: document.getElementById('space-title-input')
      ,spaceUsernameInput: document.getElementById('space-username-input')
      ,spaceUsernameStatus: document.getElementById('space-username-status')
      ,spaceMembersSearch: document.getElementById('space-members-search')
      ,spaceMembersList: document.getElementById('space-members-list')
      ,spaceMembersCount: document.getElementById('space-members-count')
      ,spaceProfile: document.getElementById('space-profile')
      ,spaceProfileBackdrop: document.getElementById('space-profile-backdrop')
      ,spaceProfileClose: document.getElementById('space-profile-close')
      ,spaceProfileRole: document.getElementById('space-profile-role')
      ,spaceProfileEdit: document.getElementById('space-profile-edit')
      ,spaceProfileAvatarButton: document.getElementById('space-profile-avatar-button')
      ,spaceProfileAvatar: document.getElementById('space-profile-avatar')
      ,spaceProfileAvatarInput: document.getElementById('space-profile-avatar-input')
      ,spaceProfileTitle: document.getElementById('space-profile-title')
      ,spaceProfileSubtitle: document.getElementById('space-profile-subtitle')
      ,spaceProfileEditForm: document.getElementById('space-profile-edit-form')
      ,spaceProfileTitleInput: document.getElementById('space-profile-title-input')
      ,spaceProfileUsernameInput: document.getElementById('space-profile-username-input')
      ,spaceProfileEditCancel: document.getElementById('space-profile-edit-cancel')
      ,spaceProfileSave: document.getElementById('space-profile-save')
      ,spaceProfileAdminCount: document.getElementById('space-profile-admin-count')
      ,spaceProfileAdmins: document.getElementById('space-profile-admins')
      ,spaceProfileMembersSection: document.getElementById('space-profile-members-section')
      ,spaceProfileMemberCount: document.getElementById('space-profile-member-count')
      ,spaceProfileMembers: document.getElementById('space-profile-members')
      ,spaceProfileLeave: document.getElementById('space-profile-leave')
    };
  }

  bindEvents() {
    // ПОИСК СООБЩЕНИЙ ВНУТРИ ТЕКУЩЕГО ЧАТА
    if (this.el.btnChatSearch) {
      this.el.btnChatSearch.addEventListener('click', () => this.el.messageSearchPanel.classList.contains('hidden') ? this.openMessageSearch() : this.closeMessageSearch());
    }
    if (this.el.messageSearchClose) {
      this.el.messageSearchClose.addEventListener('click', () => this.closeMessageSearch());
    }
    if (this.el.messageSearchInput) {
      this.el.messageSearchInput.addEventListener('input', () => this.updateMessageSearch());
      this.el.messageSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeMessageSearch();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.moveMessageSearch(e.shiftKey ? -1 : 1);
        }
      });
    }
    if (this.el.messageSearchPrev) {
      this.el.messageSearchPrev.addEventListener('click', () => this.moveMessageSearch(-1));
    }
    if (this.el.messageSearchNext) {
      this.el.messageSearchNext.addEventListener('click', () => this.moveMessageSearch(1));
    }

    // ПЕРЕКЛЮЧЕНИЕ ГЛАВНЫХ РАЗДЕЛОВ (ЧАТЫ, КОНТАКТЫ, ПРОФИЛЬ, НАСТРОЙКИ)
    if (this.el.railNavChats) this.el.railNavChats.addEventListener('click', () => this.switchSidebarView('chats'));
    if (this.el.railNavContacts) this.el.railNavContacts.addEventListener('click', () => this.switchSidebarView('contacts'));
    if (this.el.railNavProfile) this.el.railNavProfile.addEventListener('click', () => this.switchSidebarView('profile'));
    if (this.el.railNavSettings) this.el.railNavSettings.addEventListener('click', () => this.switchSidebarView('settings'));
    if (this.el.railBtnLogout) this.el.railBtnLogout.addEventListener('click', () => this.logout());

    if (this.el.mobNavChats) this.el.mobNavChats.addEventListener('click', () => this.switchSidebarView('chats'));
    if (this.el.mobNavContacts) this.el.mobNavContacts.addEventListener('click', () => this.switchSidebarView('contacts'));
    if (this.el.mobNavProfile) this.el.mobNavProfile.addEventListener('click', () => this.switchSidebarView('profile'));
    if (this.el.mobNavSettings) this.el.mobNavSettings.addEventListener('click', () => this.switchSidebarView('settings'));

    // КОНТАКТЫ
    if (this.el.btnSortContacts) {
      this.el.btnSortContacts.addEventListener('click', () => this.toggleContactsSort());
    }
    if (this.el.btnAddContactOpen) {
      this.el.btnAddContactOpen.addEventListener('click', () => this.openAddContactModal());
    }
    if (this.el.btnCloseAddContact) {
      this.el.btnCloseAddContact.addEventListener('click', () => this.closeAddContactModal());
    }
    if (this.el.btnCancelAddContact) {
      this.el.btnCancelAddContact.addEventListener('click', () => this.closeAddContactModal());
    }
    if (this.el.formAddContact) {
      this.el.formAddContact.addEventListener('submit', (e) => this.handleAddContactSubmit(e));
    }
    if (this.el.contactsSearch) {
      this.el.contactsSearch.addEventListener('input', () => this.renderContactsList());
    }

    // ПРОФИЛЬ В САЙДБАРЕ (ЖИВАЯ ЛЕНТА)
    if (this.el.feedProfileForm) {
      this.el.feedProfileForm.addEventListener('submit', (e) => this.handleFeedProfileSave(e));
    }
    if (this.el.feedProfileBio) {
      this.el.feedProfileBio.addEventListener('input', () => {
        if (this.el.feedBioCounter) {
          this.el.feedBioCounter.innerText = (this.el.feedProfileBio.value || '').length + ' / 140';
        }
      });
    }
    if (this.el.btnFeedAvatarPrev) {
      this.el.btnFeedAvatarPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stepFeedAvatar(-1);
      });
    }
    if (this.el.btnFeedAvatarNext) {
      this.el.btnFeedAvatarNext.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stepFeedAvatar(1);
      });
    }
    if (this.el.btnFeedChangePhoto && this.el.avatarFileInput) {
      this.el.btnFeedChangePhoto.addEventListener('click', () => this.el.avatarFileInput.click());
    }
    if (this.el.btnFeedSetMainPhoto) {
      this.el.btnFeedSetMainPhoto.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.storage.setMainProfilePhoto(this.currentUser.username, this.feedAvatarIndex);
        this.feedAvatarIndex = 0;
        this.renderAvatars();
        this.renderProfileFeed();
        this.showToast('Фотография установлена как главная');
      });
    }
    if (this.el.btnFeedRemovePhoto) {
      this.el.btnFeedRemovePhoto.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Удалить эту фотографию профиля?')) return;
        await this.storage.deleteProfilePhoto(this.currentUser.username, this.feedAvatarIndex);
        this.feedAvatarIndex = 0;
        this.renderAvatars();
        this.renderProfileFeed();
        this.showToast('Фотография профиля удалена');
      });
    }
    if (this.el.btnProfileAvatarPrev) {
      this.el.btnProfileAvatarPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stepModalAvatar(-1);
      });
    }
    if (this.el.btnProfileAvatarNext) {
      this.el.btnProfileAvatarNext.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stepModalAvatar(1);
      });
    }
    if (this.el.feedTabs) {
      this.el.feedTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const target = tab.getAttribute('data-feed-tab');
          this.switchFeedMediaTab(target);
        });
      });
    }

    // НАСТРОЙКИ И МОДАЛЬНЫЕ ОКНА
    if (this.el.btnSettingsOpenMyFiles) {
      this.el.btnSettingsOpenMyFiles.addEventListener('click', () => this.openMyFilesModal());
    }
    if (this.el.btnCloseMyFiles) {
      this.el.btnCloseMyFiles.addEventListener('click', () => this.closeMyFilesModal());
    }
    if (this.el.myfilesSearch) {
      this.el.myfilesSearch.addEventListener('input', () => this.renderMyFilesList());
    }
    if (this.el.myfilesFilters) {
      this.el.myfilesFilters.forEach(chip => {
        chip.addEventListener('click', () => {
          this.el.myfilesFilters.forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.myfilesFilter = chip.getAttribute('data-myfiles-filter');
          this.renderMyFilesList();
        });
      });
    }
    if (this.el.btnSettingsBlacklist) {
      this.el.btnSettingsBlacklist.addEventListener('click', () => this.openBlacklistModal());
    }
    [this.el.btnSettingsCreateSpace, this.el.btnCreateSpaceChats, this.el.btnCreateSpaceContacts].forEach(button => {
      if (button) button.addEventListener('click', () => this.openSpaceCreator());
    });
    if (this.el.spaceCreatorClose) this.el.spaceCreatorClose.addEventListener('click', () => this.closeSpaceCreator());
    if (this.el.spaceCreatorBack) this.el.spaceCreatorBack.addEventListener('click', () => this.setSpaceCreatorStep(1));
    if (this.el.spaceCreatorNext) this.el.spaceCreatorNext.addEventListener('click', () => this.prepareSpaceMembers());
    if (this.el.spaceCreatorSave) this.el.spaceCreatorSave.addEventListener('click', () => this.createSpaceFromWizard());
    if (this.el.spaceAvatarButton && this.el.spaceAvatarInput) this.el.spaceAvatarButton.addEventListener('click', () => this.el.spaceAvatarInput.click());
    if (this.el.spaceAvatarInput) this.el.spaceAvatarInput.addEventListener('change', event => this.handleSpaceAvatar(event));
    if (this.el.spaceMembersSearch) this.el.spaceMembersSearch.addEventListener('input', () => this.renderSpaceMemberChoices());
    if (this.el.spaceUsernameInput) this.el.spaceUsernameInput.addEventListener('input', () => this.updateSpaceUsernameStatus());
    this.el.spaceTypeChoices.forEach(button => button.addEventListener('click', () => {
      this.el.spaceTypeChoices.forEach(choice => choice.classList.toggle('active', choice === button));
      this.el.spaceTypeChoices.forEach(choice => choice.setAttribute('aria-checked', String(choice === button)));
      this.updateSpaceAvatarPreview();
    }));
    if (this.el.spaceProfileClose) this.el.spaceProfileClose.addEventListener('click', () => this.closeSpaceProfile());
    if (this.el.spaceProfileBackdrop) this.el.spaceProfileBackdrop.addEventListener('click', () => this.closeSpaceProfile());
    if (this.el.spaceProfileEdit) this.el.spaceProfileEdit.addEventListener('click', () => this.setSpaceProfileEditing(true));
    if (this.el.spaceProfileEditCancel) this.el.spaceProfileEditCancel.addEventListener('click', () => this.setSpaceProfileEditing(false));
    if (this.el.spaceProfileSave) this.el.spaceProfileSave.addEventListener('click', () => this.saveSpaceProfile());
    if (this.el.spaceProfileAvatarButton && this.el.spaceProfileAvatarInput) this.el.spaceProfileAvatarButton.addEventListener('click', () => {
      if (!this.el.spaceProfileEditForm.classList.contains('hidden')) this.el.spaceProfileAvatarInput.click();
    });
    if (this.el.spaceProfileAvatarInput) this.el.spaceProfileAvatarInput.addEventListener('change', event => this.handleSpaceProfileAvatar(event));
    if (this.el.spaceProfileLeave) this.el.spaceProfileLeave.addEventListener('click', () => this.leaveCurrentSpace());
    if (this.el.btnCloseBlacklist) {
      this.el.btnCloseBlacklist.addEventListener('click', () => this.closeBlacklistModal());
    }
    if (this.el.btnAddToBlacklist) {
      this.el.btnAddToBlacklist.addEventListener('click', () => this.handleBlacklistAdd());
    }
    if (this.el.btnSettingsClearCache) {
      this.el.btnSettingsClearCache.addEventListener('click', () => this.clearMediaCache());
    }

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
      if (this.el.chatActionsMenu && !this.el.chatActionsMenu.contains(e.target) && !this.el.btnChatInfoPanel.contains(e.target)) {
        this.closeChatActionsMenu();
      }
    });

    if (this.el.chatActionsMenu) {
      this.el.chatActionsMenu.addEventListener('click', (event) => {
        const button = event.target.closest('[data-chat-action]');
        if (button) this.handleChatAction(button.dataset.chatAction);
      });
    }
    if (this.el.downloadsClose) this.el.downloadsClose.addEventListener('click', () => this.el.downloadsPanel.classList.add('hidden'));
    document.addEventListener('click', (event) => {
      const link = event.target.closest('.tg-attachment-download, #lightbox-download');
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      const item = link.id === 'lightbox-download' ? this.currentLightboxItem : null;
      this.downloadFile(item || {
        name: link.getAttribute('download') || 'document',
        type: link.dataset.mime || '',
        dataUrl: link.href
      });
    }, true);

    this.el.btnMenuLogout.addEventListener('click', () => this.logout());
    document.getElementById('btn-settings-logout').addEventListener('click', () => this.logout());
    this.bindProfilePhotoControls();

    // Старый переключатель в меню оставлен как быстрый выбор тёмной/светлой темы.
    if (this.el.toggleNightMode) {
      this.el.toggleNightMode.addEventListener('change', (e) => {
        this.setAppearanceTheme(e.target.checked ? 'dark' : 'light');
      });
    }
    this.el.themeChoices.forEach(button => {
      button.addEventListener('click', () => this.setAppearanceTheme(button.dataset.themeChoice));
    });
    if (this.el.btnSettingsProfile) {
      this.el.btnSettingsProfile.addEventListener('click', () => this.switchSidebarView('profile'));
    }
    this.el.backgroundChoices.forEach(button => {
      button.addEventListener('click', () => {
        const background = button.dataset.chatBackgroundChoice;
        const settings = this.getAppearanceSettings();
        if (background === 'custom') {
          this.el.chatBackgroundFile.click();
          return;
        }
        this.setChatBackground(background);
      });
    });
    if (this.el.chatBackgroundFile) {
      this.el.chatBackgroundFile.addEventListener('change', e => {
        const file = e.target.files && e.target.files[0];
        if (file) this.setCustomChatBackground(file);
        e.target.value = '';
      });
    }
    if (this.el.chatBackgroundDim) {
      this.el.chatBackgroundDim.addEventListener('input', e => {
        const dim = Math.max(0, Math.min(70, Number(e.target.value) || 0));
        if (this.el.chatBackgroundDimValue) this.el.chatBackgroundDimValue.textContent = dim + '%';
        document.body.style.setProperty('--tg-wallpaper-overlay', 'rgba(0,0,0,' + (dim / 100).toFixed(2) + ')');
      });
      this.el.chatBackgroundDim.addEventListener('change', e => {
        this.saveAppearanceSettings({ dim: Math.max(0, Math.min(70, Number(e.target.value) || 0)) });
        this.syncAppearanceControls();
      });
    }
    if (this.el.btnResetChatBackground) {
      this.el.btnResetChatBackground.addEventListener('click', () => this.setChatBackground('default'));
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
        this.showToast('Sheet Messenger v3.37.0\nПрофили сообществ и улучшенный контраст');
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
        if (this.storage.getSpace(this.currentChatId)) {
          this.openSpaceProfile(this.currentChatId);
          return;
        }
        if (this.currentChatId.startsWith('saved:') || this.currentChatId === 'general') return;
        const peer = this.getPeerUsernameFromChatId(this.currentChatId);
        this.openUserProfile(peer, peer.toLowerCase() === this.currentUser.username.toLowerCase());
      });
    }
    if (this.el.btnChatInfoPanel) {
      this.el.btnChatInfoPanel.addEventListener('click', (event) => {
        event.stopPropagation();
        const opening = this.el.chatActionsMenu.classList.contains('hidden');
        this.updateChatActionsMenu();
        this.el.chatActionsMenu.classList.toggle('hidden', !opening);
        this.el.btnChatInfoPanel.setAttribute('aria-expanded', String(opening));
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

    // Действия в профиле: Написать, контакт, звонок, Копировать @username
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

    if (this.el.btnProfileActionContact) {
      this.el.btnProfileActionContact.addEventListener('click', () => this.openContactFromProfile());
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

    if (this.el.btnProfileActionCall) {
      this.el.btnProfileActionCall.addEventListener('click', () => this.callActiveProfile());
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
    if (this.el.mediaPlayerPanel) {
      this.el.mediaPlayerPanel.addEventListener('click', event => {
        if (!event.target.closest('button')) this.revealMediaSource();
      });
      this.el.mediaPlayerPanel.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
          event.preventDefault();
          this.revealMediaSource();
        }
      });
    }
    if (this.el.videoRecordingPanel) {
      this.el.videoRecordingPanel.addEventListener('click', event => {
        event.stopPropagation();
        this.switchCircleCamera();
      });
      this.el.videoRecordingPanel.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.switchCircleCamera();
        }
      });
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

    // Telegram-подобный выбор медиа и файлов
    this.el.btnAttach.addEventListener('click', () => this.openAttachmentPicker());
    this.el.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    if (this.el.mediaInput) this.el.mediaInput.addEventListener('change', (e) => this.handleFileUpload(e));
    if (this.el.attachmentPickerBackdrop) this.el.attachmentPickerBackdrop.addEventListener('click', () => this.closeAttachmentPicker());
    if (this.el.attachmentPickerClose) this.el.attachmentPickerClose.addEventListener('click', () => this.closeAttachmentPicker());
    if (this.el.attachmentPickerDone) this.el.attachmentPickerDone.addEventListener('click', () => this.closeAttachmentPicker(true));
    if (this.el.attachmentPickerMedia) this.el.attachmentPickerMedia.addEventListener('click', () => this.el.mediaInput.click());
    if (this.el.attachmentPickerFile) this.el.attachmentPickerFile.addEventListener('click', () => this.el.fileInput.click());
    if (this.el.attachmentPickerClear) {
      this.el.attachmentPickerClear.addEventListener('click', async () => {
        while (this.pendingFiles && this.pendingFiles.length) await this.removePendingFileAt(this.pendingFiles.length - 1);
      });
    }
    if (this.el.btnComposerUnblock) {
      this.el.btnComposerUnblock.addEventListener('click', () => this.handleComposerRestrictionAction());
    }

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
    this.activeSearchFilter = 'chats';
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
      this.globalSearchOpen = true;
      this.handleSearch(this.el.chatSearch.value, this.activeSearchFilter);
    });

    this.el.chatSearch.addEventListener('input', () => {
      this.handleSearch(this.el.chatSearch.value, this.activeSearchFilter);
    });

    this.el.btnSearchClear.addEventListener('click', () => {
      this.el.chatSearch.value = '';
      if (this.el.searchFilters) this.el.searchFilters.classList.add('hidden');
      this.globalSearchOpen = false;
      this.handleSearch('', 'chats');
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
      if (this.el.attachmentPicker && !this.el.attachmentPicker.classList.contains('hidden')) {
        if (e.key === 'Escape') this.closeAttachmentPicker();
      } else if (this.el.lightboxModal && !this.el.lightboxModal.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          this.closeLightbox();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.lightboxPrev();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
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
      let trackingSwipe = false;
      this.el.lightboxModal.addEventListener('touchstart', (e) => {
        trackingSwipe = e.touches?.length === 1 && Boolean(e.target.closest('#lightbox-imgwrap'));
        if (trackingSwipe && e.target.tagName === 'VIDEO') {
          trackingSwipe = e.touches[0].clientY < e.target.getBoundingClientRect().bottom - 55;
        }
        if (trackingSwipe) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      this.el.lightboxModal.addEventListener('touchend', (e) => {
        if (trackingSwipe && e.changedTouches && e.changedTouches[0]) {
          trackingSwipe = false;
          const deltaX = e.changedTouches[0].clientX - touchStartX;
          const deltaY = e.changedTouches[0].clientY - touchStartY;
          if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            if (deltaX > 0) this.lightboxPrev();
            else this.lightboxNext();
          }
        }
      }, { passive: true });
      this.el.lightboxModal.addEventListener('touchcancel', () => { trackingSwipe = false; }, { passive: true });
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
      this.openChat(this.storage.getSavedChatId(this.currentUser.username), 'Избранное');
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
    this.applyAppearanceSettings(false);

    const openState = sessionStorage.getItem('gm_active_chat_open');
    const storedChatId = sessionStorage.getItem('gm_active_chat_id') || '';
    const ownSavedChatId = this.storage.getSavedChatId(this.currentUser.username);
    const savedChatId = (!storedChatId || storedChatId === 'general' || storedChatId.startsWith('saved:')) ? ownSavedChatId : storedChatId;
    const storedChatTitle = sessionStorage.getItem('gm_active_chat_title') || '';
    const restoredSpace = this.storage.getSpace(savedChatId);
    const savedChatTitle = restoredSpace ? restoredSpace.title : (savedChatId === ownSavedChatId ? 'Избранное' : (storedChatTitle || 'Диалог'));

    this.currentChatId = savedChatId;
    this.currentChatTitle = savedChatTitle;
    if (this.el.activeChatTitle) {
      this.el.activeChatTitle.innerText = savedChatTitle;
    }
    if (restoredSpace) {
      if (this.el.activeChatStatus) this.el.activeChatStatus.innerText = (restoredSpace.members || []).length + (restoredSpace.type === 'channel' ? ' подписчиков' : ' участников');
      if (this.el.activeChatAvatar) {
        this.el.activeChatAvatar.innerHTML = restoredSpace.avatar
          ? '<img src="' + this.escapeAttr(restoredSpace.avatar) + '" alt="Аватар" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">'
          : this.uiIcon(restoredSpace.type === 'channel' ? 'broadcast' : 'users');
      }
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
    this.switchSidebarView(this.activeSidebarView || 'chats');
    this.renderProfileFeed();
    this.updateComposerBlockState();

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

  getPeerUsernameFromChatId(chatId) {
    const normalizedChatId = String(chatId || '').trim().toLowerCase();
    if (normalizedChatId.startsWith('saved:')) return String(this.currentUser && this.currentUser.username || '').toLowerCase();
    if (!normalizedChatId.startsWith('dm:')) return 'general';

    const participants = normalizedChatId.split(':').slice(1).filter(Boolean);
    const currentUsername = String(this.currentUser && this.currentUser.username || '').toLowerCase();
    return participants.find(username => username !== currentUsername) || currentUsername || 'general';
  }

  openDirectChat(targetUsername) {
    const chatId = this.getDmChatId(this.currentUser.username, targetUsername);
    const title = '@' + targetUsername;
    this.openChat(chatId, title);

    this.el.chatSearch.value = '';
    this.globalSearchOpen = false;
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

    const isSaved = chatId === this.storage.getSavedChatId(this.currentUser.username);
    const isGeneral = chatId === 'general';
    const space = this.storage.getSpace(chatId);
    const resolvedTitle = space ? space.title : title;
    this.currentChatTitle = resolvedTitle;
    this.el.activeChatTitle.innerText = resolvedTitle;
    this.el.activeChatStatus.innerText = space
      ? ((space.members || []).length + (space.type === 'channel' ? ' подписчиков' : ' участников'))
      : (isSaved ? 'личное облако' : (isGeneral ? 'канал общения' : 'в сети'));

    if (space || isSaved || isGeneral) {
      this.el.activeChatAvatar.innerHTML = space && space.avatar
        ? '<img src="' + this.escapeAttr(space.avatar) + '" alt="Аватар" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">'
        : this.uiIcon(space ? (space.type === 'channel' ? 'broadcast' : 'users') : (isSaved ? 'star' : 'globe'));
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
            this.openUserProfile(peerUsername, false);
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

    this.updateComposerBlockState();
    this.updateMainActionButtonState();
    this.renderChatList();
    this.renderMessages();
  }

  async renderChatList() {
    let chats = await this.storage.getUserChats(this.currentUser.username);

    // Фильтрация по папкам
    if (this.activeFolder === 'dm') {
      chats = chats.filter(c => !c.isGeneral && !c.isSaved && !c.isCommunity);
    } else if (this.activeFolder === 'channels') {
      chats = chats.filter(c => c.isGeneral || c.isCommunity);
    }

    this.el.chatList.innerHTML = '';

    chats.forEach(chat => {
      const isActive = chat.id === this.currentChatId;
      const item = document.createElement('div');
      item.className = 'tg-chat-item' + (isActive ? ' active' : '');

      const avatarClass = chat.isSaved ? 'tg-avatar-saved' : (chat.isCommunity ? 'tg-avatar-community' : (chat.isGeneral ? 'tg-avatar-general' : 'tg-avatar-user'));
      const avatarContent = chat.isSaved
        ? this.uiIcon('star')
        : (chat.isCommunity
        ? (chat.avatar ? '<img src="' + this.escapeAttr(chat.avatar) + '" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : this.uiIcon(chat.isChannel ? 'broadcast' : 'users'))
        : (chat.isGeneral
        ? this.uiIcon('globe')
        : (chat.avatar ? '<img src="' + chat.avatar + '" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' : (chat.peer ? chat.peer[0].toUpperCase() : '?'))));

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
    this.chatMediaPlaybackQueue = [];

    if (msgs.length === 0) {
      const saved = this.currentChatId === this.storage.getSavedChatId(this.currentUser.username);
      this.el.messagesFeed.innerHTML = '<div class="tg-premium-empty">' + this.uiIcon(saved ? 'star' : 'message', 'tg-ui-icon-xl') + '<strong>' + (saved ? 'Ваше Избранное' : 'Сообщений пока нет') + '</strong><span>' + (saved ? 'Храните здесь сообщения, медиа и документы — их видите только вы' : 'Начните диалог первым') + '</span></div>';
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
          if (!this.playNextChatMedia(m.id)) this.finishActiveMediaSession(vid);
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
              messageId: m.id,
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
        this.chatMediaPlaybackQueue.push({ messageId: m.id, type: 'circle', start: startCirclePlay });
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
            if (!this.playNextChatMedia(m.id)) this.finishActiveMediaSession(audioObj);
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

        const toggleVoicePlay = async (autoAdvance = false) => {
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
              messageId: m.id,
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
        this.chatMediaPlaybackQueue.push({ messageId: m.id, type: 'voice', start: toggleVoicePlay });

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
        msgAvatar.setAttribute('role', 'button');
        msgAvatar.setAttribute('tabindex', '0');
        msgAvatar.setAttribute('aria-label', 'Профиль @' + msgAvatar.getAttribute('data-sender'));
        msgAvatar.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); msgAvatar.click(); }
        });
        msgAvatar.addEventListener('click', (e) => {
          e.stopPropagation();
          const sender = msgAvatar.getAttribute('data-sender');
          this.openUserProfile(sender, false);
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
    const blockState = this.storage.getChatPostingState(this.currentUser.username, this.currentChatId);
    if (blockState.restricted) {
      this.updateComposerBlockState();
      this.showToast(blockState.reason === 'channel-readonly' ? 'Публиковать в канале могут только администраторы' : (blockState.reason === 'not-member' ? 'Вы не состоите в этом сообществе' : (blockState.blockedByMe ? 'Сначала разблокируйте @' + blockState.peer : 'Пользователь ограничил переписку')));
      return;
    }
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
    this.renderAttachmentPicker();
    e.target.value = '';
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
    return this._mediaBlobUrlCache.get(file.mediaId) || file.dataUrl || file.data || file.url || '';
  }

  async hydrateMediaThumbnail(element, file, isVideo) {
    if (!file) return;
    try {
      let src = this.getAttachmentSrc(file);
      if (!src && file.mediaId) {
        const blob = await this.storage.getMediaBlob(file.mediaId);
        if (blob) {
          src = this._mediaBlobUrlCache.get(file.mediaId) || URL.createObjectURL(blob);
          this._mediaBlobUrlCache.set(file.mediaId, src);
        }
      }
      if (!src || !element.isConnected) return;
      const media = document.createElement(isVideo ? 'video' : 'img');
      media.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      if (isVideo) {
        media.muted = true;
        media.playsInline = true;
        media.preload = 'metadata';
        media.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(media.duration) && media.duration > 0.1) media.currentTime = 0.1;
        }, {once:true});
      } else { media.alt = file.name || 'Фото'; media.loading = 'lazy'; }
      media.src = src;
      element.querySelector('img, video')?.remove();
      element.prepend(media);
      element.querySelector('.tg-media-placeholder-icon')?.remove();
    } catch (_) { /* Keep the existing placeholder when a stored file is unavailable. */ }
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
          ? '<video class="tg-media-photo tg-media-video" src="' + safeSrc + '" muted playsinline preload="metadata"></video><span class="tg-media-play" aria-hidden="true">' + this.uiIcon('play') + '</span>'
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
    this.lightboxReturnFocus = document.activeElement;
    this.lightboxPlaylist = (playlist && playlist.length) ? playlist : [{ src, name, kind }];
    this.lightboxIndex = typeof index === 'number' && index >= 0 && index < this.lightboxPlaylist.length ? index : 0;
    this.lightboxShowCurrent();
    if (this.el.lightboxModal) this.el.lightboxModal.classList.remove('hidden');
    document.body.classList.add('tg-media-viewer-open');
    this.el.lightboxClose?.focus();
  }

  async lightboxShowCurrent() {
    if (!this.lightboxPlaylist || !this.lightboxPlaylist.length) return;
    const generation = this.lightboxGeneration = (this.lightboxGeneration || 0) + 1;
    this.el.lightboxVideo?.pause();
    const item = this.lightboxPlaylist[this.lightboxIndex];
    if (!item) return;
    this.currentLightboxItem = item;

    let src = item.src;
    if (!src && item.mediaId) {
      src = this._mediaBlobUrlCache.get(item.mediaId);
      if (!src) {
        const blob = await this.storage.getMediaBlob(item.mediaId);
        if (blob) {
          src = URL.createObjectURL(blob);
          this._mediaBlobUrlCache.set(item.mediaId, src);
        }
      }
      item.src = src;
    }

    if (generation !== this.lightboxGeneration) return;
    const isVideo = (item.kind || item.type) === 'video';
    this.el.lightboxModal?.classList.toggle('is-circle-viewer', Boolean(item.isCircle));
    if (this.el.lightboxImg) {
      this.el.lightboxImg.classList.toggle('hidden', isVideo);
      this.el.lightboxImg.src = isVideo ? '' : (src || '');
    }
    if (this.el.lightboxVideo) {
      this.el.lightboxVideo.classList.toggle('hidden', !isVideo);
      this.el.lightboxVideo.pause();
      this.el.lightboxVideo.src = isVideo ? (src || '') : '';
      if (isVideo && src) {
        this.el.lightboxVideo.load();
        this.el.lightboxVideo.play().catch(() => {});
      }
    }
    if (this.el.lightboxFilename) {
      this.el.lightboxFilename.innerText = item.name || (isVideo ? 'Видео' : 'Фото');
    }
    if (this.el.lightboxDownload) {
      this.el.lightboxDownload.href = src || '';
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
    this.lightboxGeneration = (this.lightboxGeneration || 0) + 1;
    if (this.el.lightboxModal) this.el.lightboxModal.classList.add('hidden');
    if (this.el.lightboxVideo) {
      this.el.lightboxVideo.pause();
      this.el.lightboxVideo.removeAttribute('src');
      this.el.lightboxVideo.load();
    }
    if (this.el.lightboxImg) this.el.lightboxImg.src = '';
    this.lightboxPlaylist = [];
    this.currentLightboxItem = null;
    this.el.lightboxModal?.classList.remove('is-circle-viewer');
    this.lightboxIndex = 0;
    document.body.classList.remove('tg-media-viewer-open');
    if (this.lightboxReturnFocus?.isConnected) this.lightboxReturnFocus.focus();
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
      const iconName = kind === 'image' ? 'image' : (kind === 'video' ? 'video' : 'file');
      const displayName = this.truncateFileName(f.name || 'document');
      return [
        '<div class="tg-attach-pill">',
        '  <span class="tg-attach-pill-icon">' + this.uiIcon(iconName, 'tg-ui-icon-sm') + '</span>',
        '  <span class="tg-attach-pill-name" title="' + this.escapeAttr(f.name) + '">' + this.escape(displayName) + '</span>',
        '  <button type="button" class="tg-attach-pill-remove" data-idx="' + idx + '" title="Удалить">' + this.uiIcon('close', 'tg-ui-icon-sm') + '</button>',
        '</div>'
      ].join('');
    }).join('');

    this.el.composerAttachments.querySelectorAll('.tg-attach-pill-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        await this.removePendingFileAt(idx);
      });
    });

    this.updateMainActionButtonState();
  }

  openAttachmentPicker() {
    if (!this.el.attachmentPicker) return this.el.fileInput.click();
    this.renderAttachmentPicker();
    this.el.attachmentPicker.classList.remove('hidden');
    this.el.attachmentPicker.setAttribute('aria-hidden', 'false');
    document.body.classList.add('tg-overlay-open');
  }

  closeAttachmentPicker(focusComposer = false) {
    if (!this.el.attachmentPicker) return;
    this.el.attachmentPicker.classList.add('hidden');
    this.el.attachmentPicker.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('tg-overlay-open');
    if (focusComposer && this.el.messageInput) this.el.messageInput.focus({ preventScroll: true });
  }

  async removePendingFileAt(index) {
    if (!this.pendingFiles || index < 0 || index >= this.pendingFiles.length) return;
    const removed = this.pendingFiles.splice(index, 1)[0];
    if (removed && removed.mediaId) {
      const cachedUrl = this._mediaBlobUrlCache.get(removed.mediaId);
      if (cachedUrl) URL.revokeObjectURL(cachedUrl);
      this._mediaBlobUrlCache.delete(removed.mediaId);
      await this.storage.deleteMediaBlob(removed.mediaId);
    }
    this.renderPendingAttachments();
    this.renderAttachmentPicker();
  }

  renderAttachmentPicker() {
    if (!this.el.attachmentPickerGrid) return;
    const files = this.pendingFiles || [];
    this.el.attachmentPickerGrid.replaceChildren();
    if (this.el.attachmentPickerEmpty) this.el.attachmentPickerEmpty.classList.toggle('hidden', files.length > 0);
    if (this.el.attachmentPickerClear) this.el.attachmentPickerClear.classList.toggle('hidden', files.length === 0);
    if (this.el.attachmentPickerCount) {
      this.el.attachmentPickerCount.textContent = files.length
        ? ('Выбрано: ' + files.length)
        : 'Выберите фото, видео или файл';
    }
    if (this.el.attachmentPickerDone) {
      this.el.attachmentPickerDone.textContent = files.length ? ('Добавить · ' + files.length) : 'Готово';
    }

    files.forEach((file, index) => {
      const tile = document.createElement('article');
      tile.className = 'tg-attachment-preview-tile';
      const kind = this.getAttachmentKind(file);
      const previewUrl = file.mediaId ? this._mediaBlobUrlCache.get(file.mediaId) : '';
      let preview = '<span class="tg-attachment-file-preview">' + this.uiIcon(kind === 'video' ? 'video' : 'file') + '<b>' + this.escape(this.getFileExtension(file.name || 'FILE')) + '</b></span>';
      if (kind === 'image' && previewUrl) preview = '<img src="' + this.escapeAttr(previewUrl) + '" alt="">';
      if (kind === 'video' && previewUrl) preview = '<video src="' + this.escapeAttr(previewUrl) + '" muted playsinline preload="metadata"></video><span class="tg-attachment-video-mark">' + this.uiIcon('video', 'tg-ui-icon-sm') + '</span>';
      tile.innerHTML = preview + '<span class="tg-attachment-preview-name" title="' + this.escapeAttr(file.name || 'document') + '">' + this.escape(this.truncateFileName(file.name || 'document')) + '</span><button type="button" class="tg-attachment-preview-remove" aria-label="Убрать ' + this.escapeAttr(file.name || 'файл') + '">' + this.uiIcon('close', 'tg-ui-icon-sm') + '</button>';
      tile.querySelector('.tg-attachment-preview-remove').addEventListener('click', () => this.removePendingFileAt(index));
      this.el.attachmentPickerGrid.appendChild(tile);
    });
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
      this.cameraInputStream = stream;

      // Если к моменту открытия камеры пользователь уже отменил кнопку (и не зафиксировал запись)
      if (!this.isHoldingMainAction && !this.isRecordingLocked) {
        this.cleanupStream();
        return;
      }

      this.circleCameraFacing = 'user';
      this.el.videoStreamPreview.classList.add('is-front-camera');
      this.el.videoStreamPreview.srcObject = stream;
      await this.el.videoStreamPreview.play().catch(() => {});
      this.mediaStream = this.createCircleRecordingStream(stream);
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

  createCircleRecordingStream(cameraStream) {
    const canvas = document.createElement('canvas');
    if (!canvas.captureStream) return cameraStream;
    canvas.width = 360;
    canvas.height = 360;
    const ctx = canvas.getContext('2d', { alpha: false });
    const draw = () => {
      const video = this.el.videoStreamPreview;
      if (ctx && video.videoWidth && video.videoHeight) {
        const side = Math.min(video.videoWidth, video.videoHeight);
        const sx = (video.videoWidth - side) / 2;
        const sy = (video.videoHeight - side) / 2;
        ctx.save();
        if (this.circleCameraFacing === 'user') {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
      this.circleDrawFrame = requestAnimationFrame(draw);
    };
    draw();
    const output = canvas.captureStream(30);
    cameraStream.getAudioTracks().forEach(track => output.addTrack(track));
    this.circleCanvasStream = output;
    return output;
  }

  async switchCircleCamera() {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording' || this.switchingCircleCamera) return;
    this.switchingCircleCamera = true;
    const nextFacing = this.circleCameraFacing === 'user' ? 'environment' : 'user';
    try {
      if (!this.circleCanvasStream) {
        const track = this.mediaStream?.getVideoTracks()[0];
        if (!track?.applyConstraints) throw new Error('Camera switching is unavailable');
        await track.applyConstraints({ facingMode: { exact: nextFacing } });
      } else {
        const nextVideo = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: { exact: nextFacing } },
          audio: false
        }).catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacing }, audio: false }));
        const oldVideoTracks = this.cameraInputStream?.getVideoTracks() || [];
        const audioTracks = this.cameraInputStream?.getAudioTracks() || [];
        this.cameraInputStream = new MediaStream([...nextVideo.getVideoTracks(), ...audioTracks]);
        this.el.videoStreamPreview.srcObject = this.cameraInputStream;
        await this.el.videoStreamPreview.play().catch(() => {});
        oldVideoTracks.forEach(track => track.stop());
      }
      this.circleCameraFacing = nextFacing;
      this.el.videoStreamPreview.classList.toggle('is-front-camera', nextFacing === 'user');
      if (navigator.vibrate) navigator.vibrate(18);
      this.showToast(nextFacing === 'user' ? 'Фронтальная камера' : 'Основная камера');
    } catch (error) {
      console.warn('Camera switch error:', error);
      this.showToast('Не удалось переключить камеру');
    } finally {
      this.switchingCircleCamera = false;
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

        // Векторная камера: одинаково выглядит на Android и в браузере.
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 7;
        ctx.lineJoin = 'round';
        ctx.strokeRect(87, 93, 52, 39);
        ctx.beginPath();
        ctx.moveTo(139, 104);
        ctx.lineTo(158, 95);
        ctx.lineTo(158, 130);
        ctx.lineTo(139, 121);
        ctx.closePath();
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

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
    if (this.circleDrawFrame) {
      cancelAnimationFrame(this.circleDrawFrame);
      this.circleDrawFrame = 0;
    }
    if (this.cameraInputStream) {
      this.cameraInputStream.getTracks().forEach(t => t.stop());
      this.cameraInputStream = null;
    }
    if (this.circleCanvasStream) {
      this.circleCanvasStream.getTracks().forEach(t => t.stop());
      this.circleCanvasStream = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.el.videoStreamPreview) {
      this.el.videoStreamPreview.srcObject = null;
      this.el.videoStreamPreview.classList.remove('is-front-camera');
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
    username = (username || '').replace(/^@/, '').toLowerCase().trim();
    if (username === 'общий чат' || username === 'общий') username = 'general';

    this.el.profileAvatarLarge.classList.remove('is-expanded');
    this.el.profileAvatarLarge.parentElement.classList.remove('photo-expanded');
    this.activeProfileUser = await this.storage.getUserProfile(username);
    if (this.activeProfileUser && this.activeProfileUser.username) {
      username = this.activeProfileUser.username.toLowerCase();
    }
    isOwn = Boolean(this.currentUser && username === this.currentUser.username.toLowerCase());
    const isMuted = this.isChatMuted(this.currentChatId);

    // Заголовок: для своего "Мой профиль", для собеседника "Информация"
    if (this.el.profilePanelHeaderTitle) {
      this.el.profilePanelHeaderTitle.innerText = isOwn ? 'Мой профиль' : 'Информация';
    }

    // СТРОГОЕ СКРЫТИЕ КНОПОК РЕДАКТИРОВАНИЯ ДЛЯ ЧУЖОГО ПРОФИЛЯ
    if (this.el.btnHeaderEditProfile) {
      this.el.btnHeaderEditProfile.classList.toggle('hidden', !isOwn);
      this.el.btnHeaderEditProfile.style.display = isOwn ? '' : 'none';
    }
    if (this.el.profileEditBox) {
      this.el.profileEditBox.classList.toggle('hidden', !isOwn);
      this.el.profileEditBox.style.display = isOwn ? '' : 'none';
    }
    if (this.el.btnEditProfile) {
      this.el.btnEditProfile.classList.toggle('hidden', !isOwn);
      this.el.btnEditProfile.style.display = isOwn ? '' : 'none';
    }
    if (this.el.btnChangeAvatar) {
      this.el.btnChangeAvatar.classList.toggle('hidden', !isOwn);
      this.el.btnChangeAvatar.style.display = isOwn ? '' : 'none';
    }

    this.updateProfileContactAction();

    // Аватары и альбом фото профиля
    this.modalAvatarIndex = 0;
    this.updateModalAvatarUI();

    // Имя и статус
    const displayName = (this.activeProfileUser && this.activeProfileUser.name) || ('@' + username);
    if (this.el.profileName) this.el.profileName.innerText = displayName;
    if (this.el.profileStatus) this.el.profileStatus.innerText = isOwn ? 'в сети' : 'был(а) недавно';

    // Поля информации
    if (this.el.profileUsernameVal) {
      this.el.profileUsernameVal.innerText = '@' + username;
    }
    if (this.el.profileBioVal) {
      this.el.profileBioVal.innerText = (this.activeProfileUser && this.activeProfileUser.bio) || (isOwn ? 'Пользуюсь Telegram Web ✨' : 'О себе пока ничего не написано');
    }
    const savedContact = this.storage.getContacts(this.currentUser.username).find(item => item.username.toLowerCase() === username);
    const phone = (this.activeProfileUser && this.activeProfileUser.phone) || (savedContact && savedContact.phone) || '';
    if (this.el.profilePhoneVal) this.el.profilePhoneVal.innerText = phone || 'Не указан';
    if (this.el.profilePhoneItem) this.el.profilePhoneItem.classList.toggle('is-empty', !phone);

    // Звук / Уведомления
    this.updateMuteUI(isMuted);

    // Сбрасываем вкладки на "Медиа"
    if (this.el.profileTabs) {
      this.el.profileTabs.forEach((tab, tIdx) => {
        tab.classList.toggle('active', tIdx === 0);
      });
      ['media', 'files', 'voice'].forEach((type, tIdx) => {
        const pane = document.getElementById('pane-profile-' + type);
        if (pane) pane.classList.toggle('hidden', tIdx !== 0);
      });
    }

    // Вкладки медиа, файлов, голосовых: ЖИВАЯ ЛЕНТА
    await this.renderProfileMediaTabs(username, isOwn);

    if (this.el.profileModalOverlay) this.el.profileModalOverlay.classList.remove('hidden');
    if (this.el.profilePanel) {
      this.el.profilePanel.classList.remove('hidden');
      const scrollEl = this.el.profilePanel.querySelector('.tg-profile-body');
      if (scrollEl) scrollEl.scrollTop = 0;
    }
    const tabContent = document.querySelector('.tg-profile-tab-content');
    if (tabContent) tabContent.scrollTop = 0;
  }

  updateModalAvatarUI() {
    const user = this.activeProfileUser;
    const avatars = user ? (Array.isArray(user.avatars) && user.avatars.length > 0 ? user.avatars : (user.avatar ? [user.avatar] : [])) : [];
    const count = avatars.length;
    const idx = Math.min(Math.max(0, this.modalAvatarIndex || 0), Math.max(0, count - 1));
    this.modalAvatarIndex = idx;

    if (count > 0 && avatars[idx]) {
      const currentPhoto = avatars[idx];
      this.el.profileAvatarLarge.innerHTML = '<img src="' + currentPhoto + '" alt="Avatar" style="cursor:pointer;width:100%;height:100%;border-radius:50%;object-fit:cover;">';
      this.el.profileAvatarLarge.style.cursor = 'pointer';
      this.el.profileAvatarLarge.onclick = () => this.toggleProfilePhoto(this.el.profileAvatarLarge);
    } else {
      const isGeneralProfile = !(user && user.username && user.username !== 'general');
      this.el.profileAvatarLarge.innerHTML = isGeneralProfile ? this.uiIcon('globe', 'tg-ui-icon-xl') : user.username[0].toUpperCase();
      this.el.profileAvatarLarge.style.cursor = 'default';
      this.el.profileAvatarLarge.onclick = null;
    }

    this.refreshPhotoMenu(this.el.profileAvatarLarge);
    if (count > 1) {
      if (this.el.profileAvatarCounter) {
        this.el.profileAvatarCounter.innerText = (idx + 1) + ' / ' + count;
        this.el.profileAvatarCounter.classList.remove('hidden');
      }
      if (this.el.btnProfileAvatarPrev) this.el.btnProfileAvatarPrev.classList.remove('hidden');
      if (this.el.btnProfileAvatarNext) this.el.btnProfileAvatarNext.classList.remove('hidden');
    } else {
      if (this.el.profileAvatarCounter) this.el.profileAvatarCounter.classList.add('hidden');
      if (this.el.btnProfileAvatarPrev) this.el.btnProfileAvatarPrev.classList.add('hidden');
      if (this.el.btnProfileAvatarNext) this.el.btnProfileAvatarNext.classList.add('hidden');
    }
  }

  stepModalAvatar(delta) {
    const user = this.activeProfileUser;
    const avatars = user ? (Array.isArray(user.avatars) && user.avatars.length > 0 ? user.avatars : (user.avatar ? [user.avatar] : [])) : [];
    if (avatars.length <= 1) return;
    this.modalAvatarIndex = (this.modalAvatarIndex + delta + avatars.length) % avatars.length;
    this.updateModalAvatarUI();
  }

  getFileBadge(fileName, mimeType) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    let bg = '#546e7a';
    let label = ext ? ext.substring(0, 4).toUpperCase() : 'DOC';

    if (['pdf'].includes(ext)) { bg = '#e53935'; label = 'PDF'; }
    else if (['doc', 'docx', 'rtf'].includes(ext)) { bg = '#1e88e5'; label = 'DOC'; }
    else if (['xls', 'xlsx', 'csv'].includes(ext)) { bg = '#2e7d32'; label = 'XLS'; }
    else if (['ppt', 'pptx'].includes(ext)) { bg = '#d84315'; label = 'PPT'; }
    else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) { bg = '#ef6c00'; label = 'ZIP'; }
    else if (['apk'].includes(ext)) { bg = '#00897b'; label = 'APK'; }
    else if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) { bg = '#8e24aa'; label = 'AUDIO'; }
    else if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) { bg = '#0288d1'; label = 'VIDEO'; }
    else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) { bg = '#43a047'; label = 'IMG'; }
    else if (['txt', 'log', 'md', 'json', 'js', 'html', 'css'].includes(ext)) { bg = '#455a64'; label = ext.toUpperCase(); }

    return { bg, label };
  }

  formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  async downloadFile(file) {
    if (!file) return;
    const fileName = file.name || 'document';
    const task = this.createDownloadTask(fileName, file.type || 'application/octet-stream');
    try {
      let blob = file.blob || null;
      let url = file.dataUrl || file.url || file.data || file.src || '';
      if (!blob && file.mediaId) blob = await this.storage.getMediaBlob(file.mediaId);
      if (!blob && !url && file.mediaId) url = this._mediaBlobUrlCache.get(file.mediaId) || '';
      if (!blob && url) {
        this.updateDownloadTask(task, 12, 'Подготовка файла…');
        const response = await fetch(url);
        blob = await response.blob();
      }
      if (!blob) throw new Error('Файл недоступен');
      task.type = (String(file.type || '').includes('/') ? file.type : '') || blob.type || this.inferMimeType(fileName);
      task.size = blob.size;
      const plugins = window.Capacitor && window.Capacitor.Plugins;
      const native = Boolean(window.Capacitor?.isNativePlatform?.() && plugins?.Filesystem);
      if (native) {
        const rawBase64 = await this.readBlobForNative(blob, progress => this.updateDownloadTask(task, 12 + Math.round(progress * 58), 'Сохранение…'));
        const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_').slice(-120) || 'document';
        const path = 'Sheet Messenger/' + Date.now() + '-' + safeName;
        const result = await plugins.Filesystem.writeFile({ path, data: rawBase64, directory: 'DOCUMENTS', recursive: true });
        task.filePath = result.uri;
        task.native = true;
      } else {
        url = URL.createObjectURL(blob);
        task.url = url;
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 100);
      }
      this.updateDownloadTask(task, 100, 'Загружено · нажмите, чтобы открыть', true);
      this.persistDownloadTask(task);
      this.showToast('Файл «' + fileName + '» загружен');
    } catch (error) {
      console.warn('Download error:', error);
      this.updateDownloadTask(task, 0, 'Не удалось скачать · нажмите, чтобы повторить', false, true);
      task.retry = () => this.downloadFile(file);
      this.showToast('Не удалось скачать файл');
    }
  }

  createDownloadTask(name, type) {
    const id = 'download_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tg-download-task';
    row.innerHTML = '<span class="tg-download-icon">' + this.uiIcon('file') + '</span><span class="tg-download-main"><strong></strong><span class="tg-download-status">Подготовка…</span><span class="tg-download-track"><span></span></span></span><span class="tg-download-percent">0%</span>';
    row.querySelector('strong').textContent = name;
    const task = { id, name, type, row, progress: 0 };
    row.addEventListener('click', () => task.retry ? task.retry() : this.openDownloadedFile(task));
    this.downloadTasks.set(id, task);
    this.el.downloadsList.prepend(row);
    this.el.downloadsPanel.classList.remove('hidden');
    return task;
  }

  inferMimeType(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    return ({
      pdf:'application/pdf', txt:'text/plain', html:'text/html', css:'text/css', js:'text/javascript', json:'application/json',
      jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', svg:'image/svg+xml',
      mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg',
      zip:'application/zip', apk:'application/vnd.android.package-archive'
    })[ext] || 'application/octet-stream';
  }

  updateDownloadTask(task, progress, status, done = false, failed = false) {
    task.progress = progress;
    task.row.querySelector('.tg-download-track span').style.width = progress + '%';
    task.row.querySelector('.tg-download-percent').textContent = done ? 'Открыть' : (failed ? 'Повторить' : progress + '%');
    task.row.querySelector('.tg-download-status').textContent = (task.size ? this.formatSize(task.size) + ' · ' : '') + status;
    task.row.classList.toggle('is-complete', done);
    task.row.classList.toggle('is-failed', failed);
  }

  readBlobForNative(blob, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = event => onProgress(event.lengthComputable ? event.loaded / event.total : 0.45);
      reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'));
      reader.onload = () => {
        onProgress(1);
        resolve(String(reader.result || '').split(',')[1] || '');
      };
      reader.readAsDataURL(blob);
    });
  }

  persistDownloadTask(task) {
    if (!task.filePath) return;
    const saved = JSON.parse(localStorage.getItem('gm_downloads') || '[]');
    localStorage.setItem('gm_downloads', JSON.stringify([{ name: task.name, type: task.type, filePath: task.filePath, savedAt: Date.now() }, ...saved.filter(item => item.filePath !== task.filePath)].slice(0, 30)));
  }

  async openDownloadedFile(task) {
    try {
      const plugins = window.Capacitor && window.Capacitor.Plugins;
      if (task.native && task.filePath && plugins?.FileOpener) {
        await plugins.FileOpener.open({ filePath: task.filePath, contentType: task.type || 'application/octet-stream', openWithDefault: true });
      } else if (task.url) {
        window.open(task.url, '_blank');
      } else {
        throw new Error('Файл больше недоступен');
      }
    } catch (error) {
      console.warn('Open downloaded file error:', error);
      this.showToast('На устройстве нет приложения для открытия этого файла');
    }
  }

  createProfileFileCard(item) {
    const row = document.createElement('div');
    row.className = 'tg-feed-file-row';
    const file = item.file || {};
    const fileName = file.name || 'Документ';
    const sizeStr = file.size ? this.formatSize(file.size) : '';
    const { bg, label } = this.getFileBadge(fileName, file.type);
    const timeStr = item.time ? item.time : '';
    const senderStr = item.sender ? (' · @' + item.sender) : '';

    row.innerHTML = [
      '<div class="tg-doc-badge" style="background:' + bg + ';">' + label + '</div>',
      '<div class="tg-feed-file-info">',
      '  <div class="tg-feed-file-name" title="' + this.escapeAttr(fileName) + '">' + this.escape(fileName) + '</div>',
      '  <div class="tg-feed-file-meta">' + sizeStr + (timeStr ? ' · ' + timeStr : '') + this.escape(senderStr) + '</div>',
      '</div>',
      '<button type="button" class="tg-file-dl-btn" title="Скачать файл">',
      '  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
      '</button>'
    ].join('');

    const dlBtn = row.querySelector('.tg-file-dl-btn');
    const triggerDownload = (e) => {
      e.stopPropagation();
      this.downloadFile(file);
    };

    if (dlBtn) dlBtn.addEventListener('click', triggerDownload);
    row.addEventListener('click', triggerDownload);
    return row;
  }

  buildCirclePlaylist(items) {
    return (items || []).filter(item => item && item.type === 'circle').map(item => {
      const media = item.circleVideo || {};
      return {
        src: media.dataUrl || media.url || media.data || this._mediaBlobUrlCache.get(media.mediaId) || '',
        mediaId: media.mediaId || null,
        name: 'Видеокружок от @' + (item.sender || 'пользователя'),
        type: 'video',
        kind: 'video',
        isCircle: true
      };
    });
  }

  createProfileVoiceCard(item, circlePlaylist = null, circleIndex = -1) {
    const card = document.createElement('div');
    card.className = 'tg-feed-voice-card';
    const isCircle = item.type === 'circle';
    const totalDur = (item.voice && item.voice.duration) || (item.circleVideo && item.circleVideo.duration) || 0;
    const voiceMediaId = item.voice ? item.voice.mediaId : (item.circleVideo ? item.circleVideo.mediaId : null);
    let voiceSrc = item.voice ? (item.voice.dataUrl || item.voice.data || item.voice.url) : (item.circleVideo ? (item.circleVideo.dataUrl || item.circleVideo.url) : null);

    if (isCircle) {
      // Карточка видеокружка
      card.innerHTML = [
        '<div class="tg-voice-play-btn" style="background:#0284c7;" title="Воспроизвести кружок">',
        '  ' + this.uiIcon('video') + '',
        '</div>',
        '<div class="tg-feed-voice-meta">',
        '  <div class="tg-feed-voice-title">Видеокружок (' + this.formatDuration(totalDur) + ')</div>',
        '  <div class="tg-feed-voice-sub">от @' + this.escape(item.sender) + (item.time ? ' · ' + item.time : '') + '</div>',
        '</div>',
        '<button type="button" class="tg-file-dl-btn tg-watch-btn" title="Смотреть кружок">' + this.uiIcon('play', 'tg-ui-icon-sm') + '<span>Смотреть</span></button>'
      ].join('');

      const playCircle = async (e) => {
        e.stopPropagation();
        let src = voiceSrc;
        if (!src && voiceMediaId) {
          src = this._mediaBlobUrlCache.get(voiceMediaId);
          if (!src) {
            const blob = await this.storage.getMediaBlob(voiceMediaId);
            if (blob) {
              src = URL.createObjectURL(blob);
              this._mediaBlobUrlCache.set(voiceMediaId, src);
            }
          }
        }
        if (src || voiceMediaId) {
          const playlist = circlePlaylist && circlePlaylist.length ? circlePlaylist : [{
            src: src || '', mediaId: voiceMediaId, name: 'Видеокружок от @' + (item.sender || 'пользователя'), kind: 'video', type: 'video', isCircle: true
          }];
          this.openLightboxPlaylist(playlist, circleIndex >= 0 ? circleIndex : 0);
        } else {
          this.showToast('Медиафайл кружочка недоступен');
        }
      };

      card.addEventListener('click', playCircle);
      return card;
    }

    // Карточка голосового сообщения с живым плеером
    const barsCount = 26;
    const waveformHtml = this.generateWaveformBars(item.msgId || item.time || 'profile_voice', barsCount);

    card.innerHTML = [
      '<button type="button" class="tg-voice-play-btn" title="Воспроизвести">',
      '  <svg class="tg-icon-play" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
      '  <svg class="tg-icon-pause hidden" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
      '</button>',
      '<div class="tg-feed-voice-meta">',
      '  <div class="tg-voice-waveform">',
      '    <div class="tg-waveform-bars tg-waveform-bg">' + waveformHtml + '</div>',
      '    <div class="tg-waveform-fg" style="width: 0%;"><div class="tg-waveform-bars">' + waveformHtml + '</div></div>',
      '  </div>',
      '  <div class="tg-feed-voice-row">',
      '    <span class="tg-voice-time-label">' + this.formatDuration(totalDur) + '</span>',
      '    <span class="tg-feed-voice-sub">от @' + this.escape(item.sender) + (item.time ? ' · ' + item.time : '') + '</span>',
      '  </div>',
      '</div>'
    ].join('');

    const playBtn = card.querySelector('.tg-voice-play-btn');
    const playIcon = card.querySelector('.tg-icon-play');
    const pauseIcon = card.querySelector('.tg-icon-pause');
    const waveformFg = card.querySelector('.tg-waveform-fg');
    const waveformEl = card.querySelector('.tg-voice-waveform');
    const timeLabel = card.querySelector('.tg-voice-time-label');

    let audio = null;

    const setupAudioEvents = (a) => {
      a.addEventListener('timeupdate', () => {
        const dur = a.duration || totalDur || 1;
        const progress = Math.min(1, Math.max(0, a.currentTime / dur));
        if (waveformFg) waveformFg.style.width = (progress * 100) + '%';
        if (timeLabel) timeLabel.innerText = this.formatDuration(Math.floor(a.currentTime)) + ' / ' + this.formatDuration(Math.floor(dur));
      });
      a.addEventListener('ended', () => {
        if (playIcon) playIcon.classList.remove('hidden');
        if (pauseIcon) pauseIcon.classList.add('hidden');
        if (waveformFg) waveformFg.style.width = '0%';
        if (timeLabel) timeLabel.innerText = this.formatDuration(totalDur);
        if (this.currentPlayingAudio === a) {
          this.currentPlayingAudio = null;
          this.currentPlayingAudioBtn = null;
        }
      });
      a.addEventListener('pause', () => {
        if (playIcon) playIcon.classList.remove('hidden');
        if (pauseIcon) pauseIcon.classList.add('hidden');
      });
    };

    const togglePlay = async () => {
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
          setupAudioEvents(audio);
        }
      }
      if (!audio) {
        this.showToast('Голосовое сообщение недоступно для воспроизведения');
        return;
      }

      if (audio.paused) {
        this.stopAllPlayingMedia(audio);
        this.currentPlayingAudio = audio;
        this.currentPlayingAudioBtn = playBtn;

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

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlay();
    });

    waveformEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rect = waveformEl.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

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
          setupAudioEvents(audio);
        }
      }
      if (!audio) return;

      const dur = audio.duration || totalDur || 1;
      try { audio.currentTime = pct * dur; } catch (_) {}
      if (waveformFg) waveformFg.style.width = (pct * 100) + '%';
      if (timeLabel) timeLabel.innerText = this.formatDuration(Math.floor(audio.currentTime)) + ' / ' + this.formatDuration(Math.floor(dur));

      if (audio.paused) {
        togglePlay();
      }
    });

    return card;
  }

  async renderProfileMediaTabs(targetUsername, isOwn = false) {
    let data;
    if (isOwn) {
      data = await this.storage.getAllUserMedia(this.currentUser.username);
    } else {
      data = await this.storage.getUserSharedMedia(this.currentUser.username, targetUsername);
    }
    const { media, files, voice } = data;

    // Обновляем бейджи счетчиков
    if (this.el.badgeCountMedia) this.el.badgeCountMedia.innerText = media.length;
    if (this.el.badgeCountFiles) this.el.badgeCountFiles.innerText = files.length;
    if (this.el.badgeCountVoice) this.el.badgeCountVoice.innerText = voice.length;

    // 1. Медиа (Фото / Видео) с галереей плейлиста
    if (this.el.profileMediaGrid && this.el.emptyProfileMedia) {
      this.el.profileMediaGrid.innerHTML = '';
      if (media.length === 0) {
        this.el.emptyProfileMedia.classList.remove('hidden');
      } else {
        this.el.emptyProfileMedia.classList.add('hidden');
        const mediaPlaylist = media.map((item, pIdx) => {
          const file = item.file;
          const src = file ? (file.dataUrl || (file.mediaId ? this._mediaBlobUrlCache.get(file.mediaId) : file.url) || file.data) : '';
          return {
            src,
            mediaId: file?.mediaId,
            name: (file && file.name) || (item.isVideo ? 'Видео' : 'Фотография'),
            type: item.isVideo ? 'video' : 'image',
            kind: item.isVideo ? 'video' : 'image'
          };
        });

        media.forEach((item, idx) => {
          const thumb = document.createElement('div');
          thumb.className = 'tg-profile-media-thumb';
          const file = item.file;
          const src = file ? (file.dataUrl || (file.mediaId ? this._mediaBlobUrlCache.get(file.mediaId) : file.url) || file.data) : '';
          if (item.isVideo) {
            thumb.innerHTML = '<span class="tg-media-placeholder-icon">' + this.uiIcon('video', 'tg-ui-icon-xl') + '</span><span class="tg-profile-media-video-badge">' + this.uiIcon('play', 'tg-ui-icon-xs') + item.time + '</span>';
          } else if (src) {
            thumb.innerHTML = '<img src="' + this.escapeAttr(src) + '" alt="Photo" style="width:100%;height:100%;object-fit:cover;">';
          } else {
            thumb.innerHTML = '<span class="tg-media-placeholder-icon">' + this.uiIcon('image', 'tg-ui-icon-xl') + '</span>';
          }
          thumb.addEventListener('click', () => {
            if (mediaPlaylist.length > 0 && mediaPlaylist[idx] && (mediaPlaylist[idx].src || mediaPlaylist[idx].mediaId)) {
              this.openLightboxPlaylist(mediaPlaylist, idx);
            } else if (src) {
              this.openLightbox(src, (file && file.name) || 'Медиа', item.isVideo ? 'video' : 'image');
            }
          });
          this.el.profileMediaGrid.appendChild(thumb);
          this.hydrateMediaThumbnail(thumb, file, item.isVideo);
        });
      }
    }

    // 2. Файлы (Документы как реальные карточки файлов)
    if (this.el.profileFilesList && this.el.emptyProfileFiles) {
      this.el.profileFilesList.innerHTML = '';
      if (files.length === 0) {
        this.el.emptyProfileFiles.classList.remove('hidden');
      } else {
        this.el.emptyProfileFiles.classList.add('hidden');
        files.forEach(item => {
          const card = this.createProfileFileCard(item);
          this.el.profileFilesList.appendChild(card);
        });
      }
    }

    // 3. Голосовые / Кружочки с живым аудиопроигрывателем
    if (this.el.profileVoiceList && this.el.emptyProfileVoice) {
      this.el.profileVoiceList.innerHTML = '';
      if (voice.length === 0) {
        this.el.emptyProfileVoice.classList.remove('hidden');
      } else {
        this.el.emptyProfileVoice.classList.add('hidden');
        const circlePlaylist = this.buildCirclePlaylist(voice);
        voice.forEach(item => {
          const circleIndex = item.type === 'circle' ? voice.filter(entry => entry.type === 'circle').indexOf(item) : -1;
          const card = this.createProfileVoiceCard(item, circlePlaylist, circleIndex);
          this.el.profileVoiceList.appendChild(card);
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
    if (this.el.editProfilePhone) this.el.editProfilePhone.value = this.currentUser.phone || '';
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
    const newPhone = this.el.editProfilePhone ? this.el.editProfilePhone.value.trim() : '';
    if (newPhone && !/^[+\d()\s-]{5,32}$/.test(newPhone)) {
      this.showToast('Проверьте формат номера телефона');
      return;
    }

    await this.storage.updateUserProfile(this.currentUser.username, {
      name: newName,
      bio: newBio,
      phone: newPhone,
      avatar: this.pendingEditAvatar
    });

    this.currentUser.name = newName;
    this.currentUser.bio = newBio;
    this.currentUser.phone = newPhone;
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
    if (this.el.currentUserName && this.currentUser) {
      this.el.currentUserName.innerText = this.currentUser.name || ('@' + this.currentUser.username);
    }
    if (this.el.currentUserHandle && this.currentUser) {
      this.el.currentUserHandle.innerText = '@' + this.currentUser.username;
    }
  }

  rememberSearchChat(chat) {
    const key = 'gm_recent_search_' + this.currentUser.username;
    const recent = JSON.parse(localStorage.getItem(key) || '[]');
    try { localStorage.setItem(key, JSON.stringify([chat, ...recent.filter(c => c.id !== chat.id)].slice(0, 12))); } catch (_) {}
  }

  async handleSearch(q, filter = this.activeSearchFilter || 'chats') {
    const generation = this.searchGeneration = (this.searchGeneration || 0) + 1;
    q = q.trim().toLowerCase().replace(/^@/, '');
    const opened = Boolean(this.globalSearchOpen || q);
    this.el.btnSearchClear.classList.toggle('hidden', !opened);
    this.el.searchFilters.classList.toggle('hidden', !opened);
    this.el.searchResultsSection.classList.toggle('hidden', !opened);
    this.el.chatList.classList.toggle('hidden', opened);
    this.el.foldersBar.classList.toggle('hidden', opened);
    if (!opened) return;
    const me = this.currentUser.username.toLowerCase();
    const chats = await this.storage.getUserChats(me);
    const allowed = new Set(chats.map(c => c.id));
    const messages = JSON.parse(localStorage.getItem('gm_messages') || '[]').filter(m => allowed.has(m.chatId));
    const users = q && filter === 'chats' ? await this.storage.searchUsers(q, me) : [];
    if (generation !== this.searchGeneration) return;
    const list = this.el.searchResultsList;
    list.replaceChildren();
    const caption = this.el.searchResultsSection.querySelector('.tg-section-caption');
    if (caption) caption.textContent = q ? 'Результаты поиска' : (filter === 'chats' ? 'Недавние' : 'Материалы ваших чатов');
    const addRow = (title, subtitle, icon, action) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tg-search-item tg-search-result-button';
      row.innerHTML = '<span class="tg-avatar tg-avatar-user tg-avatar-icon">' + this.uiIcon(icon) + '</span><span class="tg-chat-body"><span class="tg-chat-name">' + this.escape(title) + '</span><span class="tg-chat-snippet">' + this.escape(subtitle) + '</span></span>';
      row.addEventListener('click', action);
      list.appendChild(row);
    };
    const go = async (chat, message) => {
      this.rememberSearchChat(chat);
      this.globalSearchOpen = false;
      this.el.chatSearch.value = '';
      this.handleSearch('');
      await this.openChat(chat.id, chat.title);
      if (message) {
        this.openMessageSearch();
        this.el.messageSearchInput.value = q || message.text || message.sender || '';
        this.updateMessageSearch(false);
      }
    };
    if (filter === 'chats') {
      const selected = q ? chats.filter(c => (c.title + ' ' + (c.peer || '')).toLowerCase().includes(q)) :
        JSON.parse(localStorage.getItem('gm_recent_search_' + me) || '[]');
      selected.forEach(c => addRow(c.title, c.isSaved ? 'Личное облако' : (c.id === 'general' ? 'Общий чат' : 'Личный диалог'), c.isSaved ? 'star' : 'message', () => go(c)));
      users.filter(u => !selected.some(c => c.peer === u.username)).forEach(u => {
        const chat = { id: this.getDmChatId(me, u.username), title: u.name || '@' + u.username, peer: u.username };
        addRow(chat.title, '@' + u.username, 'message', () => go(chat));
      });
      if (q) messages.filter(m => (m.text || '').toLowerCase().includes(q)).slice(-50).reverse().forEach(m => {
        const chat = chats.find(c => c.id === m.chatId);
        addRow(m.text, chat.title + ' · ' + (m.time || ''), 'message', () => go(chat, m));
      });
    } else {
      const matching = messages.filter(m => !q || (m.text + ' ' + m.sender + ' ' + (m.files || [m.file]).filter(Boolean).map(f => f.name).join(' ')).toLowerCase().includes(q));
      if (filter === 'voice') {
        const voiceItems = matching.filter(m => m.voice || m.circleVideo).slice().reverse().map(m => ({
          msgId: m.id, type: m.circleVideo ? 'circle' : 'voice', voice: m.voice, circleVideo: m.circleVideo, sender: m.sender, chatId: m.chatId, time: m.time
        }));
        const circlePlaylist = this.buildCirclePlaylist(voiceItems);
        let circleIndex = 0;
        voiceItems.forEach(item => {
          list.appendChild(this.createProfileVoiceCard(item, circlePlaylist, item.type === 'circle' ? circleIndex++ : -1));
        });
      } else {
        const entries = matching.flatMap(m => (m.files || [m.file]).filter(Boolean).map(file => ({ file, message: m })));
        const isMedia = f => /^(image|video)\//.test(f.type || '') || /\.(png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|m4v)$/i.test(f.name || '');
        const items = entries.filter(e => filter === 'media' ? isMedia(e.file) : !isMedia(e.file));
        const playlist = items.map(({file:f}) => ({src:this.getAttachmentSrc(f), mediaId:f.mediaId, name:f.name, kind:/^video\//.test(f.type || '') || /\.(mp4|webm|mov|m4v)$/i.test(f.name || '') ? 'video' : 'image'}));
        const grid = document.createElement('div');
        grid.className = 'tg-profile-media-grid';
        if (filter === 'media' && items.length) list.appendChild(grid);
        items.forEach(({file, message}, index) => {
          if (filter === 'files') list.appendChild(this.createProfileFileCard({ file, sender: message.sender, time: message.time }));
          else {
            const thumb = document.createElement('button');
            thumb.type = 'button';
            thumb.className = 'tg-profile-media-thumb tg-search-media-thumb';
            thumb.setAttribute('aria-label', file.name || 'Открыть медиа');
            thumb.title = file.name || 'Медиа';
            thumb.innerHTML = this.uiIcon(playlist[index].kind === 'video' ? 'video' : 'image');
            thumb.addEventListener('click', () => this.openLightboxPlaylist(playlist, index));
            grid.appendChild(thumb);
            this.hydrateMediaThumbnail(thumb, file, playlist[index].kind === 'video');
          }
        });
      }
    }
    if (!list.children.length) {
      const empty = document.createElement('div');
      empty.className = 'tg-search-empty';
      empty.textContent = q ? 'Ничего не найдено' : (filter === 'chats' ? 'Здесь появятся недавно найденные чаты. Начните вводить имя или сообщение.' : 'Пока нет материалов');
      list.appendChild(empty);
    }
  }

  // ==========================================
  // НАВИГАЦИЯ САЙДБАРА (ЧАТЫ, КОНТАКТЫ, ПРОФИЛЬ, НАСТРОЙКИ)
  // ==========================================

  switchSidebarView(viewName) {
    this.activeSidebarView = viewName || 'chats';
    const views = ['chats', 'contacts', 'profile', 'settings'];

    // Обновляем состояние табов на Desktop Rail и Mobile Bottom Nav
    views.forEach(v => {
      const railBtn = document.getElementById('rail-nav-' + v);
      if (railBtn) railBtn.classList.toggle('active', v === viewName);
      const mobBtn = document.getElementById('mob-nav-' + v);
      if (mobBtn) mobBtn.classList.toggle('active', v === viewName);
      const viewEl = document.getElementById('sidebar-view-' + v);
      if (viewEl) viewEl.classList.toggle('hidden', v !== viewName);
    });

    // На мобильном, если пользователь переключает вкладки внизу, закрываем чат-вью, чтобы показать сайдбар
    if (this.el.chatView && window.innerWidth <= 768 && viewName !== 'chats') {
      this.el.chatView.classList.remove('active');
      sessionStorage.setItem('gm_active_chat_open', '0');
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
  // КОНТАКТЫ
  // ==========================================

  renderContactsList() {
    if (!this.currentUser || !this.el.contactsList) return;
    const allContacts = this.storage.getContacts(this.currentUser.username);
    const searchVal = (this.el.contactsSearch ? this.el.contactsSearch.value : '').toLowerCase().trim();

    let filtered = allContacts.filter(c => {
      if (!searchVal) return true;
      return (c.name || '').toLowerCase().includes(searchVal) || (c.username || '').toLowerCase().includes(searchVal);
    });

    if (this.contactsSortMode === 'name') {
      filtered.sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, 'ru'));
    } else {
      filtered.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    }

    if (this.el.contactsCountLabel) {
      this.el.contactsCountLabel.innerText = allContacts.length + ' контактов';
    }
    if (this.el.statContactsCount) {
      this.el.statContactsCount.innerText = allContacts.length;
    }

    this.el.contactsList.innerHTML = '';
    if (filtered.length === 0) {
      this.el.contactsList.innerHTML = '<div style="padding:28px 16px;text-align:center;color:var(--tg-text-sub);font-size:13.5px;">' +
        (searchVal ? 'Контакты не найдены' : 'Список контактов пуст. Нажмите «+» чтобы добавить.') + '</div>';
      return;
    }

    filtered.forEach(c => {
      const row = document.createElement('div');
      row.className = 'tg-contact-item';
      const initial = (c.name || c.username || '?')[0].toUpperCase();
      const dateStr = c.addedAt ? new Date(c.addedAt).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';

      row.innerHTML = [
        '<div class="tg-avatar tg-avatar-user" style="width:42px;height:42px;font-size:16px;">' + (c.avatar ? '<img src="' + this.escapeAttr(c.avatar) + '" alt="Avatar" style="width:100%;height:100%;object-fit:cover;">' : initial) + '</div>',
        '<div class="tg-contact-info">',
        '  <div class="tg-contact-name">' + this.escape(c.name || ('@' + c.username)) + '</div>',
        '  <div class="tg-contact-sub">@' + this.escape(c.username) + (c.phone ? ' · ' + this.escape(c.phone) : '') + (dateStr ? ' · добавлен ' + dateStr : '') + '</div>',
        '</div>',
        '<div class="tg-contact-actions">',
        '  <button class="tg-contact-btn-chat" title="Написать сообщение" aria-label="Написать сообщение">' + this.uiIcon('message') + '</button>',
        '  <button class="tg-contact-btn-del" title="Удалить из контактов" aria-label="Удалить из контактов">' + this.uiIcon('trash') + '</button>',
        '</div>'
      ].join('');

      const btnChat = row.querySelector('.tg-contact-btn-chat');
      const btnDel = row.querySelector('.tg-contact-btn-del');

      row.addEventListener('click', (e) => {
        if (btnDel && btnDel.contains(e.target)) return;
        this.openDirectChat(c.username);
        this.switchSidebarView('chats');
      });

      if (btnChat) {
        btnChat.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openDirectChat(c.username);
          this.switchSidebarView('chats');
        });
      }

      if (btnDel) {
        btnDel.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteContact(c.username);
        });
      }

      this.el.contactsList.appendChild(row);
    });
  }

  toggleContactsSort() {
    this.contactsSortMode = this.contactsSortMode === 'name' ? 'date' : 'name';
    if (this.el.btnSortContacts) {
      this.el.btnSortContacts.innerHTML = this.uiIcon('sort') + '<span class="tg-sort-label">' + (this.contactsSortMode === 'name' ? 'А–Я' : 'Дата') + '</span>';
      this.el.btnSortContacts.title = this.contactsSortMode === 'name' ? 'Сортировка по имени' : 'Сортировка по дате добавления';
    }
    this.renderContactsList();
    this.showToast(this.contactsSortMode === 'name' ? 'Сортировка: по алфавиту (А-Я)' : 'Сортировка: по дате добавления');
  }

  async openSpaceCreator(type = 'group') {
    if (!this.currentUser || !this.el.spaceCreator) return;
    this.spaceDraftAvatar = '';
    this.spaceDraftMembers = new Set();
    this.spaceMemberCandidates = [];
    if (this.el.spaceTitleInput) this.el.spaceTitleInput.value = '';
    if (this.el.spaceUsernameInput) this.el.spaceUsernameInput.value = '';
    if (this.el.spaceMembersSearch) this.el.spaceMembersSearch.value = '';
    this.el.spaceTypeChoices.forEach(button => {
      const active = button.dataset.spaceType === type;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
    this.updateSpaceAvatarPreview();
    this.updateSpaceUsernameStatus();
    this.setSpaceCreatorStep(1);
    this.el.spaceCreator.classList.remove('hidden');
    this.el.spaceCreator.setAttribute('aria-hidden', 'false');
    document.body.classList.add('space-creator-open');
    window.setTimeout(() => this.el.spaceTitleInput && this.el.spaceTitleInput.focus(), 120);
  }

  closeSpaceCreator() {
    if (!this.el.spaceCreator) return;
    this.el.spaceCreator.classList.add('hidden');
    this.el.spaceCreator.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('space-creator-open');
    if (this.el.spaceAvatarInput) this.el.spaceAvatarInput.value = '';
  }

  setSpaceCreatorStep(step) {
    this.spaceWizardStep = step === 2 ? 2 : 1;
    const second = this.spaceWizardStep === 2;
    if (this.el.spaceCreatorStepOne) this.el.spaceCreatorStepOne.classList.toggle('hidden', second);
    if (this.el.spaceCreatorStepTwo) this.el.spaceCreatorStepTwo.classList.toggle('hidden', !second);
    if (this.el.spaceCreatorBack) this.el.spaceCreatorBack.classList.toggle('hidden', !second);
    if (this.el.spaceCreatorNext) this.el.spaceCreatorNext.classList.toggle('hidden', second);
    if (this.el.spaceCreatorSave) this.el.spaceCreatorSave.classList.toggle('hidden', !second);
    if (this.el.spaceCreatorStepLabel) this.el.spaceCreatorStepLabel.textContent = second ? 'Шаг 2 из 2 · Участники' : 'Шаг 1 из 2 · Оформление';
    if (this.el.spaceCreatorTitle) this.el.spaceCreatorTitle.textContent = second ? 'Добавьте участников' : 'Новое сообщество';
  }

  getSelectedSpaceType() {
    const active = Array.from(this.el.spaceTypeChoices || []).find(button => button.classList.contains('active'));
    return active && active.dataset.spaceType === 'channel' ? 'channel' : 'group';
  }

  updateSpaceUsernameStatus() {
    if (!this.el.spaceUsernameStatus || !this.el.spaceUsernameInput) return;
    const username = this.el.spaceUsernameInput.value.trim().toLowerCase().replace(/^@/, '');
    let text = '5–32 символа, латиница, цифры и подчёркивание';
    let state = '';
    if (username) {
      if (!/^[a-z][a-z0-9_]{4,31}$/.test(username)) {
        text = 'Начните с латинской буквы, минимум 5 символов';
        state = 'error';
      } else if (!this.storage.isSpaceUsernameAvailable(username)) {
        text = '@' + username + ' уже занят';
        state = 'error';
      } else {
        text = '@' + username + ' свободен';
        state = 'success';
      }
    }
    this.el.spaceUsernameStatus.textContent = text;
    this.el.spaceUsernameStatus.className = 'tg-space-field-status' + (state ? ' ' + state : '');
  }

  async handleSpaceAvatar(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      this.showToast('Выберите изображение для аватара');
      return;
    }
    try {
      this.spaceDraftAvatar = await this.readAndCompressImage(file, 480, 480, 0.82);
      this.updateSpaceAvatarPreview();
    } catch (error) {
      console.warn('Space avatar error:', error);
      this.showToast('Не удалось обработать изображение');
    } finally {
      event.target.value = '';
    }
  }

  updateSpaceAvatarPreview() {
    if (!this.el.spaceAvatarPreview) return;
    this.el.spaceAvatarPreview.innerHTML = this.spaceDraftAvatar
      ? '<img src="' + this.spaceDraftAvatar + '" alt="Аватар сообщества">'
      : this.uiIcon(this.getSelectedSpaceType() === 'channel' ? 'broadcast' : 'users', 'tg-ui-icon-xl');
  }

  async prepareSpaceMembers() {
    const title = String(this.el.spaceTitleInput && this.el.spaceTitleInput.value || '').trim();
    const username = String(this.el.spaceUsernameInput && this.el.spaceUsernameInput.value || '').trim().toLowerCase().replace(/^@/, '');
    if (!title) {
      this.showToast('Введите название сообщества');
      this.el.spaceTitleInput.focus();
      return;
    }
    if (!/^[a-z][a-z0-9_]{4,31}$/.test(username) || !this.storage.isSpaceUsernameAvailable(username)) {
      this.showToast('Проверьте свободный username');
      this.el.spaceUsernameInput.focus();
      return;
    }
    const candidateMap = new Map();
    this.storage.getContacts(this.currentUser.username).forEach(contact => candidateMap.set(contact.username.toLowerCase(), { ...contact }));
    const chats = await this.storage.getUserChats(this.currentUser.username);
    chats.filter(chat => !chat.isSaved && !chat.isGeneral && !chat.isCommunity && chat.peer).forEach(chat => {
      if (!candidateMap.has(chat.peer.toLowerCase())) candidateMap.set(chat.peer.toLowerCase(), { username: chat.peer, name: chat.title, avatar: chat.avatar || '' });
    });
    candidateMap.delete(this.currentUser.username.toLowerCase());
    this.spaceMemberCandidates = await Promise.all(Array.from(candidateMap.values()).map(async candidate => {
      const profile = await this.storage.getUserProfile(candidate.username);
      return {
        username: candidate.username.toLowerCase(),
        name: candidate.name || (profile && profile.name) || ('@' + candidate.username),
        avatar: candidate.avatar || (profile && profile.avatar) || ''
      };
    }));
    this.spaceMemberCandidates.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    this.renderSpaceMemberChoices();
    this.setSpaceCreatorStep(2);
  }

  renderSpaceMemberChoices() {
    if (!this.el.spaceMembersList) return;
    const query = String(this.el.spaceMembersSearch && this.el.spaceMembersSearch.value || '').trim().toLowerCase();
    const candidates = this.spaceMemberCandidates.filter(candidate => !query || candidate.name.toLowerCase().includes(query) || candidate.username.includes(query));
    this.el.spaceMembersList.replaceChildren();
    if (!candidates.length) {
      const empty = document.createElement('div');
      empty.className = 'tg-space-members-empty';
      empty.textContent = query ? 'Ничего не найдено' : 'Контактов пока нет — сообщество можно создать без участников';
      this.el.spaceMembersList.appendChild(empty);
    }
    candidates.forEach(candidate => {
      const selected = this.spaceDraftMembers.has(candidate.username);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tg-space-member' + (selected ? ' selected' : '');
      row.innerHTML = '<span class="tg-space-member-avatar">' + (candidate.avatar ? '<img src="' + this.escapeAttr(candidate.avatar) + '" alt="">' : this.escape(candidate.username[0].toUpperCase())) + '</span><span class="tg-space-member-copy"><strong>' + this.escape(candidate.name) + '</strong><small>@' + this.escape(candidate.username) + '</small></span><span class="tg-space-member-check">' + this.uiIcon('check', 'tg-ui-icon-sm') + '</span>';
      row.addEventListener('click', () => {
        if (this.spaceDraftMembers.has(candidate.username)) this.spaceDraftMembers.delete(candidate.username);
        else this.spaceDraftMembers.add(candidate.username);
        this.renderSpaceMemberChoices();
      });
      this.el.spaceMembersList.appendChild(row);
    });
    if (this.el.spaceMembersCount) this.el.spaceMembersCount.textContent = this.spaceDraftMembers.size ? ('Выбрано: ' + this.spaceDraftMembers.size) : 'Участников можно добавить позже';
  }

  async createSpaceFromWizard() {
    if (!this.el.spaceCreatorSave || this.el.spaceCreatorSave.disabled) return;
    this.el.spaceCreatorSave.disabled = true;
    try {
      const space = this.storage.createSpace({
        type: this.getSelectedSpaceType(),
        title: this.el.spaceTitleInput.value,
        username: this.el.spaceUsernameInput.value,
        avatar: this.spaceDraftAvatar,
        owner: this.currentUser.username,
        members: Array.from(this.spaceDraftMembers)
      });
      this.closeSpaceCreator();
      this.activeFolder = 'all';
      if (this.el.foldersBar) this.el.foldersBar.querySelectorAll('.tg-folder-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.folder === 'all'));
      this.switchSidebarView('chats');
      await this.renderChatList();
      this.openChat(space.id, space.title);
      this.showToast(space.type === 'channel' ? 'Канал создан' : 'Группа создана');
    } catch (error) {
      this.showToast(error.message || 'Не удалось создать сообщество');
    } finally {
      this.el.spaceCreatorSave.disabled = false;
    }
  }

  closeSpaceProfile() {
    if (!this.el.spaceProfile) return;
    this.el.spaceProfile.classList.add('hidden');
    this.el.spaceProfile.setAttribute('aria-hidden', 'true');
    this.activeSpaceId = '';
    document.body.classList.remove('space-profile-open');
  }

  async openSpaceProfile(chatId) {
    const space = this.storage.getSpace(chatId);
    if (!space || !this.currentUser || !this.el.spaceProfile) return;
    this.activeSpaceId = chatId;
    this.spaceProfileEditAvatar = space.avatar || '';
    this.setSpaceProfileEditing(false);
    this.el.spaceProfile.classList.remove('hidden');
    this.el.spaceProfile.setAttribute('aria-hidden', 'false');
    document.body.classList.add('space-profile-open');
    await this.renderSpaceProfile();
  }

  async renderSpaceProfile() {
    const space = this.storage.getSpace(this.activeSpaceId);
    if (!space) return this.closeSpaceProfile();
    const me = this.currentUser.username.toLowerCase();
    const isAdmin = (space.admins || []).includes(me);
    const isOwner = space.owner === me;
    if (this.el.spaceProfileRole) this.el.spaceProfileRole.textContent = isOwner ? 'Создатель' : (isAdmin ? 'Администратор' : (space.type === 'channel' ? 'Подписчик канала' : 'Участник группы'));
    if (this.el.spaceProfileTitle) this.el.spaceProfileTitle.textContent = space.title;
    if (this.el.spaceProfileSubtitle) this.el.spaceProfileSubtitle.textContent = '@' + space.username + ' · ' + (space.members || []).length + (space.type === 'channel' ? ' подписчиков' : ' участников');
    if (this.el.spaceProfileAvatar) this.el.spaceProfileAvatar.innerHTML = space.avatar
      ? '<img src="' + this.escapeAttr(space.avatar) + '" alt="Аватар сообщества">'
      : this.uiIcon(space.type === 'channel' ? 'broadcast' : 'users', 'tg-ui-icon-xl');
    if (this.el.spaceProfileEdit) this.el.spaceProfileEdit.classList.toggle('hidden', !isAdmin);
    if (this.el.spaceProfileAvatarButton) this.el.spaceProfileAvatarButton.classList.toggle('editable', isAdmin && !this.el.spaceProfileEditForm.classList.contains('hidden'));
    if (this.el.spaceProfileLeave) {
      this.el.spaceProfileLeave.classList.toggle('hidden', isOwner);
      this.el.spaceProfileLeave.disabled = isOwner;
    }
    if (this.el.spaceProfileAdminCount) this.el.spaceProfileAdminCount.textContent = String((space.admins || []).length);
    if (this.el.spaceProfileMemberCount) this.el.spaceProfileMemberCount.textContent = String((space.members || []).length);
    if (this.el.spaceProfileMembersSection) this.el.spaceProfileMembersSection.classList.toggle('hidden', !isAdmin);

    const usernames = Array.from(new Set([].concat(space.admins || [], isAdmin ? (space.members || []) : [])));
    const profiles = new Map();
    await Promise.all(usernames.map(async username => profiles.set(username, await this.storage.getUserProfile(username))));
    const renderRow = (username, adminList) => {
      const profile = profiles.get(username) || {};
      const row = document.createElement('div');
      const targetIsAdmin = (space.admins || []).includes(username);
      row.className = 'tg-space-profile-person';
      row.innerHTML = '<span class="tg-space-profile-person-avatar">' + (profile.avatar ? '<img src="' + this.escapeAttr(profile.avatar) + '" alt="">' : this.escape(username[0].toUpperCase())) + '</span><span class="tg-space-profile-person-copy"><strong>' + this.escape(profile.name || ('@' + username)) + '</strong><small>@' + this.escape(username) + (username === space.owner ? ' · создатель' : (targetIsAdmin ? ' · администратор' : '')) + '</small></span>';
      if (!adminList && isAdmin && username !== space.owner && username !== me) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tg-space-admin-toggle' + (targetIsAdmin ? ' active' : '');
        button.textContent = targetIsAdmin ? 'Снять' : 'Назначить';
        button.addEventListener('click', async () => {
          try {
            this.storage.setSpaceAdmin(space.id, me, username, !targetIsAdmin);
            await this.renderSpaceProfile();
            this.showToast(targetIsAdmin ? 'Администратор снят' : 'Администратор назначен');
          } catch (error) { this.showToast(error.message || 'Не удалось изменить права'); }
        });
        row.appendChild(button);
      }
      return row;
    };
    if (this.el.spaceProfileAdmins) {
      this.el.spaceProfileAdmins.replaceChildren(...(space.admins || []).map(username => renderRow(username, true)));
    }
    if (this.el.spaceProfileMembers && isAdmin) {
      this.el.spaceProfileMembers.replaceChildren(...(space.members || []).map(username => renderRow(username, false)));
    }
  }

  setSpaceProfileEditing(editing) {
    const space = this.storage.getSpace(this.activeSpaceId);
    if (!space || !this.el.spaceProfileEditForm) return;
    const isAdmin = (space.admins || []).includes(this.currentUser.username.toLowerCase());
    editing = Boolean(editing && isAdmin);
    this.el.spaceProfileEditForm.classList.toggle('hidden', !editing);
    if (this.el.spaceProfileEdit) this.el.spaceProfileEdit.classList.toggle('active', editing);
    if (this.el.spaceProfileAvatarButton) this.el.spaceProfileAvatarButton.classList.toggle('editable', editing);
    const editBadge = this.el.spaceProfileAvatarButton && this.el.spaceProfileAvatarButton.querySelector('i');
    if (editBadge) editBadge.classList.toggle('hidden', !editing);
    if (editing) {
      this.spaceProfileEditAvatar = space.avatar || '';
      this.el.spaceProfileTitleInput.value = space.title;
      this.el.spaceProfileUsernameInput.value = space.username;
      window.setTimeout(() => this.el.spaceProfileTitleInput.focus(), 80);
    } else if (this.el.spaceProfileAvatarInput) {
      this.el.spaceProfileAvatarInput.value = '';
    }
  }

  async handleSpaceProfileAvatar(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      this.spaceProfileEditAvatar = await this.readAndCompressImage(file, 480, 480, 0.82);
      if (this.el.spaceProfileAvatar) this.el.spaceProfileAvatar.innerHTML = '<img src="' + this.spaceProfileEditAvatar + '" alt="Новый аватар">';
    } catch (error) {
      this.showToast('Не удалось обработать изображение');
    } finally { event.target.value = ''; }
  }

  async saveSpaceProfile() {
    if (!this.activeSpaceId || !this.el.spaceProfileSave) return;
    this.el.spaceProfileSave.disabled = true;
    try {
      const updated = this.storage.updateSpace(this.activeSpaceId, this.currentUser.username, {
        title: this.el.spaceProfileTitleInput.value,
        username: this.el.spaceProfileUsernameInput.value,
        avatar: this.spaceProfileEditAvatar
      });
      this.setSpaceProfileEditing(false);
      if (this.currentChatId === updated.id) this.openChat(updated.id, updated.title);
      await this.renderChatList();
      await this.renderSpaceProfile();
      this.showToast('Сообщество обновлено');
    } catch (error) {
      this.showToast(error.message || 'Не удалось сохранить изменения');
    } finally { this.el.spaceProfileSave.disabled = false; }
  }

  async leaveCurrentSpace() {
    const chatId = this.activeSpaceId || this.currentChatId;
    const space = this.storage.getSpace(chatId);
    if (!space) return;
    if (!confirm('Покинуть «' + space.title + '»?')) return;
    try {
      this.storage.leaveSpace(chatId, this.currentUser.username);
      this.closeSpaceProfile();
      this.openChat(this.storage.getSavedChatId(this.currentUser.username), 'Избранное');
      if (window.innerWidth <= 768) this.el.chatView.classList.remove('active');
      await this.renderChatList();
      this.showToast('Вы покинули сообщество');
    } catch (error) { this.showToast(error.message || 'Не удалось покинуть сообщество'); }
  }

  updateComposerBlockState() {
    if (!this.currentUser || !this.el.messageComposer || !this.el.blockedComposer) return { restricted: false };
    const state = this.storage.getChatPostingState(this.currentUser.username, this.currentChatId);
    this.el.messageComposer.classList.toggle('hidden', state.restricted);
    this.el.blockedComposer.classList.toggle('hidden', !state.restricted);
    if (state.restricted) {
      this.closeAttachmentPicker();
      if (this.el.composerAttachments) this.el.composerAttachments.classList.add('hidden');
      if (this.el.blockedComposerText) {
        this.el.blockedComposerText.textContent = state.reason === 'channel-readonly'
          ? 'В этом канале публикуют только администраторы'
          : (state.reason === 'not-member' ? 'Вы больше не состоите в этом сообществе' : (state.blockedByMe ? ('@' + state.peer + ' в чёрном списке') : ('@' + state.peer + ' ограничил переписку')));
      }
      if (this.el.btnComposerUnblock) {
        const actionable = state.blockedByMe || state.reason === 'channel-readonly';
        this.el.btnComposerUnblock.classList.toggle('hidden', !actionable);
        this.el.btnComposerUnblock.disabled = !actionable;
        this.el.btnComposerUnblock.textContent = state.reason === 'channel-readonly' ? (this.isChatMuted(this.currentChatId) ? 'Включить уведомления' : 'Выключить уведомления') : 'Разблокировать';
      }
    } else {
      this.renderPendingAttachments();
    }
    return state;
  }

  handleComposerRestrictionAction() {
    const state = this.storage.getChatPostingState(this.currentUser.username, this.currentChatId);
    if (state.reason === 'channel-readonly') {
      const muted = this.toggleChatMute(this.currentChatId);
      this.updateComposerBlockState();
      this.showToast(muted ? 'Уведомления канала отключены' : 'Уведомления канала включены');
      return;
    }
    this.unblockCurrentChatUser();
  }

  unblockCurrentChatUser() {
    const state = this.storage.getChatBlockState(this.currentUser.username, this.currentChatId);
    if (!state.blockedByMe || !state.peer) return;
    this.storage.toggleBlacklist(this.currentUser.username, state.peer);
    this.updateComposerBlockState();
    this.updateChatActionsMenu();
    this.renderBlacklist();
    this.showToast('@' + state.peer + ' разблокирован');
  }

  closeChatActionsMenu() {
    if (this.el.chatActionsMenu) this.el.chatActionsMenu.classList.add('hidden');
    if (this.el.btnChatInfoPanel) this.el.btnChatInfoPanel.setAttribute('aria-expanded', 'false');
  }

  updateChatActionsMenu() {
    if (!this.el.chatActionsMenu) return;
    const peer = this.getPeerUsernameFromChatId(this.currentChatId);
    const general = this.currentChatId === 'general';
    const saved = this.currentChatId === this.storage.getSavedChatId(this.currentUser.username);
    const space = this.storage.getSpace(this.currentChatId);
    const contacts = this.storage.getContacts(this.currentUser.username);
    const isContact = contacts.some(contact => contact.username.toLowerCase() === peer.toLowerCase());
    const isMuted = this.isChatMuted(this.currentChatId);
    const isBlocked = this.storage.getBlacklist(this.currentUser.username).includes(peer.toLowerCase());
    const contactButton = this.el.chatActionsMenu.querySelector('[data-chat-action="contact"]');
    const blockButton = this.el.chatActionsMenu.querySelector('[data-chat-action="block"]');
    const spaceInfoButton = this.el.chatActionsMenu.querySelector('[data-chat-action="space-info"]');
    const spaceLeaveButton = this.el.chatActionsMenu.querySelector('[data-chat-action="space-leave"]');
    if (spaceInfoButton) spaceInfoButton.classList.toggle('hidden', !space);
    if (spaceLeaveButton) spaceLeaveButton.classList.toggle('hidden', !space || space.owner === this.currentUser.username.toLowerCase());
    contactButton.classList.toggle('hidden', general || saved || Boolean(space));
    blockButton.classList.toggle('hidden', general || saved || Boolean(space));
    const deleteButton = this.el.chatActionsMenu.querySelector('[data-chat-action="delete"]');
    if (deleteButton) deleteButton.classList.toggle('hidden', saved || Boolean(space));
    const clearButton = this.el.chatActionsMenu.querySelector('[data-chat-action="clear"]');
    if (clearButton) clearButton.classList.toggle('hidden', Boolean(space) && !(space.admins || []).includes(this.currentUser.username.toLowerCase()));
    contactButton.querySelector('span').textContent = isContact ? 'Изменить контакт' : 'Добавить контакт';
    blockButton.querySelector('span').textContent = isBlocked ? 'Убрать из чёрного списка' : 'Добавить в чёрный список';
    this.el.chatActionsMenu.querySelector('[data-chat-action="mute"] span').textContent = isMuted ? 'Включить звук' : 'Выключить звук';
  }

  async removeMessagesMedia(messages) {
    const ids = [];
    for (const message of messages || []) {
      for (const file of message.files || (message.file ? [message.file] : [])) if (file?.mediaId) ids.push(file.mediaId);
      if (message.voice?.mediaId) ids.push(message.voice.mediaId);
      if (message.circleVideo?.mediaId) ids.push(message.circleVideo.mediaId);
      if (message.circleVideo?.posterId) ids.push(message.circleVideo.posterId);
    }
    for (const id of new Set(ids)) {
      await this.storage.deleteMediaBlob(id);
      const url = this._mediaBlobUrlCache.get(id);
      if (url) URL.revokeObjectURL(url);
      this._mediaBlobUrlCache.delete(id);
    }
  }

  async handleChatAction(action) {
    this.closeChatActionsMenu();
    const chatId = this.currentChatId;
    const peer = this.getPeerUsernameFromChatId(chatId);
    const space = this.storage.getSpace(chatId);
    if (action === 'space-info') {
      if (space) await this.openSpaceProfile(chatId);
      return;
    }
    if (action === 'space-leave') {
      if (space) {
        this.activeSpaceId = chatId;
        await this.leaveCurrentSpace();
      }
      return;
    }
    if (action === 'contact') {
      if (space) return;
      const profile = await this.storage.getUserProfile(peer);
      this.openAddContactModal(peer, profile);
      return;
    }
    if (action === 'mute') {
      const muted = this.toggleChatMute(chatId);
      this.updateMuteUI(muted);
      this.showToast(muted ? 'Уведомления отключены' : 'Уведомления включены');
      return;
    }
    if (action === 'clear') {
      if (space && !(space.admins || []).includes(this.currentUser.username.toLowerCase())) return;
      if (!confirm('Очистить всю историю этого чата? Отменить действие будет нельзя.')) return;
      this.closeActiveMediaSession(true);
      const removed = this.storage.clearChat(chatId);
      await this.removeMessagesMedia(removed);
      await this.refreshData();
      this.showToast('История чата очищена');
      return;
    }
    if (action === 'block') {
      if (space) return;
      const blocked = this.storage.getBlacklist(this.currentUser.username).includes(peer.toLowerCase());
      if (!confirm(blocked ? 'Убрать @' + peer + ' из чёрного списка?' : 'Добавить @' + peer + ' в чёрный список?')) return;
      this.storage.toggleBlacklist(this.currentUser.username, peer);
      this.updateComposerBlockState();
      this.renderBlacklist();
      this.showToast(blocked ? 'Пользователь разблокирован' : 'Пользователь добавлен в чёрный список');
      return;
    }
    if (action === 'delete') {
      if (space) return;
      if (!confirm('Удалить чат и всю его историю? Отменить действие будет нельзя.')) return;
      this.closeActiveMediaSession(true);
      const removed = this.storage.deleteChat(this.currentUser.username, chatId);
      await this.removeMessagesMedia(removed);
      this.openChat(this.storage.getSavedChatId(this.currentUser.username), 'Избранное');
      if (window.innerWidth <= 768) this.el.chatView.classList.remove('active');
      await this.renderChatList();
      this.showToast('Чат удалён');
    }
  }

  openAddContactModal(prefillUsername = '', profile = null) {
    if (this.el.modalAddContact) {
      this.el.modalAddContact.classList.remove('hidden');
      if (this.el.addContactUsername) {
        this.el.addContactUsername.value = prefillUsername || '';
        this.el.addContactUsername.focus();
      }
      const saved = this.storage.getContacts(this.currentUser.username).find(contact => contact.username.toLowerCase() === String(prefillUsername).toLowerCase());
      const data = saved || profile || {};
      const editing = Boolean(saved);
      const title = this.el.modalAddContact.querySelector('#add-contact-modal-title');
      const submit = this.el.modalAddContact.querySelector('#add-contact-submit');
      if (title) title.textContent = editing ? 'Изменить контакт' : 'Добавить контакт';
      if (submit) submit.textContent = editing ? 'Сохранить' : 'Добавить';
      if (this.el.addContactName) this.el.addContactName.value = data.name || '';
      if (this.el.addContactPhone) this.el.addContactPhone.value = data.phone || '';
      if (this.el.addContactBio) this.el.addContactBio.value = data.bio || '';
      if (this.el.addContactPreviewName) this.el.addContactPreviewName.textContent = data.name || (prefillUsername ? '@' + prefillUsername : 'Новый контакт');
      if (this.el.addContactAvatar) {
        this.el.addContactAvatar.innerHTML = data.avatar ? '<img src="' + this.escapeAttr(data.avatar) + '" alt="Avatar">' : String(prefillUsername || '?').charAt(0).toUpperCase();
      }
    }
  }

  closeAddContactModal() {
    if (this.el.modalAddContact) {
      this.el.modalAddContact.classList.add('hidden');
    }
  }

  handleAddContactSubmit(e) {
    e.preventDefault();
    const username = (this.el.addContactUsername ? this.el.addContactUsername.value : '').trim().replace(/^@/, '');
    const name = (this.el.addContactName ? this.el.addContactName.value : '').trim();
    const phone = (this.el.addContactPhone ? this.el.addContactPhone.value : '').trim();
    const bio = (this.el.addContactBio ? this.el.addContactBio.value : '').trim();

    if (!username) {
      this.showToast('Укажите @username контакта');
      return;
    }

    if (phone && !/^[+\d()\s-]{5,32}$/.test(phone)) {
      this.showToast('Проверьте формат номера телефона');
      return;
    }
    const profile = this.activeProfileUser?.username === username ? this.activeProfileUser : null;
    this.storage.saveContact(this.currentUser.username, { username, name: name || ('@' + username), phone, bio, avatar: profile?.avatar || '' });
    this.closeAddContactModal();
    this.renderContactsList();
    this.showToast('Контакт @' + username + ' сохранён');
    if (this.activeProfileUser?.username === username) this.updateProfileContactAction();
  }

  updateProfileContactAction() {
    if (!this.activeProfileUser || !this.currentUser) return;
    const isOwn = this.activeProfileUser.username.toLowerCase() === this.currentUser.username.toLowerCase();
    const isGeneral = this.activeProfileUser.username.toLowerCase() === 'general';
    const contact = this.storage.getContacts(this.currentUser.username).find(item => item.username.toLowerCase() === this.activeProfileUser.username.toLowerCase());
    if (this.el.profileActionsRow) this.el.profileActionsRow.classList.toggle('hidden', isOwn || isGeneral);
    if (this.el.profileContactText) this.el.profileContactText.textContent = contact ? 'Изменить' : 'Добавить';
  }

  openContactFromProfile() {
    if (!this.activeProfileUser) return;
    this.openAddContactModal(this.activeProfileUser.username, this.activeProfileUser);
  }

  callActiveProfile() {
    if (!this.activeProfileUser) return;
    const contact = this.storage.getContacts(this.currentUser.username).find(item => item.username.toLowerCase() === this.activeProfileUser.username.toLowerCase());
    const phone = (this.activeProfileUser.phone || contact?.phone || '').trim();
    if (!phone) {
      this.showToast('Номер телефона не указан');
      return;
    }
    window.location.href = 'tel:' + phone.replace(/[^+\d]/g, '');
  }

  deleteContact(targetUsername) {
    if (!confirm('Удалить контакт @' + targetUsername + '?')) return;
    this.storage.deleteContact(this.currentUser.username, targetUsername);
    this.renderContactsList();
    this.showToast('Контакт @' + targetUsername + ' удалён');
  }

  // ==========================================
  // ПРОФИЛЬ (ЖИВАЯ ЛЕНТА В САЙДБАРЕ)
  // ==========================================


  toggleProfilePhoto(avatar) {
    const expanded = avatar.classList.toggle('is-expanded');
    avatar.parentElement.classList.toggle('photo-expanded', expanded);
    avatar.setAttribute('aria-expanded', String(expanded));
    avatar.parentElement.querySelector('.tg-photo-menu')?.classList.add('hidden');
    this.refreshPhotoMenu(avatar);
  }

  refreshPhotoMenu(avatar) {
    const own = avatar === this.el.feedUserAvatar || this.activeProfileUser?.username === this.currentUser?.username;
    const hasPhoto = Boolean(avatar.querySelector('img'));
    const wrap = avatar.parentElement;
    wrap.querySelector('.tg-photo-more')?.classList.toggle('hidden', !own || !hasPhoto || !avatar.classList.contains('is-expanded'));
    if (!hasPhoto) {
      avatar.classList.remove('is-expanded');
      wrap.classList.remove('photo-expanded');
    }
  }

  bindProfilePhotoControls() {
    for (const avatar of [this.el.feedUserAvatar, this.el.profileAvatarLarge]) {
      avatar.setAttribute('role', 'button');
      avatar.tabIndex = 0;
      avatar.setAttribute('aria-label', 'Развернуть или свернуть фото профиля');
      const wrap = avatar.parentElement;
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'tg-photo-more hidden';
      more.setAttribute('aria-label', 'Действия с фотографией');
      more.setAttribute('aria-expanded', 'false');
      more.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
      const menu = document.createElement('div');
      menu.className = 'tg-photo-menu hidden';
      const close = () => { menu.classList.add('hidden'); more.setAttribute('aria-expanded', 'false'); };
      for (const [action, label] of [['main', 'Сделать основным'], ['delete', 'Удалить фотографию']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', async () => {
          close();
          const own = avatar === this.el.feedUserAvatar || this.activeProfileUser?.username === this.currentUser?.username;
          if (!own) return;
          const index = avatar === this.el.feedUserAvatar ? this.feedAvatarIndex : this.modalAvatarIndex;
          if (!confirm(action === 'main' ? 'Сделать эту фотографию основной?' : 'Удалить эту фотографию профиля?')) return;
          try {
            if (action === 'main') await this.storage.setMainProfilePhoto(this.currentUser.username, index);
            else await this.storage.deleteProfilePhoto(this.currentUser.username, index);
            const profile = await this.storage.getUserProfile(this.currentUser.username);
            Object.assign(this.currentUser, { avatar: profile.avatar, avatars: profile.avatars });
            this.feedAvatarIndex = this.modalAvatarIndex = 0;
            this.renderAvatars();
            await this.renderProfileFeed();
            if (this.activeProfileUser?.username === this.currentUser.username) {
              this.activeProfileUser = profile;
              this.updateModalAvatarUI();
            }
            this.showToast(action === 'main' ? 'Основное фото обновлено' : 'Фотография удалена');
          } catch (_) { this.showToast('Не удалось изменить фото. Попробуйте ещё раз.'); }
        });
        menu.appendChild(button);
      }
      more.addEventListener('click', () => {
        menu.classList.toggle('hidden');
        more.setAttribute('aria-expanded', String(!menu.classList.contains('hidden')));
      });
      document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
      wrap.append(more, menu);
      const step = delta => {
        close();
        if (avatar === this.el.feedUserAvatar) this.stepFeedAvatar(delta);
        else this.stepModalAvatar(delta);
      };
      avatar.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); avatar.click(); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); }
        if (e.key === 'Escape') { close(); if (avatar.classList.contains('is-expanded')) this.toggleProfilePhoto(avatar); }
      });
      let start = null;
      let swiped = false;
      avatar.addEventListener('touchstart', e => {
        swiped = false;
        start = e.touches.length === 1 ? {x:e.touches[0].clientX, y:e.touches[0].clientY} : null;
      }, {passive:true});
      avatar.addEventListener('touchend', e => {
        if (!start) return;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
        start = null;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          swiped = true;
          step(dx > 0 ? -1 : 1);
        } else if (Math.abs(dy) > 55 && Math.abs(dy) > Math.abs(dx) * 1.25) {
          const shouldExpand = dy > 0;
          if (shouldExpand !== avatar.classList.contains('is-expanded')) {
            swiped = true;
            this.toggleProfilePhoto(avatar);
          }
        }
      }, {passive:true});
      avatar.addEventListener('touchcancel', () => { start = null; }, {passive:true});
      avatar.addEventListener('click', e => { if (swiped) { swiped = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    }
    document.getElementById('btn-edit-username').addEventListener('click', () => {
      const input = this.el.feedProfileUsername;
      input.readOnly = !input.readOnly;
      input.focus();
      if (!input.readOnly) input.select();
      document.getElementById('btn-edit-username').setAttribute('aria-pressed', String(!input.readOnly));
    });
  }

  async renderProfileFeed() {
    if (!this.currentUser) return;
    const profile = await this.storage.getUserProfile(this.currentUser.username);
    const displayName = (profile && profile.name) ? profile.name : (this.currentUser.name || this.currentUser.username);
    const bio = (profile && profile.bio) ? profile.bio : '';
    const phone = (profile && profile.phone) ? profile.phone : '';

    if (this.el.feedHeroName) this.el.feedHeroName.innerText = displayName;
    if (this.el.feedProfileDisplayName) this.el.feedProfileDisplayName.value = displayName;
    if (this.el.feedProfileUsername) this.el.feedProfileUsername.value = '@' + this.currentUser.username;
    if (this.el.feedProfileBio) {
      this.el.feedProfileBio.value = bio;
      if (this.el.feedBioCounter) {
        this.el.feedBioCounter.innerText = bio.length + ' / 140';
      }
    }
    if (this.el.feedProfilePhone) this.el.feedProfilePhone.value = phone;

    const avatars = (profile && profile.avatars && profile.avatars.length > 0)
      ? profile.avatars
      : (profile && profile.avatar ? [profile.avatar] : []);
    const count = avatars.length;
    const idx = Math.min(Math.max(0, this.feedAvatarIndex || 0), Math.max(0, count - 1));
    this.feedAvatarIndex = idx;

    if (this.el.feedUserAvatar) {
      if (count > 0 && avatars[idx]) {
        this.el.feedUserAvatar.innerHTML = '<img src="' + avatars[idx] + '" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;cursor:pointer;">';
        this.el.feedUserAvatar.style.cursor = 'pointer';
        this.el.feedUserAvatar.onclick = () => this.toggleProfilePhoto(this.el.feedUserAvatar);
      } else {
        this.el.feedUserAvatar.innerHTML = '<span style="font-size:32px;color:#fff;">' + this.currentUser.username[0].toUpperCase() + '</span>';
        this.el.feedUserAvatar.style.cursor = 'default';
        this.el.feedUserAvatar.onclick = null;
      }
    }

    if (count > 1) {
      if (this.el.feedAvatarCounter) {
        this.el.feedAvatarCounter.innerText = (idx + 1) + ' / ' + count;
        this.el.feedAvatarCounter.classList.remove('hidden');
      }
      if (this.el.btnFeedAvatarPrev) this.el.btnFeedAvatarPrev.classList.remove('hidden');
      if (this.el.btnFeedAvatarNext) this.el.btnFeedAvatarNext.classList.remove('hidden');
      if (this.el.btnFeedSetMainPhoto) this.el.btnFeedSetMainPhoto.classList.toggle('hidden', idx === 0);
    } else {
      if (this.el.feedAvatarCounter) this.el.feedAvatarCounter.classList.add('hidden');
      if (this.el.btnFeedAvatarPrev) this.el.btnFeedAvatarPrev.classList.add('hidden');
      if (this.el.btnFeedAvatarNext) this.el.btnFeedAvatarNext.classList.add('hidden');
      if (this.el.btnFeedSetMainPhoto) this.el.btnFeedSetMainPhoto.classList.add('hidden');
    }

    if (this.el.btnFeedRemovePhoto) {
      this.el.btnFeedRemovePhoto.classList.toggle('hidden', count === 0);
    }

    this.refreshPhotoMenu(this.el.feedUserAvatar);

    // Статистика
    const chats = await this.storage.getUserChats(this.currentUser.username);
    const mediaObj = await this.storage.getAllUserMedia(this.currentUser.username);
    const contacts = this.storage.getContacts(this.currentUser.username);

    if (this.el.statChatsCount) this.el.statChatsCount.innerText = chats.length;
    if (this.el.statMediaCount) this.el.statMediaCount.innerText = mediaObj.media.length + mediaObj.files.length + mediaObj.voice.length;
    if (this.el.statContactsCount) this.el.statContactsCount.innerText = contacts.length;

    this.renderProfileFeedMedia(mediaObj);
  }

  stepFeedAvatar(delta) {
    const avatars = this.currentUser ? this.storage.getProfilePhotos(this.currentUser.username) : [];
    if (avatars.length <= 1) return;
    this.feedAvatarIndex = (this.feedAvatarIndex + delta + avatars.length) % avatars.length;
    this.renderProfileFeed();
  }

  async handleAvatarUpload(fileOrEvent) {
    let file = fileOrEvent;
    if (fileOrEvent && fileOrEvent.target && fileOrEvent.target.files) {
      file = fileOrEvent.target.files[0];
    }
    if (!file) return;
    if (!this.currentUser) {
      this.showToast('Вы не авторизованы');
      return;
    }
    try {
      const base64 = await this.readAndCompressImage(file, 480, 480, 0.82);
      const avatars = await this.storage.addProfilePhoto(this.currentUser.username, base64);
      this.currentUser.avatar = avatars[0];
      this.currentUser.avatars = avatars;
      this.feedAvatarIndex = 0;
      this.modalAvatarIndex = 0;
      this.pendingEditAvatar = avatars[0];
      if (this.el.editAvatarPreview) {
        this.el.editAvatarPreview.innerHTML = '<img src="' + avatars[0] + '" alt="Avatar">';
      }
      this.renderAvatars();
      this.renderProfileFeed();
      if (this.activeProfileUser && this.activeProfileUser.username.toLowerCase() === this.currentUser.username.toLowerCase()) {
        this.openUserProfile(this.currentUser.username, true);
      }
      if (this.el.avatarFileInput) this.el.avatarFileInput.value = '';
      this.showToast('Новое фото профиля успешно добавлено ✨');
    } catch (e) {
      console.warn('Avatar upload error:', e);
      if (this.el.avatarFileInput) this.el.avatarFileInput.value = '';
      this.showToast('Ошибка при загрузке фото');
    }
  }

  readAndCompressImage(file, maxWidth = 480, maxHeight = 480, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file || !(file instanceof Blob || file instanceof File)) {
        return reject(new Error('Некорректный файл изображения'));
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const side = Math.min(img.width, img.height);
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = Math.max(1, Math.min(side, maxWidth, maxHeight));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Не удалось декодировать изображение'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });
  }

  openLightboxPlaylist(playlist, index = 0) {
    if (!playlist || !playlist.length) return;
    const initial = playlist[index] || playlist[0];
    this.openLightbox(initial.src, initial.name, initial.kind || initial.type || 'image', playlist, index);
  }

  switchFeedMediaTab(tab) {
    this.feedActiveTab = tab || 'media';
    if (this.el.feedTabs) {
      this.el.feedTabs.forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-feed-tab') === tab);
      });
    }
    if (this.el.feedPaneMedia) this.el.feedPaneMedia.classList.toggle('hidden', tab !== 'media');
    if (this.el.feedPaneFiles) this.el.feedPaneFiles.classList.toggle('hidden', tab !== 'files');
    if (this.el.feedPaneVoice) this.el.feedPaneVoice.classList.toggle('hidden', tab !== 'voice');
  }

  async renderProfileFeedMedia(cachedMedia = null) {
    const data = cachedMedia || await this.storage.getAllUserMedia(this.currentUser.username);

    // 1. Фото / Видео
    if (this.el.feedPaneMedia) {
      this.el.feedPaneMedia.innerHTML = '';
      if (data.media.length === 0) {
        this.el.feedPaneMedia.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tg-text-sub);font-size:13px;">Нет сохраненных фото и видео</div>';
      } else {
        const grid = document.createElement('div');
        grid.className = 'tg-feed-media-grid';

        const mediaPlaylist = data.media.map(m => {
          const file = m.file;
          const url = file ? (file.dataUrl || (file.mediaId ? this._mediaBlobUrlCache.get(file.mediaId) : file.url) || file.data) : '';
          return {
            src: url,
            mediaId: file?.mediaId,
            name: (file && file.name) || (m.isVideo ? 'Видео' : 'Фотография'),
            type: m.isVideo ? 'video' : 'image',
            kind: m.isVideo ? 'video' : 'image'
          };
        });

        data.media.forEach((m, idx) => {
          const item = document.createElement('div');
          item.className = 'tg-feed-grid-item';
          const file = m.file;
          const url = file ? (file.dataUrl || (file.mediaId ? this._mediaBlobUrlCache.get(file.mediaId) : file.url) || file.data) : null;
          if (m.isVideo) {
            item.innerHTML = '<span class="tg-media-placeholder-icon">' + this.uiIcon('video', 'tg-ui-icon-xl') + '</span><span class="tg-profile-media-video-badge">Видео</span>';
          } else if (url) {
            item.innerHTML = '<img src="' + url + '" alt="Photo" style="width:100%;height:100%;object-fit:cover;">';
          } else {
            item.innerHTML = '<span class="tg-media-placeholder-icon">' + this.uiIcon('image', 'tg-ui-icon-xl') + '</span>';
          }
          item.addEventListener('click', () => {
            if (mediaPlaylist.length > 0 && mediaPlaylist[idx] && (mediaPlaylist[idx].src || mediaPlaylist[idx].mediaId)) {
              this.openLightboxPlaylist(mediaPlaylist, idx);
            } else if (url) {
              this.openLightbox(url, file ? (file.name || 'Медиа') : 'Медиа', m.isVideo ? 'video' : 'image');
            } else if (m.chatId) {
              this.openChat(m.chatId, m.chatId.startsWith('saved:') ? 'Избранное' : (m.chatId === 'general' ? 'Общий чат' : 'Диалог'));
            }
          });
          grid.appendChild(item);
          this.hydrateMediaThumbnail(item, file, m.isVideo);
        });
        this.el.feedPaneMedia.appendChild(grid);
      }
    }

    // 2. Файлы (Реальные карточки документов с кнопкой скачивания)
    if (this.el.feedPaneFiles) {
      this.el.feedPaneFiles.innerHTML = '';
      if (data.files.length === 0) {
        this.el.feedPaneFiles.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tg-text-sub);font-size:13px;">Нет отправленных документов</div>';
      } else {
        data.files.forEach(f => {
          const card = this.createProfileFileCard(f);
          this.el.feedPaneFiles.appendChild(card);
        });
      }
    }

    // 3. Голосовые и кружочки с живым аудиоплеером
    if (this.el.feedPaneVoice) {
      this.el.feedPaneVoice.innerHTML = '';
      if (data.voice.length === 0) {
        this.el.feedPaneVoice.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tg-text-sub);font-size:13px;">Нет голосовых сообщений и кружочков</div>';
      } else {
        const circlePlaylist = this.buildCirclePlaylist(data.voice);
        let circleIndex = 0;
        data.voice.forEach(v => {
          const card = this.createProfileVoiceCard(v, circlePlaylist, v.type === 'circle' ? circleIndex++ : -1);
          this.el.feedPaneVoice.appendChild(card);
        });
      }
    }
  }

  async handleFeedProfileSave(e) {
    if (e) e.preventDefault();
    const displayName = (this.el.feedProfileDisplayName ? this.el.feedProfileDisplayName.value : '').trim();
    const bio = (this.el.feedProfileBio ? this.el.feedProfileBio.value : '').trim();
    const phone = (this.el.feedProfilePhone ? this.el.feedProfilePhone.value : '').trim();
    if (phone && !/^[+\d()\s-]{5,32}$/.test(phone)) {
      this.showToast('Проверьте формат номера телефона');
      return;
    }

    try {
      const requested = this.el.feedProfileUsername.value.trim().replace(/^@/, '').toLowerCase();
      if (requested !== this.currentUser.username) {
        if (!confirm('Изменить username на @' + requested + '? Для следующего входа используйте новое имя.')) return;
        const old = this.currentUser.username;
        const renamed = this.storage.renameUsername(old, requested);
        this.currentUser.username = renamed;
        this.currentChatId = this.currentChatId.startsWith('dm:')
          ? 'dm:' + this.currentChatId.slice(3).split(':').map(u => u === old ? renamed : u).sort().join(':')
          : (this.currentChatId === 'saved:' + old ? 'saved:' + renamed : this.currentChatId);
        sessionStorage.setItem('gm_active_chat_id', this.currentChatId);
        window.history.replaceState({chatId:this.currentChatId, title:sessionStorage.getItem('gm_active_chat_title')}, '', window.location.pathname + window.location.search);
        this.closeActiveMediaSession(true);
        this.closeMessageSearch(false);
        this.activeProfileUser = null;
        this.el.feedProfileUsername.readOnly = true;
        document.getElementById('btn-edit-username').setAttribute('aria-pressed', 'false');
        await this.renderChatList();
        await this.renderMessages();
        this.renderContactsList();
      }
      await this.storage.updateUserProfile(this.currentUser.username, { name: displayName || this.currentUser.username, bio, phone });
    } catch (error) {
      this.showToast(error.message || 'Не удалось сохранить профиль');
      return;
    }
    this.currentUser.name = displayName;
    this.currentUser.phone = phone;
    localStorage.setItem('gm_current_user', JSON.stringify(this.currentUser));

    if (this.el.feedHeroName) this.el.feedHeroName.innerText = displayName;
    if (this.el.currentUserName) this.el.currentUserName.innerText = '@' + this.currentUser.username;
    this.renderAvatars();
    this.showToast('Профиль успешно сохранён');
  }

  // ==========================================
  // НАСТРОЙКИ И УПРАВЛЕНИЕ ПАМЯТЬЮ
  // ==========================================

  getAppearanceStorageKey() {
    const username = this.currentUser && this.currentUser.username;
    return username ? 'gm_appearance_' + username.toLowerCase() : 'gm_appearance_guest';
  }

  getAppearanceSettings() {
    const defaults = { theme: 'medium', background: 'default', dim: 22, customMediaId: '' };
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(this.getAppearanceStorageKey()) || '{}'); } catch (_) {}
    const legacyTheme = this.currentUser ? '' : localStorage.getItem('tg_theme');
    const theme = ['dark', 'medium', 'light'].includes(stored.theme)
      ? stored.theme
      : (['dark', 'medium', 'light'].includes(legacyTheme) ? legacyTheme : defaults.theme);
    const background = ['default', 'mesh', 'lines', 'dusk', 'custom'].includes(stored.background)
      ? stored.background
      : defaults.background;
    const dim = Math.max(0, Math.min(70, Number.isFinite(Number(stored.dim)) ? Number(stored.dim) : defaults.dim));
    return { ...defaults, ...stored, theme, background, dim };
  }

  saveAppearanceSettings(patch) {
    const settings = { ...this.getAppearanceSettings(), ...(patch || {}) };
    localStorage.setItem(this.getAppearanceStorageKey(), JSON.stringify(settings));
    localStorage.setItem('tg_theme', settings.theme);
    return settings;
  }

  setAppearanceTheme(theme) {
    if (!['dark', 'medium', 'light'].includes(theme)) return;
    this.saveAppearanceSettings({ theme });
    this.applyAppearanceSettings(true);
  }

  setChatBackground(background) {
    if (!['default', 'mesh', 'lines', 'dusk', 'custom'].includes(background)) return;
    const current = this.getAppearanceSettings();
    if (background === 'custom' && !current.customMediaId) {
      if (this.el.chatBackgroundFile) this.el.chatBackgroundFile.click();
      return;
    }
    this.saveAppearanceSettings({ background });
    this.applyAppearanceSettings(false);
    this.showToast(background === 'default' ? 'Стандартный фон восстановлен' : 'Фон переписки изменён');
  }

  async setCustomChatBackground(file) {
    if (!file || !String(file.type || '').startsWith('image/')) {
      this.showToast('Выберите изображение для фона');
      return;
    }
    const username = this.currentUser && this.currentUser.username ? this.currentUser.username.toLowerCase() : 'guest';
    const mediaId = 'appearance_wallpaper_' + username;
    const wallpaperBlob = await this.prepareChatBackgroundBlob(file);
    const saved = await this.storage.saveMediaBlob(mediaId, wallpaperBlob);
    if (!saved) {
      this.showToast('Не удалось сохранить фон на устройстве');
      return;
    }
    this.saveAppearanceSettings({ background: 'custom', customMediaId: mediaId });
    await this.applyAppearanceSettings(false);
    this.showToast('Собственный фон установлен');
  }

  prepareChatBackgroundBlob(file) {
    if (!file || !String(file.type || '').startsWith('image/')) return Promise.resolve(file);
    return new Promise(resolve => {
      const sourceUrl = URL.createObjectURL(file);
      const img = new Image();
      const finish = value => {
        URL.revokeObjectURL(sourceUrl);
        resolve(value || file);
      };
      img.onload = () => {
        const maxSide = 1920;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        if (scale === 1 && file.size <= 2.5 * 1024 * 1024) return finish(file);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return finish(file);
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(finish, 'image/jpeg', 0.86);
      };
      img.onerror = () => finish(file);
      img.src = sourceUrl;
    });
  }

  syncAppearanceControls(settings = this.getAppearanceSettings()) {
    const labels = { dark: 'Тёмная', medium: 'Средняя', light: 'Светлая' };
    if (this.el.settingsThemeLabel) this.el.settingsThemeLabel.textContent = labels[settings.theme] || labels.medium;
    this.el.themeChoices.forEach(button => {
      const active = button.dataset.themeChoice === settings.theme;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    this.el.backgroundChoices.forEach(button => {
      const active = button.dataset.chatBackgroundChoice === settings.background;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    if (this.el.chatBackgroundDim) this.el.chatBackgroundDim.value = String(settings.dim);
    if (this.el.chatBackgroundDimValue) this.el.chatBackgroundDimValue.textContent = settings.dim + '%';
    if (this.el.toggleNightMode) this.el.toggleNightMode.checked = settings.theme !== 'light';
  }

  async applyAppearanceSettings(announce = false) {
    const settings = this.getAppearanceSettings();
    const themeClasses = ['tg-theme-dark', 'tg-theme-medium', 'tg-theme-light'];
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme === 'light' ? 'light' : 'dark';
    document.body.classList.remove(...themeClasses);
    document.body.classList.add('tg-theme-' + settings.theme);
    document.body.dataset.chatBackground = settings.background;
    document.body.style.setProperty('--tg-wallpaper-overlay', 'rgba(0,0,0,' + (settings.dim / 100).toFixed(2) + ')');
    this.syncAppearanceControls(settings);

    const loadRequest = ++this.appearanceLoadRequest;
    if (settings.background === 'custom' && settings.customMediaId) {
      const blob = await this.storage.getMediaBlob(settings.customMediaId);
      if (loadRequest !== this.appearanceLoadRequest) return;
      if (blob) {
        if (this.chatBackgroundObjectUrl) URL.revokeObjectURL(this.chatBackgroundObjectUrl);
        this.chatBackgroundObjectUrl = URL.createObjectURL(blob);
        document.body.style.setProperty('--tg-chat-custom-image', 'url("' + this.chatBackgroundObjectUrl + '")');
        if (this.el.customChatBackgroundPreview) this.el.customChatBackgroundPreview.style.backgroundImage = 'url("' + this.chatBackgroundObjectUrl + '")';
      } else {
        this.saveAppearanceSettings({ background: 'default', customMediaId: '' });
        document.body.dataset.chatBackground = 'default';
        this.syncAppearanceControls(this.getAppearanceSettings());
      }
    } else {
      if (this.chatBackgroundObjectUrl) {
        URL.revokeObjectURL(this.chatBackgroundObjectUrl);
        this.chatBackgroundObjectUrl = '';
      }
      document.body.style.removeProperty('--tg-chat-custom-image');
      if (this.el.customChatBackgroundPreview) this.el.customChatBackgroundPreview.style.backgroundImage = '';
    }

    if (announce) {
      const labels = { dark: 'Тёмная тема включена', medium: 'Средняя тема включена', light: 'Светлая тема включена' };
      this.showToast(labels[settings.theme]);
    }
  }

  async renderSettingsView() {
    if (!this.currentUser) return;
    this.syncAppearanceControls();
    const avatar = this.currentUser.avatar || '';
    const displayName = this.currentUser.name || ('@' + this.currentUser.username);
    if (this.el.settingsProfileName) this.el.settingsProfileName.textContent = displayName;
    if (this.el.settingsProfileHandle) this.el.settingsProfileHandle.textContent = '@' + this.currentUser.username;
    if (this.el.settingsProfileAvatar) {
      this.el.settingsProfileAvatar.innerHTML = avatar
        ? '<img src="' + this.escapeAttr(avatar) + '" alt="">'
        : this.escape((this.currentUser.username || '?')[0].toUpperCase());
    }
    let bytes = 0;
    try {
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          bytes += ((localStorage[key].length + key.length) * 2);
        }
      }
    } catch (_) {}
    const kb = Math.round(bytes / 1024);
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    const text = bytes > 1024 * 1024 ? (mb + ' МБ') : (kb + ' КБ');
    if (this.el.settingsStorageUsage) {
      this.el.settingsStorageUsage.innerText = text + ' (сообщения, кэш медиа и вложения)';
    }
  }

  async clearMediaCache() {
    if (!confirm('Очистить локальный кэш медиа и освободить место на устройстве?')) return;
    try {
      if (this.storage.mediaDB) {
        const tx = this.storage.mediaDB.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').clear();
      }
      this._mediaBlobUrlCache.clear();
      if (this.getAppearanceSettings().background === 'custom') {
        this.saveAppearanceSettings({ background: 'default', customMediaId: '' });
        await this.applyAppearanceSettings(false);
      }
      this.showToast('Кэш медиа успешно очищен');
      this.renderSettingsView();
    } catch (e) {
      this.showToast('Кэш очищен');
      this.renderSettingsView();
    }
  }

  // ==========================================
  // МОДАЛЬНОЕ ОКНО «МОИ ФАЙЛЫ»
  // ==========================================

  openMyFilesModal() {
    if (this.el.modalMyFiles) {
      this.el.modalMyFiles.classList.remove('hidden');
      this.myfilesFilter = 'all';
      if (this.el.myfilesFilters) {
        this.el.myfilesFilters.forEach((c, idx) => c.classList.toggle('active', idx === 0));
      }
      if (this.el.myfilesSearch) this.el.myfilesSearch.value = '';
      this.renderMyFilesList();
    }
  }

  closeMyFilesModal() {
    if (this.el.modalMyFiles) {
      this.el.modalMyFiles.classList.add('hidden');
    }
  }

  async renderMyFilesList() {
    if (!this.currentUser || !this.el.myfilesList) return;
    const data = await this.storage.getAllUserMedia(this.currentUser.username);
    const q = (this.el.myfilesSearch ? this.el.myfilesSearch.value : '').toLowerCase().trim();
    const filter = this.myfilesFilter || 'all';

    let allItems = [];
    if (filter === 'all' || filter === 'media') {
      data.media.forEach(m => allItems.push({ ...m, itemType: 'media' }));
    }
    if (filter === 'all' || filter === 'files' || filter === 'docs') {
      data.files.forEach(f => allItems.push({ ...f, itemType: 'file' }));
    }
    if (filter === 'all' || filter === 'voice') {
      data.voice.forEach(v => allItems.push({ ...v, itemType: 'voice' }));
    }

    if (q) {
      allItems = allItems.filter(item => {
        const name = (item.file ? item.file.name : (item.type === 'circle' ? 'Видеокружок' : 'Голосовое')) || '';
        return name.toLowerCase().includes(q) || (item.chatId || '').toLowerCase().includes(q) || (item.sender || '').toLowerCase().includes(q);
      });
    }

    this.el.myfilesList.innerHTML = '';
    if (allItems.length === 0) {
      this.el.myfilesList.innerHTML = '<div style="padding:28px;text-align:center;color:var(--tg-text-sub);font-size:13.5px;">Файлы не найдены</div>';
      return;
    }

    // Составляем единый упорядоченный плейлист для фото, видео и кружочков из текущего отображаемого списка
    const mediaItems = [];
    allItems.forEach(it => {
      if (it.itemType === 'media') {
        mediaItems.push(it);
      } else if (it.itemType === 'voice' && it.type === 'circle') {
        mediaItems.push(it);
      }
    });

    const mediaPlaylist = mediaItems.map((item, idx) => {
      const isCircle = item.type === 'circle';
      const file = item.file;
      const isVideo = item.isVideo || isCircle;
      let url = file ? (file.dataUrl || (file.mediaId ? this._mediaBlobUrlCache.get(file.mediaId) : file.url) || file.data) : null;
      if (!url && item.circleVideo) {
        url = item.circleVideo.dataUrl || (item.circleVideo.mediaId ? this._mediaBlobUrlCache.get(item.circleVideo.mediaId) : item.circleVideo.url) || item.circleVideo.data;
      }
      return {
        src: url || '',
        mediaId: file ? file.mediaId : (item.circleVideo ? item.circleVideo.mediaId : null),
        name: (file && file.name) || (isCircle ? ('Видеокружок от @' + (item.sender || 'пользователя')) : (isVideo ? 'Видео' : 'Фотография')),
        type: isVideo ? 'video' : 'image',
        kind: isVideo ? 'video' : 'image',
        isCircle
      };
    });

    allItems.forEach(item => {
      if (item.itemType === 'file') {
        const card = this.createProfileFileCard(item);
        this.el.myfilesList.appendChild(card);
      } else if (item.itemType === 'voice') {
        const pIdx = mediaItems.indexOf(item);
        const card = this.createProfileVoiceCard(item, mediaPlaylist, pIdx);
        this.el.myfilesList.appendChild(card);
      } else if (item.itemType === 'media') {
        const file = item.file;
        const url = file ? (file.dataUrl || (file.mediaId ? this._mediaBlobUrlCache.get(file.mediaId) : file.url) || file.data) : null;
        const row = document.createElement('div');
        row.className = 'tg-myfile-row';
        const title = item.file ? (item.file.name || (item.isVideo ? 'Видео' : 'Фото')) : 'Медиа';
        const sub = (item.time || '') + ' · диалог: ' + (String(item.chatId || '').startsWith('saved:') ? 'избранное' : (item.chatId === 'general' ? 'общий чат' : (item.chatId || 'личный')));
        row.innerHTML = [
          '<div class="tg-myfile-kind-icon">' + this.uiIcon(item.isVideo ? 'video' : 'image') + '</div>',
          '<div style="flex:1;min-width:0;">',
          '  <div style="font-size:14px;font-weight:500;color:var(--tg-text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this.escape(title) + '</div>',
          '  <div style="font-size:12px;color:var(--tg-text-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this.escape(sub) + '</div>',
          '</div>',
          '<button type="button" class="tg-file-dl-btn tg-watch-btn">' + this.uiIcon('play', 'tg-ui-icon-sm') + '<span>Открыть</span></button>'
        ].join('');

        const triggerOpen = (e) => {
          e.stopPropagation();
          const pIdx = mediaItems.indexOf(item);
          if (mediaPlaylist.length > 0 && pIdx !== -1) {
            this.openLightboxPlaylist(mediaPlaylist, pIdx);
          } else if (url) {
            this.openLightbox(url, title, item.isVideo ? 'video' : 'image');
          }
        };

        const dlBtn = row.querySelector('.tg-file-dl-btn');
        if (dlBtn) dlBtn.addEventListener('click', triggerOpen);
        row.addEventListener('click', triggerOpen);
        this.el.myfilesList.appendChild(row);
      }
    });
  }

  // ==========================================
  // МОДАЛЬНОЕ ОКНО «ЧЕРНЫЙ СПИСОК»
  // ==========================================

  openBlacklistModal() {
    if (this.el.modalBlacklist) {
      this.el.modalBlacklist.classList.remove('hidden');
      this.renderBlacklist();
    }
  }

  closeBlacklistModal() {
    if (this.el.modalBlacklist) {
      this.el.modalBlacklist.classList.add('hidden');
    }
  }

  renderBlacklist() {
    if (!this.currentUser || !this.el.blacklistItemsList) return;
    const list = this.storage.getBlacklist(this.currentUser.username);
    this.el.blacklistItemsList.innerHTML = '';
    if (list.length === 0) {
      this.el.blacklistItemsList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tg-text-sub);font-size:13.5px;">Черный список пуст</div>';
      return;
    }

    const users = JSON.parse(localStorage.getItem('gm_users') || '[]');
    const contacts = this.storage.getContacts(this.currentUser.username);
    list.forEach(u => {
      const profile = users.find(item => String(item.username || '').toLowerCase() === u) || {};
      const contact = contacts.find(item => String(item.username || '').toLowerCase() === u) || {};
      const title = contact.name || profile.name || ('@' + u);
      const avatar = profile.avatar || '';
      const row = document.createElement('div');
      row.className = 'tg-contact-item tg-blacklist-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', 'Открыть чат с @' + u);
      row.innerHTML = [
        '<div class="tg-avatar tg-avatar-user tg-avatar-danger">' + (avatar ? '<img src="' + this.escapeAttr(avatar) + '" alt="">' : this.escape(u[0].toUpperCase())) + '</div>',
        '<div class="tg-contact-info">',
        '  <div class="tg-contact-name">' + this.escape(title) + '</div>',
        '  <div class="tg-contact-sub">@' + this.escape(u) + ' · заблокирован</div>',
        '</div>',
        '<button type="button" class="tg-blacklist-unblock">Разблокировать</button>'
      ].join('');

      const btn = row.querySelector('button');
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.unblockUser(u);
      });
      const openChat = () => {
        this.closeBlacklistModal();
        this.switchSidebarView('chats');
        this.openDirectChat(u);
      };
      row.addEventListener('click', openChat);
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openChat(); }
      });

      this.el.blacklistItemsList.appendChild(row);
    });
  }

  async handleBlacklistAdd() {
    const input = this.el.blacklistInputUsername;
    const username = (input ? input.value : '').trim().replace(/^@/, '');
    if (!username) {
      this.showToast('Введите @username для блокировки');
      return;
    }
    if (username.toLowerCase() === this.currentUser.username.toLowerCase()) {
      this.showToast('Нельзя заблокировать собственный профиль');
      return;
    }
    const profile = await this.storage.getUserProfile(username);
    if (!profile || profile.username === 'general') {
      this.showToast('Пользователь @' + username + ' не найден');
      return;
    }
    if (this.storage.getBlacklist(this.currentUser.username).includes(username.toLowerCase())) {
      this.showToast('@' + username + ' уже в чёрном списке');
      return;
    }
    this.storage.toggleBlacklist(this.currentUser.username, username);
    if (input) input.value = '';
    this.renderBlacklist();
    this.showToast('Пользователь @' + username + ' добавлен в черный список');
  }

  unblockUser(targetUsername) {
    this.storage.toggleBlacklist(this.currentUser.username, targetUsername);
    this.renderBlacklist();
    this.updateComposerBlockState();
    this.updateChatActionsMenu();
    this.showToast('Пользователь @' + targetUsername + ' разблокирован');
  }

  uiIcon(name, className = '') {
    const safeName = String(name || '').replace(/[^a-z0-9-]/gi, '');
    const safeClass = String(className || '').replace(/[^a-z0-9 _-]/gi, '');
    return '<svg class="tg-ui-icon' + (safeClass ? ' ' + safeClass : '') + '" aria-hidden="true"><use href="#tg-icon-' + safeName + '"></use></svg>';
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
