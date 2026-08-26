import {
  validatePlan, initPlan, pickRunnable, applyResult, isFinished,
  contextFor, describePlan, runPlan, DEFAULT_MAX_PARALLEL,
  planFromDelegations, runWaves, parallelSummary,
} from './agentSchedule.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got : ${JSON.stringify(g)}\n        want: ${JSON.stringify(w)}`);

const step = (id, needs = [], agent = id) => ({ id, agent, label: `doing ${id}`, needs });

// ── The requirement itself ───────────────────────────────────────────────────
// "If a task needs three agents and each can work without the others finishing, all three should
// work at once. But if an agent will answer better once it has what the previous one found, it
// must wait for that."
console.log('\n=== independent work happens at the same time ===');
{
  const p = initPlan({ steps: [step('leads'), step('competitors'), step('pricing')] });
  eq('all three are runnable immediately', pickRunnable(p).map((s) => s.id), ['leads', 'competitors', 'pricing']);
}

console.log('\n=== dependent work waits, and only it ===');
{
  const p = initPlan({ steps: [step('leads'), step('competitors'), step('outreach', ['leads'])] });
  eq('the dependent step is not offered', pickRunnable(p).map((s) => s.id), ['leads', 'competitors']);

  const after = applyResult(p, 'leads', { ok: true, output: '40 leads' });
  eq('once its input is done it becomes runnable',
     pickRunnable(after).map((s) => s.id).sort(), ['competitors', 'outreach']);

  // Waiting must BUY something: the step has to actually receive the work it waited for.
  ok('and it receives what it waited for', /40 leads/.test(contextFor(after, 'outreach')), contextFor(after, 'outreach'));
  ok('...labelled with who produced it', /from leads/.test(contextFor(after, 'outreach')));
  eq('a step with no dependencies gets no context', contextFor(after, 'competitors'), '');
}

console.log('\n=== a chain waits all the way down ===');
{
  let p = initPlan({ steps: [step('a'), step('b', ['a']), step('c', ['b'])] });
  eq('only the first can start', pickRunnable(p).map((s) => s.id), ['a']);
  p = applyResult(p, 'a', { ok: true, output: 'A' });
  eq('then the second', pickRunnable(p).map((s) => s.id), ['b']);
  p = applyResult(p, 'b', { ok: true, output: 'B' });
  eq('then the third', pickRunnable(p).map((s) => s.id), ['c']);
  ok('and the third sees the second, not the first', /B/.test(contextFor(p, 'c')) && !/A/.test(contextFor(p, 'c')));
}

console.log('\n=== two inputs means waiting for both ===');
{
  let p = initPlan({ steps: [step('leads'), step('pricing'), step('proposal', ['leads', 'pricing'])] });
  p = applyResult(p, 'leads', { ok: true, output: 'L' });
  eq('one of two is not enough', pickRunnable(p).map((s) => s.id), ['pricing']);
  p = applyResult(p, 'pricing', { ok: true, output: 'P' });
  eq('both, and it goes', pickRunnable(p).map((s) => s.id), ['proposal']);
  const ctx = contextFor(p, 'proposal');
  ok('and it receives both', /L/.test(ctx) && /P/.test(ctx), ctx);
}

// ── One broken step must not cost the afternoon ──────────────────────────────
console.log('\n=== a failure blocks what needed it, and nothing else ===');
{
  let p = initPlan({ steps: [step('leads'), step('outreach', ['leads']), step('report', ['outreach']), step('unrelated')] });
  p = applyResult(p, 'leads', { ok: false, error: 'the sheet was empty' });
  const by = (id) => p.steps.find((s) => s.id === id);
  eq('the failed step is failed', by('leads').state, 'failed');
  eq('what needed it is blocked, not silently run on nothing', by('outreach').state, 'blocked');
  eq('and so is what needed THAT — the chain is followed', by('report').state, 'blocked');
  eq('unrelated work is untouched', by('unrelated').state, 'waiting');
  ok('a blocked step says which step let it down', /leads/.test(by('outreach').error ?? ''), by('outreach').error);
  eq('unrelated work can still start', pickRunnable(p).map((s) => s.id), ['unrelated']);
  ok('the run is not finished while that remains', !isFinished(p));
}

