// A page that mounts the real chrome so the design pass can be LOOKED AT rather than assumed.
// Mirrors vite.harness.config.ts and adds one alias: AuthContext, which otherwise throws without a
// Supabase session. Build:  npx vite build --config vite.visual.config.ts --outDir dist-visual
import { readFileSync } from "node:fs";
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
const stub = path.resolve(__dirname, 'harness/tauri-stub.ts');
const auth = path.resolve(__dirname, 'harness/auth-stub.tsx');
const evstub = path.resolve(__dirname, 'harness/cursor-stub.ts');
const availstub = path.resolve(__dirname, 'harness/avail-stub.ts');
const sbstub = path.resolve(__dirname, 'harness/supabase-stub.ts');
// The running version, read from package.json at build time. The Settings panel used to carry a
// hand-typed string and was fifty-one releases out of date.
const APP_VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig({
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(APP_VERSION) },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@tauri-apps\/api\/event$/, replacement: evstub },
      { find: /^@tauri-apps\/api\/core$/, replacement: stub },
      { find: /^@tauri-apps\/api\/window$/, replacement: stub },
      { find: /^@tauri-apps\/api\/webviewWindow$/, replacement: stub },
      { find: /^@tauri-apps\/plugin-shell$/, replacement: stub },
      { find: /^@tauri-apps\/plugin-dialog$/, replacement: stub },
      { find: /^@tauri-apps\/plugin-autostart$/, replacement: stub },
      // Anchored at both ends: Vite substitutes only the MATCHED substring, so an unanchored
      // pattern leaves the './..' prefix in front of an absolute path.
      { find: /^.*\/contexts\/AuthContext$/, replacement: auth },
      // aisource-stub: fake availability so every kind of menu row appears in the screenshot.
      { find: /^.*\/lib\/aiSource$/, replacement: availstub },
      // supabase-stub: screens that read the database can be looked at without a real session.
      { find: /^.*\/lib\/supabase$/, replacement: sbstub },
    ],
  },
  build: { rollupOptions: { input: { visual: path.resolve(__dirname, 'visual.html'), cursor: path.resolve(__dirname, 'visual-cursor.html') } } },
});
