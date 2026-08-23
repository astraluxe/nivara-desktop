import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
const stub = path.resolve(__dirname, 'harness/tauri-stub.ts');
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
    ],
  },
  build: { rollupOptions: { input: path.resolve(__dirname, 'harness.html') } },
  server: { port: 5199, strictPort: true },
});