// ── The failures that would otherwise hang forever ───────────────────────────
console.log('\n=== a plan that could never finish is refused up front ===');
{
  const cyc = validatePlan({ steps: [step('a', ['b']), step('b', ['a'])] });
  eq('a two-step cycle is caught', cyc.length, 1);
  eq('...and named as a cycle', cyc[0].kind, 'cycle');
  ok('...with the loop spelled out', /a/.test(cyc[0].detail) && /b/.test(cyc[0].detail), cyc[0].detail);

  const long = validatePlan({ steps: [step('a', ['c']), step('b', ['a']), step('c', ['b'])] });
  ok('a three-step cycle is caught too', long.some((p) => p.kind === 'cycle'), JSON.stringify(long));

}

console.log('\n=== a dependency on something nobody produces ===');
{
  const v = validatePlan({ steps: [step('a', ['nowhere'])] });
  eq('caught as missing', v[0].kind, 'missing');
  ok('...and names it', /nowhere/.test(v[0].detail), v[0].detail);
  const dup = validatePlan({ steps: [step('a'), step('a')] });
  eq('duplicate ids are caught', dup[0].kind, 'duplicate');
  eq('a sound plan has no problems', validatePlan({ steps: [step('a'), step('b', ['a'])] }), []);
}

// ── The ceiling ──────────────────────────────────────────────────────────────
console.log('\n=== the parallel ceiling ===');
{
  const many = initPlan({ steps: ['a', 'b', 'c', 'd', 'e'].map((i) => step(i)) });
  eq(`defaults to ${DEFAULT_MAX_PARALLEL} at once`, pickRunnable(many).length, DEFAULT_MAX_PARALLEL);
  eq('and is configurable', pickRunnable({ ...many, maxParallel: 2 }).length, 2);
  const busy = { ...many, steps: many.steps.map((s, i) => (i < 2 ? { ...s, state: 'running' } : s)) };
  eq('what is already running counts against it', pickRunnable({ ...busy, maxParallel: 3 }).length, 1);
  eq('a full house offers nothing', pickRunnable({ ...busy, maxParallel: 2 }).length, 0);
}

// ── End to end, with a fake worker ───────────────────────────────────────────
console.log('\n=== running a real plan ===');
{
  const order = [];
  let peak = 0, live = 0;
  const plan = {
    steps: [step('leads'), step('competitors'), step('pricing'), step('proposal', ['leads', 'pricing'])],
    maxParallel: 3,
  };
  const done = await runPlan(plan, async (s, ctx) => {
    live++; peak = Math.max(peak, live);
    order.push(s.id);
    await new Promise((r) => setTimeout(r, s.id === 'leads' ? 30 : 5));
    live--;
    return s.id === 'proposal' ? `built from: ${ctx.length} chars` : s.id.toUpperCase();
  });
  ok('everything finished', isFinished(done), JSON.stringify(done.steps.map((s) => [s.id, s.state])));
  ok('all four ran', order.length === 4, order.join(','));
  ok('the three independent ones overlapped', peak >= 2, 'peak concurrency ' + peak);
  ok('the dependent one ran last', order[order.length - 1] === 'proposal', order.join(','));
  ok('and it was handed its inputs', /built from: [1-9]/.test(done.steps.find((s) => s.id === 'proposal').output));
  eq('every step is done', done.steps.filter((s) => s.state === 'done').length, 4);
}

console.log('\n=== a worker that throws does not take the run with it ===');
{
  const plan = { steps: [step('good'), step('bad'), step('needsBad', ['bad'])] };
  const done = await runPlan(plan, async (s) => {
    if (s.id === 'bad') throw new Error('model exploded');
    return 'fine';
  });
  const by = (id) => done.steps.find((s) => s.id === id);
  eq('the good one still succeeded', by('good').state, 'done');
  eq('the bad one is failed', by('bad').state, 'failed');
  ok('...with the reason kept', /exploded/.test(by('bad').error ?? ''), by('bad').error);
  eq('its dependent is blocked, not run', by('needsBad').state, 'blocked');
  ok('the run completed rather than hanging', isFinished(done));
}

console.log('\n=== an impossible plan fails loudly instead of hanging ===');
{
  let threw = '';
  try { await runPlan({ steps: [step('a', ['b']), step('b', ['a'])] }, async () => 'x'); }
  catch (e) { threw = e.message; }
  ok('runPlan refuses a cycle', /cannot run/i.test(threw), threw);
  ok('...and says why', /wait on each other/i.test(threw), threw);
}

console.log('\n=== stop means stop ===');
{
  let started = 0;
  const plan = { steps: ['a', 'b', 'c', 'd'].map((i) => step(i)), maxParallel: 1 };
  const done = await runPlan(plan, async (s) => { started++; await new Promise((r) => setTimeout(r, 5)); return 'x'; },
    () => {}, () => started >= 2);
  ok('it stopped early rather than finishing everything', started < 4, 'started ' + started);
  ok('and nothing was left mid-flight', !done.steps.some((s) => s.state === 'running'),
     JSON.stringify(done.steps.map((s) => [s.id, s.state])));
}

