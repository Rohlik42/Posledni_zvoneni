// Commit versioned asset URLs so GitHub Pages needs no custom build step.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname;
const htmlPath = path.join(root, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
for (const asset of ['style.css', 'game.js', 'vendor/babylon.js']) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, asset))).digest('hex').slice(0, 16);
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Limit replacement to a whole quoted URL; do not change arbitrary page text.
  const urlPattern = new RegExp('((?:src|href)="' + escaped + ')(?:\\?[^" ]*)?"', 'g');
  if (!urlPattern.test(html)) throw new Error('Missing asset reference: ' + asset);
  urlPattern.lastIndex = 0;
  html = html.replace(urlPattern, '$1?v=' + hash + '"');
}
if (html !== fs.readFileSync(htmlPath, 'utf8')) {
  fs.writeFileSync(htmlPath, html);
  console.log('Updated content hashes in index.html');
}
