// Produce a single-file standalone HTML from the Vite build output.
// Inlines the CSS, JS, and any /assets/*.png referenced by the bundle as data URIs.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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
    case '.wav': return 'audio/wav';
    default: return 'application/octet-stream';
  }
};

// This pattern is for IMAGES, which are referenced in the bundle as literal
// `/assets/name.png` strings and so can be swapped inline.  AUDIO cannot use
// it and is handled separately below: a sound's URL is ASSEMBLED at runtime
// from a directory constant plus a filename, so the full path never appears
// in the JS for a regex to find.
//
// (The rule here used to be "audio is deliberately excluded, do not add wav
// to this pattern".  That was right while every id was a synth draft — the
// standalone needed no audio because it was already fully audible.  It stopped
// being right when real takes landed: the standalone was then structurally
// unable to play the one thing the preview existed to audition, and WAV-only
// mode was silence rather than an A/B.  The warning's advice still holds
// though — adding `wav` to THIS pattern would not have worked.)
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

// ── Recorded SFX ────────────────────────────────────────────────────────────
//
// Emitted as a filename -> data-URI table rather than substituted into the JS,
// because there is no path string to substitute: `AudioSystem` builds each URL
// as SFX_ASSET_DIR + name at runtime.  The loader checks this table before
// fetching, so a baked take takes exactly the same decode / rejection /
// round-robin path a served one does.
//
// Only files the MANIFEST references are baked, so a stray file in the folder
// costs nothing, and only ids that survive discovery are ever asked for.
const sfxDir = resolve(publicAssetsDir, 'sfx');
const sfxInline = {};
let sfxBytes = 0;
if (existsSync(sfxDir)) {
  for (const file of readdirSync(sfxDir)) {
    if (!/\.wav$/i.test(file)) continue;
    // The bundle carries the manifest's bare filenames; anything not named
    // there is unreachable at runtime and would be dead weight in the file.
    if (!jsSource.includes(file)) continue;
    const abs = resolve(sfxDir, file);
    sfxBytes += statSync(abs).size;
    sfxInline[file] = toDataUri(abs);
  }
}
const sfxTag = Object.keys(sfxInline).length
  ? `<script>window.__omniSfxInline=${JSON.stringify(sfxInline)};</script>`
  : '';

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
    ${sfxTag}
    <script type="module">${jsSource}</script>
  </body>
</html>
`;

const out = resolve('omniverse-standalone.html');
writeFileSync(out, finalHtml);
const mb = (finalHtml.length / (1024 * 1024)).toFixed(2);
const sfxCount = Object.keys(sfxInline).length;
console.log(`Wrote ${out} (${mb} MB, ${replaced.size} images + ${sfxCount} sfx takes inlined`
  + `${sfxCount ? `, ${(sfxBytes / 1024 / 1024).toFixed(2)} MB of audio` : ''})`);
