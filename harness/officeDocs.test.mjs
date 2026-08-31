// ─── Word, PowerPoint and Excel, read properly ───────────────────────────────
//
// The chat's file picker offered no Office formats at all — a small business does not keep its work
// in Markdown. Making them selectable is the easy half; each of these assertions is a way the OTHER
// half goes wrong silently, where the file is accepted and the content arrives subtly mangled.

import {
  extOf, legacyFormatMessage, slideOrder, sheetOrder, parseSharedStrings, sheetToRows, OFFICE_EXTS,
} from './officeDocs.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== the old binary formats get an answer, not silence ===');
{
  // Reading a 1997 compound-file .doc means implementing a format Microsoft never published, for a
  // file anyone can convert in four clicks. A picker that simply will not show it is a dead end.
  const m = legacyFormatMessage('Report.doc');
  ok('a .doc is explained', !!m && m.includes('.docx'), String(m));
  ok('...and names the file', m.includes('Report.doc'));
  ok('...and says how to fix it', /Save As/i.test(m));
  ok('a .ppt points at .pptx', legacyFormatMessage('deck.ppt').includes('.pptx'));
  ok('an .xls points at .xlsx', legacyFormatMessage('books.xls').includes('.xlsx'));

  ok('a modern file gets no such message', legacyFormatMessage('Report.docx') === null);
  ok('nor does a pdf', legacyFormatMessage('paper.pdf') === null);
  ok('the picker offers all six', OFFICE_EXTS.length === 6 && OFFICE_EXTS.includes('pptx'));
  ok('extOf is case-insensitive', extOf('A.DOCX') === 'docx');
}

console.log('\n=== slide 10 comes after slide 2, not before it ===');
{
  // A plain string sort puts "slide10" second. A reordered deck reads as nonsense rather than as a
  // bug, so nobody reports it — which is exactly why it is asserted.
  const files = [
    'ppt/slides/slide10.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide1.xml',
    'ppt/slides/_rels/slide1.xml.rels', 'ppt/presentation.xml', 'ppt/media/image1.png',
  ];
  const out = slideOrder(files);
  ok('numeric order, not alphabetical',
    out.join() === 'ppt/slides/slide1.xml,ppt/slides/slide2.xml,ppt/slides/slide10.xml', out.join());
  ok('relationship files are not slides', !out.some((p) => p.includes('_rels')));
  ok('nor is the presentation itself', !out.some((p) => p.includes('presentation.xml')));

  const sheets = sheetOrder(['xl/worksheets/sheet3.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']);
  ok('worksheets are ordered the same way',
    sheets.join() === 'xl/worksheets/sheet1.xml,xl/worksheets/sheet3.xml', sheets.join());
  ok('styles are not a worksheet', !sheets.some((p) => p.includes('styles')));
}

console.log('\n=== Excel does not put text in its cells ===');
{
  // It puts an INDEX into a shared table, and marks the cell t="s". Read a sheet without that table
  // and a spreadsheet of names arrives as a spreadsheet of 0, 1, 2, 3.
  const ss = `<sst><si><t>Name</t></si><si><t>Priya Sharma</t></si><si><t>Acme &amp; Co</t></si></sst>`;
  const shared = parseSharedStrings(ss);
  ok('the table is read', shared.length === 3, JSON.stringify(shared));
  ok('entities inside it are decoded', shared[2] === 'Acme & Co', shared[2]);
  ok('an empty table does not crash', parseSharedStrings('<sst/>').length === 0);
  // Rich text splits one string across several <t> runs; joining them is what keeps it one value.
  ok('a split run is joined back up',
    parseSharedStrings('<sst><si><r><t>Pri</t></r><r><t>ya</t></r></si></sst>')[0] === 'Priya');

  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c></row>
    <row r="3"></row>
  </sheetData></worksheet>`;
  const rows = sheetToRows(sheet, shared);
  ok('shared strings are resolved, not left as indexes',
    rows[0] === 'Name\tPriya Sharma', JSON.stringify(rows[0]));
  ok('numbers stay numbers', rows[1] === 'Acme & Co\t42', JSON.stringify(rows[1]));
  ok('an empty row is dropped', rows.length === 2, String(rows.length));

  // Inline strings are the other way Excel stores text, and they are not in the shared table.
  const inline = `<worksheet><sheetData><row><c t="inlineStr"><is><t>Direct</t></is></c></row></sheetData></worksheet>`;
  ok('inline strings are read too', sheetToRows(inline, []).join() === 'Direct', sheetToRows(inline, []).join());

  // A missing table must not throw — it must just leave the cell blank.
  ok('a cell pointing at a missing table is blank, not "undefined"',
    sheetToRows(`<worksheet><sheetData><row><c t="s"><v>9</v></c><c><v>1</v></c></row></sheetData></worksheet>`, [])
      .join() === '\t1');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
