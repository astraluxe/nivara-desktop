/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand — fixed across themes
        accent:       "#7C5CFF",
        "accent-dim": "#5B3EDF",
        "nv-green":   "#22c55e",
        "nv-yellow":  "#eab308",
        // Theme-aware — driven by CSS vars in index.css
        "nv-bg":      "var(--nv-bg)",
        "nv-surface": "var(--nv-surface)",
        "nv-surface2":"var(--nv-surface2)",
        "nv-border":  "var(--nv-border)",
        "nv-text":    "var(--nv-text)",
        "nv-muted":   "var(--nv-muted)",
        "nv-faint":   "var(--nv-faint)",
        // nv-red uses RGB channels so bg-nv-red/10 opacity modifiers work
        "nv-red":     "rgb(var(--nv-red) / <alpha-value>)",
        // theme-aware status colors (dark: bright pastels, light: deeper saturated)
        "nv-ok":      "var(--nv-ok)",
        "nv-warn":    "var(--nv-warn)",
        "nv-bad":     "var(--nv-bad)",
        "nv-info":    "var(--nv-info)",
      },
      fontFamily: {
        sans: ["Space Grotesk", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        // Serif reading font for assistant message prose — like a well-typeset web article. Falls
        // back to system serifs (Georgia/Charter) so it still reads well if Google Fonts is offline.
        serif: ["Source Serif 4", "Charter", "Georgia", "Cambria", "Times New Roman", "serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "Monaco", "monospace"],
      },
    },
  },
  plugins: [],
};
