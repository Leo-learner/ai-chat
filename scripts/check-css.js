const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'public', 'style.css');
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

console.log('css ok');
