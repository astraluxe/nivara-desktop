// ─── The shortcut that kept answering the wrong question ─────────────────────
//
// Every case below is a real sentence from the owner or a close variant. A false 'build' is not a
// cosmetic miss: the deck setup form replaces whatever they actually asked for, and they have to
// start again.

import { routeDeckRequest, asksAboutADeck, namesOwnApp, deckBriefSignals } from './deckRouting.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const routes = (text, want) =>
  ok(`${want.padEnd(6)} ← "${text.slice(0, 62)}${text.length > 62 ? '…' : ''}"`,
    routeDeckRequest(text) === want, `got ${routeDeckRequest(text)}`);

console.log('\n=== THE BUG: asking ABOUT a deck is not asking FOR one ===');
{
  // Reported by the owner, in these words, after a deck had already been made. The old rule saw
  // "ppt" and put the BUILDER form on screen instead of writing the script.
  routes('and i asked for give me a script to follow to present the ppt in college', 'boss');
  routes('give me a script to follow to present the ppt in college', 'boss');
  routes('write speaker notes for the deck', 'boss');
  routes('what should i say on slide 3', 'boss');
  routes('how do i open the presentation confidently', 'boss');
  routes('summarise the ppt for me', 'boss');
  routes('review my deck and tell me what is weak', 'boss');
  routes('what questions will they ask after this presentation', 'boss');
  routes('shorten the deck', 'boss');
}

console.log('\n=== the user naming their own application ===');
{
  // The other half of the report: asked to use Microsoft PowerPoint with a PDF attached, the
  // shortcut fired first, so the boss never saw it and never called office_automation.
  routes('read the given doc and make a proper ppt for it. use Microsoft power point', 'office');
  routes('use my powerpoint', 'office');
  routes('make this in powerpoint', 'office');
  routes('open Microsoft Word and write it up', 'office');
  routes('put the numbers in Excel', 'office');
  ok('naming an app is detected', namesOwnApp('use microsoft power point'));
  ok('...and a plain deck ask is not', !namesOwnApp('make me a deck about pricing'));
}

console.log('\n=== a real build request still works ===');
{
  routes('make me a presentation about our pricing', 'build');
  routes('build a pitch deck for investors', 'build');
  routes('create a 10 slide deck on the Q3 numbers', 'build');
  routes('turn this into slides', 'build');
  routes('i need a deck for tomorrow', 'build');

  // A full slide-by-slide brief is the ask however many times it says "email" in its bullets.
  const brief = 'Slide 1: Title. Slide 2: Problem. Slide 3: Our solution — integrates with email '
    + 'and calendar. Slide 4: Pricing. 12 slides total, with speaker notes.';
  routes(brief, 'build');
  ok('a brief scores on its own signals', deckBriefSignals(brief.toLowerCase()) >= 2);
}

console.log('\n=== a passing mention is never a build request ===');
{
  routes('email me the deck', 'boss');
  routes('attach the ppt to that message', 'boss');
  routes('send the presentation to Priya', 'boss');
  // The message is the job; the deck is the attachment.
  routes('write a cold email to 40 leads and attach our pitch deck', 'boss');
  routes('research our competitors and tell me how their ppt looks', 'boss');
  // No verb at all — the old rule returned true for this purely because it contains "ppt".
  routes('the ppt', 'boss');
  routes('where is the ppt saved', 'boss');
}

console.log('\n=== the vetoes are the right way round ===');
{
  // Asking about beats naming an app: "explain the powerpoint" wants an explanation, not Office.
  routes('explain the powerpoint to me', 'boss');
  ok('asksAboutADeck catches a script request', asksAboutADeck('give me a script to present'));
  ok('...and does not catch a build request', !asksAboutADeck('make me a deck about pricing'));

  // Empty and rubbish must not build anything.
  routes('', 'boss');
  routes('hi', 'boss');
  routes('thanks!', 'boss');
}

console.log('\n=== the old rule, described so the regression is named ===');
{
  // This is precisely what the removed line did: a bare noun anywhere returned true.
  const oldRule = (t) => /\b(power\s?point|\.pptx|\bppt\b|pitch\s?deck|slide\s?deck|slidedeck|keynote)\b/.test(t.toLowerCase());
  const reported = 'give me a script to follow to present the ppt in college';
  ok('the old rule WOULD have hijacked the reported sentence', oldRule(reported));
  ok('...and the new one does not', routeDeckRequest(reported) === 'boss');
}

console.log('\n=== which application did they name? ===');
{
  // namesOwnApp answers "one of their own programs"; the deck builder needs to know WHICH one.
  // Routing every 'office' message into the presentation builder would answer "write this up in
  // Microsoft Word" with a slide-deck form.
  const { namedApp } = await import('./deckRouting.js');
  ok('PowerPoint by name', namedApp('make the proper ppt in microsoft power point') === 'powerpoint',
    String(namedApp('make the proper ppt in microsoft power point')));
  ok('PowerPoint, spelled as one word', namedApp('build it in powerpoint please') === 'powerpoint');
  ok('Word', namedApp('write this up in Microsoft Word') === 'word', String(namedApp('write this up in Microsoft Word')));
  ok('Excel', namedApp('put these numbers in excel') === 'excel', String(namedApp('put these numbers in excel')));
  ok('no application named', namedApp('make me a deck about our pricing') === null);
  ok('...and an unrelated sentence', namedApp('what should I say in the meeting?') === null);
  // The routing itself must still send Word to the boss, which owns the Office tool.
  ok('a Word request still routes to the boss, not the deck builder',
    routeDeckRequest('write this up in Microsoft Word') === 'office' && namedApp('write this up in Microsoft Word') !== 'powerpoint');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
