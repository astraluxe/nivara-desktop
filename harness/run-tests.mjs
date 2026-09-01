// ─── The checks that have to pass before this stuff ships ─────────────────────
//
// Two kinds, because the bugs they catch are two kinds.
//
//   1. PURE LOGIC, in node. Which contacts a bulk email edit is allowed to touch; how a model's
//      rewrite is read back into a subject and a body; where a compose link points; what a tool
//      loop keeps when it trims its own history. None of these need a model, a key, a browser or
//      a campaign — and every one of them is somewhere a mistake is silent and expensive (forty
//      drafts rewritten, a subject line blanked, an email opened in the wrong mailbox, the user's
//      actual request dropped out of the agent's context).
//
//   2. THE PANEL ITSELF, in a real Chrome. The logic being right does not mean the button is
//      wired to it. `drive.mjs` mounts the real OutreachCopilot with a fake model and clicks
//      through it: type in the draft, rewrite it, undo, push the change to the others, check the
//      already-sent contact was spared, switch mail provider, watch where Compose actually goes.
//
// Run:  node harness/run-tests.mjs          (builds the harness first if needed)
//       node harness/run-tests.mjs --unit   (skip the browser half)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const tmp = path.join(root, 'node_modules', '.cache', 'nv-harness');
fs.mkdirSync(tmp, { recursive: true });

const win = process.platform === 'win32';
const esbuild = path.join(root, 'node_modules', '.bin', win ? 'esbuild.cmd' : 'esbuild');
const vite = path.join(root, 'node_modules', '.bin', win ? 'vite.cmd' : 'vite');
// A .cmd shim cannot be spawned directly on Windows (EINVAL) — it needs a shell to interpret it.
const binOpts = (extra) => ({ shell: win, ...extra });

const UNITS = [
  ['runHistory',    'src/lib/runHistory.ts'],
  ['mailProviders', 'src/lib/mailProviders.ts'],
  ['emailDraft',    'src/lib/emailDraft.ts'],
  ['outreachSender','src/lib/outreachSender.ts'],
  ['agentBrain',    'src/lib/agentBrain.ts'],
  ['installedApps', 'src/lib/installedApps.ts'],
  ['officeCom',     'src/lib/officeCom.ts'],
  ['agentCli',      'src/lib/agentCli.ts'],
  ['agentSchedule', 'src/lib/agentSchedule.ts'],
  ['chatConnection','src/lib/chatConnection.ts'],
  ['agentCliSetup', 'src/lib/agentCli.ts'],
  ['krewTips',      'src/lib/krewTips.ts'],
  ['agentActivity', 'src/lib/agentActivity.ts'],
  ['gitStatus',     'src/lib/gitStatus.ts'],
  ['toolShelf',     'src/lib/toolShelf.ts'],
  ['usageMeter',    'src/lib/usageMeter.ts'],
  ['deckRouting',   'src/lib/deckRouting.ts'],
  ['docImages',     'src/lib/docImages.ts'],
  ['officeDocs',    'src/lib/officeDocs.ts'],
  ['markdownPaste', 'src/lib/markdownPaste.ts'],
  ['refusalGuard',  'src/lib/refusalGuard.ts'],
  ['quickReplies',  'src/lib/quickReplies.ts'],
  ['pictureSave',   'src/lib/pictureSave.ts'],
  ['fileIcons',     'src/lib/fileIcons.ts'],
  ['entitlement',   'src/lib/entitlement.ts'],
  ['designedDeck',  'src/lib/designedDeck.ts'],
  ['runWrapUp',     'src/lib/runWrapUp.ts'],
  ['planConfig',    'src/lib/planConfig.ts'],
  ['urlFidelity',   'src/lib/urlFidelity.ts'],
  ['pptxPolish',    'src/lib/pptxPolish.ts'],
  ['deck',          'src/lib/deck.ts'],
  ['deckEnding',    'src/lib/deckEnding.ts'],
  ['choiceReply',   'src/lib/choiceReply.ts'],
  ['inlineFigures', 'src/lib/inlineFigures.ts'],
  ['studyBrief',    'src/lib/studyBrief.ts'],
  ['modelFallback', 'src/lib/modelFallback.ts'],
  ['aiSourceMenu',  'src/components/AiSourceMenu.tsx'],
];

