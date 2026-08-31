const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validateDist(distPath) {
  const manifestPath = path.join(distPath, 'asset-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Production frontend manifest is missing');

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Production frontend manifest is invalid: ${error.message}`);
  }

  for (const name of ['index.html', 'app.min.js', 'style.min.css']) {
    const filePath = path.join(distPath, name);
    if (!fs.existsSync(filePath)) throw new Error(`Production frontend asset is missing: ${name}`);
    if (manifest.files?.[name]?.sha256 !== sha256(filePath)) {
      throw new Error(`Production frontend asset checksum mismatch: ${name}`);
    }
  }

  const html = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8');
  const version = manifest.assetVersion;
  if (!version || !html.includes(`app.min.js?v=${version}`) || !html.includes(`style.min.css?v=${version}`)) {
    throw new Error('Production frontend asset versions do not match the manifest');
  }
  return manifest;
}

module.exports = { sha256, validateDist };
