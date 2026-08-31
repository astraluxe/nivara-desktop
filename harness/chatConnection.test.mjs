// ─── Does the title-bar menu actually reach the chat? ────────────────────────
//
// THE BUG THIS EXISTS FOR. The row of Local / Own Key / adris.tech pills at the top of Krew and
// Coder was removed in favour of one control in the title bar. Correct — they were a second switch
// on the same setting. But the pills were the only thing that ever wrote the chat's `mode`, so
// removing them removed the writer and left the reader: the menu reached the Claude Code / Codex
// branch (which reads the preference directly) and NOTHING else. Choosing "adris.tech", "your
// NVIDIA key" or "Local model" changed a label in the title bar while the chat carried on
// answering from whatever localStorage last held.
//
// Silent, shipped, and impossible to see from the outside — which is exactly the class of failure
// the roadmap's own rule names: a feature is not done when the module works, it is done when the
// thing the user chooses produces the thing they asked for.
//
// So the mapping is a pure function in its own file, and this drives every branch of it.

import { chatConnectionFor } from './chatConnection.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got : ${JSON.stringify(g)}\n        want: ${JSON.stringify(w)}`);

const avail = (o = {}) => ({
  byokProviders: o.byokProviders ?? [],
  localModels: o.localModels ?? [],
  signedIn: o.signedIn ?? true,
  clis: o.clis ?? [],
});
const LOCAL = [
  { name: 'Llama 3 8B', filename: 'llama3-8b.gguf', sizeGb: 4.7 },
  { name: 'Qwen 14B',   filename: 'qwen-14b.gguf',  sizeGb: 9.1 },
];

console.log('\n=== every choice in the menu reaches the chat ===');
{
  eq('adris.tech selects the hosted model',
    chatConnectionFor({ mode: 'nivara' }, avail({ byokProviders: ['nvidia'] })),
    { mode: 'nivara', bridge: false });

  eq('a key selects own-key on THAT provider',
    chatConnectionFor({ mode: 'own_key', provider: 'groq' }, avail({ byokProviders: ['nvidia', 'groq'] })),
    { mode: 'own_key', provider: 'groq', model: undefined, bridge: false });

  eq('a local model selects local, by filename',
    chatConnectionFor({ mode: 'local', localModel: 'qwen-14b.gguf' }, avail({ localModels: LOCAL })),
    { mode: 'local', localModel: 'qwen-14b.gguf', bridge: false });

  // The one branch that already worked, kept working. It maps to own_key because every use of
  // `mode` outside the model call itself is asking "does this spend the adris.tech allowance" —
  // and the answer for a subscription is no.
  const c = chatConnectionFor({ mode: 'agent_cli', cli: 'codex' }, avail({ clis: ['codex'] }));
  ok('the bridge is flagged as the bridge', c.bridge === true);
  ok('...and never as adris.tech, so it cannot spend the allowance', c.mode !== 'nivara');
}

console.log('\n=== an explicitly chosen model follows its own key, and only its own key ===');
{
  const pref = { mode: 'own_key', provider: 'nvidia', model: 'nvidia/llama-3.3-70b' };
  eq('the chosen model is carried',
    chatConnectionFor(pref, avail({ byokProviders: ['nvidia'] })).model,
    'nvidia/llama-3.3-70b');

  // The NVIDIA key is gone, so this falls back to Groq. Carrying an NVIDIA model id over would send
  // it to an endpoint that has never heard of it — the "nvapi model at groq → 404" shape.
  eq('a fallback to another key does NOT carry the first key\'s model',
    chatConnectionFor(pref, avail({ byokProviders: ['groq'] })),
    { mode: 'own_key', provider: 'groq', model: undefined, bridge: false });
}

