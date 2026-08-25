// A page that mounts the real chrome so the design pass can be LOOKED AT rather than assumed.
// Mirrors vite.harness.config.ts and adds one alias: AuthContext, which otherwise throws without a
// Supabase session. Build:  npx vite build --config vite.visual.config.ts --outDir dist-visual
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
const stub = path.resolve(__dirname, 'harness/tauri-stub.ts');
const auth = path.resolve(__dirname, 'harness/auth-stub.tsx');
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@tauri-apps\/api\/event$/, replacement: stub },
      { find: /^@tauri-apps\/api\/core$/, replacement: stub },
      { find: /^@tauri-apps\/api\/window$/, replacement: stub },
      { find: /^@tauri-apps\/api\/webviewWindow$/, replacement: stub },
      { find: /^@tauri-apps\/plugin-shell$/, replacement: stub },
      { find: /^@tauri-apps\/plugin-dialog$/, replacement: stub },
      { find: /^@tauri-apps\/plugin-autostart$/, replacement: stub },
      // Anchored at both ends: Vite substitutes only the MATCHED substring, so an unanchored
      // pattern leaves the './..' prefix in front of an absolute path.
      { find: /^.*\/contexts\/AuthContext$/, replacement: auth },
    ],
  },
  build: { rollupOptions: { input: path.resolve(__dirname, 'visual.html') } },
});
