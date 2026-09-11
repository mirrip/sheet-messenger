const test = require('node:test');
const assert = require('node:assert/strict');
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
  save('gm_messages', [{id:'message-id', sender:'alice', chatId:'dm:alice:bobby', text:'alice should stay in text', files:[{mediaId:'blob-id'}], reactions:{like:['alice','bobby']}}]);
  save('gm_contacts_alice', [{username:'bobby'}]);
  save('gm_contacts_bobby', [{username:'alice'}]);
  save('gm_blacklist_bobby', ['alice']);
  save('gm_muted_chats', ['dm:alice:bobby']);
  save('gm_recent_search_alice', [{id:'dm:alice:bobby', peer:'bobby', title:'Bobby'}]);
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
  assert.equal(localStorage.getItem('gm_contacts_alice'), null);
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
