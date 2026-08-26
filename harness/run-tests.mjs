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
];

let failed = 0;
for (const [name, src] of UNITS) {
  // Each test imports `./<name>.js`, so the bundle is written next to a copy of the test.
  execFileSync(esbuild, [path.join(root, src), '--bundle', '--format=esm', `--outfile=${path.join(tmp, name + '.js')}`],
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
  console.log('\n### Mailbox setup, in a real browser');
  try { execFileSync(process.execPath, [path.join(here, 'drive-smtp.mjs')], { stdio: 'inherit' }); }
  catch { failed++; }
}

console.log(failed ? `\n${failed} suite(s) FAILED` : '\nall suites passed');
process.exit(failed ? 1 : 0);