let failed = 0;
for (const [name, src] of UNITS) {
  // Each test imports `./<name>.js`, so the bundle is written next to a copy of the test.
  // The env define lets a .tsx COMPONENT be bundled and its pure exports tested in node. Without
  // it anything that reaches supabase.ts dies on `import.meta.env` at import time, which put every
  // decision living inside a component permanently out of reach of a unit test — including the one
  // that decides what the title bar says it is running on.
  execFileSync(esbuild, [path.join(root, src), '--bundle', '--format=esm',
    '--jsx=automatic',
    '--define:import.meta.env=__NV_ENV__', `--inject:${path.join(here, 'env-shim.js')}`,
    `--outfile=${path.join(tmp, name + '.js')}`],
    binOpts({ stdio: 'ignore' }));
  fs.copyFileSync(path.join(here, `${name}.test.mjs`), path.join(tmp, `${name}.test.mjs`));
  console.log(`\n### ${name}`);
  try { execFileSync(process.execPath, [path.join(tmp, `${name}.test.mjs`)], { stdio: 'inherit' }); }
  catch { failed++; }
}

if (!process.argv.includes('--unit')) {
  const built = path.join(root, 'dist-harness', 'harness.html');
  if (!fs.existsSync(built) || process.argv.includes('--rebuild')) {
    console.log('\n### building the harness page');
    execFileSync(vite, ['build', '--config', 'vite.harness.config.ts', '--outDir', 'dist-harness'],
      binOpts({ cwd: root, stdio: 'ignore' }));
  }
  // Real Microsoft Office, on a real machine. This suite exists because the Office feature was
  // verified as a module and as a script, shipped, and STILL told the user "I cannot create or save
  // files" — nothing had ever exercised executeTool(name, args) → a file on disk. It skips cleanly
  // off Windows or without Office.
  // A picture INSIDE a real .docx, and the encoding around it. A study guide built from four
  // lecture decks came back carrying none of their diagrams — Word had no way to hold one, because
  // a block was a style and a string. Also pins ₹ and the em dash, which is where a wrong
  // PowerShell invocation quietly turns money into mojibake.
  console.log('\n### A figure inside a real Word document');
  try { execFileSync(process.execPath, [path.join(here, 'word-figure.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  console.log('\n### Making a real document, through the agent tool');
  try { execFileSync(process.execPath, [path.join(here, 'officeDispatch.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  console.log('\n### OutreachCopilot, in a real browser');
  try { execFileSync(process.execPath, [path.join(here, 'drive.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  // The send run gets its own pass: it is the only feature in the app that does something to a
  // real stranger, so its failure paths — a refused SMTP login, an unconfirmed delivery, a Stop
  // mid-run — are driven explicitly rather than hoped about.
  console.log('\n### Automatic sending, in a real browser');
  try { execFileSync(process.execPath, [path.join(here, 'drive-send.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  // Setting the mailbox up is the step a non-technical person actually has to do, so it gets its
  // own pass — including the mistake the first real user made.
  console.log('\n### Pasting Markdown into a real Brain note');
  try { execFileSync(process.execPath, [path.join(here, 'brain-paste.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  console.log('\n### A real .docx, read by the shipped code');
  try { execFileSync(process.execPath, [path.join(here, 'docx-real.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  console.log('\n### Mailbox setup, in a real browser');
  try { execFileSync(process.execPath, [path.join(here, 'drive-smtp.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  // Two buttons that looked alive and did nothing. Both were found by the user, not by us, so both
  // are now driven against the shipped components rather than argued about.
  console.log('\n### The rail opens the user\'s own Word, Excel and PowerPoint');
  try { execFileSync(process.execPath, [path.join(here, 'rail-office.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  console.log('\n### The deck asks where it should go');
  try { execFileSync(process.execPath, [path.join(here, 'deck-destination.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  console.log('\n### A real .pptx, opened and searched for the pictures');
  try { execFileSync(process.execPath, [path.join(here, 'deck-images.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  console.log('\n### Coder reads as a code editor');
  try { execFileSync(process.execPath, [path.join(here, 'coder-shell.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

  console.log('\n### A real .pptx, opened in the real PowerPoint');
  try { execFileSync(process.execPath, [path.join(here, 'powerpoint-real.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }

}

console.log(failed ? `\n${failed} suite(s) FAILED` : '\nall suites passed');
process.exit(failed ? 1 : 0);
