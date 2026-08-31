import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// The running version, read from package.json at build time. The Settings panel used to carry a
// hand-typed string and was fifty-one releases out of date.
const APP_VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig(async () => ({
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(APP_VERSION) },
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
        // The agent cursor overlay (click-through, draws the pointer) and the small window it
        // opens below itself when it has to ask the user something.
        cursor: "cursor.html",
        ask: "ask.html",
        // quickbadge (the float-over-apps corner badge) is removed for now — quickbar stays.
      },
    },
  },
}));
