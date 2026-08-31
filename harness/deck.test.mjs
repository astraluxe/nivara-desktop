// ─── Deciding the deck's length so the user does not have to ─────────────────
//
// The setup card made everyone pick a number between 4 and 24 before anything was built. Someone
// handing over a document has no idea whether it is a nine-slide document or a twenty-slide one —
// that is the thing they came here to be told. "Auto" is the answer to that, and this is what it
// answers with.
//
// Also here: parseDeckSpec's salvage path, because it is the reason a deck the chat announced as
// 31 slides could arrive as 29. It drops slides it cannot parse, which is right — but it must drop
// only the broken ones, and never quietly lose a good deck.

import { autoSlideCount, parseDeckSpec } from './deck.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== how long should this deck be ===');
{
  // Nothing attached: only the user's sentence to go on.
  ok('a bare request gets an ordinary deck', autoSlideCount(0) === 10, `${autoSlideCount(0)}`);
  ok('a one-line request too', autoSlideCount(120) === 10);

  // More source material, more slides.
  const small = autoSlideCount(3_000), big = autoSlideCount(20_000);
  ok('a longer document gets more slides', big > small, `${small} then ${big}`);
  ok('a short document is not padded out', small <= 12, `${small}`);

  // Never outside what the rest of the pipeline can build.
  ok('never fewer than six', autoSlideCount(500) >= 6, `${autoSlideCount(500)}`);
  ok('never more than thirty', autoSlideCount(5_000_000) === 30, `${autoSlideCount(5_000_000)}`);
  ok('a whole book is still thirty, not four hundred', autoSlideCount(400_000) === 30);

  // Density changes how much goes on each slide, so it changes how many are needed.
  const light = autoSlideCount(12_000, 'light');
  const balanced = autoSlideCount(12_000, 'balanced');
  const detailed = autoSlideCount(12_000, 'detailed');
  ok('light packs less per slide, so needs more of them', light > balanced, `${light} vs ${balanced}`);
  ok('detailed packs more per slide, so needs fewer', detailed < balanced, `${detailed} vs ${balanced}`);

  // Rubbish in must not produce rubbish out — this feeds a slide-count loop.
  ok('a negative is not a negative deck', autoSlideCount(-500) === 10);
  ok('NaN does not become NaN slides', Number.isFinite(autoSlideCount(NaN)) && autoSlideCount(NaN) === 10);
  ok('undefined is handled', autoSlideCount(undefined) === 10);
}

console.log('\n=== the parser must not silently lose good slides ===');
{
  const three = JSON.stringify({ title: 'T', slides: [
    { layout: 'title', title: 'A' }, { layout: 'bullets', title: 'B', bullets: ['x'] }, { layout: 'closing', title: 'C' }] });
  ok('a clean spec keeps every slide', parseDeckSpec(three).slides.length === 3);
  ok('inside a json fence too', parseDeckSpec('```json\n' + three + '\n```').slides.length === 3);
  ok('with prose around it', parseDeckSpec('Here you go:\n' + three + '\nHope that helps').slides.length === 3);

  // A reasoning model's scratchpad has braces in it and used to swallow the deck.
  ok('a <think> block does not eat the deck',
    parseDeckSpec('<think>I will write {"layout":"x"} first</think>' + three).slides.length === 3);

  // Truncation mid-array: every COMPLETE slide must come back, not nothing. Cut in the middle of
  // the third slide, so two are whole and one is wreckage.
  const cut = three.slice(0, three.indexOf('{"layout":"closing"') + 12);
  const salvaged = parseDeckSpec(cut);
  ok('a stream cut mid-slide still yields the whole ones', salvaged && salvaged.slides.length === 2,
    salvaged ? `${salvaged.slides.length}` : 'null');
  ok('...and the wreckage is not passed off as a slide',
    salvaged && salvaged.slides.every((sl) => sl.title));

  ok('genuine rubbish returns null rather than an empty deck', parseDeckSpec('no json at all here') === null);
  ok('an empty string is null', parseDeckSpec('') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
