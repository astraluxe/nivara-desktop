// ─── The file tree has to be scannable ───────────────────────────────────────
//
// Every file drew the same grey dot, so the tree could only be read, never scanned. These check the
// mapping is right and — more importantly — that every badge is legible on both themes, because a
// colour picked to look like the language is worth nothing if it disappears on the background.

import { fileIcon, isImageFile, allIconColours, labelInk, GENERIC_FILE } from './fileIcons.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== the languages in this repo ===');
{
  ok('a .ts file', fileIcon('KrewChat.ts').label === 'TS');
  ok('a .tsx file', fileIcon('KrewChat.tsx').label === 'TS');
  ok('a .rs file', fileIcon('lib.rs').label === 'RS');
  ok('a .mjs harness file', fileIcon('run-tests.mjs').label === 'JS');
  ok('a stylesheet', fileIcon('index.css').label === '#');
  ok('a web page', fileIcon('pricing.html').label === '<>');
  ok('a markdown doc', fileIcon('ROADMAP.md').label === 'MD');
  ok('a python script', fileIcon('main.py').label === 'PY');
  ok('a PowerShell script', fileIcon('build-signed.ps1').name === 'PowerShell');
}

console.log('\n=== the whole name beats the extension ===');
{
  // "package.json" says far more to a reader than "some JSON".
  ok('package.json is npm, not plain JSON', fileIcon('package.json').label === 'NPM');
  ok('...and its lock file is a lock', fileIcon('package-lock.json').name === 'npm lock file');
  ok('Cargo.toml is Rust, not plain TOML', fileIcon('Cargo.toml').label === 'RS');
  ok('tsconfig.json is TypeScript', fileIcon('tsconfig.json').label === 'TS');
  ok('a readme is a readme', fileIcon('README.md').label === 'RM');
  ok('case never matters', fileIcon('PACKAGE.JSON').label === 'NPM');
}

console.log('\n=== the awkward names ===');
{
  // A leading dot is part of the name, not an extension: ".gitignore" is not "gitignore files".
  ok('.gitignore is recognised', fileIcon('.gitignore').label === 'GIT');
  ok('.env is recognised', fileIcon('.env').name === 'Environment file');
  ok('a dotfile with no rule is generic', fileIcon('.mysteryrc').label === GENERIC_FILE.label);
  ok('a multi-dot name uses the LAST part', fileIcon('vite.visual.config.ts').label === 'TS');
  ok('no extension at all', fileIcon('Makefile').label === GENERIC_FILE.label);
  ok('an empty name', fileIcon('').label === GENERIC_FILE.label);
  ok('an unknown extension', fileIcon('notes.xyz').label === GENERIC_FILE.label);
}

console.log('\n=== the documents a business actually opens ===');
{
  ok('a Word document', fileIcon('brief.docx').name === 'Word document');
  ok('a spreadsheet', fileIcon('leads.xlsx').name === 'Excel spreadsheet');
  ok('a presentation', fileIcon('deck.pptx').name === 'PowerPoint');
  ok('a PDF', fileIcon('invoice.pdf').label === 'PD');
  ok('an image is an image', isImageFile('figure1.png'));
  ok('an svg counts too', isImageFile('logo.svg'));
  ok('a .ts file is not an image', !isImageFile('main.ts'));
}

console.log('\n=== every badge is legible, on both themes ===');
{
  // The badge is a FILLED chip with the label knocked out of it, which is how editors draw these.
  // So the contrast that matters is label-against-chip — fully under our control — plus a check
  // that the chip itself does not merge into the background it sits on.
  const INK = [18, 18, 24], PAPER = [245, 245, 249];
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  const unreadable = [], invisible = [];
  for (const hex of allIconColours()) {
    const ink = labelInk(hex);
    if (ratio(rgb(hex), rgb(ink)) < 4.5) unreadable.push(`${hex} label ${ink} = ${ratio(rgb(hex), rgb(ink)).toFixed(2)}`);
    // A chip must stand off both backgrounds enough to be seen as a chip.
    const onInk = ratio(rgb(hex), INK), onPaper = ratio(rgb(hex), PAPER);
    if (onInk < 1.35 || onPaper < 1.35) invisible.push(`${hex} (ink ${onInk.toFixed(2)}, paper ${onPaper.toFixed(2)})`);
  }
  ok(`all ${allIconColours().length} labels are readable on their chip`, unreadable.length === 0, unreadable.join('\n        '));
  ok('every chip stands off both backgrounds', invisible.length === 0, invisible.join('\n        '));
  ok('a dark chip takes white ink', labelInk('#3178C6') === '#FFFFFF');
  ok('a bright chip takes dark ink', labelInk('#E8C33C') === '#14141A');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
