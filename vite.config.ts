import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    headers: {
      "Cache-Control": "no-store",
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  optimizeDeps: {
    include: ['pdfjs-dist'],
    exclude: ['pdfjs-dist/build/pdf.worker.mjs', 'pdfjs-dist/build/pdf.worker.min.mjs'],
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Multi-page: the main app + the always-on-top Quick Bar window.
    rollupOptions: {
      input: {
        main: "index.html",
        quickbar: "quickbar.html",
        quickbadge: "quickbadge.html",
      },
    },
  },
}));
