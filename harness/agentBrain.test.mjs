// ─── The choices block, parsed the way a free model actually writes it ────────
//
// This is the one piece of the "offer buttons instead of a paragraph" feature that runs on model
// output, so it is the one piece that has to survive bad model output. The card renderer maps
// straight over the option list: valid JSON of the wrong shape used to reach it and take the whole
// chat down. And a block we cannot read must still be REMOVED — the stream hides it while typing,
// so leaving it in at the end made the text change into a wall of JSON the moment the turn ended.

import { extractChoices } from './agentBrain.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); } };
const eq = (name, got, want) => ok(name, got === want, `\n    got : ${got}\n    want: ${want}`);

const wrap = (json) => `Here are the two sensible next moves.\n\nCHOICES_BLOCK:\n${json}\nEND_CHOICES`;
const GOOD = JSON.stringify({
  title: 'Which of these first?',
  choices: [
    { id: 'a', label: 'Find more leads', preview: 'Search for 20 more like the ones that replied', content: 'Find 20 more leads like the ones who replied' },
    { id: 'b', label: 'Chase the quiet ones', preview: "Follow up with the 8 who haven't answered", content: "Write follow-ups for the contacts who haven't replied" },
  ],
});

// ── The documented happy path (the exact shape the boss prompt tells it to write) ──
console.log('\n=== the shape we ask for ===');
const g = extractChoices(wrap(GOOD));
eq('two options come back', g.choices?.choices.length, 2);
eq('the title survives', g.choices?.title, 'Which of these first?');
eq('the prose is kept', g.cleanContent, 'Here are the two sensible next moves.');
ok('no machinery left in the prose', !/CHOICES_BLOCK|END_CHOICES|\{/.test(g.cleanContent), g.cleanContent);
eq('content is what gets sent', g.choices?.choices[1].content, "Write follow-ups for the contacts who haven't replied");

// ── No block at all: nothing changes ──
console.log('\n=== no block ===');
const none = extractChoices('Just an ordinary answer.');
eq('content untouched', none.cleanContent, 'Just an ordinary answer.');
eq('no card', none.choices, null);

// ── Broken output must never render a card, and never leave JSON on screen ──
console.log('\n=== bad model output ===');
for (const [name, body] of [
  ['truncated json',        '{"title":"x","choices":[{"id":"a","label":"A"'],
  ['trailing comma',        '{"title":"x","choices":[{"id":"a","label":"A","content":"a"},]}'],
  ['an object, not a list', '{"title":"x","choices":{"id":"a","label":"A","content":"a"}}'],
  ['empty list',            '{"title":"x","choices":[]}'],
  ['only one real option',  '{"title":"x","choices":[{"id":"a","label":"A","content":"do a"}]}'],
  ['label but no content',  '{"title":"x","choices":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}'],
  ['not json at all',       'pick one of the two options above'],
]) {
  const r = extractChoices(wrap(body));
  eq(`${name}: no card`, r.choices, null);
  ok(`${name}: block is stripped anyway`, !/CHOICES_BLOCK|END_CHOICES/.test(r.cleanContent), r.cleanContent);
  eq(`${name}: the prose still shows`, r.cleanContent, 'Here are the two sensible next moves.');
}

// A half-good list keeps the good ones — as long as two survive.
const mixed = extractChoices(wrap('{"title":"x","choices":[{"id":"a","label":"A","content":"do a"},{"label":""},{"id":"c","label":"C","content":"do c"}]}'));
eq('junk options are dropped, real ones kept', mixed.choices?.choices.length, 2);
eq('...and the ids are the real ones', mixed.choices?.choices.map((c) => c.id).join(','), 'a,c');

// ── Missing bits get sane fallbacks rather than breaking the card ──
console.log('\n=== filling the gaps ===');
const gaps = extractChoices(wrap('{"choices":[{"label":"A","content":"do a"},{"label":"B","content":"do b"}]}'));
ok('a missing title gets one', !!gaps.choices?.title, gaps.choices?.title);
eq('missing ids are generated and unique', gaps.choices?.choices.map((c) => c.id).join(','), 'c1,c2');
eq('a missing preview is an empty string, not undefined', gaps.choices?.choices[0].preview, '');

// ── Five options is a menu, not a choice ──
eq('capped at four',
  extractChoices(wrap(JSON.stringify({ title: 't', choices: [1,2,3,4,5,6].map((n) => ({ id: `o${n}`, label: `L${n}`, content: `c${n}` })) }))).choices?.choices.length,
  4);

// ── Scores are normalised, not trusted ──
console.log('\n=== scores ===');
const sc = extractChoices(wrap('{"title":"t","choices":[{"id":"a","label":"A","content":"do a","effort":9,"impact":4,"confidence":180},{"id":"b","label":"B","content":"do b"}]}'));
eq('an out-of-range effort is clamped', sc.choices?.choices[0].effort, 5);
eq('an out-of-range confidence is clamped', sc.choices?.choices[0].confidence, 100);
eq('an unscored option stays unscored', sc.choices?.choices[1].effort, undefined);


console.log('\n=== a choices block the model never finished ===');
{
  // No END_CHOICES means the model ran out mid-block. The raw JSON used to be left in the text and
  // shown to the user — a wall of {"title":"What next?","choices":[{"id":"a"... hanging off the end
  // of their answer. The options are lost either way; the mess does not have to be.
  const prose = 'Here are your notes.\n\nAll done.';
  const cut = prose + '\n\nCHOICES_BLOCK:\n{"title":"What next?","choices":[{"id":"a","label":"Go deep';
  const r = extractChoices(cut);
  ok('no machinery is left on screen', !r.cleanContent.includes('CHOICES_BLOCK'), r.cleanContent.slice(-60));
  ok('...nor its JSON', !r.cleanContent.includes('{"title"'), r.cleanContent.slice(-60));
  ok('the answer itself is kept', r.cleanContent.trim() === prose, JSON.stringify(r.cleanContent));
  ok('and no card is offered from a half-written block', r.choices === null);

  // Text with no block at all must come back completely untouched.
  const plain = extractChoices('Just an ordinary answer.');
  ok('an ordinary answer is untouched', plain.cleanContent === 'Just an ordinary answer.' && plain.choices === null);

  // A complete block with two usable options still produces a card.
  const good = prose + '\n\nCHOICES_BLOCK:\n' + JSON.stringify({ title: 'What next?', choices: [
    { id: 'a', label: 'Go deeper on SDN', preview: 'p', content: 'Explain SDN vs Orchestration in more detail.' },
    { id: 'b', label: 'More questions', preview: 'p', content: 'Give me ten more likely exam questions.' },
  ] }) + '\nEND_CHOICES';
  const g = extractChoices(good);
  ok('a complete block still makes a card', g.choices && g.choices.choices.length === 2, JSON.stringify(g.choices));
  ok('...with the prose left clean', g.cleanContent.trim() === prose, JSON.stringify(g.cleanContent));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
