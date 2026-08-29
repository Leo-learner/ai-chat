const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, 'public', name), 'utf8');
const files = {
  html: read('index.html'),
  js: read('app.js'),
  css: read('style.css'),
};

const forbidden = [
  ['html', /stilltype|tabMemory|tabControl|tabTerminal|tabFinder|modelSheet/i],
  ['js', /memoryState|save-memory|isMacOSClient|initControlPanel|tabStilltype/i],
  ['css', /!important|stilltype-page|memory-page|terminal-page|finder-page/i],
];

for (const [file, pattern] of forbidden) {
  if (pattern.test(files[file])) throw new Error(`${file} contains retired production UI: ${pattern}`);
}

const budgets = { html: 24_000, js: 100_000, css: 60_000 };
for (const [file, limit] of Object.entries(budgets)) {
  const bytes = Buffer.byteLength(files[file]);
  if (bytes > limit) throw new Error(`${file} is ${bytes} bytes; budget is ${limit}`);
}

console.log('production frontend surface ok');
