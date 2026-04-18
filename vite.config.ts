import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss(), nebulaManifestPlugin()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
