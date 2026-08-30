#!/usr/bin/env node

const esbuild = require('esbuild');
const csso = require('csso');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const distDir = path.join(publicDir, 'dist');
const startedAt = Date.now();

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(publicDir, 'app.mjs')],
  bundle: true,
  minify: true,
  target: 'es2020',
  outfile: path.join(distDir, 'app.min.js'),
  format: 'iife',
});

const cssSource = fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8');
const cssMinified = csso.minify(cssSource, { restructure: true }).css;
fs.writeFileSync(path.join(distDir, 'style.min.css'), cssMinified);

const assetVersion = createHash('sha256')
  .update(fs.readFileSync(path.join(distDir, 'app.min.js')))
  .update(cssMinified)
  .digest('hex')
  .slice(0, 12);

const htmlSource = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const html = htmlSource
  .replace(/app\.mjs(\?[^"']*)?/g, `app.min.js?v=${assetVersion}`)
  .replace(/style\.css(\?[^"']*)?/g, `style.min.css?v=${assetVersion}`);
fs.writeFileSync(path.join(distDir, 'index.html'), html);

for (const name of fs.readdirSync(publicDir)) {
  if (/\.(ico|png|svg|webmanifest|xml)$/i.test(name) || /^favicon/i.test(name)) {
    fs.copyFileSync(path.join(publicDir, name), path.join(distDir, name));
  }
}
fs.cpSync(path.join(publicDir, 'vendor'), path.join(distDir, 'vendor'), { recursive: true });

const moduleDir = path.join(publicDir, 'modules');
const jsSourceBytes = fs.statSync(path.join(publicDir, 'app.mjs')).size
  + fs.readdirSync(moduleDir)
    .filter(name => name.endsWith('.mjs'))
    .reduce((total, name) => total + fs.statSync(path.join(moduleDir, name)).size, 0);
const sourceBytes = jsSourceBytes + Buffer.byteLength(cssSource) + Buffer.byteLength(htmlSource);
const builtBytes = fs.statSync(path.join(distDir, 'app.min.js')).size + Buffer.byteLength(cssMinified) + Buffer.byteLength(html);
console.log(`Frontend: ${(sourceBytes / 1024).toFixed(0)}KB source -> ${(builtBytes / 1024).toFixed(0)}KB built`);
console.log(`Build done in ${Date.now() - startedAt}ms (${assetVersion})`);
