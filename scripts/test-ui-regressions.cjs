const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { StorageService, TelegramApp } = require('../app.js');

class MemoryStorage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i]; }
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) { this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const read = key => JSON.parse(localStorage.getItem(key));
function fixture() {
  global.localStorage = new MemoryStorage();
  const storage = new StorageService({ STORAGE_MODE: 'local' });
  save('gm_users', [{id:'stable-id', username:'alice', password:'test-only', avatar:'unchanged'}, {username:'bobby'}]);
  save('gm_current_user', {id:'stable-id', username:'alice'});
  save('gm_messages', [
    {id:'message-id', sender:'alice', chatId:'dm:alice:bobby', text:'alice should stay in text', files:[{mediaId:'blob-id'}], reactions:{like:['alice','bobby']}},
    {id:'saved-id', sender:'alice', chatId:'saved:alice', text:'private note'}
  ]);
  save('gm_contacts_alice', [{username:'bobby'}]);
  save('gm_contacts_bobby', [{username:'alice'}]);
  save('gm_blacklist_bobby', ['alice']);
  save('gm_muted_chats', ['dm:alice:bobby']);
  save('gm_recent_search_alice', [{id:'dm:alice:bobby', peer:'bobby', title:'Bobby'}]);
  save('gm_appearance_alice', {theme:'light', background:'mesh', dim:18});
  return storage;
}
test('rename preserves IDs, attachments, content, login and relationship references', async () => {
  const storage = fixture();
  assert.equal(storage.renameUsername('alice', '@zoe_new'), 'zoe_new');
  const message = read('gm_messages')[0];
  assert.equal(message.chatId, 'dm:bobby:zoe_new');
  assert.equal(message.sender, 'zoe_new');
  assert.equal(message.id, 'message-id');
  assert.equal(message.text, 'alice should stay in text');
  assert.equal(message.files[0].mediaId, 'blob-id');
  assert.deepEqual(message.reactions.like, ['zoe_new','bobby']);
  assert.equal(read('gm_users')[0].id, 'stable-id');
  assert.equal(read('gm_users')[0].avatar, 'unchanged');
  assert.equal(read('gm_contacts_bobby')[0].username, 'zoe_new');
  assert.deepEqual(read('gm_blacklist_bobby'), ['zoe_new']);
  assert.deepEqual(read('gm_muted_chats'), ['dm:bobby:zoe_new']);
  assert.equal(read('gm_recent_search_zoe_new')[0].id, 'dm:bobby:zoe_new');
  assert.equal(read('gm_messages')[1].chatId, 'saved:zoe_new');
  assert.equal(read('gm_appearance_zoe_new').theme, 'light');
  assert.equal(localStorage.getItem('gm_contacts_alice'), null);
  assert.equal(localStorage.getItem('gm_appearance_alice'), null);
  assert.equal((await storage.login('zoe_new', 'test-only')).user.id, 'stable-id');
});
test('invalid or occupied names never modify storage', () => {
  const storage = fixture();
  const before = [...localStorage.data];
  for (const name of ['bobby','bad:name','x','имя']) assert.throws(() => storage.renameUsername('alice',name));
  assert.deepEqual([...localStorage.data], before);
});
test('write failure rolls all changed keys back', () => {
  const storage = fixture();
  const before = [...localStorage.data];
  const set = localStorage.setItem.bind(localStorage);
  let failed = false;
  localStorage.setItem = (key, value) => {
    if (key === 'gm_current_user' && !failed) { failed = true; throw Error('quota'); }
    set(key, value);
  };
  assert.throws(() => storage.renameUsername('alice','zoe_new'));
  assert.deepEqual([...localStorage.data], before);
});
test('late media load cannot replace a newer slide', async () => {
  let resolve;
  const app = Object.create(TelegramApp.prototype);
  app.el = { lightboxImg: { classList: {toggle(){}}, src:'' } };
  app._mediaBlobUrlCache = new Map();
  app.storage = { getMediaBlob: () => new Promise(r => {resolve=r;}) };
  app.lightboxPlaylist = [{mediaId:'slow',kind:'image'}, {src:'new.jpg',kind:'image'}];
  app.lightboxIndex = 0;
  const pending = app.lightboxShowCurrent();
  app.lightboxIndex = 1;
  await app.lightboxShowCurrent();
  resolve(null);
  await pending;
  assert.equal(app.el.lightboxImg.src, 'new.jpg');
});

test('global search excludes other users private dialogs and supports empty recent history', async () => {
  const storage = fixture();
  save('gm_messages', [
    {id:'mine',sender:'bobby',chatId:'dm:alice:bobby',text:'secret visible'},
    {id:'other',sender:'bobby',chatId:'dm:alice2:bobby',text:'secret private'}
  ]);
  const node = () => ({children:[], classList:{toggle(){}}, appendChild(v){this.children.push(v);}, replaceChildren(){this.children=[];}, addEventListener(){}});
  global.document = {createElement:node};
  const app = Object.create(TelegramApp.prototype);
  app.storage = storage;
  app.currentUser = {username:'alice'};
  app.escape = app.uiIcon = s => s;
  app.el = Object.fromEntries(['btnSearchClear','searchFilters','searchResultsSection','chatList','foldersBar','searchResultsList'].map(k => [k,node()]));
  app.el.searchResultsSection.querySelector = () => null;
  await app.handleSearch('secret','chats');
  assert.equal(app.el.searchResultsList.children.length, 1);
  assert.match(app.el.searchResultsList.children[0].innerHTML, /secret visible/);
  assert.doesNotMatch(app.el.searchResultsList.children[0].innerHTML, /secret private/);
  save('gm_recent_search_alice', []);
  app.globalSearchOpen = true;
  await app.handleSearch('','chats');
  assert.match(app.el.searchResultsList.children[0].textContent, /недавно найденные/);
});

test('chat clearing removes only the selected conversation', () => {
  const storage = fixture();
  save('gm_messages', [
    {id:'one',chatId:'dm:alice:bobby',sender:'alice'},
    {id:'two',chatId:'general',sender:'bobby'}
  ]);
  const removed = storage.clearChat('dm:alice:bobby');
  assert.deepEqual(removed.map(item => item.id), ['one']);
  assert.deepEqual(read('gm_messages').map(item => item.id), ['two']);
});

test('download MIME inference covers APK and common media', () => {
  const app = Object.create(TelegramApp.prototype);
  assert.equal(app.inferMimeType('release.apk'), 'application/vnd.android.package-archive');
  assert.equal(app.inferMimeType('photo.JPG'), 'image/jpeg');
  assert.equal(app.inferMimeType('unknown.mina'), 'application/octet-stream');
});

test('media queue advances to the next voice or circle below', async () => {
  const previousWindow = global.window;
  global.window = { setTimeout: callback => { callback(); return 1; } };
  const started = [];
  const app = Object.create(TelegramApp.prototype);
  app.currentChatId = 'general';
  app.activeMediaSession = {messageId:'first',chatId:'general'};
  app.chatMediaPlaybackQueue = [
    {messageId:'first', type:'voice', start:() => started.push('first')},
    {messageId:'second', type:'circle', start:auto => started.push(auto ? 'second-auto' : 'second')},
    {messageId:'third', type:'voice', start:auto => started.push(auto ? 'third-auto' : 'third')}
  ];
  assert.equal(app.playNextChatMedia('first'), true);
  await Promise.resolve();
  assert.deepEqual(started, ['second-auto']);
  assert.equal(app.playNextChatMedia('third'), false);
  global.window = previousWindow;
});

test('appearance preferences stay isolated per account and normalize invalid values', () => {
  global.localStorage = new MemoryStorage();
  const app = Object.create(TelegramApp.prototype);
  app.currentUser = {username:'alice'};
  localStorage.setItem('tg_theme', 'dark');

  assert.deepEqual(app.getAppearanceSettings(), {
    theme:'medium', background:'default', dim:22, customMediaId:''
  });

  app.saveAppearanceSettings({theme:'light', background:'lines', dim:99});
  assert.equal(app.getAppearanceSettings().theme, 'light');
  assert.equal(app.getAppearanceSettings().background, 'lines');
  assert.equal(app.getAppearanceSettings().dim, 70);

  app.currentUser = {username:'bob'};
  assert.equal(app.getAppearanceSettings().theme, 'medium');
  assert.equal(app.getAppearanceSettings().background, 'default');

  localStorage.setItem('gm_appearance_bob', JSON.stringify({theme:'broken', background:'unknown', dim:-4}));
  assert.equal(app.getAppearanceSettings().theme, 'medium');
  assert.equal(app.getAppearanceSettings().background, 'default');
  assert.equal(app.getAppearanceSettings().dim, 0);
});

test('saved messages are private and pinned only for their owner', async () => {
  const storage = fixture();
  save('gm_messages', [
    {id:'alice-note', sender:'alice', chatId:'saved:alice', text:'Alice private', time:'10:00', createdAt:10},
    {id:'bob-note', sender:'bobby', chatId:'saved:bobby', text:'Bob private', time:'10:01', createdAt:11},
    {id:'dm-note', sender:'bobby', chatId:'dm:alice:bobby', text:'Shared', time:'10:02', createdAt:12}
  ]);
  const aliceChats = await storage.getUserChats('alice');
  assert.equal(aliceChats[0].id, 'saved:alice');
  assert.equal(aliceChats[0].title, 'Избранное');
  assert.equal(aliceChats[0].lastMsg, 'Alice private');
  assert.equal(aliceChats.some(chat => chat.id === 'saved:bobby'), false);
  const bobChats = await storage.getUserChats('bobby');
  assert.equal(bobChats[0].id, 'saved:bobby');
  assert.equal(bobChats[0].lastMsg, 'Bob private');
});

test('blacklist blocks both sides of a direct conversation until unblocked', async () => {
  const storage = fixture();
  const chatId = 'dm:alice:bobby';
  let state = storage.getChatBlockState('alice', chatId);
  assert.equal(state.blockedByPeer, true);
  assert.equal(state.blockedByMe, false);
  await assert.rejects(() => storage.sendMessage(chatId, 'alice', 'must not send'), /ограничил/);

  storage.toggleBlacklist('bobby', 'alice');
  assert.equal(storage.getChatBlockState('alice', chatId).blocked, false);
  await assert.doesNotReject(() => storage.sendMessage(chatId, 'alice', 'allowed now'));

  storage.toggleBlacklist('alice', 'bobby');
  state = storage.getChatBlockState('alice', chatId);
  assert.equal(state.blockedByMe, true);
  await assert.rejects(() => storage.sendMessage(chatId, 'alice', 'blocked by me'), /разблокируйте/);
  await assert.doesNotReject(() => storage.sendMessage('saved:alice', 'alice', 'private note'));
});

test('groups and channels are visible only to members and enforce publishing rights', async () => {
  const storage = fixture();
  save('gm_blacklist_bobby', []);
  const group = storage.createSpace({type:'group', title:'Design Team', username:'design_team', owner:'alice', members:['bobby']});
  const channel = storage.createSpace({type:'channel', title:'Product News', username:'product_news', owner:'alice', members:['bobby']});

  const aliceChats = await storage.getUserChats('alice');
  const bobChats = await storage.getUserChats('bobby');
  const strangerChats = await storage.getUserChats('charlie');
  assert.equal(aliceChats.some(chat => chat.id === group.id && chat.isGroup), true);
  assert.equal(bobChats.some(chat => chat.id === channel.id && chat.isChannel), true);
  assert.equal(strangerChats.some(chat => chat.id === group.id || chat.id === channel.id), false);

  await assert.doesNotReject(() => storage.sendMessage(group.id, 'bobby', 'Hello group'));
  await assert.doesNotReject(() => storage.sendMessage(channel.id, 'alice', 'Official post'));
  await assert.rejects(() => storage.sendMessage(channel.id, 'bobby', 'Not allowed'), /администраторы/);
  await assert.rejects(() => storage.sendMessage(group.id, 'charlie', 'Not a member'), /не состоите/);
});

test('community usernames are validated, unique and migrate with the owner account', () => {
  const storage = fixture();
  assert.throws(() => storage.createSpace({type:'group', title:'Bad', username:'1bad', owner:'alice'}), /Username/);
  const space = storage.createSpace({type:'channel', title:'Studio', username:'studio_news', owner:'alice', members:['bobby']});
  assert.equal(storage.isSpaceUsernameAvailable('studio_news'), false);
  assert.throws(() => storage.createSpace({type:'group', title:'Duplicate', username:'studio_news', owner:'bobby'}), /занят/);
  storage.renameUsername('alice', 'alice_new');
  const migrated = storage.getSpace(space.id);
  assert.equal(migrated.owner, 'alice_new');
  assert.deepEqual(migrated.admins, ['alice_new']);
  assert.deepEqual(migrated.members.sort(), ['alice_new','bobby']);
});

test('community profile editing and administrator roles enforce permissions', () => {
  const storage = fixture();
  const space = storage.createSpace({type:'group', title:'Old title', username:'old_team', owner:'alice', members:['bobby','charlie']});
  assert.throws(() => storage.updateSpace(space.id, 'bobby', {title:'No access'}), /администраторы/);
  const updated = storage.updateSpace(space.id, 'alice', {title:'New title', username:'new_team'});
  assert.equal(updated.title, 'New title');
  assert.equal(updated.username, 'new_team');
  assert.throws(() => storage.updateSpace(space.id, 'alice', {username:'bobby'}), /занят/);

  storage.setSpaceAdmin(space.id, 'alice', 'bobby', true);
  assert.equal(storage.getSpace(space.id).admins.includes('bobby'), true);
  assert.equal(storage.updateSpace(space.id, 'bobby', {title:'Edited by admin'}).title, 'Edited by admin');
  assert.throws(() => storage.setSpaceAdmin(space.id, 'bobby', 'alice', false), /Создателя/);

  storage.leaveSpace(space.id, 'charlie');
  assert.equal(storage.getSpace(space.id).members.includes('charlie'), false);
  assert.throws(() => storage.leaveSpace(space.id, 'alice'), /передать права/);
});

test('profile media tiles stay inside their grid and cannot cover profile controls', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(css, /\.tg-feed-grid-item\s*\{[^}]*position:\s*relative;[^}]*aspect-ratio:\s*1\s*\/\s*1;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.tg-feed-grid-item \.tg-media-placeholder-icon,[^{]*\{[^}]*pointer-events:\s*none;/s);
});

