import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Short git SHA of HEAD at build time, surfaced on the title screen so
// it's obvious which commit a deployed preview is actually running.
// Falls back to 'dev' when git isn't available (e.g. a source tarball).
function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || 'dev';
  } catch {
    return 'dev';
  }
}

// Scans public/assets/ for every Nebula*.png and exposes the resulting URL
// list to the app via the virtual module `virtual:nebula-manifest`.  Drop a
// new Nebula##.png into the folder and the dev server picks it up on reload;
// no code changes required.
function nebulaManifestPlugin(): Plugin {
  const VIRTUAL_ID = 'virtual:nebula-manifest';
  const RESOLVED   = '\0' + VIRTUAL_ID;
  const assetsDir  = path.resolve(__dirname, 'public/assets');

  const scan = (): string[] => {
    try {
      return fs
        .readdirSync(assetsDir)
        .filter(f => /^Nebula\d+\.png$/i.test(f))
        .sort()
        .map(f => `/assets/${f}`);
    } catch {
      return [];
    }
  };

  return {
    name: 'nebula-manifest',
    resolveId(id) { if (id === VIRTUAL_ID) return RESOLVED; },
    load(id) {
      if (id !== RESOLVED) return;
      return `export default ${JSON.stringify(scan())};`;
    },
    configureServer(server) {
      const reload = (file: string) => {
        if (!/Nebula\d+\.png$/i.test(path.basename(file))) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add(assetsDir);
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
    },
  };
}

/**
 * SFX manifest — auto-discovers recorded takes in `public/assets/sfx/`.
 *
 * Same shape as the nebula plugin above and for the same reason: dropping a
 * file into the folder should be the whole workflow.  With 100+ sound ids and
 * several takes wanted per id, a hand-maintained list in the registry would be
 * wrong within a week.
 *
 * The CONVENTION is the id with dots turned into dashes, plus any suffix:
 *
 *     crash.player.shard  ->  crash-player-shard.wav
 *                             crash-player-shard-a.wav
 *                             crash-player-shard-rice-02.wav
 *
 * A file is matched to an id by LONGEST-PREFIX against the ids the registry
 * actually declares, which happens at runtime where that set is known — so
 * this plugin only has to list what exists, not understand it.  A file that
 * matches nothing is ignored (and reported by `scripts/smoke/assets.mjs`).
 */
function sfxManifestPlugin(): Plugin {
  const VIRTUAL_ID = 'virtual:sfx-manifest';
  const RESOLVED   = '\0' + VIRTUAL_ID;
  const sfxDir     = path.resolve(__dirname, 'public/assets/sfx');

  const scan = (): string[] => {
    try {
      return fs.readdirSync(sfxDir).filter(f => /\.wav$/i.test(f)).sort();
    } catch {
      return [];
    }
  };

  return {
    name: 'sfx-manifest',
    resolveId(id) { if (id === VIRTUAL_ID) return RESOLVED; },
    load(id) {
      if (id !== RESOLVED) return;
      return `export default ${JSON.stringify(scan())};`;
    },
    configureServer(server) {
      const reload = (file: string) => {
        if (!/\.wav$/i.test(path.basename(file))) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add(sfxDir);
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
      server.watcher.on('change', reload);
    },
  };
}

export default defineConfig(() => {
    return {
      define: {
        __APP_VERSION__: JSON.stringify(gitShortSha()),
        __BUILD_TIME__:  JSON.stringify(new Date().toISOString()),
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss(), nebulaManifestPlugin(), sfxManifestPlugin()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
