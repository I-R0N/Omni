import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { isTableId, loadTableModule, tableFile, TABLE_FILES, DATA_DIR } from './scripts/toml-tables.mjs';

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
 * These WAVs are the SECOND tier, a fallback: AudioSystem fetches a take only
 * for an id that no decoded cinematic bank (`public/assets/audio/`) covers,
 * which today is none of them.
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
 * matches nothing is ignored, listed in the pause menu's audio panel, and
 * caught by `tests/audio.spec.ts`, which asserts there are none.
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


/**
 * Content tables — `data/*.toml` parsed at BUILD time into
 * `virtual:table/<name>` modules (engine-core S3, plan D32).  See
 * scripts/toml-tables.mjs, which owns the list and the parser and is shared
 * with the Node sim harness (scripts/sim-test.mjs) so the two cannot disagree
 * about what a table id resolves to.  The parser is a devDependency and ships
 * no runtime bytes; the standalone single-file build gets the data because it
 * is inside the module.
 */
function tomlTablesPlugin(): Plugin {
  const RESOLVED = (id: string) => '\0' + id;
  return {
    name: 'toml-tables',
    resolveId(id) { if (isTableId(id)) return RESOLVED(id); },
    load(id) {
      if (!id.startsWith('\0') || !isTableId(id.slice(1))) return;
      const table = id.slice(1);
      this.addWatchFile(tableFile(table));
      return loadTableModule(table);
    },
    configureServer(server) {
      const reload = (file: string) => {
        if (!TABLE_FILES.includes(path.basename(file))) return;
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.id && mod.id.startsWith('\0virtual:table/')) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add(DATA_DIR);
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
      plugins: [react(), tailwindcss(), nebulaManifestPlugin(), sfxManifestPlugin(), tomlTablesPlugin()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          // MEASUREMENT BUILD ONLY.  React's production `react-dom` strips the
          // `<Profiler>` instrumentation, so `onRender` never fires and the UI
          // cost reads exactly 0 — indistinguishable from "there is no cost".
          // `react-dom/profiling` is the production build WITH the timers kept.
          // Opt-in via the env var so the SHIPPING bundle is untouched: same
          // pattern as `vite build --minify false` for allocation attribution.
          //
          //   OMNI_PROFILE_REACT=1 npx vite build
          //
          ...(process.env.OMNI_PROFILE_REACT
            ? { 'react-dom/client': 'react-dom/profiling' }
            : {}),
        }
      }
    };
});
