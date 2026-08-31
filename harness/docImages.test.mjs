// ─── Pictures out of the user's own document ─────────────────────────────────
//
// A deck built from a document that HAS diagrams, containing none of them, is missing the part the
// reader needed. The owner: *"if the user doc has pic then need to add that also in the ppt… it
// should be done and its required."*
//
// Reading a PDF or a .docx needs a browser, so what is asserted here is the JUDGEMENT — which
// pictures are worth placing, in what order, and which are junk. That is where this goes wrong in a
// way nobody notices until a slide has a bullet glyph blown up on it.

import {
  isWorthPlacing, inDocumentOrder, dedupe, tidy, mimeForMedia, docxMediaOrder, MAX_DOC_IMAGES,
} from './docImages.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const img = (i, w, h, uri = 'data:image/png;base64,AAAA' + i) =>
  ({ source: 'doc.pdf', index: i, dataUri: uri, width: w, height: h });

console.log('\n=== most pictures in a document are not content ===');
{
  // A diagram, a chart, a photo.
  ok('a diagram is placed', isWorthPlacing(800, 600));
  ok('a screenshot is placed', isWorthPlacing(1280, 720));
  ok('a tall portrait photo is placed', isWorthPlacing(600, 900));

  // Putting these on a slide looks like a fault, not an omission.
  ok('a bullet glyph is dropped', !isWorthPlacing(16, 16));
  ok('an icon is dropped', !isWorthPlacing(64, 64));
  ok('a 1x1 spacer is dropped', !isWorthPlacing(1, 1));
  ok('a horizontal rule is dropped', !isWorthPlacing(1200, 8));
  ok('a vertical sidebar strip is dropped', !isWorthPlacing(8, 1200));
  // Right at the edge of the rule: 12:1 is out, 10:1 is in.
  ok('a wide banner at 15:1 is dropped', !isWorthPlacing(1800, 120));
  ok('a wide-ish figure at 4:1 is kept', isWorthPlacing(1200, 300));

  ok('nonsense is dropped', !isWorthPlacing(0, 0) && !isWorthPlacing(-5, 100) && !isWorthPlacing(NaN, 10));
}

console.log('\n=== a deck should follow the document ===');
{
  const shuffled = [img(3, 800, 600), img(1, 800, 600), img(2, 800, 600)];
  ok('pictures come back in document order',
    inDocumentOrder(shuffled).map((i) => i.index).join() === '1,2,3');
  ok('the input is not mutated', shuffled[0].index === 3);
}

console.log('\n=== the header logo on every page is one picture, not forty ===');
{
  // A logo in a PDF page header is drawn again on every page. Without this a 40-page document
  // yields 40 copies of the same image and they crowd out everything real.
  const logo = 'data:image/png;base64,LOGOLOGOLOGO';
  const many = [img(1, 400, 400, logo), img(2, 400, 400, logo), img(3, 400, 400, logo), img(4, 900, 600)];
  const out = dedupe(many);
  ok('repeats collapse to one', out.length === 2, `${out.length}`);
  ok('the first occurrence is the one kept', out[0].index === 1);
  ok('a genuinely different picture survives', out.some((i) => i.width === 900));
  ok('same bytes at a different size are kept apart',
    dedupe([img(1, 400, 400, logo), img(2, 200, 200, logo)]).length === 2);
}

console.log('\n=== tidy does the whole job in one call ===');
{
  const logo = 'data:image/png;base64,HEADERLOGO';
  const raw = [
    img(2, 900, 700),          // a real figure
    img(1, 16, 16),            // a bullet
    img(1, 400, 300, logo),    // header logo
    img(3, 400, 300, logo),    // …again
    img(3, 1400, 20),          // a rule
    img(4, 1000, 800),         // another real figure
  ];
  const out = tidy(raw);
  ok('junk is gone', out.every((i) => i.width >= 120 && i.height >= 120));
  ok('repeats are gone', new Set(out.map((i) => i.dataUri)).size === out.length);
  ok('what is left is in order', out.map((i) => i.index).join() === '1,2,4', out.map((i) => i.index).join());
  ok('three real pictures survive', out.length === 3);

  // Twelve is already more than a deck can use; a 200-page report must not return 200.
  const flood = Array.from({ length: 50 }, (_, i) => img(i + 1, 800, 600, 'data:image/png;base64,U' + i));
  ok('the count is capped', tidy(flood).length === MAX_DOC_IMAGES);
  ok('and the cap keeps the EARLIEST ones', tidy(flood)[0].index === 1);

  ok('an empty document gives nothing, and does not throw', tidy([]).length === 0);
}

console.log('\n=== what Word stores, and what a browser can draw ===');
{
  ok('png', mimeForMedia('image1.png') === 'image/png');
  ok('jpeg, both spellings',
    mimeForMedia('a.jpg') === 'image/jpeg' && mimeForMedia('a.jpeg') === 'image/jpeg');
  ok('gif', mimeForMedia('a.gif') === 'image/gif');
  // A Windows metafile is a VECTOR format no browser can draw. Shipping one produces a broken
  // image on a slide, which is worse than leaving the slide alone.
  ok('emf is refused', mimeForMedia('image3.emf') === null);
  ok('wmf is refused', mimeForMedia('image4.wmf') === null);
  ok('case does not matter', mimeForMedia('IMAGE.PNG') === 'image/png');
}

console.log('\n=== .docx media, in the order Word numbered it ===');
{
  const files = [
    'word/document.xml', 'word/media/image10.png', 'word/media/image2.jpeg',
    'word/media/image1.png', 'word/media/image3.emf', '[Content_Types].xml',
    'word/_rels/document.xml.rels',
  ];
  const out = docxMediaOrder(files);
  // image10 must come after image2 — a plain string sort puts "10" before "2", which silently
  // reorders every document with ten or more pictures.
  ok('numbered numerically, not alphabetically',
    out.join() === 'word/media/image1.png,word/media/image2.jpeg,word/media/image10.png', out.join());
  ok('non-media entries are ignored', !out.some((p) => p.includes('document.xml')));
  ok('undrawable formats never enter the list', !out.some((p) => p.endsWith('.emf')));
  ok('a document with no pictures gives nothing', docxMediaOrder(['word/document.xml']).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
