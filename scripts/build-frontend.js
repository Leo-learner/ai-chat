#!/usr/bin/env node
// Build frontend: minify JS with esbuild, CSS with csso, copy static assets

const esbuild = require('esbuild');
const csso = require('csso');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const dist = path.join(pub, 'dist');

fs.mkdirSync(dist, { recursive: true });

const start = Date.now();

// 1. Minify JS
const jsResult = esbuild.buildSync({
  entryPoints: [path.join(pub, 'app.js')],
  bundle: true,
  minify: true,
  target: 'es2020',
  outfile: path.join(dist, 'app.min.js'),
  write: true,
  format: 'iife',
});
const jsIn = fs.statSync(path.join(pub, 'app.js')).size;
const jsOut = fs.statSync(path.join(dist, 'app.min.js')).size;
console.log(`JS: ${(jsIn / 1024).toFixed(0)}KB → ${(jsOut / 1024).toFixed(0)}KB (${((1 - jsOut / jsIn) * 100).toFixed(0)}% smaller)`);

// 2. Minify CSS
const cssRaw = fs.readFileSync(path.join(pub, 'style.css'), 'utf-8');
const cssMin = csso.minify(cssRaw, { restructure: false }).css;
fs.writeFileSync(path.join(dist, 'style.min.css'), cssMin);
const cssIn = Buffer.byteLength(cssRaw);
const cssOut = Buffer.byteLength(cssMin);
console.log(`CSS: ${(cssIn / 1024).toFixed(0)}KB → ${(cssOut / 1024).toFixed(0)}KB (${((1 - cssOut / cssIn) * 100).toFixed(0)}% smaller)`);

// 3. Copy index.html with updated references
let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf-8');
html = html.replace(/app\.js/g, 'dist/app.min.js');
html = html.replace(/style\.css(\?[^"']*)?/g, 'dist/style.min.css');
fs.writeFileSync(path.join(dist, 'index.html'), html);
const htmlSize = fs.statSync(path.join(dist, 'index.html')).size;
console.log(`HTML: dist/index.html (${(htmlSize / 1024).toFixed(0)}KB)`);

// 4. Copy static assets
for (const name of fs.readdirSync(pub)) {
  if (/\.(ico|png|svg|webmanifest|xml)$/i.test(name) || /^favicon/i.test(name)) {
    fs.copyFileSync(path.join(pub, name), path.join(dist, name));
  }
}

console.log(`Build done in ${Date.now() - start}ms`);
