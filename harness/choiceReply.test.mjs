// ─── A card that promises a reply has to send one ────────────────────────────
//
// The user asked for exam notes, got them, and was then offered options by the boss. They picked
// "Explain SDN vs Orchestration in more detail, specifically how they differ in scope and function
// for a potential long-answer question" — and nothing happened. Their words: "i do click on an
// option but nth came after tht".
//
// The card's own subtitle says "Tap one, then confirm — it is sent as your reply". It was not sent.
// The confirm handler wrote the text to the database and the card rendered that same text back
// inside itself, styled as an assistant answer — so the user saw their own request reflected at
// them, and the agent never answered it. `ChoiceItem.content` has always been documented as "What
// gets sent as if the user had typed it, so it must read in their voice and stand alone": it is the
// USER'S message, and displaying it as a reply was the whole mistake.
//
// The rule this file holds: **the message is never empty**. `send('')` returns silently, which is
// the dead button itself.

import { replyForChoice } from './choiceReply.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== the model wrote the reply for them ===');
{
  const c = { id: 'a', label: 'Go deeper on SDN', preview: 'scope and function', content: 'Explain SDN vs Orchestration in more detail, specifically how they differ in scope and function.' };
  ok('its own phrasing is what gets sent', replyForChoice(c) === c.content, replyForChoice(c));
}

console.log('\n=== the option the user actually clicked ===');
{
  // extractChoices drops any option without content, so this shape does not reach a rendered card —
  // but replyForChoice must not depend on that, because the block is written by a model.
  const c = { id: 'b', label: 'Explain SDN vs Orchestration in more detail', preview: 'scope and function, for a long-answer question', content: '' };
  const msg = replyForChoice(c, { title: 'What next?', choices: [c] });
  ok('something is sent', msg.trim().length > 0, JSON.stringify(msg));
  ok('...carrying what they read on the button', msg.includes('SDN') && msg.includes('scope and function'), msg);
}

console.log('\n=== the message is NEVER empty ===');
{
  // Every degenerate shape a model can emit. Each must still produce something the agent can act
  // on, because send('') returns silently and the user sees a button that does nothing.
  const shapes = [
    ['no content', { id: '1', label: 'Do the thing', preview: '', content: '' }],
    ['label is whitespace', { id: '3', label: '   ', preview: 'the preview text', content: '' }],
    ['everything blank', { id: '4', label: '', preview: '', content: '' }],
    ['content is a stub', { id: '5', label: 'Option A', preview: '', content: 'TBD' }],
    ['content is a dash', { id: '6', label: 'Option B', preview: '', content: '---' }],
    ['content says N/A', { id: '7', label: 'Option C', preview: '', content: 'N/A' }],
  ];
  for (const [name, c] of shapes) {
    const msg = replyForChoice(c, { title: 'Next step', choices: [c] });
    ok(`${name} still sends something`, typeof msg === 'string' && msg.trim().length > 1, JSON.stringify(msg));
  }
  ok('a wholly empty choice falls back to a usable instruction',
    replyForChoice({ id: '9', label: '', preview: '', content: '' }).trim().length > 5);
  ok('undefined does not throw', typeof replyForChoice(undefined) === 'string');
  ok('null does not throw', typeof replyForChoice(null) === 'string');
}

console.log('\n=== a stub is not taken at its word ===');
{
  // A model that fills `content` with "TBD" rather than leaving it out must not have that sent as
  // the user's message. What they clicked is sent instead.
  for (const stub of ['TBD', 'N/A', 'n/a', 'TODO', 'none', 'null', '...', '--']) {
    const msg = replyForChoice({ id: 'x', label: 'Go deeper on SDN', preview: '', content: stub });
    ok(`"${stub}" is not sent as the message`, msg === 'Go deeper on SDN', msg);
  }
  ok('real content is sent exactly as written',
    replyForChoice({ id: 'x', label: 'L', preview: '', content: 'Compare the two on scope and on function.' })
      === 'Compare the two on scope and on function.');
}

console.log('\n=== the label and preview are not duplicated ===');
{
  const c = { id: 'd', label: 'Same words', preview: 'Same words', content: '' };
  ok('an echoed preview is not repeated', replyForChoice(c) === 'Same words', replyForChoice(c));

  const t = { id: 'e', label: 'Go deeper', preview: '', content: '' };
  ok('the card title gives a bare fragment its context',
    replyForChoice(t, { title: 'SDN vs Orchestration', choices: [t] }) === 'SDN vs Orchestration: Go deeper',
    replyForChoice(t, { title: 'SDN vs Orchestration', choices: [t] }));

  const inc = { id: 'f', label: 'More on SDN vs Orchestration', preview: '', content: '' };
  ok('...but is not bolted on when the label already says it',
    replyForChoice(inc, { title: 'SDN vs Orchestration', choices: [inc] }) === 'More on SDN vs Orchestration');

  const both = { id: 'g', label: 'Go deeper', preview: 'on scope and function', content: '' };
  ok('label and preview are joined when they differ',
    replyForChoice(both) === 'Go deeper — on scope and function', replyForChoice(both));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
