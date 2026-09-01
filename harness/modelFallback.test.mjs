// ─── An empty answer should cost a retry, not the user's evening ─────────────
//
// Four lecture decks attached, revision notes asked for, and the model returned nothing. The app
// told the user so and stopped. They switched to a larger model by hand and it worked first time.
//
// Their instruction: "change the model for nvidia if on one high model and some other model does
// respond then change to tht one... but to a high model or higher b parameter model".
//
// The parameter count has to be read off the model id, because that is the only signal available
// without another network call. The trap is everything in an id that LOOKS like a size and is not —
// the "3.3" in llama-3.3, the "4" in gpt-4, a date, a version — and reading one of those as a size
// would rank a small model above a large one and pick the wrong retry.

import { paramsOf, nextModel, switchNote } from './modelFallback.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== reading the size off the name ===');
{
  ok('llama-3.3-70b-instruct is 70', paramsOf('llama-3.3-70b-instruct') === 70, String(paramsOf('llama-3.3-70b-instruct')));
  ok('qwen3-235b-a22b is 235', paramsOf('qwen3-235b-a22b') === 235, String(paramsOf('qwen3-235b-a22b')));
  ok('llama-3.1-8b-instant is 8', paramsOf('llama-3.1-8b-instant') === 8);
  ok('a 1.5b model is 1.5', paramsOf('qwen2.5-1.5b') === 1.5, String(paramsOf('qwen2.5-1.5b')));

  // Mixture-of-experts: the product is the honest total. Reading 8x7b as 7 would rank it below a
  // plain 8b, which is backwards.
  ok('mixtral-8x7b is 56', paramsOf('mixtral-8x7b-32768') === 56, String(paramsOf('mixtral-8x7b-32768')));
  ok('8x22b is 176', paramsOf('mixtral-8x22b') === 176, String(paramsOf('mixtral-8x22b')));

  // Everything in an id that looks like a size and is not.
  ok('the 4 in gpt-4 is not a size', paramsOf('gpt-4') === null, String(paramsOf('gpt-4')));
  ok('the 3.3 in llama-3.3 alone is not a size', paramsOf('llama-3.3-instruct') === null, String(paramsOf('llama-3.3-instruct')));
  ok('kimi-k2 says nothing', paramsOf('kimi-k2') === null, String(paramsOf('kimi-k2')));
  ok('a date is not a size', paramsOf('claude-3-5-sonnet-20241022') === null, String(paramsOf('claude-3-5-sonnet-20241022')));
  ok('an empty id is null', paramsOf('') === null);
  ok('rubbish is null', paramsOf(undefined) === null);
}

console.log('\n=== picking the retry ===');
{
  // The user's own key, as modelHealth would have measured it — rankScan order.
  const opts = [
    { id: 'llama-3.3-70b-instruct', window: 128000 },
    { id: 'llama-3.1-8b-instant', window: 128000 },
    { id: 'qwen3-235b-a22b', window: 262144 },
    { id: 'mixtral-8x7b-32768', window: 32768 },
  ];
  const p = nextModel('llama-3.3-70b-instruct', opts);
  ok('it reaches for the biggest thing available', p.id === 'qwen3-235b-a22b', p.id);
  ok('...and says it is bigger', p.bigger === true);

  // From the smallest, it must not pick something even smaller.
  const q = nextModel('llama-3.1-8b-instant', opts);
  ok('from a small model it goes up, not down', q.id === 'qwen3-235b-a22b', q.id);

  // Already tried the big one: take the next largest rather than looping.
  const r = nextModel('llama-3.3-70b-instruct', opts, ['qwen3-235b-a22b']);
  ok('a model already tried is not offered again', r.id !== 'qwen3-235b-a22b', r.id);
  ok('...and the next largest is taken', r.id === 'mixtral-8x7b-32768', r.id);

  ok('nothing left returns null', nextModel('a', [{ id: 'a' }]) === null);
  ok('an empty list returns null', nextModel('a', []) === null);
  ok('everything tried returns null',
    nextModel('a', [{ id: 'a' }, { id: 'b' }], ['b']) === null);
  ok('case does not let a model repeat itself',
    nextModel('Llama-3.3-70B', [{ id: 'llama-3.3-70b' }]) === null);
}

console.log('\n=== when no id says a size ===');
{
  // Nothing to compare by name, so a much roomier context is the same argument by another measure.
  const opts = [
    { id: 'kimi-k2', window: 32000 },
    { id: 'kimi-k3', window: 200000 },
  ];
  const p = nextModel('kimi-k2', opts);
  ok('the roomier one is taken', p.id === 'kimi-k3', p.id);
  ok('...and counts as bigger', p.bigger === true);

  // Same size, same window: still worth one try, but do not claim it is an upgrade.
  const same = nextModel('model-a', [{ id: 'model-a', window: 8000 }, { id: 'model-b', window: 8000 }]);
  ok('a sideways move is still offered', same.id === 'model-b');
  ok('...but is not called bigger', same.bigger === false);
}

console.log('\n=== what the user is told ===');
{
  const n = switchNote('llama-3.3-70b-instruct', 'qwen3-235b-a22b', true);
  ok('it names both models', n.includes('llama-3.3-70b-instruct') && n.includes('qwen3-235b-a22b'));
  ok('it says why', /larger/i.test(n));
  ok('it makes clear nothing extra was charged', /adris\.tech/i.test(n));
  ok('a sideways move does not claim to be an upgrade',
    !/larger/i.test(switchNote('a', 'b', false)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
