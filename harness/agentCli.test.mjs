import {
  buildClaudeArgs, parseClaudeJson, STRIPPED_ENV, availableClis, CLI_LABEL,
  buildClaudeStreamArgs, parseStreamLine,
  argvLength,
  ARGV_LIMIT,
  usableCliCache,
  CLI_CACHE_TTL_MS,} from './agentCli.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got : ${JSON.stringify(g)}\n        want: ${JSON.stringify(w)}`);

// ── The finding this whole file rests on ─────────────────────────────────────
// Measured on a real machine: with ANTHROPIC_API_KEY set, `claude -p` returned HTTP 401 after three
// minutes of retries. With it cleared, the identical call succeeded in 6.3 seconds. If the app
// inherits that variable it silently bills an API key instead of using the subscription the user
// pays for — the exact opposite of why the bridge exists.
console.log('\n=== the subscription, not somebody\'s API key ===');
ok('ANTHROPIC_API_KEY is cleared before every spawn', STRIPPED_ENV.includes('ANTHROPIC_API_KEY'));
ok('so is the auth-token form',  STRIPPED_ENV.includes('ANTHROPIC_AUTH_TOKEN'));
ok('so is a redirected base URL', STRIPPED_ENV.includes('ANTHROPIC_BASE_URL'));
ok('and the OpenAI equivalents, for Codex', STRIPPED_ENV.includes('OPENAI_API_KEY'));
ok('a parent session identity is not inherited', STRIPPED_ENV.includes('CLAUDE_CODE_SESSION_ID'));

console.log('\n=== the command line ===');
{
  const a = buildClaudeArgs('hello');
  // `-p` with NO inline prompt: the CLI reads it from stdin. These three assertions used to check
  // the opposite — that the prompt was argv[1] — which is precisely what made a long one fatal.
  eq('non-interactive print mode', a[0], '-p');
  ok('the prompt is NOT on the command line', !a.includes('hello'));
  ok('structured output is requested', a.includes('--output-format') && a.includes('json'));
  ok('no model is forced when none is asked for', !a.includes('--model'));
  ok('no session is resumed when none is given', !a.includes('--resume'));

  // A 20,000-character prompt used to be one enormous argument. Together with a 60,440-character
  // system prompt that is over twice the Windows limit, which is how a valid question became
  // "The filename or extension is too long."
  const long = 'x'.repeat(20000);
  const big = buildClaudeArgs(long);
  eq('a very long prompt never reaches argv', big.filter((s) => s.startsWith('xxx')).length, 0);
  ok('...so the command line stays short whatever is asked', argvLength(big) < 200);

  const b = buildClaudeArgs('hi', { model: 'sonnet', sessionId: 'abc-123', systemPrompt: 'be brief' });
  ok('a model is passed through', b[b.indexOf('--model') + 1] === 'sonnet');
  ok('a session is resumed', b[b.indexOf('--resume') + 1] === 'abc-123');
  // Rust stages it to a file and appends --append-system-prompt-file; it never comes through here.
  ok('the system prompt is NOT appended as an argument', !b.includes('--append-system-prompt'));
  ok('...and its text is nowhere in argv', !b.includes('be brief'));
}

console.log('\n=== the CLI gets no tools of its own by default ===');
{
  // The bridge buys THINKING. The hands are adris's own tools, which the user already approves
  // through the normal flow, so the CLI has no business editing files or running commands itself.
  const a = buildClaudeArgs('hello');
  const i = a.indexOf('--allowedTools');
  ok('an allow-list is always sent', i !== -1);
  eq('...and it is empty by default', a[i + 1], '');
  const b = buildClaudeArgs('hello', { allowedTools: ['Read', 'Grep'] });
  eq('an explicit allow-list is honoured', b[b.indexOf('--allowedTools') + 1], 'Read Grep');
}

