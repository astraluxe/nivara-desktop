// ─── "if recap could have been expanded then it would have been more useful" ──
//
// A student attached four lecture decks: "explain everything from this ppt i have an exam coming up
// for 50 marks... first do a sort of quick recap for me covering all the ppts and then question
// bank". The question bank was excellent. The recap was a bullet skeleton.
//
// Both halves of that are in one sentence and pull opposite ways — "explain everything" and "a sort
// of quick recap" — and a model reading "quick" writes a contents page. The point of revision notes
// is that you can revise FROM them.
//
// The risk in fixing it is the opposite failure: turning every attached spreadsheet into a lecture.
// So most of what follows is about the directive staying silent.

import { readStudyAsk, studyDirective } from './studyBrief.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

const REAL = 'explain everything from this ppt i have an exam coming up for 50 marks it will have easy, medium and hard questions so first do a sort of quick recap for me covering all the ppts and then question bank';

console.log('\n=== reading the ask ===');
{
  const a = readStudyAsk(REAL);
  ok('an exam is recognised', a.exam);
  ok('so is the wish to be taught', a.learning);
  ok('the mark total is picked up', a.marks === 50, String(a.marks));

  ok('"revision" counts', readStudyAsk('help me revise this').exam);
  ok('"question bank" counts', readStudyAsk('make a question bank').exam);
  ok('marks alone imply an exam', readStudyAsk('this is worth 20 marks').exam);
  ok('"explain" is learning', readStudyAsk('explain this document').learning);
  ok('"walk me through" is learning', readStudyAsk('walk me through the contract').learning);

  // Nonsense mark totals must not be believed.
  ok('a silly mark total is dropped', readStudyAsk('worth 9000 marks').marks === null);
  ok('zero marks is dropped', readStudyAsk('worth 0 marks').marks === null);
  ok('no marks mentioned is null', readStudyAsk('explain this').marks === null);
}

console.log('\n=== the directive fires where it should ===');
{
  const d = studyDirective(REAL, true);
  ok('it fires on the real request', d.length > 0);
  ok('it says quick does not mean thin', /tight, not thin/i.test(d));
  ok('it forbids a contents page', /contents page/i.test(d));
  ok('it demands the explanation, not just the name', /not just its name/i.test(d));
  ok('it forbids "refer to the slides"', /refer to the slides/i.test(d));
  ok('it insists the notes stand alone', /stand alone/i.test(d));
  ok('it keeps the source numbers', /number, name, definition/i.test(d));
  ok('it uses the mark total', d.includes('50 marks'));

  ok('a plain "explain this document" fires too', studyDirective('explain this document', true).length > 0);
  ok('...without inventing a mark total', !/marks\.\*\*/.test(studyDirective('explain this document', true)));
}

console.log('\n=== and stays silent everywhere else ===');
{
  // The failure to avoid: every attached file turning into a lecture.
  ok('nothing without source material', studyDirective(REAL, false) === '');
  ok('an ordinary question about a sheet', studyDirective('how many rows have an email?', true) === '');
  ok('a request to build something', studyDirective('make me a deck from this', true) === '');
  ok('a lead-gen ask', studyDirective('find me 50 CFOs in Bengaluru', true) === '');
  ok('an outreach ask', studyDirective('draft an email to these people', true) === '');
  ok('an empty message', studyDirective('', true) === '');
  ok('a filter request naming no learning', studyDirective('filter this to Karnataka only', true) === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
