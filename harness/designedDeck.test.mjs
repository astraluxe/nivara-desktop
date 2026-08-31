// ─── An agent's deck has to be designed, not typed ───────────────────────────
//
// When an agent made a PowerPoint, every slide came out of the same ppLayoutText mould: a title box
// and a bullet box, twelve times. The owner's words were "not just typing or writing on it but
// designing it".
//
// The agent still hands over what it always handed over — titles and bullets. These check that what
// comes back is a deck with a shape: an opener, sections, a figure that gets a slide of its own, a
// close. And that ordinary content still lands on an ordinary slide, because a layout chosen for the
// sake of variety is worse than the repetition it replaced.

import { planLayouts, buildSpec, housePalette } from './designedDeck.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const layouts = (slides) => planLayouts(slides).map((s) => s.layout);

console.log('\n=== a deck has a beginning and an end ===');
{
  const l = layouts([
    { title: 'Q3 review', body: 'Prepared for the board' },
    { title: 'Where we are', bullets: ['Revenue up', 'Costs flat'] },
    { title: 'What we need', bullets: ['Two hires'] },
    { title: 'Thank you', body: 'Questions welcome' },
  ]);
  ok('it opens on a title slide', l[0] === 'title', JSON.stringify(l));
  ok('it ends on a closing slide', l[l.length - 1] === 'closing', JSON.stringify(l));
  ok('the middle is not all one layout or all different', l.length === 4);
}

console.log('\n=== a single figure gets a slide of its own ===');
{
  // "42%" buried in a bullet list is a fact; alone on a slide it is a point.
  const l = layouts([
    { title: 'Deck' },
    { title: 'Revenue growth', bullets: ['42%'] },
    { title: 'Close' },
  ]);
  ok('a lone number becomes a stat slide', l[1] === 'stat', JSON.stringify(l));

  const spec = buildSpec('D', [{ title: 'D' }, { title: 'Growth', bullets: ['42%'] }, { title: 'End' }]);
  ok('...with the number as the stat', spec.slides[1].stat === '42%', JSON.stringify(spec.slides[1]));
  ok('...and the heading as its label', spec.slides[1].statLabel === 'Growth');

  // A sentence is not a figure.
  ok('a sentence stays a bullet slide',
    layouts([{ title: 'D' }, { title: 'Note', bullets: ['We grew by a good margin this year'] }, { title: 'E' }])[1] === 'bullets');
}

console.log('\n=== a quotation reads as a quotation ===');
{
  const s = buildSpec('D', [
    { title: 'D' },
    { title: 'Dr Mehta', bullets: ['"The workflow is well thought out."'] },
    { title: 'End' },
  ]);
  ok('it becomes a quote slide', s.slides[1].layout === 'quote', s.slides[1].layout);
  ok('the quotation marks are stripped', !/^["“]/.test(s.slides[1].quote || ''), s.slides[1].quote);
  ok('the name becomes the attribution', s.slides[1].attribution === 'Dr Mehta');
}

console.log('\n=== a bare heading is a section break ===');
{
  const l = layouts([{ title: 'D' }, { title: 'Part two' }, { title: 'Detail', bullets: ['a', 'b'] }, { title: 'End' }]);
  ok('a heading with nothing under it becomes a section', l[1] === 'section', JSON.stringify(l));
}

console.log('\n=== balanced points become two columns ===');
{
  const l = layouts([
    { title: 'D' },
    { title: 'Before and after', bullets: ['Slow', 'Manual', 'Fast', 'Automatic'] },
    { title: 'End' },
  ]);
  ok('four balanced points split into columns', l[1] === 'two-column', JSON.stringify(l));
  // Three points do not split evenly, so they must not be forced.
  ok('three points stay a bullet slide',
    layouts([{ title: 'D' }, { title: 'Three', bullets: ['a', 'b', 'c'] }, { title: 'E' }])[1] === 'bullets');
  // Nor should a long list be crammed into two columns.
  ok('ten points stay a bullet slide',
    layouts([{ title: 'D' }, { title: 'Many', bullets: Array.from({ length: 10 }, (_, i) => 'p' + i) }, { title: 'E' }])[1] === 'bullets');
}

console.log('\n=== ordinary content is left alone ===');
{
  // The important half. Reaching for an unusual layout on ordinary material is how a deck ends up
  // looking clever and reading badly.
  const l = layouts([
    { title: 'D' },
    { title: 'Findings', bullets: ['The first thing we found', 'The second thing we found', 'A third'] },
    { title: 'Method', bullets: ['We interviewed 20 people'] },
    { title: 'End' },
  ]);
  ok('prose bullets stay bullet slides', l[1] === 'bullets' && l[2] === 'bullets', JSON.stringify(l));
}

console.log('\n=== the awkward inputs ===');
{
  ok('an empty deck does not crash', planLayouts([]).length === 0);
  ok('one slide is still a title', layouts([{ title: 'Only' }])[0] === 'title');
  ok('two slides do not lose the second', layouts([{ title: 'A' }, { title: 'B', bullets: ['x'] }]).length === 2);
  ok('empty bullets are dropped', (buildSpec('D', [{ title: 'D' }, { title: 'T', bullets: ['', '  ', 'real'] }]).slides[1].bullets || []).length === 1);
  ok('a missing title does not crash', layouts([{ bullets: ['a'] }]).length === 1);
}

console.log('\n=== one house style ===');
{
  const p = housePalette();
  ok('the accent is the brand purple', p.accent === '#7C5CFF', p.accent);
  ok('every colour is a full hex', Object.values(p).every((c) => /^#[0-9A-F]{6}$/i.test(c)), JSON.stringify(p));
  const s = buildSpec('Quarterly review', [{ title: 'Quarterly review' }]);
  ok('the deck carries its title', s.title === 'Quarterly review');
  ok('and a font pair', !!s.font.heading && !!s.font.body);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
