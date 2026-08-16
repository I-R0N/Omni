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

// IMAGES ONLY — AUDIO IS DELIBERATELY EXCLUDED, and this is the answer to
// docs/AUDIO_PLAN.md §2a (the standalone-build fork).
//
// Every sound id carries a procedural synth draft, and a recorded .wav only
// REPLACES that draft where one is installed.  So the standalone build needs
// no audio at all: it fetches nothing, falls back to the drafts, and is fully
// audible.  The recorded library can therefore grow without bound — a
// hundred takes or a thousand — and this file does not grow by a byte.
//
// Do NOT add wav/mp3/ogg to this pattern to "fix" the standalone's sound.
// It already has sound.  Adding audio here trades a working 5.5MB single
// file for a broken 50MB one, and base64 inflates it by a further third.
// If sampled audio in the standalone is ever genuinely wanted, that is a
// deliberate product decision to take with the repo owner (and probably
// wants a curated subset, not the whole folder), not a regex edit.
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