test('profile photo picker and direct community exit have dedicated controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="feed-avatar-file-input"[^>]*accept="image\/\*"/);
  assert.match(html, /id="btn-chat-leave-space"[^>]*title="Выйти из сообщества"/);
});

test('profile collections put the newest saved material first', async () => {
  const storage = fixture();
  save('gm_messages', [
    {id:'old-photo', sender:'alice', chatId:'saved:alice', createdAt:100, files:[{name:'old.jpg', type:'image/jpeg'}]},
    {id:'new-photo', sender:'alice', chatId:'saved:alice', createdAt:300, files:[{name:'new.jpg', type:'image/jpeg'}]},
    {id:'middle-file', sender:'alice', chatId:'saved:alice', createdAt:200, files:[{name:'notes.txt', type:'text/plain'}]}
  ]);
  const result = await storage.getAllUserMedia('alice');
  assert.deepEqual(result.media.map(item => item.msgId), ['new-photo', 'old-photo']);
  assert.deepEqual(result.files.map(item => item.msgId), ['middle-file']);
});

test('video thumbnails are generated from a real frame', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(source, /hydrateMediaThumbnail[\s\S]*captureVideoPosterBlob\(video, true\)/);
  assert.match(source, /image\.alt = file\.name \? 'Превью '/);
});

