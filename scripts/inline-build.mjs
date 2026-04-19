// Produce a single-file standalone HTML from the Vite build output.
// Inlines the CSS, JS, and any /assets/*.png referenced by the bundle as data URIs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';

const distDir = resolve('dist');
const publicAssetsDir = resolve('public/assets');

const html = readFileSync(resolve(distDir, 'index.html'), 'utf8');

const scriptMatch = html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/);
const cssMatch = html.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
if (!scriptMatch || !cssMatch) throw new Error('Could not locate built script/css tags.');

const scriptPath = resolve(distDir, scriptMatch[1].replace(/^\//, ''));
const cssPath = resolve(distDir, cssMatch[1].replace(/^\//, ''));

let jsSource = readFileSync(scriptPath, 'utf8');
const cssSource = readFileSync(cssPath, 'utf8');

const mimeFor = (ext) => {
  switch (ext.toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
};

const assetPattern = /\/assets\/([A-Za-z0-9_.-]+\.(?:png|jpg|jpeg|webp|svg|gif))/g;
const referenced = new Set();
for (const m of jsSource.matchAll(assetPattern)) referenced.add(m[1]);

const toDataUri = (absPath) => {
  const bytes = readFileSync(absPath);
  const mime = mimeFor(extname(absPath));
  return `data:${mime};base64,${bytes.toString('base64')}`;
};

const replaced = new Map();
for (const name of referenced) {
  const candidates = [
    resolve(distDir, 'assets', name),
    resolve(publicAssetsDir, name),
  ];
  const src = candidates.find(existsSync);
  if (!src) {
    console.warn(`[warn] asset not found: ${name} — leaving path unchanged`);
    continue;
  }
  replaced.set(name, toDataUri(src));
}

for (const [name, dataUri] of replaced) {
  const needle = `/assets/${name}`;
  jsSource = jsSource.split(needle).join(dataUri);
}

const finalHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <title>OmniVerse Engine</title>
    <style>${cssSource}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${jsSource}</script>
  </body>
</html>
`;

const out = resolve('omniverse-standalone.html');
writeFileSync(out, finalHtml);
const mb = (finalHtml.length / (1024 * 1024)).toFixed(2);
console.log(`Wrote ${out} (${mb} MB, ${replaced.size} assets inlined)`);
