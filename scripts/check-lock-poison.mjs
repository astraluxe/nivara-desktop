// ─── A panic must not be able to brick the app ───────────────────────────────
//
// `mutex.lock().unwrap()` panics for good once the mutex is poisoned, and a mutex is poisoned the
// moment any thread panics while holding it. One panic in one command then breaks every later call
// on that lock, for the rest of the session: the chat opens blank because the conversation cannot
// be read, and nothing is clickable because nothing that touches the database answers. Only a
// restart clears it.
//
// That is a permanent, app-wide failure caused by a single transient fault, and it is what the user
// hit: "it was blank and the exe hung there... nth was clickable after tht".
//
// `.lock().unwrap_or_else(|e| e.into_inner())` takes the guard anyway, which for a connection or a
// cache is right — a panic in our code does not corrupt them, and one bad operation should cost one
// operation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'src');
const offenders = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { walk(f); continue; }
    if (!e.name.endsWith('.rs')) continue;
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      // Comments explain the pattern by name — including the note on KrewDbConn, which quotes it
      // verbatim to say why it is wrong. Only real code counts.
      const code = line.replace(/\/\/.*$/, '');
      if (code.includes('.lock().unwrap()')) offenders.push(`${path.relative(root, f)}:${i + 1}`);
    });
  }
};
walk(root);

if (offenders.length) {
  console.error('\nA poisoned mutex would brick the app here:\n');
  for (const o of offenders) console.error('  ' + o);
  console.error('\n  Use .lock().unwrap_or_else(|e| e.into_inner()) — see the note on KrewDbConn.\n');
  process.exit(1);
}
console.log('mutex locks: none can be bricked by a single panic');