console.log('\n=== reading the answer ===');
{
  const good = JSON.stringify({ is_error: false, result: 'BRIDGE_OK', session_id: 's1', total_cost_usd: 0.04 });
  const r = parseClaudeJson(good);
  ok('a good reply is ok', r.ok);
  eq('the text comes back', r.text, 'BRIDGE_OK');
  eq('the session id is kept, so the next turn can continue it', r.sessionId, 's1');
  eq('the cost is reported rather than hidden', r.costUsd, 0.04);

  // The real 401 envelope, trimmed to the fields that matter. It carries session_id and a
  // success-looking subtype, which is exactly how an error gets mistaken for an empty answer.
  const err = JSON.stringify({
    is_error: true, subtype: 'success', api_error_status: 401,
    terminal_reason: 'api_error', session_id: 's2', result: '',
  });
  const e = parseClaudeJson(err);
  ok('an error is an error, not an empty reply', !e.ok);
  ok('...and says what kind', /api_error/.test(e.error ?? ''), e.error);
  ok('...and names the status code', /401/.test(e.error ?? ''), e.error);
  ok('..."subtype: success" does not fool it', !e.ok);

  ok('a blank result is not passed off as an answer', !parseClaudeJson(JSON.stringify({ is_error: false, result: '   ' })).ok);
  ok('unparseable output is an error', !parseClaudeJson('not json at all').ok);
  ok('...and keeps the output so it can be shown', /not json at all/.test(parseClaudeJson('not json at all').error ?? ''));

  // A warning line before the envelope is exactly what the real CLI printed when the API key was
  // set, so the parser has to survive it.
  const noisy = '⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set\n'
    + JSON.stringify({ is_error: false, result: 'still fine', session_id: 's3' });
  const n = parseClaudeJson(noisy);
  ok('a warning printed before the JSON does not break it', n.ok, n.error);
  eq('...and the answer is still read', n.text, 'still fine');
}

console.log('\n=== what this machine can offer ===');
eq('nothing installed, nothing offered', availableClis({ claude_code: '', codex: '' }), []);
eq('Claude Code alone', availableClis({ claude_code: 'C:\\x\\claude.exe', codex: '' }), ['claude_code']);
eq('both when both are there',
   availableClis({ claude_code: 'a', codex: 'b' }), ['claude_code', 'codex']);
eq('a missing detection is not a claim', availableClis(null), []);
eq('the labels are the names people use', CLI_LABEL, { claude_code: 'Claude Code', codex: 'Codex' });

console.log('\n=== streaming, and the answer that arrived twice ===');
{
  // These line shapes are the real ones, captured from `claude --output-format stream-json
  // --include-partial-messages`. The CLI sends BOTH the deltas AND a whole `assistant` message
  // carrying the same text -- the first live run printed "12345" as "1234512345".
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
    JSON.stringify({ type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '123' } } }),
    JSON.stringify({ type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '45' } } }),
    JSON.stringify({ type: 'assistant', session_id: 's1', message: { content: [{ type: 'text', text: '12345' }] } }),
    JSON.stringify({ type: 'result', session_id: 's1', is_error: false, result: '12345' }),
  ];

  // Exactly the assembly streamAgentCli performs.
  const assemble = (ls) => {
    let text = '', sawDelta = false, session, done = false, error;
    for (const l of ls) {
      const p = parseStreamLine(l);
      if (p.sessionId) session = p.sessionId;
      if (p.error) error = p.error;
      if (p.done) done = true;
      if (p.kind === 'delta') sawDelta = true;
      if (p.kind === 'whole' && sawDelta) continue;
      if (p.text) text += p.text;
    }
    return { text, session, done, error };
  };

  const r = assemble(lines);
  eq('the answer is assembled once, not twice', r.text, '12345');
  eq('the session id is kept for the next turn', r.session, 's1');
  ok('the end of the stream is seen', r.done);

  // A CLI that cannot send partials must still produce the answer -- the whole-message line is a
  // duplicate only when deltas exist.
  const noDeltas = lines.filter((l) => JSON.parse(l).type !== 'stream_event');
  eq('with no deltas at all it still answers', assemble(noDeltas).text, '12345');

  // The final result line repeats the answer and must never be appended.
  eq('the result envelope contributes no text', parseStreamLine(lines[4]).text, '');
  ok('...but is marked done', parseStreamLine(lines[4]).done);

  // An error envelope is an error, not an empty answer.
  const bad = assemble([JSON.stringify({ type: 'result', is_error: true, api_error_status: 401, terminal_reason: 'api_error', session_id: 's2' })]);
  ok('a failed run reports why', /api_error/.test(bad.error ?? ''), bad.error);
  ok('...with the status code', /401/.test(bad.error ?? ''), bad.error);

  ok('a warning line before the JSON is ignored, not crashed on', parseStreamLine('⚠ something').text === '');
  ok('a half-written line is ignored', parseStreamLine('{"type":"stream_ev').text === '');
}

