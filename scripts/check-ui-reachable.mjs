// EVERY PROVIDER MUST BE SELECTABLE, NOT MERELY DEFINED.
//
// Written after OmniRoute was added to the registry, given a one-button installer and a help panel,
// and still could not be chosen — because the dropdown is built from PROVIDER_ORDER, a separate
// list, and nobody had added it there. The same gap had been hiding NVIDIA for longer: the free-key
// box said "Pick NVIDIA (free) in Provider above" and it was not in the list at all.
//
// A provider missing from that array does not exist as far as the user is concerned, however
// completely it is wired underneath — and nothing fails, which is what makes it worth a check.
//
//   node scripts/check-ui-reachable.mjs
import fs from 'fs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ai = fs.readFileSync(root + 'src/lib/ai.ts', 'utf8');
const bar = fs.readFileSync(root + 'src/components/coder/ConnectionBar.tsx', 'utf8');

// Providers the app defines.
const block = ai.slice(ai.indexOf('export const PROVIDERS'));
const defined = [...block.slice(0, block.indexOf('\n};')).matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map(m => m[1]);

// Providers the user can actually pick.
const orderSrc = bar.slice(bar.indexOf('const PROVIDER_ORDER'));
const order = [...orderSrc.slice(0, orderSrc.indexOf('];')).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

const unreachable = defined.filter(p => !order.includes(p));
const phantom = order.filter(p => !defined.includes(p));

console.log(`  providers defined   : ${defined.length}  (${defined.join(', ')})`);
console.log(`  selectable in the UI: ${order.length}`);
if (unreachable.length) console.log(`  DEFINED BUT UNREACHABLE: ${unreachable.join(', ')}`);
if (phantom.length)     console.log(`  IN THE MENU BUT UNDEFINED: ${phantom.join(', ')}`);

// The Rust side must know any provider that carries its own endpoint, or the request silently
// falls through to the OpenAI default — which is how an OmniRoute key ended up being sent to
// OpenAI and coming back as "invalid API key".
const rs = fs.readFileSync(root + 'src-tauri/src/lib.rs', 'utf8');
const userSupplied = ['omniroute', 'custom'];
const unguarded = userSupplied.filter(p => !rs.includes(`"${p}"`));
if (unguarded.length) console.log(`  NOT HANDLED IN RUST: ${unguarded.join(', ')}`);

// A PROVIDER YOU SET UP MUST SURVIVE BEING CHOSEN.
//
// The chat corrects the provider when the selected one has no key behind it — sensible, until the
// user picks a gateway they are about to install. omniroute and custom have no key until the setup
// is finished, so that rule fired in the gap and snapped them back to NVIDIA. Pressing OmniRoute
// appeared to open the NVIDIA panel: by the time it rendered, the provider had already changed
// underneath it. Nothing errored, which is what made it hard to see.
const chat = fs.readFileSync(root + 'src/components/krew/KrewChat.tsx', 'utf8');
const correctLine = chat.split(String.fromCharCode(10)).find((l) => /setProvider\(svc as Provider\)/.test(l)) ?? '';
const exempted = /userIsSettingUp|omniroute/.test(correctLine);
if (!exempted) {
  console.log('  PROVIDER AUTO-CORRECT HAS NO EXEMPTION: omniroute/custom will snap back before setup finishes');
}

const bad = unreachable.length + phantom.length + unguarded.length + (exempted ? 0 : 1);
console.log(`\n${bad === 0 ? 'ALL PROVIDERS REACHABLE' : bad + ' PROBLEMS'}`);
process.exit(bad ? 1 : 0);
