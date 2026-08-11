// EVERY DECLARED TOOL MUST BE EXECUTABLE.
// A tool in the schema with no branch in executeTool is worse than a missing tool: the model is
// told it exists, calls it, and the turn dies on a silent fall-through.
import fs from 'fs';
// Repo-relative so it runs anywhere: node scripts/check-tool-coverage.mjs
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const src = fs.readFileSync(root + 'src/lib/krewTools.ts', 'utf8');

const declared = [...src.matchAll(/^\s*name: '([a-z_0-9]+)',/gm)].map(m => m[1]);
const handled = new Set([...src.matchAll(/toolName === '([a-z_0-9]+)'/g)].map(m => m[1]));
// Connected-app tools go through one generic HTTP path keyed off SERVICE_TOOLS.
const serviceBlocks = [...src.matchAll(/SERVICE_TOOLS[\s\S]{0,80}?\{([\s\S]*?)\n\};/g)].map(m => m[1]).join('\n');
const generic = new Set([...serviceBlocks.matchAll(/name: '([a-z_0-9]+)'/g)].map(m => m[1]));
const mcpish = (n) => /^mcp__/.test(n);
// Intercepted by the agent loop in KrewChat rather than executeTool — delegating and running a
// pipeline ARE the loop, and council_review opens the council card. Verified present there.
const chatSrc = fs.readFileSync(root + 'src/components/krew/KrewChat.tsx', 'utf8');
const inLoop = (n) => new RegExp(`'${n}'`).test(chatSrc);

let pass = 0, fail = 0;
const missing = [];
for (const t of [...new Set(declared)]) {
  if (handled.has(t) || generic.has(t) || mcpish(t) || inLoop(t)) pass++;
  else { missing.push(t); fail++; }
}
console.log(`  declared tools : ${new Set(declared).size}`);
console.log(`  with a handler : ${pass}`);
console.log(`  UNHANDLED      : ${fail}`);
if (missing.length) console.log('    ' + missing.join('\n    '));

// Every slash command must map to a real run-mode.
const chat = fs.readFileSync(root + 'src/components/krew/KrewChat.tsx', 'utf8');
const cmds = [...chat.matchAll(/\{ cmd: '([a-z-]+)',[^\n]*?run: '([a-zA-Z]+)'/g)].map(m => ({ c: m[1], r: m[2] }));
const runs = new Set([...chat.matchAll(/c\.run === '([a-zA-Z]+)'/g)].map(m => m[1]));
  runs.add('toggleSetting');
runs.add('prompt'); runs.add('nav');
const badCmds = cmds.filter(x => !runs.has(x.r));
console.log(`\n  slash commands : ${cmds.length}`);
console.log(`  bad run-mode   : ${badCmds.length}${badCmds.length ? ' -> ' + badCmds.map(x=>'/'+x.c+' ('+x.r+')').join(', ') : ''}`);

// Every command the Info page documents must exist.
const info = fs.readFileSync(root + 'src/modules/InfoModule.tsx', 'utf8');
const documented = [...new Set([...info.matchAll(/<K>\/([a-z-]+)<\/K>/g)].map(m => m[1]))];
const have = new Set(cmds.map(x => x.c));
const undocumentedReal = documented.filter(d => !have.has(d));
console.log(`\n  commands documented in the Info page : ${documented.length}`);
console.log(`  documented but NOT registered        : ${undocumentedReal.length}${undocumentedReal.length ? ' -> ' + undocumentedReal.map(d=>'/'+d).join(', ') : ''}`);

const bad = fail + badCmds.length + undocumentedReal.length;
console.log(`\n${bad === 0 ? 'ALL CLEAR' : bad + ' PROBLEMS'}`);
process.exit(bad ? 1 : 0);