console.log('\n=== the streaming command line ===');
{
  const a = buildClaudeStreamArgs('hello');
  ok('asks for stream-json', a.includes('stream-json'));
  ok('asks for partial messages, or the "stream" is one lump at the end',
     a.includes('--include-partial-messages'));
  ok('the prompt is not on the command line here either', !a.includes('hello'));
  const b = buildClaudeStreamArgs('hi', { sessionId: 'abc', model: 'sonnet' });
  eq('a session is resumed', b[b.indexOf('--resume') + 1], 'abc');
  eq('the model is passed', b[b.indexOf('--model') + 1], 'sonnet');
  eq('and it still gets no tools of its own', b[b.indexOf('--allowedTools') + 1], '');
}


console.log('\n=== nothing enormous may go back onto the command line ===');
{
  // THE BUG. Asking the boss anything over the Claude bridge died with
  // "could not start claude.exe: The filename or extension is too long. (os error 206)".
  //
  // Nothing was wrong with the filename. Windows caps a whole command line at 32,767 characters —
  // measured on a real machine the cliff sits between 32,000 and 33,000 — and the boss system
  // prompt is 60,440 characters, passed as `--append-system-prompt <the whole thing>`. So the
  // largest agent in the product was unreachable, behind an error that named a file.
  //
  // The system prompt now goes to a FILE and the prompt goes down STDIN, both staged by Rust.
  const huge = 'S'.repeat(60440);      // the real boss prompt length
  const longPrompt = 'P'.repeat(40000); // and a user who pastes a lot

  for (const build of [buildClaudeArgs, buildClaudeStreamArgs]) {
    const args = build(longPrompt, { systemPrompt: huge, model: 'sonnet', allowedTools: [] });
    const joined = args.join(' ');

    ok(`${build.name}: the system prompt is not in argv`, !joined.includes(huge.slice(0, 200)));
    ok(`${build.name}: the user prompt is not in argv`, !joined.includes(longPrompt.slice(0, 200)));
    ok(`${build.name}: the command line stays under the Windows limit`,
      argvLength(args) < ARGV_LIMIT, `${argvLength(args)} chars`);
    // It must still be a -p run, or the CLI waits for an interactive session that never comes.
    ok(`${build.name}: still asks for a printed answer`, args.includes('-p'));
    ok(`${build.name}: still passes the model`, args.includes('sonnet'));
  }

  // The old shape, so the regression is described rather than merely absent.
  const oldStyle = ['-p', longPrompt, '--append-system-prompt', huge];
  ok('the shape that used to be built WOULD have blown the limit',
    argvLength(oldStyle) > 32767, `${argvLength(oldStyle)} chars`);

  ok('argvLength counts quoting overhead', argvLength(['ab', 'cd']) > 4);
  ok('an empty command line is zero', argvLength([]) === 0);
}


console.log('\n=== "not installed" is never remembered ===');
{
  // THE BUG. The first launch, before the user had Claude Code, cached `{claude_code: ''}` — and
  // the cache never expired. After that the menu said "set it up" forever: installing Claude Code
  // changed nothing, signing in changed nothing, and the app was answering from a cache of the
  // user's past. An absent tool is precisely the thing they are about to go and add.
  const now = 1_700_000_000_000;
  const found = JSON.stringify({ claude_code: 'C:/x/claude.exe', codex: '', at: now });

  ok('a real detection is remembered', !!usableCliCache(found, now));
  ok('...and its path comes back', usableCliCache(found, now).claude_code.endsWith('claude.exe'));

  ok('an empty detection is NEVER remembered',
    usableCliCache(JSON.stringify({ claude_code: '', codex: '', at: now }), now) === null);
  ok('...not even a fresh one', 
    usableCliCache(JSON.stringify({ claude_code: '', codex: '', at: now }), now + 1000) === null);

  // A CLI can be uninstalled, so even a good answer goes stale.
  ok('a stale positive is re-checked',
    usableCliCache(found, now + CLI_CACHE_TTL_MS + 1) === null);
  ok('...but not before it needs to be',
    !!usableCliCache(found, now + CLI_CACHE_TTL_MS - 1000));

  // Anything written by the version that could cache absence is not trusted.
  ok('the old untimestamped shape is re-checked once',
    usableCliCache(JSON.stringify({ claude_code: 'C:/x/claude.exe', codex: '' }), now) === null);

  ok('nothing stored is nothing believed', usableCliCache(null, now) === null);
  ok('rubbish does not crash it', usableCliCache('{{{', now) === null);
  ok('a codex-only machine is remembered too',
    !!usableCliCache(JSON.stringify({ claude_code: '', codex: 'C:/x/codex.exe', at: now }), now));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