console.log('\n=== a choice that cannot be honoured falls back, it does not break ===');
{
  // These carry a `fellBackFrom` marker now, so they are checked field by field rather than by
  // whole-object equality — the fallback itself is what they are about, and it still happens. The
  // marker exists because falling back SILENTLY is what let the title bar say "Your NVIDIA key"
  // while adris.tech answered; see the section at the end of this file.
  eq('own key with no key left → the hosted model, not a dead chat',
    chatConnectionFor({ mode: 'own_key', provider: 'nvidia' }, avail()),
    { mode: 'nivara', bridge: false, fellBackFrom: 'own_key' });

  eq('local with nothing downloaded → the hosted model',
    chatConnectionFor({ mode: 'local', localModel: 'gone.gguf' }, avail()),
    { mode: 'nivara', bridge: false, fellBackFrom: 'local' });

  eq('local with a model that was deleted → the one that IS there',
    chatConnectionFor({ mode: 'local', localModel: 'deleted.gguf' }, avail({ localModels: LOCAL })).localModel,
    'llama3-8b.gguf');

  // Availability needs Tauri and the network. Neither is a reason to leave the chat on a stale mode.
  eq('no availability at all is still answerable',
    chatConnectionFor({ mode: 'nivara' }, null),
    { mode: 'nivara', bridge: false });
}

console.log('\n=== "choose for me" means the same thing here as in resolveAiSource ===');
{
  eq('your own key comes first — it costs the user nothing extra',
    chatConnectionFor({ mode: 'auto' }, avail({ byokProviders: ['nvidia'], localModels: LOCAL })).mode,
    'own_key');

  eq('then adris.tech',
    chatConnectionFor({ mode: 'auto' }, avail({ signedIn: true, localModels: LOCAL })).mode,
    'nivara');

  eq('then whatever is on the machine',
    chatConnectionFor({ mode: 'auto' }, avail({ signedIn: false, localModels: LOCAL })).mode,
    'local');

  eq('and with nothing at all, the hosted model rather than a crash',
    chatConnectionFor({ mode: 'auto' }, avail({ signedIn: false })),
    { mode: 'nivara', bridge: false });
}


console.log('\n=== an explicit choice is not silently swapped ===');
{
  // The reported bug: the title bar said "Your NVIDIA key" and adris.tech was answering.
  //
  // `avail` is null whenever the availability probe FAILED — it needs Tauri and the network, and
  // the caller passes null on exactly that path. Treating that as "the key is gone" moved the user
  // onto the hosted model, spending their adris.tech allowance, in silence.
  const pref = { mode: 'own_key', provider: 'nvidia', model: 'llama-3.3-70b' };
  const blind = chatConnectionFor(pref, null);
  ok('a failed probe does not move them to adris.tech', blind.mode === 'own_key', blind.mode);
  ok('...and keeps the provider they chose', blind.provider === 'nvidia');
  ok('...and the model with it', blind.model === 'llama-3.3-70b');
  ok('...and does not claim a fallback happened', !blind.fellBackFrom);

  // A local model, same reasoning.
  const localBlind = chatConnectionFor({ mode: 'local', localModel: 'qwen.gguf' }, null);
  ok('a failed probe keeps the local model too', localBlind.mode === 'local', localBlind.mode);
  ok('...naming the one they picked', localBlind.localModel === 'qwen.gguf');

  // When we DID look and it is genuinely gone, falling back is right — but it must be admitted.
  const gone = chatConnectionFor(pref, { byokProviders: [], localModels: [], signedIn: true });
  ok('a key that is really gone falls back', gone.mode === 'nivara');
  ok('...and says which choice it could not honour', gone.fellBackFrom === 'own_key', String(gone.fellBackFrom));

  const localGone = chatConnectionFor({ mode: 'local', localModel: 'qwen.gguf' }, { byokProviders: [], localModels: [], signedIn: true });
  ok('a local model that is really gone falls back', localGone.mode === 'nivara');
  ok('...and says so', localGone.fellBackFrom === 'local');

  // The happy path must be untouched, and must never claim a fallback.
  const fine = chatConnectionFor(pref, { byokProviders: ['nvidia'], localModels: [], signedIn: true });
  ok('an available key is used as chosen', fine.mode === 'own_key' && fine.provider === 'nvidia');
  ok('...with no fallback marker', !fine.fellBackFrom);

  // Choosing adris.tech deliberately is not a fallback either.
  const hosted = chatConnectionFor({ mode: 'nivara' }, { byokProviders: ['nvidia'], localModels: [], signedIn: true });
  ok('choosing adris.tech is not a fallback', hosted.mode === 'nivara' && !hosted.fellBackFrom);

  // 'auto' means "choose for me", so resolving it to anything is never a fallback.
  const auto = chatConnectionFor({ mode: 'auto' }, { byokProviders: [], localModels: [], signedIn: true });
  ok('auto resolving to adris.tech is not a fallback', !auto.fellBackFrom);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