console.log('\n=== what the user is told while it runs ===');
{
  const p = initPlan({ steps: [step('leads', [], 'Meera'), step('pricing', [], 'Arjun'), step('proposal', ['leads']) ] });
  const running = { ...p, steps: p.steps.map((s, i) => (i < 2 ? { ...s, state: 'running' } : s)) };
  const line = describePlan(running);
  ok('it names who is working, not just a count', /Meera/.test(line) && /Arjun/.test(line), line);
  ok('it says what they are doing', /doing leads/.test(line), line);
  ok('and what is still waiting', /1 waiting/.test(line), line);
  ok('never a bare "working"', !/^working/i.test(line), line);
}

console.log('\n=== adding to a task that is already running ===');
{
  // What people remember mid-task is almost always an ADDITION -- "also cc my partner", "skip the
  // ones in Mumbai" -- and today they have to wait for the whole run to finish before saying it.
  const seen = {};
  const plan = { steps: [step('a'), step('b', ['a'])], maxParallel: 1 };
  let added = false;
  const done = await runPlan(
    plan,
    async (s, ctx) => { seen[s.id] = ctx; if (s.id === 'a') added = true; return s.id.toUpperCase(); },
    () => {},
    () => false,
    (stepId) => (added && stepId === 'b' ? 'LATE: also cc the partner' : ''),
  );
  ok('the first step ran without it', !/LATE/.test(seen.a || ''), seen.a);
  ok('the next step received it', /also cc the partner/.test(seen.b || ''), seen.b);
  ok('...alongside what it was waiting for, not instead of it', /A/.test(seen.b || ''), seen.b);
  ok('the run still completed', isFinished(done));
}

console.log('\n=== the boss workflow, turned into a plan ===');
{
  // {{prev}} has always meant "I need the step before me", so every existing prompt must keep
  // behaving exactly as it does today.
  const chain = planFromDelegations([
    { agent_key: 'research_agent', task: 'Find 15 companies' },
    { agent_key: 'cold_outreach', task: 'Using this list {{prev}}, write outreach' },
  ]);
  eq('the first step needs nothing', chain.steps[0].needs, []);
  eq('{{prev}} still means the step before it', chain.steps[1].needs, ['1']);

  // The win: steps that never needed each other stop queueing.
  const wide = planFromDelegations([
    { agent_key: 'research_agent', task: 'Research competitors' },
    { agent_key: 'analyst', task: 'Pull my pricing' },
    { agent_key: 'writer', task: 'Check my calendar' },
  ]);
  ok('three unrelated steps are all independent', wide.steps.every((s) => s.needs.length === 0));
  eq('...so they are one wave', runWaves(wide).length, 1);
  eq('...of three', runWaves(wide)[0].length, 3);
  ok('and it says so', /3 working at the same time/.test(parallelSummary(wide)), parallelSummary(wide));

  // An explicit needs wins over everything.
  const explicit = planFromDelegations([
    { agent_key: 'a', task: 'A' },
    { agent_key: 'b', task: 'B' },
    { agent_key: 'c', task: 'C', needs: ['1', '2'] },
  ]);
  eq('explicit needs is honoured', explicit.steps[2].needs, ['1', '2']);
  eq('the first two go together, then the third', runWaves(explicit).map((w) => w.length), [2, 1]);

  // A model will name an agent rather than a number about half the time.
  const byKey = planFromDelegations([
    { agent_key: 'research_agent', task: 'A' },
    { agent_key: 'writer', task: 'B', needs: ['research_agent'] },
  ]);
  eq('an agent_key dependency resolves to its step', byKey.steps[1].needs, ['1']);

  // A step cannot need itself -- that would deadlock the whole run on one bad line.
  const selfish = planFromDelegations([{ agent_key: 'a', task: 'A', needs: ['1'] }]);
  eq('a self-dependency is dropped', selfish.steps[0].needs, []);
}

console.log('\n=== a badly ordered list is fixed, not obeyed ===');
{
  // The real failure: a model lists the writer first, and the writer opens with an empty {{prev}}.
  const wrong = planFromDelegations([
    { agent_key: 'writer', task: 'Write it up', needs: ['research_agent'] },
    { agent_key: 'research_agent', task: 'Find the facts' },
  ]);
  const order = runWaves(wrong).flat().map((s) => s.agent);
  eq('the researcher is put first regardless of how it was listed', order, ['research_agent', 'writer']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
