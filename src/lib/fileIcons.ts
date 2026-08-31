// ─── Telling files apart at a glance ─────────────────────────────────────────
//
// The file tree drew a grey middle-dot for every file, whatever it was: source, image, lock file,
// spreadsheet — one identical dot. An editor's tree is scanned, not read, and there was nothing to
// scan by.
//
// Editors solve this with a language icon per file type. Rather than ship a glyph font, this maps an
// extension to a SHORT LABEL and a COLOUR. A two-letter badge is unambiguous at 14px in a way a
// tiny pictogram is not — "TS" is never mistaken for anything else, whereas a small blue shape is.
// The colours follow the conventions people already know from their editor, so the tree looks
// familiar rather than invented.

export interface FileIconSpec {
  /** One or two characters, drawn in the badge. */
  label: string;
  /** The colour people already associate with this language. */
  colour: string;
  /** Spoken name, for the tooltip and for screen readers. */
  name: string;
}

/** Extension → how it is drawn. Lower-case, no dot. */
const BY_EXT: Record<string, FileIconSpec> = {
  // ── web ──
  ts:    { label: 'TS', colour: '#3178C6', name: 'TypeScript' },
  tsx:   { label: 'TS', colour: '#3178C6', name: 'TypeScript React' },
  js:    { label: 'JS', colour: '#E8C33C', name: 'JavaScript' },
  jsx:   { label: 'JS', colour: '#E8C33C', name: 'JavaScript React' },
  mjs:   { label: 'JS', colour: '#E8C33C', name: 'JavaScript module' },
  cjs:   { label: 'JS', colour: '#E8C33C', name: 'JavaScript module' },
  html:  { label: '<>', colour: '#E44D26', name: 'HTML' },
  htm:   { label: '<>', colour: '#E44D26', name: 'HTML' },
  css:   { label: '#', colour: '#42A5F5', name: 'CSS' },
  scss:  { label: '#', colour: '#CD6799', name: 'Sass' },
  sass:  { label: '#', colour: '#CD6799', name: 'Sass' },
  vue:   { label: 'V', colour: '#41B883', name: 'Vue' },
  svelte:{ label: 'S', colour: '#FF3E00', name: 'Svelte' },

  // ── other languages ──
  rs:    { label: 'RS', colour: '#DEA584', name: 'Rust' },
  py:    { label: 'PY', colour: '#4B8BBE', name: 'Python' },
  go:    { label: 'GO', colour: '#00ADD8', name: 'Go' },
  java:  { label: 'JV', colour: '#E76F00', name: 'Java' },
  rb:    { label: 'RB', colour: '#CC342D', name: 'Ruby' },
  php:   { label: 'PH', colour: '#777BB4', name: 'PHP' },
  c:     { label: 'C',  colour: '#5C6BC0', name: 'C' },
  h:     { label: 'H',  colour: '#5C6BC0', name: 'C header' },
  cpp:   { label: 'C+', colour: '#00599C', name: 'C++' },
  cs:    { label: 'C#', colour: '#68217A', name: 'C#' },
  swift: { label: 'SW', colour: '#F05138', name: 'Swift' },
  kt:    { label: 'KT', colour: '#A97BFF', name: 'Kotlin' },
  sql:   { label: 'DB', colour: '#4DB6AC', name: 'SQL' },
  sh:    { label: '$',  colour: '#89E051', name: 'Shell script' },
  bash:  { label: '$',  colour: '#89E051', name: 'Shell script' },
  ps1:   { label: '>_', colour: '#5391FE', name: 'PowerShell' },
  bat:   { label: '>_', colour: '#A0A0A0', name: 'Batch file' },

  // ── data and config ──
  json:  { label: '{}', colour: '#F0B429', name: 'JSON' },
  jsonc: { label: '{}', colour: '#F0B429', name: 'JSON' },
  yaml:  { label: 'YM', colour: '#CB171E', name: 'YAML' },
  yml:   { label: 'YM', colour: '#CB171E', name: 'YAML' },
  toml:  { label: 'TM', colour: '#9C4221', name: 'TOML' },
  xml:   { label: '<>', colour: '#8BC34A', name: 'XML' },
  env:   { label: '.E', colour: '#ECD53F', name: 'Environment file' },
  lock:  { label: '🔒', colour: '#8A8A8A', name: 'Lock file' },

  // ── documents ──
  md:    { label: 'MD', colour: '#7FB3D5', name: 'Markdown' },
  mdx:   { label: 'MD', colour: '#7FB3D5', name: 'Markdown' },
  txt:   { label: 'TX', colour: '#9E9E9E', name: 'Text' },
  pdf:   { label: 'PD', colour: '#DC3733', name: 'PDF' },
  doc:   { label: 'W',  colour: '#2B579A', name: 'Word document' },
  docx:  { label: 'W',  colour: '#2B579A', name: 'Word document' },
  xls:   { label: 'X',  colour: '#217346', name: 'Excel spreadsheet' },
  xlsx:  { label: 'X',  colour: '#217346', name: 'Excel spreadsheet' },
  csv:   { label: 'X',  colour: '#217346', name: 'Spreadsheet' },
  ppt:   { label: 'P',  colour: '#C43E1C', name: 'PowerPoint' },
  pptx:  { label: 'P',  colour: '#C43E1C', name: 'PowerPoint' },

  // ── media ──
  png:   { label: 'IM', colour: '#AB7DF8', name: 'Image' },
  jpg:   { label: 'IM', colour: '#AB7DF8', name: 'Image' },
  jpeg:  { label: 'IM', colour: '#AB7DF8', name: 'Image' },
  gif:   { label: 'IM', colour: '#AB7DF8', name: 'Image' },
  webp:  { label: 'IM', colour: '#AB7DF8', name: 'Image' },
  svg:   { label: 'SV', colour: '#FFB13B', name: 'SVG image' },
  ico:   { label: 'IM', colour: '#AB7DF8', name: 'Icon' },
  mp4:   { label: 'MV', colour: '#FF7043', name: 'Video' },
  webm:  { label: 'MV', colour: '#FF7043', name: 'Video' },
  mp3:   { label: 'AU', colour: '#4DD0E1', name: 'Audio' },
  wav:   { label: 'AU', colour: '#4DD0E1', name: 'Audio' },
  zip:   { label: 'ZP', colour: '#BDB76B', name: 'Archive' },
  exe:   { label: 'EX', colour: '#B0BEC5', name: 'Program' },
};

