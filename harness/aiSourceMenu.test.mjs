// ─── The title bar has to name what is actually running ──────────────────────
//
// The user, after an update: "the top option was an nvidia key but when i entered it showed codex
// tho the exe was running on nvidia key only".
//
// `getAiAvailability()` needs Tauri, a CLI probe and a session check, so `avail` is null for the
// first stretch after launch. With no key rows built yet, the pill's row lookup missed and fell
// through to whatever row happened to match loosely — the "Connect your own key" row for someone
// who had connected a key months ago, or a row of an entirely different kind. Measured before the
// fix: an NVIDIA preference rendered as **"Connect your own key"** on every launch.
//
// A control that misreports the engine is worse than no control: the whole point of one setting is
// that the user can trust what it says. And "Your NVIDIA key" answers whose key, not the question
// they actually have, which is what it is thinking with — so the model rides along.

import { buildChoices, pillFor, currentChoiceId } from './aiSourceMenu.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

const availWith = (o = {}) => ({ byokProviders: [], localModels: [], signedIn: true, clis: [], ...o });
const pill = (pref, avail) => pillFor(pref, avail, buildChoices(avail, pref));

console.log('\n=== while we have not finished looking ===');
{
  // `avail === null` means the probe has not answered — NOT that the key is gone.
  const nv = { mode: 'own_key', provider: 'nvidia', model: 'llama-3.3-70b-instruct' };
  const p = pill(nv, null);
  ok('an NVIDIA key is named as an NVIDIA key', p.label === 'Your NVIDIA key', p.label);
  ok('...and never as "connect a key" to someone who has one', !/connect/i.test(p.label), p.label);
  ok('...with the model beside it', p.detail === 'llama-3.3-70b-instruct', p.detail);

  const loc = pill({ mode: 'local', localModel: 'qwen2.5-7b-instruct.gguf' }, null);
  ok('a local model keeps its name', loc.label === 'Local model' && loc.detail === 'qwen2.5-7b-instruct', JSON.stringify(loc));
  ok('...without the file extension', !loc.detail.endsWith('.gguf'));

  const cx = pill({ mode: 'agent_cli', cli: 'codex' }, null);
  ok('the Codex bridge stays Codex', /codex/i.test(cx.label), cx.label);
  const cc = pill({ mode: 'agent_cli', cli: 'claude_code' }, null);
  ok('...and Claude Code stays Claude Code', /claude/i.test(cc.label), cc.label);
  ok('a bridge is never mislabelled as the other one', !/codex/i.test(cc.label), cc.label);

  // The hosted adris.tech plan is retired (Oct 2026). A stored 'nivara' must never be presented
  // as if a hosted model were running — it means nothing is connected.
  ok('a stored adris.tech choice reads "Connect an AI", never adris.tech',
    pill({ mode: 'nivara' }, null).label === 'Connect an AI', pill({ mode: 'nivara' }, null).label);
}

console.log('\n=== once we have looked ===');
{
  const nv = { mode: 'own_key', provider: 'nvidia', model: 'llama-3.3-70b-instruct' };
  const there = pill(nv, availWith({ byokProviders: ['nvidia'] }));
  ok('a key that is present is named', there.label === 'Your NVIDIA key', there.label);
  ok('...with its model', there.detail === 'llama-3.3-70b-instruct', there.detail);

  // Genuinely gone is a different thing from not-yet-known, and here the fallback IS the truth.
  const gone = pill(nv, availWith({ byokProviders: [] }));
  ok('a key that is really gone says so', /connect/i.test(gone.label), gone.label);
  ok('...and claims no model', gone.detail === '', gone.detail);
}

console.log('\n=== the pill never lies about the kind of source ===');
{
  // The report was an NVIDIA key showing as Codex. Whatever the availability, a preference of one
  // kind must never render as a different kind.
  const cases = [
    [{ mode: 'own_key', provider: 'groq', model: 'llama-3.3-70b' }, /groq/i],
    [{ mode: 'own_key', provider: 'gemini', model: 'gemini-3-flash' }, /gemini/i],
    [{ mode: 'agent_cli', cli: 'codex' }, /codex/i],
    [{ mode: 'nivara' }, /^(connect an ai|choose for me)$/i],
  ];
  for (const [pref, want] of cases) {
    for (const avail of [null, availWith({ byokProviders: [pref.provider].filter(Boolean), clis: [pref.cli].filter(Boolean) })]) {
      const p = pill(pref, avail);
      ok(`${pref.mode}${pref.provider ? '/' + pref.provider : ''}${pref.cli ? '/' + pref.cli : ''} (avail ${avail ? 'known' : 'unknown'}) reads right`,
        want.test(p.label), p.label);
    }
  }
}

console.log('\n=== the retired hosted plan is never offered ===');
{
  for (const avail of [null, availWith(), availWith({ byokProviders: ['nvidia'], clis: ['codex'] })]) {
    const choices = buildChoices(avail, { mode: 'auto' });
    ok(`no menu row selects the hosted plan (avail ${avail ? 'known' : 'unknown'})`, !choices.some((c) => c.mode === 'nivara'),
      choices.map((c) => c.id).join(','));
    ok('...and no row is labelled adris.tech', !choices.some((c) => /adris\.tech/i.test(c.label)),
      choices.map((c) => c.label).join(','));
    ok('...and none offers a hosted / pay-per-use model', !choices.some((c) => /hosted|pay per use/i.test(c.blurb + ' ' + (c.cost ?? ''))),
      choices.map((c) => c.blurb).join(' | '));
  }
}

console.log('\n=== nothing here throws on a half-written preference ===');
{
  for (const pref of [{}, { mode: 'own_key' }, { mode: 'local' }, { mode: 'agent_cli' }, { mode: 'auto' }]) {
    const p = pill(pref, null);
    ok(`${JSON.stringify(pref)} still produces a label`, typeof p.label === 'string' && p.label.length > 0, JSON.stringify(p));
  }
}

console.log('\n=== the highlighted row still tracks the choice ===');
{
  // pillFor answers "what is running"; currentChoiceId answers "what did you pick". They are
  // allowed to differ while loading, but the second must keep working exactly as it did.
  const nv = { mode: 'own_key', provider: 'nvidia' };
  const cs = buildChoices(availWith({ byokProviders: ['nvidia'] }), nv);
  ok('the NVIDIA row is the selected one', currentChoiceId(nv, cs) === 'key:nvidia', currentChoiceId(nv, cs));
  ok('an unknown preference still resolves to something', typeof currentChoiceId({ mode: 'auto' }, cs) === 'string');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
