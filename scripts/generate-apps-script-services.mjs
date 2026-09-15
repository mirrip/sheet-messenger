import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const backend = fs.readFileSync(path.join(root, 'apps-script-v2', 'Backend.gs'), 'utf8');
const outRoot = path.join(root, 'apps-script-services');

const services = {
  auth: ['auth.register', 'auth.login', 'auth.logout', 'auth.me'],
  directory: ['users.search'],
  profiles: ['profile.get', 'profile.update', 'profile.photo.set', 'profile.photo.get'],
  conversations: ['conversations.list', 'conversations.ensureDm'],
  memberships: ['conversations.clearForMe', 'conversations.read'],
  spaces: ['spaces.create', 'spaces.update', 'spaces.leave', 'spaces.members.setRole'],
  messages: ['messages.page', 'messages.sync', 'messages.send', 'messages.edit', 'messages.delete'],
  reactions: ['reactions.toggle'],
  media: ['media.init', 'media.putChunk', 'media.complete', 'media.downloadChunk'],
  maintenance: []
};

const manifest = {
  timeZone: 'Europe/Moscow',
  dependencies: {},
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' }
};

fs.mkdirSync(outRoot, { recursive: true });
for (const [name, actions] of Object.entries(services)) {
  const dir = path.join(outRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Backend.gs'), backend);
  const serviceConfig = `const SERVICE_NAME = "kumir-${name}";\nconst SERVICE_ACTIONS = Object.freeze(${JSON.stringify(actions)});\n`;
  fs.writeFileSync(path.join(dir, 'ServiceConfig.gs'), serviceConfig);
  fs.writeFileSync(path.join(dir, 'Combined.gs'), serviceConfig + '\n' + backend);
  fs.writeFileSync(path.join(dir, 'appsscript.json'), JSON.stringify(manifest, null, 2) + '\n');
}

console.log(`Generated ${Object.keys(services).length} isolated Apps Script services.`);
