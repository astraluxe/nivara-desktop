// ─── Several agents at once, and the single slot that hid them ───────────────
//
// THE BUG. The activity bus was `let current: AgentActivity | null` — ONE slot. Independent agents
// genuinely run at the same time (55 assertions cover the delegation itself), and every one of them
// calls setActivity, so they overwrote each other. The screen showed whichever wrote most recently,
// flickering between three names.
//
// So "several agents working for you" — the strongest thing this product does, and the direct answer
// to "it doesn't feel like I have a team" — was never missing. It was being drawn one agent at a
// time, in the same box, forever.

import {
  setActivity, endActivity, silenceActivity, resumeActivity, getActivity, getActivities,
} from './agentActivity.js';

// The bus dispatches on window; node has none, and the code already tolerates that.
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

const act = (key, name, headline) => ({
  agent: name, agentKey: key, headline, startedAt: Date.now(), phase: 'tool',
});

const reset = () => { resumeActivity(); setActivity(null); };

console.log('\n=== one agent behaves exactly as before ===');
{
  reset();
  ok('nothing running means nothing shown', getActivity() === null && getActivities().length === 0);
  setActivity(act('researcher', 'Nyx.Research', 'Searching'));
  ok('the newest is returned', getActivity().agent === 'Nyx.Research');
  ok('and it is the only one', getActivities().length === 1);
  setActivity(act('researcher', 'Nyx.Research', 'Reading page 2'));
  ok('the same agent updating replaces itself, it does not stack',
    getActivities().length === 1 && getActivity().headline === 'Reading page 2');
}

console.log('\n=== THE FIX: three agents no longer erase each other ===');
{
  reset();
  setActivity(act('researcher', 'Nyx.Research', 'Searching'));
  setActivity(act('cfo', 'Arya.Finance', 'Adding up invoices'));
  setActivity(act('coder', 'Neo.Engineer', 'Writing the script'));

  ok('all three are visible at once', getActivities().length === 3,
    'got ' + getActivities().map((a) => a.agent).join(', '));
  ok('the newest leads the list', getActivities()[0].agent === 'Neo.Engineer');
  ok('...and the first one is still there, which is the whole bug',
    getActivities().some((a) => a.agent === 'Nyx.Research'));
  ok('getActivity still answers with one, so existing callers are unchanged',
    getActivity().agent === 'Neo.Engineer');
  ok('nobody appears twice',
    new Set(getActivities().map((a) => a.agentKey)).size === 3);
}

console.log('\n=== agents finish one at a time ===');
{
  reset();
  setActivity(act('a', 'A.One', 'x'));
  setActivity(act('b', 'B.Two', 'y'));
  setActivity(act('c', 'C.Three', 'z'));

  endActivity('b');
  ok('the finished one goes', !getActivities().some((a) => a.agentKey === 'b'));
  ok('...and the others stay', getActivities().length === 2);

  // Ending the newest has to hand the crown to somebody still working, or the box goes blank while
  // two agents are still going.
  endActivity('c');
  ok('ending the newest promotes another, it does not blank the box', getActivity() !== null);
  ok('and it is one that is genuinely still running', getActivity().agentKey === 'a');

  endActivity('a');
  ok('the last one out leaves nothing running', getActivity() === null && getActivities().length === 0);
  endActivity('a');
  ok('ending something already ended is harmless', getActivities().length === 0);
}

console.log('\n=== null still means "the run is over" ===');
{
  reset();
  setActivity(act('a', 'A.One', 'x'));
  setActivity(act('b', 'B.Two', 'y'));
  setActivity(null);
  // A caller that predates the map must not be able to leave half a team lit up.
  ok('null clears the whole team, not just the newest', getActivities().length === 0);
}

console.log('\n=== Stop refuses the stragglers ===');
{
  reset();
  setActivity(act('a', 'A.One', 'x'));
  setActivity(act('b', 'B.Two', 'y'));
  silenceActivity();
  ok('stopping clears everyone', getActivities().length === 0);

  // The bug this rule exists for: a stream that resolves two seconds after Stop lands one more
  // update on its way out, and the box lights up with nobody working.
  setActivity(act('c', 'C.Three', 'late write'));
  ok('a late write after Stop is refused', getActivities().length === 0);
  resumeActivity();
  setActivity(act('c', 'C.Three', 'new run'));
  ok('a new run reopens the bus', getActivities().length === 1);
}

console.log('\n=== an agent with no key still gets its own slot ===');
{
  reset();
  setActivity({ agent: 'One', agentKey: '', headline: 'a', startedAt: 1, phase: 'tool' });
  setActivity({ agent: 'Two', agentKey: '', headline: 'b', startedAt: 1, phase: 'tool' });
  // Falling back to a shared anonymous slot would reintroduce the original bug for exactly the
  // agents least likely to be noticed.
  ok('two keyless agents do not share one slot', getActivities().length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