test('attachment library is profile-bound, persistent and newest-first', () => {
  const storage = fixture();
  storage.rememberAttachment('alice', {mediaId:'old', name:'old.txt', type:'text/plain', savedAt:100});
  storage.rememberAttachment('alice', {mediaId:'new', thumbnailId:'new_thumbnail', name:'new.mp4', type:'video/mp4', savedAt:300});
  storage.rememberAttachment('bobby', {mediaId:'other', name:'other.jpg', type:'image/jpeg', savedAt:500});
  assert.deepEqual(storage.getAttachmentLibrary('alice').map(item => item.mediaId), ['new', 'old']);
  assert.equal(storage.getAttachmentLibrary('alice')[0].thumbnailId, 'new_thumbnail');
  assert.deepEqual(storage.getAttachmentLibrary('bobby').map(item => item.mediaId), ['other']);
});

test('community profile exposes media, files, voice and members tabs', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const tab of ['media', 'files', 'voice', 'members']) {
    assert.match(html, new RegExp('data-space-profile-tab="' + tab + '"'));
  }
  assert.match(html, /id="space-profile-pane-members"/);
});

test('video thumbnail blobs are saved and reused by attachment id', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(source, /createAndStoreVideoThumbnail\(mediaId, fileUrl\)/);
  assert.match(source, /saveMediaBlob\(thumbnailId, posterBlob\)/);
  assert.match(source, /getMediaBlob\(thumbnailKey\)/);
});
