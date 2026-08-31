const fs = require('fs');
const path = require('path');

for (const name of ['style.css']) {
const cssPath = path.join(__dirname, '..', 'public', name);
const css = fs.readFileSync(cssPath, 'utf8');
let balance = 0;
let line = 1;
let col = 0;
let inString = null;
let inComment = false;

for (let i = 0; i < css.length; i += 1) {
  const ch = css[i];
  const next = css[i + 1];
  col += 1;
  if (ch === '\n') {
    line += 1;
    col = 0;
  }

  if (inComment) {
    if (ch === '*' && next === '/') {
      inComment = false;
      i += 1;
      col += 1;
    }
    continue;
  }
  if (inString) {
    if (ch === '\\') {
      i += 1;
      col += 1;
    } else if (ch === inString) {
      inString = null;
    }
    continue;
  }
  if (ch === '/' && next === '*') {
    inComment = true;
    i += 1;
    col += 1;
    continue;
  }
  if (ch === '"' || ch === "'") {
    inString = ch;
    continue;
  }
  if (ch === '{') balance += 1;
  if (ch === '}') balance -= 1;
  if (balance < 0) {
    throw new Error(`CSS has an extra closing brace near ${line}:${col}`);
  }
}

if (inComment) throw new Error('CSS has an unclosed comment');
if (inString) throw new Error('CSS has an unclosed string');
if (balance !== 0) throw new Error(`CSS brace balance is ${balance}, expected 0`);

if (/!important\b/i.test(css)) throw new Error('CSS must not use !important');
if (/#dialogueApp|#chatView|body\.selected-ui\.server-chat-only/.test(css)) {
  throw new Error('Legacy high-specificity production selectors returned');
}

const selectorText = css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('{')
  .slice(0, -1)
  .map(chunk => chunk.slice(chunk.lastIndexOf('}') + 1).trim())
  .filter(selector => selector && !selector.startsWith('@'))
  .join('\n');
if (/(^|[\s>,+~])#[A-Za-z_][\w-]*/m.test(selectorText)) {
  throw new Error('Component CSS must use classes instead of ID selectors');
}

const definitions = [...css.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]);
const references = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(match => match[1]));
const unused = [...new Set(definitions)].filter(name => !references.has(name) && name !== '--icon');
if (unused.length) throw new Error(`Unused CSS variables: ${unused.join(', ')}`);

console.log(`${name} ok`);
}
