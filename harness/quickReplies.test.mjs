// ─── Buttons that answer for you ─────────────────────────────────────────────
//
// The rule this replaces only fired on a trailing list of NUMBERED options, so the commonest shapes
// — "PowerPoint or here in the chat?", "shall I include the diagrams?", "say 'extend the deck'" —
// produced nothing and the user had to retype the answer.
//
// The risk runs the other way too. A button under every message is furniture nobody reads, and a
// button that sends something the agent cannot act on is worse than none at all. So the "no
// buttons" cases below carry as much weight as the rest.

import { quickReplies } from './quickReplies.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const labels = (t) => quickReplies(t).map((q) => q.label);
const none = (name, t) => ok(`no buttons: ${name}`, quickReplies(t).length === 0, JSON.stringify(labels(t)));

console.log('\n=== the question the deck actually asks ===');
{
  const t = 'Where would you like the presentation — in Microsoft PowerPoint or here in the chat?';
  const l = labels(t);
  ok('both destinations become buttons', l.length === 2, JSON.stringify(l));
  ok('...PowerPoint is one', l.some((x) => /powerpoint/i.test(x)), JSON.stringify(l));
  ok('...the chat is the other', l.some((x) => /chat/i.test(x)), JSON.stringify(l));
}

console.log('\n=== a list of options ===');
{
  const numbered = `Which sector should I focus on?

1. Logistics
2. Fintech
3. Healthcare`;
  ok('numbered options become buttons', labels(numbered).length === 3, JSON.stringify(labels(numbered)));

  const bulleted = `I can take this a few ways — pick one:

- Basic deck, fast
- Advanced deck with images
- Just the outline`;
  ok('bulleted options work too', labels(bulleted).length === 3, JSON.stringify(labels(bulleted)));

  const bolded = `Which detail level?

- **Basic** — clean designed slides, fast
- **Advanced** — images on every key slide`;
  const bl = labels(bolded);
  ok('a bolded label loses its explanation', bl.includes('Basic') && bl.includes('Advanced'), JSON.stringify(bl));

  const many = `Pick one:
1. One
2. Two
3. Three
4. Four
5. Five
6. Six`;
  ok('never more than four buttons', quickReplies(many).length === 4, JSON.stringify(labels(many)));
}

console.log('\n=== a straight offer ===');
{
  const t = 'The deck is ready. Would you like me to add speaker notes to every slide?';
  const q = quickReplies(t);
  ok('yes and no are offered', q.length === 2, JSON.stringify(labels(t)));
  ok("...and yes carries the agent's own words back",
    /add speaker notes/i.test(q[0].send), JSON.stringify(q));
  ok('...while the button stays short', q[0].label.length <= 20, q[0].label);

  const shall = 'Shall I email this to the team?';
  ok('"shall I" works the same', quickReplies(shall).length === 2, JSON.stringify(labels(shall)));
}

console.log('\n=== a phrase the agent told the user to say ===');
{
  const t = `That came back a little short at 6 slides. Say "extend the deck" and I'll build it out further.`;
  const l = labels(t);
  ok('the exact phrase becomes a button', l.includes('extend the deck'), JSON.stringify(l));
  // A suggested phrase stands alone: the agent has already promised to act on those words.
  ok('...even though it is the only one', l.length === 1, JSON.stringify(l));
}

console.log('\n=== when NOTHING should appear ===');
{
  none('a plain answer', 'Your deck is ready — 14 slides, and every figure from your document is on its slide.');
  none('a statement with no question', 'The gingiva receives its blood supply from three sources.');
  none('the live work panel', '```status 1788100381 work\nReading your document…\n```');
  none('empty', '');
  none('whitespace', '   \n  ');
  // One option is not a choice — it reads as the only thing you are allowed to do.
  none('a single listed option', 'What next?\n\n1. Build the deck');
  // A question whose two halves are clauses, not options.
  none('an "or" inside prose', 'Do you want this to persuade the room, or is it a record of what was decided at the meeting?');
  none('a question with no options at all', 'What should the deck focus on?');
  // Code must never become a button.
  none('a question inside a fence', 'Here is the snippet:\n\n```\n// should I retry? 1. yes 2. no\n```\n');
}

console.log('\n=== the buttons are sendable as-is ===');
{
  const t = `Where should it go?

1. Microsoft PowerPoint
2. Here in the chat`;
  for (const q of quickReplies(t)) {
    ok(`"${q.label}" is short enough to be a button`, q.label.length <= 64);
    ok(`"${q.label}" sends something non-empty`, q.send.trim().length > 0);
    ok(`"${q.label}" carries no markdown`, !/[*`|]/.test(q.send), q.send);
  }
}

console.log('\n=== the same message twice gives the same buttons ===');
{
  // Rendering runs on every keystroke; unstable output would make buttons flicker.
  const t = 'Shall I include the diagrams from your document?';
  ok('stable across calls', JSON.stringify(quickReplies(t)) === JSON.stringify(quickReplies(t)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
