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
        // Theme-aware — driven by CSS vars in index.css.
        //
        // These MUST be written as rgb(var(--x) / <alpha-value>), not as a bare var(--x). With a
        // bare var, Tailwind has nowhere to put the alpha, so it silently emits no rule at all for
        // every opacity-modified use — `bg-nv-surface2/60`, `border-nv-border/60` and ~130 others
        // across the app produced no background and no border, with no build error to show for it.
        // The channel values live in index.css as --nv-x-rgb; the plain --nv-x hex vars are derived
        // from them there, so hand-written CSS keeps working unchanged.
        "nv-bg":      "rgb(var(--nv-bg-rgb) / <alpha-value>)",
        "nv-surface": "rgb(var(--nv-surface-rgb) / <alpha-value>)",
        "nv-surface2":"rgb(var(--nv-surface2-rgb) / <alpha-value>)",
        "nv-border":  "rgb(var(--nv-border-rgb) / <alpha-value>)",
        "nv-text":    "rgb(var(--nv-text-rgb) / <alpha-value>)",
        "nv-muted":   "rgb(var(--nv-muted-rgb) / <alpha-value>)",
        "nv-faint":   "rgb(var(--nv-faint-rgb) / <alpha-value>)",
        "nv-red":     "rgb(var(--nv-red) / <alpha-value>)",
        // theme-aware status colors (dark: bright pastels, light: deeper saturated)
        "nv-ok":      "rgb(var(--nv-ok-rgb) / <alpha-value>)",
        "nv-warn":    "rgb(var(--nv-warn-rgb) / <alpha-value>)",
        "nv-bad":     "rgb(var(--nv-bad-rgb) / <alpha-value>)",
        "nv-info":    "rgb(var(--nv-info-rgb) / <alpha-value>)",
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
