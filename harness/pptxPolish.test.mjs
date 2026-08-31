// ─── The three things that made the PowerPoint file look machine-made ────────
//
// The deck in the chat looked right; the .pptx of the SAME deck did not. Words at the wrong size,
// slides arriving empty, and the user's own summary: it "look[ed] very clearly like it's made using
// AI". The layout half is in deckPptx.ts. These three are pure, so they are checked here.
//
// The danger in each is over-reach: a dash rule that changes what a sentence means, a fitter that
// shrinks text nobody asked it to shrink, a metadata pass that invents an author. Most of what
// follows guards against that rather than against the original bug.

import { plainDashes, slideText, fitSize, docProps, sectionKicker, centredRow, centredStack } from './pptxPolish.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== the long dash ===');
{
  // The character itself is the tell the user asked us to drop.
  ok('a spaced em dash becomes a spaced hyphen',
    plainDashes('Fast, reliable — and cheap') === 'Fast, reliable - and cheap', plainDashes('Fast, reliable — and cheap'));
  ok('an unspaced em dash too',
    plainDashes('growth—at scale') === 'growth - at scale', plainDashes('growth—at scale'));
  ok('an en dash as well', plainDashes('the plan – revised') === 'the plan - revised');
  ok('the horizontal bar too', plainDashes('a ― b') === 'a - b');
  ok('none of them survive',
    !/[‒–—―]/.test(plainDashes('a — b – c ― d ‒ e')), plainDashes('a — b – c ― d ‒ e'));

  // A range between numbers is not a clause break, and " - " would read wrongly there.
  ok('a year range stays tight', plainDashes('2020–2024') === '2020-2024', plainDashes('2020–2024'));
  ok('a money range stays tight', plainDashes('₹10—20 lakh') === '₹10-20 lakh', plainDashes('₹10—20 lakh'));
  ok('a spaced numeric range too', plainDashes('10 – 20') === '10-20', plainDashes('10 – 20'));

  // Everything that was already fine must come out untouched.
  ok('a plain hyphen is left alone', plainDashes('well-known best-in-class') === 'well-known best-in-class');
  ok('a leading list dash is not padded', plainDashes('- first point') === '- first point');
  ok('ordinary prose is unchanged', plainDashes('Revenue grew 40% last year.') === 'Revenue grew 40% last year.');
  ok('an empty string survives', plainDashes('') === '');
  ok('a curly quote is NOT a tell and is kept', plainDashes('the “best” year') === 'the “best” year');
}

console.log('\n=== every string on its way into the file ===');
{
  ok('it trims and de-dashes', slideText('  Q1 — strong  ') === 'Q1 - strong', JSON.stringify(slideText('  Q1 — strong  ')));
  ok('undefined is an empty string, not "undefined"', slideText(undefined) === '');
  ok('null too', slideText(null) === '');
  ok('a number-ish value does not crash', slideText(42) === '42');
}

console.log('\n=== text sized to the box it is in ===');
{
  const box = { w: 11.5, h: 1.1, base: 32 };
  ok('a short title keeps the size it was designed at', fitSize(['Our Q3 results'], box) === 32);

  // The reported bug: one constant size for every title, so a long one ran off the slide.
  const long = fitSize(['Why mid-market manufacturers in Karnataka are replacing four separate subscriptions with one desktop application this year'], box);
  ok('a long title is stepped down', long < 32, `got ${long}`);
  ok('...but is still readable, not microscopic', long >= 14, `got ${long}`);

  // Monotonic: more text must never come back BIGGER.
  const a = fitSize(['short'], box), b = fitSize(['short but rather a lot longer than the first one here'], box);
  ok('more text never gets a larger size', b <= a, `${a} then ${b}`);

  // Bullets are measured as a group, since they share one box.
  const few = fitSize(['One point', 'Two point'], { w: 11.5, h: 4.4, base: 20 });
  ok('a short bullet list is left at full size', few === 20, `got ${few}`);
  // The density the setup card calls "detailed", on a slide that also carries a body line.
  const many = fitSize(Array.from({ length: 12 }, (_, i) => `Point number ${i} carrying a genuinely detailed explanation of what it means in practice`), { w: 11.5, h: 3.6, base: 20 });
  ok('an overflowing bullet list shrinks', many < few, `${few} then ${many}`);
  ok('...and not past legibility', many >= 11, `got ${many}`);

  ok('the floor is respected', fitSize([('x').repeat(9000)], { w: 2, h: 0.4, base: 20, min: 11 }) === 11);
  ok('no text at all keeps the base size', fitSize([], box) === 32);
  ok('empty strings are not counted as lines', fitSize(['', '', ''], box) === 32);
  ok('a narrow box shrinks more than a wide one',
    fitSize(['A heading of some length here'], { w: 2, h: 1, base: 24 }) < fitSize(['A heading of some length here'], { w: 11, h: 1, base: 24 }));
}