/** Whole filenames people recognise on sight, which beat the extension. */
const BY_NAME: Record<string, FileIconSpec> = {
  'package.json':      { label: 'NPM', colour: '#CB3837', name: 'npm manifest' },
  'package-lock.json': { label: '🔒', colour: '#8A8A8A', name: 'npm lock file' },
  'cargo.toml':        { label: 'RS', colour: '#DEA584', name: 'Cargo manifest' },
  'cargo.lock':        { label: '🔒', colour: '#8A8A8A', name: 'Cargo lock file' },
  'dockerfile':        { label: 'DK', colour: '#2496ED', name: 'Dockerfile' },
  'readme.md':         { label: 'RM', colour: '#42A5F5', name: 'Readme' },
  'license':           { label: '§',  colour: '#D4AF37', name: 'Licence' },
  'licence':           { label: '§',  colour: '#D4AF37', name: 'Licence' },
  '.gitignore':        { label: 'GIT', colour: '#F05032', name: 'Git ignore' },
  '.env':              { label: '.E', colour: '#ECD53F', name: 'Environment file' },
  'tsconfig.json':     { label: 'TS', colour: '#3178C6', name: 'TypeScript config' },
  'vite.config.ts':    { label: 'VT', colour: '#A855F7', name: 'Vite config' },
};

/** Anything with no rule of its own. Still a badge, so the column never goes ragged. */
export const GENERIC_FILE: FileIconSpec = { label: '·', colour: '#8A8A8A', name: 'File' };

/**
 * How to draw one file.
 *
 * The whole filename wins over the extension, because `package.json` means more to a reader than
 * "some JSON". Case never matters — README.md and readme.md are the same file to a person.
 */
export function fileIcon(fileName: string): FileIconSpec {
  const name = String(fileName || '').trim().toLowerCase();
  if (!name) return GENERIC_FILE;
  const whole = BY_NAME[name];
  if (whole) return whole;
  // ".env.local" and "vite.config.ts" both need the LAST dot segment, but a leading dot is part of
  // the name, not an extension — ".gitignore" must not be read as the extension "gitignore".
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return GENERIC_FILE;
  const ext = name.slice(dot + 1);
  return BY_EXT[ext] ?? GENERIC_FILE;
}

/** Is this a picture we could show rather than describe? */
export function isImageFile(fileName: string): boolean {
  const s = fileIcon(fileName);
  return s.name === 'Image' || s.name === 'SVG image' || s.name === 'Icon';
}

/**
 * The ink to write on a chip of this colour: white on dark chips, near-black on bright ones.
 *
 * The badge is drawn as a FILLED chip rather than as coloured text. Language colours are chosen for
 * dark editors — measured, twelve of ours fell below 3:1 on the light theme — so colouring the text
 * itself meant half the tree faded out in Paper. Knocking the label out of a solid chip keeps every
 * colour people recognise and moves the contrast problem to somewhere we fully control.
 */
export function labelInk(chipColour: string): string {
  const h = chipColour.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = (v: number) => { const t = v / 255; return t <= 0.03928 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4); };
  const lum = (x: number[]) => 0.2126 * lin(x[0]) + 0.7152 * lin(x[1]) + 0.0722 * lin(x[2]);
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
  };
  // MEASURE BOTH, take the better. A fixed luminance crossover picked white for three mid-tone
  // chips — Docker blue, git orange, the Vite purple — where black was in fact the readable choice.
  // Comparing the two ratios is exact and cannot be wrong at a boundary.
  return ratio(c, [255, 255, 255]) >= ratio(c, [20, 20, 26]) ? '#FFFFFF' : '#14141A';
}


/** Every distinct colour in use, so a check can confirm they are all legible. */
export function allIconColours(): string[] {
  const set = new Set<string>();
  for (const s of [...Object.values(BY_EXT), ...Object.values(BY_NAME), GENERIC_FILE]) set.add(s.colour);
  return [...set];
}
