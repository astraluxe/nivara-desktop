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
      // ── The design tokens from index.css, reachable as Tailwind utilities ───
      // Defined in one place there so hand-written CSS and utility classes can never drift apart.
      // Purely additive: no existing utility changes meaning.
      boxShadow: {
        e1: "var(--nv-e1)",
        e2: "var(--nv-e2)",
        e3: "var(--nv-e3)",
        lip: "var(--nv-lip)",
        "e1-lip": "var(--nv-e1), var(--nv-lip)",
        "e2-lip": "var(--nv-e2), var(--nv-lip)",
        "e3-lip": "var(--nv-e3), var(--nv-lip)",
      },
      borderRadius: {
        "nv-sm": "var(--nv-r-sm)",
        nv: "var(--nv-r)",
        "nv-lg": "var(--nv-r-lg)",
        "nv-xl": "var(--nv-r-xl)",
      },
      transitionTimingFunction: { nv: "var(--nv-ease)" },
      transitionDuration: { fast: "120ms", med: "200ms", slow: "320ms" },
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
