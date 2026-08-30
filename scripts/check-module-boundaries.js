const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const backendModules = ['auth', 'chat', 'memory', 'search', 'stream'];
for (const name of backendModules) {
  const file = `routes/${name}.js`;
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing backend module: ${file}`);
}

const frontendModules = ['state', 'api', 'message-renderer', 'sidebar'];
for (const name of frontendModules) {
  const file = `public/modules/${name}.mjs`;
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing frontend module: ${file}`);
}

const server = read('server.js');
if (/app\.(?:get|post|patch|delete)\(['"]\/api\//.test(server)) {
  throw new Error('server.js still owns a core API route');
}
for (const name of backendModules) {
  if (!server.includes(`require('./routes/${name}')`)) throw new Error(`server.js does not compose ${name} route`);
}

const app = read('public/app.mjs');
for (const name of frontendModules) {
  if (!app.includes(`./modules/${name}.mjs`)) throw new Error(`app.mjs does not import ${name}`);
}
if (/^const state\s*=|^const API\s*=\s*\{|^function createMessageElement|^async function loadChats/m.test(app)) {
  throw new Error('app.mjs still owns an extracted frontend domain');
}

console.log('core module boundaries ok');
