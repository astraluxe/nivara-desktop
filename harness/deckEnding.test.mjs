// ─── A deck that ends, rather than stops ─────────────────────────────────────
//
// The user, twice: "it never gives the ppt a proper ending... and i still feel the ppt wasnt
// completed". On a long deck the model is still writing content when it runs out of output budget,
// so the last thing it emits is whatever slide it was on. A prompt cannot fix that — the failure is
// the prompt not being reached.
//
// The risk in fixing it is bolting a boilerplate "Thank you" onto decks that already ended fine, so
// most of what follows checks that a good deck is left alone.

import { ensureProperEnding, hasClosing, hasSummary, keyPoints } from './deckEnding.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

const deck = (...slides) => ({ title: 'Blood supply of the periodontium', slides });
const content = (n) => Array.from({ length: n }, (_, i) => ({ layout: 'bullets', title: 'Point ' + i, bullets: ['a', 'b'] }));

console.log('\n=== does it already end? ===');
{
  ok('a deck ending on a closing does', hasClosing(deck({ layout: 'title', title: 'T' }, { layout: 'closing', title: 'Thanks' })));
  ok('a deck ending mid-thought does not', !hasClosing(deck({ layout: 'title', title: 'T' }, { layout: 'bullets', title: 'B' })));
  // A "closing" three slides from the end is a mislabelled content slide, not an ending.
  ok('a closing buried in the middle does not count',
    !hasClosing(deck({ layout: 'closing', title: 'Thanks' }, { layout: 'bullets', title: 'More' })));
  ok('an empty deck does not', !hasClosing(deck()));
}

console.log('\n=== the points a recap should make ===');
{
  const d = deck(
    { layout: 'title', title: 'Cover' },
    { layout: 'section', title: 'A divider' },
    { layout: 'bullets', title: 'Gingival vessels' },
    { layout: 'chart', title: 'Cost comparison' },
    { layout: 'closing', title: 'Thank you' },
  );
  const p = keyPoints(d);
  ok('content headings are taken', p.includes('Gingival vessels') && p.includes('Cost comparison'));
  ok('the cover is not a point being made', !p.includes('Cover'));
  ok('nor is a divider', !p.includes('A divider'));
  ok('nor the closing', !p.includes('Thank you'));

  ok('a repeated heading appears once',
    keyPoints(deck({ layout: 'bullets', title: 'Same' }, { layout: 'bullets', title: 'Same' })).length === 1);

  // A recap of twenty headings is not a recap.
  const many = keyPoints({ title: 'T', slides: content(20) });
  ok('a long deck is capped', many.length === 6, `${many.length}`);
  ok('...and spread across the whole deck, not just its opening',
    many[many.length - 1] !== 'Point 5', many.join(', '));
}

console.log('\n=== giving it an ending ===');
{
  // The reported case: a long deck that just stops.
  const r = ensureProperEnding({ title: 'Blood supply', slides: [{ layout: 'title', title: 'Cover' }, ...content(12)] });
  ok('a closing is added', r.spec.slides[r.spec.slides.length - 1].layout === 'closing');
  ok('...and a recap before it', r.spec.slides[r.spec.slides.length - 2].title === 'Key points');
  ok('...built from the deck itself', (r.spec.slides[r.spec.slides.length - 2].bullets || []).length >= 3);
  ok('...and both are reported, not added silently',
    r.added.includes('summary') && r.added.includes('closing'), JSON.stringify(r.added));
  ok('nothing else is disturbed', r.spec.slides[0].title === 'Cover' && r.spec.title === 'Blood supply');
}

console.log('\n=== a deck that already ends well is left alone ===');
{
  const good = { title: 'T', slides: [{ layout: 'title', title: 'Cover' }, ...content(10),
    { layout: 'bullets', title: 'Key takeaways', bullets: ['x'] }, { layout: 'closing', title: 'Thank you' }] };
  const r = ensureProperEnding(good);
  ok('no slides are added', r.spec.slides.length === good.slides.length, `${r.spec.slides.length} vs ${good.slides.length}`);
  ok('...and nothing is claimed', r.added.length === 0, JSON.stringify(r.added));
  ok('its own closing is kept', r.spec.slides[r.spec.slides.length - 1].title === 'Thank you');

  // "Conclusion" and "Summary" are the same job under a different name.
  for (const t of ['Summary', 'Conclusion', 'In summary', 'Recap', 'Key findings']) {
    const d = { title: 'T', slides: [{ layout: 'title', title: 'C' }, ...content(9),
      { layout: 'bullets', title: t }, { layout: 'closing', title: 'Bye' }] };
    ok(`"${t}" counts as a recap`, ensureProperEnding(d).added.length === 0);
  }
}

console.log('\n=== not bolting boilerplate onto a short deck ===');
{
  // Five slides do not need a recap slide. They still need an ending.
  const r = ensureProperEnding({ title: 'T', slides: [{ layout: 'title', title: 'C' }, ...content(4)] });
  ok('no recap on a short deck', !r.added.includes('summary'), JSON.stringify(r.added));
  ok('...but it still ends', r.spec.slides[r.spec.slides.length - 1].layout === 'closing');
}

console.log('\n=== a closing stranded in the middle ===');
{
  // The model mislabels a content slide as "closing" and then keeps going, so the deck reads as
  // though it ended and then carried on.
  const r = ensureProperEnding({ title: 'T', slides: [
    { layout: 'title', title: 'C' }, ...content(8),
    { layout: 'closing', title: 'Next steps', body: 'Do the thing' },
    { layout: 'bullets', title: 'One more point' }] });
  const mid = r.spec.slides.find((s) => s.title === 'Next steps');
  ok('the stranded one is demoted to content', mid.layout === 'bullets', mid.layout);
  ok('...keeping what it said', (mid.bullets || []).includes('Do the thing'));
  ok('...and the deck ends properly after it', r.spec.slides[r.spec.slides.length - 1].layout === 'closing');
}

console.log('\n=== rubbish in ===');
{
  ok('an empty deck is returned untouched', ensureProperEnding({ title: 'T', slides: [] }).spec.slides.length === 0);
  ok('...claiming nothing', ensureProperEnding({ title: 'T', slides: [] }).added.length === 0);
  ok('a missing slides array does not throw', ensureProperEnding({ title: 'T' }).added.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
