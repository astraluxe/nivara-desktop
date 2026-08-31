// ─── The Brain must not fill up with a document's figures ────────────────────
//
// Reported: the same Word document attached twice, and the Pictures folder filled with the same
// figures again. `addUniqueNode` renames a clash to "figure 1 (2)" and keeps both, so re-attaching
// anything was guaranteed to double it — and the figures should never have been saved at all.

import { pictureHash, shouldSaveToPictures, planPictureSaves } from './pictureSave.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== identity comes from the bytes, not the name ===');
{
  const a = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVQI12P8//8/AzbAxIAHDDNJAB2wAhkBFsn0AA';
  const b = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzXXXXF0lEQVQI12P8//8/AzbAxIAHDDNJAB2wAhkBFsn0AA';
  ok('the same bytes hash the same', pictureHash(a) === pictureHash(a));
  ok('different bytes hash differently', pictureHash(a) !== pictureHash(b));
  ok('empty is empty', pictureHash('') === '');
  ok('the hash is short enough to store', pictureHash(a).length < 32, pictureHash(a));
  // Length is mixed in, so a truncated copy cannot collide with the whole.
  ok('a truncated copy is a different picture', pictureHash(a) !== pictureHash(a.slice(0, -4)));
}

console.log('\n=== what is worth keeping ===');
{
  ok('a picture the user attached is kept', shouldSaveToPictures({}));
  ok('a figure lifted out of their document is NOT', !shouldSaveToPictures({ fromDoc: true }));
  ok('something that came from the Brain is not re-saved', !shouldSaveToPictures({ fromBrain: true }));
}

console.log('\n=== the reported case: the same document, twice ===');
{
  // Five figures out of a .docx. None of them should reach the Pictures folder, either time.
  const figures = [1, 2, 3, 4, 5].map((i) => ({ name: `report.docx — figure ${i}`, content: `FIG${i}`, fromDoc: true }));
  const first = planPictureSaves(figures);
  ok('nothing is saved the first time', first.save.length === 0, JSON.stringify(first.save.map((f) => f.name)));
  ok('...and all five are accounted for', first.skipped.length === 5);
  ok('...for the right reason', first.skipped.every((s) => s.why === 'from-document'));

  const second = planPictureSaves(figures, []);
  ok('nothing is saved the second time either', second.save.length === 0);
}

console.log('\n=== a picture attached twice is stored once ===');
{
  const logo = { name: 'logo.png', content: 'LOGOBYTES' };
  const first = planPictureSaves([logo]);
  ok('the first time it is saved', first.save.length === 1);

  const stored = [pictureHash(logo.content)];
  const again = planPictureSaves([{ ...logo, name: 'company-logo-final.png' }], stored);
  ok('the same bytes under a different name are skipped', again.save.length === 0, JSON.stringify(again.save));
  ok('...and reported as already saved', again.skipped[0]?.why === 'already-saved');
}

console.log('\n=== duplicates inside one batch collapse ===');
{
  // A header logo repeated on every page arrived once per page.
  const batch = [
    { name: 'header.png', content: 'SAME' },
    { name: 'header.png', content: 'SAME' },
    { name: 'header.png', content: 'SAME' },
    { name: 'chart.png', content: 'DIFFERENT' },
  ];
  const r = planPictureSaves(batch);
  ok('three copies become one', r.save.length === 2, JSON.stringify(r.save.map((f) => f.name)));
  ok('...and the genuinely different one survives', r.save.some((f) => f.name === 'chart.png'));
}

console.log('\n=== the ordinary case still works ===');
{
  const r = planPictureSaves([
    { name: 'photo.jpg', content: 'A' },
    { name: 'diagram.png', content: 'B' },
  ]);
  ok('two real attachments are both saved', r.save.length === 2);
  ok('nothing is skipped', r.skipped.length === 0);
  ok('an empty batch is fine', planPictureSaves([]).save.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
