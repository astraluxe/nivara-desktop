// ─── Every launch_application call must pass a real path ─────────────────────
//
// The Rust side is strict on purpose:
//
//     if !path.is_file() { return Err("… is not on this computer") }
//
// so a command NAME — 'winword', 'excel', 'powerpnt', 'notepad' — is always rejected. The rail
// shipped calling it with 'winword' inside a `catch {}`, which turned a hard error into a button
// that did nothing at all. The user found it before we did: "i clicked on word and nth happened".
//
// Two rules, both aimed at that failure and not at style:
//   1. No literal string as the `exe`. The path has to come from the machine scan.
//   2. No empty catch around the call. If a launch fails, the person who clicked must be told.
//
// Run: node scripts/check-app-launch.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const problems = [];

/** Every .ts/.tsx under src. */
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('launch_application')) continue;
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    const call = line.indexOf("'launch_application'");
    if (call === -1) return;
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const at = `src/${rel}:${i + 1}`;

    // RULE 1 — the exe must be an expression, never a quoted name. Anything in quotes is a guess
    // at a command name, and the launcher will reject it.
    const literal = line.match(/exe:\s*['"]([^'"]+)['"]/);
    if (literal) {
      problems.push(
        `${at}\n    exe: '${literal[1]}' is a literal — launch_application needs a real file path.\n` +
        `    Use officeApp(scan, …)!.path (or another scanned InstalledApp.path) instead.`,
      );
    }

    // RULE 2 — the failure must reach the user. An empty catch on the same or the next few lines
    // is the exact shape that hid this bug.
    const window = lines.slice(i, i + 6).join('\n');
    if (/catch\s*(\([^)]*\))?\s*\{\s*(\/\*[^]*?\*\/|\/\/[^\n]*)?\s*\}/.test(window)) {
      problems.push(
        `${at}\n    the launch is wrapped in an empty catch, so a failure is invisible.\n` +
        `    Show the error (a message, a note in the chat) — a dead button is worse than an error.`,
      );
    }
  });
}

if (problems.length) {
  console.error('\nlaunch_application is being called in a way that cannot work:\n');
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}
console.log('launch_application: every call passes a scanned path and reports its failures');
