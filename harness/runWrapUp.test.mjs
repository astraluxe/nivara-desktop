// ─── A run must never just stop ──────────────────────────────────────────────
//
// Reported: "check this portfolio page and find how much they invested in each" made some searches
// and then nothing came back to the chat.
//
// The danger in fixing it is the opposite mistake — forcing a wrap-up onto a run that was going
// fine, which would cut a working answer short or make a model summarise findings it does not have.
// So the "leave it alone" cases below carry more weight than the "rescue it" ones.

import { isAnnouncementOnly, needsWrapUp, wrapUpInstruction, ranOutMessage } from './runWrapUp.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== clearing your throat is not an answer ===');
{
  ok('"Let me search…"', isAnnouncementOnly('Let me search for their portfolio companies and see what I can find...'));
  ok('"I\'ll check the page"', isAnnouncementOnly("I'll check the page for their investments."));
  ok('"Now I will look into"', isAnnouncementOnly('Now I will look into each company in turn'));
  ok('"First, I need to gather"', isAnnouncementOnly('First, I need to gather the list of portfolio companies:'));
  ok('anything ending in a colon', isAnnouncementOnly('Here is what I found so far:'));
  ok('anything trailing off', isAnnouncementOnly('Looking at the first few companies…'));
  ok('nothing at all', isAnnouncementOnly(''));
  ok('whitespace', isAnnouncementOnly('   \n  '));
}

console.log('\n=== a real answer is left alone ===');
{
  // These matter most. Cutting a good answer short is worse than the bug.
  const real = `IAN Group has backed 38 companies. The disclosed cheque sizes cluster between ₹1.5 crore and ₹8 crore at seed.

| Company | Round | Amount |
|---|---|---|
| Agnikul | Seed | ₹3.1 cr |
| WOW Skin | Series A | ₹8.0 cr |

The three most recent rounds were all in the ₹2–4 crore band, which is the range worth anchoring an ask to.`;
  ok('a table of findings', !isAnnouncementOnly(real));
  ok('a short but complete answer',
    !isAnnouncementOnly('They have invested in 38 companies; disclosed cheques run ₹1.5–8 crore at seed.'));
  ok('an honest dead end is an answer',
    !isAnnouncementOnly('Their portfolio page lists the companies but discloses no amounts, and none of the three filings I checked name a figure.'));
  // "Let me know" is the agent handing back, not announcing work.
  ok('"let me know if" is not an announcement',
    !isAnnouncementOnly('I found 38 companies and the amounts for 12 of them. Let me know if you want the rest chased down.'));
  ok('a long reply is never an announcement', !isAnnouncementOnly('x'.repeat(700)));
}

console.log('\n=== when to step in ===');
{
  const base = { stepsUsed: 6, maxSteps: 6, anyToolRan: true, endedOnToolCall: true, visibleText: 'Let me search for their portfolio...' };
  ok('out of steps, mid-tool, only an announcement → rescue it', needsWrapUp(base));
  ok('ended on a tool call before the ceiling → rescue it',
    needsWrapUp({ ...base, stepsUsed: 3, endedOnToolCall: true }));
}

console.log('\n=== and when NOT to ===');
{
  const base = { stepsUsed: 6, maxSteps: 6, anyToolRan: true, endedOnToolCall: true, visibleText: 'Let me search...' };
  // A finished answer must never be interrupted, whatever the step count says.
  ok('a real answer is never wrapped up',
    !needsWrapUp({ ...base, visibleText: 'They have backed 38 companies, with seed cheques of ₹1.5–8 crore. The full table is above.' }));
  // Nothing to summarise: this is a silent model, and the empty-turn recovery owns that case.
  // Asking for a summary of nothing is asking for an invention.
  ok('no tools ran → not our problem to fix here',
    !needsWrapUp({ ...base, anyToolRan: false }));
  ok('...even with steps exhausted', !needsWrapUp({ ...base, anyToolRan: false, visibleText: '' }));
  // A run that finished normally with room to spare.
  ok('finished early on a real answer',
    !needsWrapUp({ stepsUsed: 2, maxSteps: 6, anyToolRan: true, endedOnToolCall: false, visibleText: 'Done — 38 companies, amounts for 12.' }));
  ok('finished early on an announcement but not mid-tool',
    !needsWrapUp({ stepsUsed: 2, maxSteps: 6, anyToolRan: true, endedOnToolCall: false, visibleText: 'Let me check...' }));
}

console.log('\n=== the instruction it sends ===');
{
  const w = wrapUpInstruction('how much IAN Group invested in each portfolio company');
  ok('it stops the tool loop', /STOP using tools/i.test(w));
  ok('it names the question', /IAN Group/.test(w));
  ok('it forbids another tool call', /Do NOT call another tool/i.test(w));
  ok('it forbids promising to continue', /Do NOT say you will\s*\ncontinue|this is the last thing you write/i.test(w));
  // The half a model gets wrong without being told: it invents rather than reporting a dead end.
  ok('it permits an honest "not enough"', /not enough to answer/i.test(w));
  ok('...and forbids inventing one', /Never invent/i.test(w));
}

console.log('\n=== and if even that produces nothing ===');
{
  const m = ranOutMessage(['web_search', 'web_search', 'browser'], 'find how much IAN Group invested in each company');
  ok('it says how many steps ran', /ran 3 steps/.test(m), m);
  ok('it names the tools', /web_search/.test(m));
  ok('it promises nothing was invented', /Nothing was made up/i.test(m));
  ok('it says what to do next', /Send it again/i.test(m));
  ok('it never says "(no response)"', !/no response/i.test(m));
  ok('one step reads as one step', /ran 1 step\b/.test(ranOutMessage(['web_search'], 'x')));
  ok('no tools is still a sentence', ranOutMessage([], 'x').length > 40);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
