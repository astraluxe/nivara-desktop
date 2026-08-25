import {
  buildClaudeArgs, parseClaudeJson, STRIPPED_ENV, availableClis, CLI_LABEL,
} from './agentCli.js';

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
  eq('non-interactive print mode', a.slice(0, 2), ['-p', 'hello']);
  ok('structured output is requested', a.includes('--output-format') && a.includes('json'));
  ok('no model is forced when none is asked for', !a.includes('--model'));
  ok('no session is resumed when none is given', !a.includes('--resume'));

  // The prompt is ONE argument, so it is never split, quoted or truncated. This is what lets the
  // .exe be spawned directly instead of through cmd.exe and its 8191-character limit.
  const long = 'x'.repeat(20000);
  const big = buildClaudeArgs(long);
  eq('a very long prompt stays a single argument', big[1].length, 20000);
  eq('...and is not split across arguments', big.filter((s) => s.startsWith('xxx')).length, 1);

  const b = buildClaudeArgs('hi', { model: 'sonnet', sessionId: 'abc-123', systemPrompt: 'be brief' });
  ok('a model is passed through', b[b.indexOf('--model') + 1] === 'sonnet');
  ok('a session is resumed', b[b.indexOf('--resume') + 1] === 'abc-123');
  ok('an extra system prompt is appended', b[b.indexOf('--append-system-prompt') + 1] === 'be brief');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
