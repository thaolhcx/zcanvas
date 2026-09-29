import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
function offlineShell(): Plugin {
  return {
    name: "offline-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      const assets = ["index.html", ...Object.keys(bundle)]
        .filter((name) => !name.endsWith(".map"))
        .map((name) => "/" + name);
      const version = createHash("sha256")
        .update(assets.join("|"))
        .digest("hex")
        .slice(0, 12);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `
const CACHE = 'zcanvas-${version}';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(${JSON.stringify(assets)})).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('zcanvas-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html'))); return;
  }
  if ((url.origin === self.location.origin && url.pathname.startsWith('/assets/')) || /\\/assets\\/ast_[a-zA-Z0-9_-]+\\/thumbnail$/.test(url.pathname)) {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
      return response;
    })));
  }
});`,
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), offlineShell()],
  server: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          canvas: ["@xyflow/react"],
          collaboration: ["yjs", "y-indexeddb", "@hocuspocus/provider"],
          validation: [
            "../contracts/node_modules/ajv/dist/2020.js",
            "../contracts/node_modules/ajv-formats/dist/index.js",
          ],
        },
      },
    },
  },
});
