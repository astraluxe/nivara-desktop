// THE TEST THAT WAS MISSING.
//
// The Office feature was verified as a module and as a PowerShell script, and shipped, and the user
// was still told "I cannot create or save files directly to your computer" -- because nothing ever
// exercised the path an agent actually takes: executeTool(name, args) -> officeCom -> the Rust
// command -> a file on disk.
//
// This drives that path for real. `invoke` is stubbed to do exactly what the Rust command does --
// spawn powershell with the script as one argument -- so everything above Rust is the shipped code.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Delete a file if the machine will let us.
 *
 * Word and PowerPoint hold a lock on a document they have open — which is exactly what this test
 * asked them to do — so unlink throws EBUSY and takes the whole run down with it, after every
 * assertion has already passed. Tidying up is not what is being tested, so it may not fail the test.
 */
function removeIfPossible(p) {
  try { fs.unlinkSync(p); return true; }
  catch (e) {
    if (e && (e.code === 'EBUSY' || e.code === 'EPERM')) {
      console.log('   note  ' + p.split(/[\\/]/).pop() + ' is still open in Office — left on disk');
      return false;
    }
    if (e && e.code === 'ENOENT') return true;
    throw e;
  }
}


const run = promisify(execFile);
const out = path.join(process.env.TEMP, 'adris-com-test');
fs.mkdirSync(out, { recursive: true });

// Stand in for the Tauri bridge with the real thing behind it.
globalThis.__invoke = async (cmd, payload) => {
  if (cmd === 'scan_installed_apps' || cmd === 'office_automation') {
    const { stdout } = await run('powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', payload.script],
      { maxBuffer: 64 << 20, timeout: 300000 });
    return stdout.trim();
  }
  throw new Error('unexpected command in this test: ' + cmd);
};

// Windows with Microsoft Office only. Elsewhere this skips loudly rather than failing — a Mac has
// no Word to drive, and a red suite that means "wrong operating system" trains people to ignore it.
if (process.platform !== 'win32') {
  console.log('  (skipped: Office automation is Windows-only)');
  process.exit(0);
}
try {
  const probe = await globalThis.__invoke('scan_installed_apps', {
    // String.raw, because "\W" and "\C" are not valid JS escapes: written as a normal string the
    // backslashes vanish, the registry path becomes nonsense, and the suite SKIPS on a machine that
    // has Word — a false pass, which is worse than a failure.
    script: String.raw`$c=(Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\Word.Application\CLSID' -ErrorAction SilentlyContinue).'(default)'; if($c){'yes'}else{'no'}`,
  });
  if (!/yes/.test(probe)) { console.log('  (skipped: Microsoft Word is not installed on this machine)'); process.exit(0); }
} catch { console.log('  (skipped: could not probe for Word)'); process.exit(0); }

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-dispatch-'));
const stub = path.join(tmpDir, 'stub.js');
fs.writeFileSync(stub, 'export const invoke=async(c,p)=>globalThis.__invoke(c,p);export const emit=async()=>{};'
  + 'export const listen=async()=>(()=>{});export const getCurrentWindow=()=>({});');
const bundle = path.join(tmpDir, 'kt.mjs');
execFileSync(path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild'),
  [path.join(root, 'src/lib/krewTools.ts'), '--bundle', '--format=esm', '--platform=node',
   '--outfile=' + bundle, '--log-level=error',
   '--alias:@tauri-apps/api/core=' + stub, '--alias:@tauri-apps/api/event=' + stub,
   '--alias:@tauri-apps/api/window=' + stub, '--alias:@tauri-apps/plugin-shell=' + stub,
   '--alias:@tauri-apps/plugin-dialog=' + stub],
  { stdio: 'pipe', shell: process.platform === 'win32' });

const { executeTool, BOSS_SYSTEM_TOOL_NAMES, SYSTEM_TOOLS } = await import(pathToFileURL(bundle).href);

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== the boss can see the tool at all ===');
ok('create_office_document is in the boss toolkit', BOSS_SYSTEM_TOOL_NAMES.includes('create_office_document'));
ok('list_installed_apps is too', BOSS_SYSTEM_TOOL_NAMES.includes('list_installed_apps'));
ok('and both are real tools', ['create_office_document', 'list_installed_apps']
  .every((n) => SYSTEM_TOOLS.some((t) => t.name === n)));

const call = (name, args) => executeTool(name, args, {}, async () => true, 'boss', '', 'test');

console.log('\n=== what is installed, through the tool ===');
{
  const r = await call('list_installed_apps', { query: 'word' });
  ok('Word is reported', /word/i.test(r), r.slice(0, 300));
  ok('and it says Office can be driven', /Can be driven directly/i.test(r), r.slice(0, 300));
}

console.log('\n=== the exact thing the user asked for ===');
{
  // A UNIQUE NAME EACH RUN. Word keeps a document it created OPEN — that is the feature — and it
  // then refuses to overwrite that file, so a second run failed on a lock left by the first and
  // reported it as a product bug. A test may not depend on the machine being tidy.
  const target = path.join(out, 'Acme Proposal ' + Date.now().toString(36) + '.docx');
  if (fs.existsSync(target)) removeIfPossible(target);
  const r = await call('create_office_document', {
    kind: 'word',
    save_path: target,
    blocks: [
      { style: 'title',   text: 'Proposal for Acme Manufacturing' },
      { style: 'heading', text: 'About adris.tech' },
      { style: 'body',    text: 'adris runs on your own computer and never stores your data.' },
      { style: 'bullet',  text: 'Agents drive the software you already own' },
      { style: 'bullet',  text: 'Your templates, your fonts, your branding' },
    ],
  });
  console.log('  tool returned:', r.slice(0, 160));
  ok('the file really exists on disk', fs.existsSync(target));
  ok('and it is a real .docx, not an empty stub', fs.existsSync(target) && fs.statSync(target).size > 8000);
  ok('the reply says which program made it', /Made in Microsoft Word/i.test(r), r);
  ok('and does not claim a template that was not used', !/your own template/i.test(r), r);
}

console.log('\n=== the args a model is likely to send ===');
{
  // Models hand arrays back as JSON strings about as often as arrays. Both must work, because the
  // user cannot see the difference and did not cause it.
  const target = path.join(out, 'json-args.xlsx');
  if (fs.existsSync(target)) removeIfPossible(target);
  const r = await call('create_office_document', {
    kind: 'excel',
    save_path: target,
    rows: JSON.stringify([['Company', 'Contact'], ['Acme', "O'Brien"]]),
  });
  ok('rows sent as a JSON string still work', fs.existsSync(target), r);
}

console.log('\n=== it refuses rather than lying ===');
{
  const r = await call('create_office_document', { kind: 'word', save_path: 'proposal.docx', blocks: [{ style: 'body', text: 'x' }] });
  ok('a relative path is refused', /NOT created/i.test(r), r);
  ok('...and the agent is told to say so', /do not tell the user it was saved/i.test(r), r);
  const b = await call('create_office_document', { kind: 'pdf', save_path: 'C:\\x\\a.pdf' });
  ok('an unsupported kind is refused', /kind must be/i.test(b), b);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