console.log('\n=== what the file says about itself ===');
{
  // `PptxGenJS Presentation` was the subject of every deck ever exported, and `adris.tech` the
  // author. Both are two clicks away in File → Info.
  const d = docProps('Q3 Business Review', 'Amogh M', 'Acme Pvt Ltd');
  ok('the subject is the deck, not the generator', d.subject === 'Q3 Business Review');
  ok('no mention of the library anywhere', !/pptxgen/i.test(JSON.stringify(d)));
  ok('no mention of adris either', !/adris/i.test(JSON.stringify(d)), JSON.stringify(d));
  ok('the author is the user', d.author === 'Amogh M');
  ok('the company is carried through', d.company === 'Acme Pvt Ltd');

  // An empty author is ordinary in a real file. A generator's name in it is a tell.
  const anon = docProps('Some deck');
  ok('an unknown author is left blank, not filled in', anon.author === '', JSON.stringify(anon));
  ok('an unknown company likewise', anon.company === '');
  ok('an untitled deck still gets a sane title', docProps('').title === 'Presentation');
  ok('whitespace is not a name', docProps('X', '   ').author === '');
}

console.log('\n=== the section divider ===');
{
  // It used to read the literal word SECTION on every divider. Nobody types that.
  ok('a divider is numbered against the total', sectionKicker(2, 4) === '02 / 04');
  ok('a lone divider just gets its number', sectionKicker(1, 1) === '01');
  ok('never the word itself', !/section/i.test(sectionKicker(1, 3)));
  ok('a nonsense index produces nothing rather than "NaN"', sectionKicker(0, 3) === '');
}


console.log('\n=== panels that neither stretch nor bunch ===');
{
  // Four plans across the full width: no cap needed, no centring gap.
  const four = centredRow(4, 11.5, 0.35, 3.6, 0.9);
  ok('four plans share the width', Math.abs(four.w - (11.5 - 0.35 * 3) / 4) < 0.001, `${four.w}`);
  ok('...starting at the left margin', Math.abs(four.x - 0.9) < 0.001, `${four.x}`);

  // One plan used to become a full-width box with a single line of text adrift in it.
  const one = centredRow(1, 11.5, 0.35, 3.6, 0.9);
  ok('a single plan is capped, not stretched', one.w === 3.6, `${one.w}`);
  ok('...and centred on the slide', Math.abs((one.x + one.w / 2) - (0.9 + 11.5 / 2)) < 0.001, `${one.x}`);

  const two = centredRow(2, 11.5, 0.35, 3.6, 0.9);
  ok('two are capped and centred as a pair', two.w === 3.6 && two.x > 0.9, `${two.w} @ ${two.x}`);
  ok('items never overflow the space they were given',
    [1, 2, 3, 4, 6].every((n) => {
      const r = centredRow(n, 11.5, 0.35, 3.6, 0.9);
      return r.x >= 0.9 - 0.001 && r.x + r.w * n + 0.35 * (n - 1) <= 0.9 + 11.5 + 0.001;
    }));
  ok('a count of zero does not divide by zero', Number.isFinite(centredRow(0, 11.5, 0.35, 3.6, 0.9).w));

  // Vertically: one timeline row used to sit at the top with the bottom half of the slide empty.
  const s1 = centredStack(1, 4.4, 1.1, 2.3);
  ok('a lone row is capped in height', s1.w === 1.1, `${s1.w}`);
  ok('...and centred in the band', Math.abs((s1.x + s1.w / 2) - (2.3 + 4.4 / 2)) < 0.001, `${s1.x}`);
  const s7 = centredStack(7, 4.4, 1.1, 2.3);
  ok('seven rows fill the band without overflowing', s7.w * 7 <= 4.4 + 0.001 && Math.abs(s7.x - 2.3) < 0.001, `${s7.w} @ ${s7.x}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
