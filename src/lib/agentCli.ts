// ─── Using the user's own Claude Code / Codex subscription ───────────────────
//
// THE IDEA. The user already pays for a coding-agent subscription far larger than anything this app
// could resell them. So adris stops being a reseller of tokens and becomes the HANDS — real Word and
// Excel, the browser, their files, their mailbox — while their own subscription is the BRAIN. The
// commercial shape follows: a licence for the bridge, not a margin on somebody else's tokens.
//
// ── THE ONE THING THAT MAKES OR BREAKS IT ────────────────────────────────────
//
// Claude Code prefers ANTHROPIC_API_KEY over the user's claude.ai login whenever both are present,
// and says so:
//
//     "claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set
//      and takes precedence over your claude.ai login"
//
// If the app inherits that variable from anywhere — a shell profile, a launcher, another tool — the
// bridge silently bills an API key instead of using the subscription the user is paying for. That
// is the exact opposite of the point.
//
// Measured on a real machine: with the variable set, the call returned HTTP 401 after three minutes
// of retries. With it cleared, the same call succeeded in 6.3 seconds. STRIPPED_ENV is that finding,
// written down and enforced on every spawn.
//
// ── WHY A FULL PATH AND NOT "claude" ─────────────────────────────────────────
//
// On Windows npm installs `claude` as a .cmd shim, and CreateProcess does not apply PATHEXT, so
// spawning "claude" fails outright. Routing through cmd.exe to reach the .cmd would reintroduce
// quoting and its 8191-character command line, which a real prompt exceeds. The shim only execs
// .../claude-code/bin/claude.exe, so the bridge resolves and spawns that directly.

export type AgentCli = 'claude_code' | 'codex';

export interface CliPaths {
  claude_code: string;
  codex: string;
}

export interface CliRunResult {
  ok: boolean;
  text: string;
  sessionId?: string;
  costUsd?: number;
  error?: string;
}

/**
 * Auth variables cleared before the CLI is spawned, so it falls back to the user's own login.
 *
 * ANTHROPIC_API_KEY is the one that was actually measured. The others are the same class of thing —
 * an alternative auth source that would quietly take precedence — and cost nothing to clear.
 */
export const STRIPPED_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  // Set inside a running Claude Code session. Left in place, a nested spawn can inherit the parent's
  // session identity instead of starting its own conversation.
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
];

export const CLI_LABEL: Record<AgentCli, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
};

// ── Building the command line ────────────────────────────────────────────────

export interface RunOptions {
  /** Continue an existing conversation instead of starting a new one. */
  sessionId?: string;
  /** 'sonnet' | 'opus' | 'haiku', or a full model id. Omitted means the user's own default. */
  model?: string;
  /**
   * What the agent is allowed to do on its own.
   *
   * Defaults to the most restrictive useful thing. This bridge is used for THINKING — the hands are
   * adris's own tools, which the user already approves through the normal flow — so the CLI has no
   * business editing files or running commands of its own by default.
   */
  allowedTools?: string[];
  systemPrompt?: string;
}

/**
 * ── NOTHING LONG GOES ON THE COMMAND LINE ───────────────────────────────────
 *
 * Windows caps an entire command line at **32,767 characters** and returns
 * *"The filename or extension is too long. (os error 206)"* past it — measured on a real machine,
 * the cliff sits between 32,000 and 33,000. The boss system prompt is **60,440 characters**, so
 * every question put to the boss over the Claude bridge failed, with an error blaming a filename.
 *
 * So the prompt goes down **stdin** and the system prompt goes into a **file** that Rust stages and
 * deletes. `argvLength` below is the assertion that keeps it that way.
 */
export function buildClaudeArgs(_prompt: string, opts: RunOptions = {}): string[] {
  // `-p` with no inline prompt: the CLI reads it from stdin. Verified against claude 2.1.251.
  const args = ['-p', '--output-format', 'json'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.sessionId) args.push('--resume', opts.sessionId);
  // An empty list is meaningful and must still be sent: it says "no tools", which is different from
  // saying nothing and inheriting whatever the user's own settings allow.
  args.push('--allowedTools', (opts.allowedTools ?? []).join(' '));
  return args;
}

export function buildCodexArgs(prompt: string, opts: RunOptions = {}): string[] {
  // Codex is not installed on the machine this was written against, so this is the documented
  // shape and NOT something that has been run. It is kept deliberately minimal for that reason,
  // and detectClis() will simply not offer Codex until it is present and can be tested.
  const args = ['exec', '--json'];
  if (opts.model) args.push('--model', opts.model);
  args.push(prompt);
  return args;
}

// ── Reading the answer ───────────────────────────────────────────────────────

/**
 * Pull the reply out of `claude --output-format json`.
 *
 * The envelope carries a great deal besides the text — usage, cost, permission denials, subagent
 * statistics. Only three things matter here, and an error is reported as an error rather than as an
 * empty answer, because a caller that cannot tell those apart will present silence as a reply.
 */
export function parseClaudeJson(raw: string): CliRunResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Not JSON at all. Sometimes a CLI prints a warning line before the envelope, so try the last
    // line that looks like an object before giving up.
    const line = raw.split('\n').reverse().find((l) => l.trim().startsWith('{'));
    if (!line) return { ok: false, text: '', error: raw.slice(0, 400) || 'no output' };
    try { data = JSON.parse(line) as Record<string, unknown>; }
    catch { return { ok: false, text: '', error: raw.slice(0, 400) }; }
  }

  const sessionId = typeof data.session_id === 'string' ? data.session_id : undefined;
  const costUsd = typeof data.total_cost_usd === 'number' ? data.total_cost_usd : undefined;

  if (data.is_error === true) {
    const status = typeof data.api_error_status === 'number' ? ` (HTTP ${data.api_error_status})` : '';
    const reason = typeof data.terminal_reason === 'string' ? data.terminal_reason : 'the agent reported an error';
    return { ok: false, text: '', sessionId, costUsd, error: `${reason}${status}` };
  }

  const text = typeof data.result === 'string' ? data.result
    : typeof data.text === 'string' ? data.text
      : '';
  if (!text.trim()) return { ok: false, text: '', sessionId, costUsd, error: 'the agent returned an empty answer' };
  return { ok: true, text, sessionId, costUsd };
}

// ── Detection ────────────────────────────────────────────────────────────────

const CACHE_KEY = 'nv-agent-cli';

/** A positive detection is trusted for this long. A CLI can also be uninstalled. */
export const CLI_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Is a stored detection still worth believing?
 *
 * ── NEVER CACHE "NOT INSTALLED" ─────────────────────────────────────────────
 *
 * This used to cache whatever detection returned, forever, including an empty result. So the first
 * launch — before the user had Claude Code — wrote `{claude_code: ''}` to localStorage, and after
 * that the menu said **"set it up"** permanently. Installing Claude Code changed nothing. Signing in
 * changed nothing. The app was answering from a cache of the user's past.
 *
 * An absent tool is exactly the thing the user is about to go and add, so absence is the one answer
 * that must never be remembered. A found tool is cached, and even that expires, because a CLI can be
 * uninstalled too.
 */
export function usableCliCache(raw: string | null, now = Date.now()): CliPaths | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CliPaths> & { at?: number };
    if (typeof v.claude_code !== 'string') return null;
    // Nothing found is never remembered, whatever its age.
    if (!v.claude_code && !v.codex) return null;
    // The old shape had no timestamp. Treat it as stale so it is checked once more, rather than
    // trusting a value written by a version that could cache absence.
    if (typeof v.at !== 'number') return null;
    if (now - v.at > CLI_CACHE_TTL_MS) return null;
    return { claude_code: v.claude_code, codex: v.codex ?? '' };
  } catch { return null; }
}

export function loadCachedClis(): CliPaths | null {
  try { return usableCliCache(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}

export async function detectClis(opts: { force?: boolean } = {}): Promise<CliPaths> {
  if (!opts.force) {
    const cached = loadCachedClis();
    if (cached) return cached;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const paths = JSON.parse(await invoke<string>('agent_cli_detect')) as CliPaths;
    const clean: CliPaths = { claude_code: paths.claude_code || '', codex: paths.codex || '' };
    // Only a POSITIVE result is written. See usableCliCache.
    if (clean.claude_code || clean.codex) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...clean, at: Date.now() })); }
      catch { /* quota */ }
    } else {
      try { localStorage.removeItem(CACHE_KEY); } catch { /* quota */ }
    }
    return clean;
  } catch {
    return { claude_code: '', codex: '' };
  }
}

/** Which bridges this machine can actually offer. */
export function availableClis(paths: CliPaths | null): AgentCli[] {
  if (!paths) return [];
  const out: AgentCli[] = [];
  if (paths.claude_code) out.push('claude_code');
  if (paths.codex) out.push('codex');
  return out;
}

// ── Running ──────────────────────────────────────────────────────────────────

/**
 * Ask the user's own agent CLI a question.
 *
 * Never throws: every failure comes back as `ok: false` with something the caller can show, because
 * the callers are background tasks that must degrade rather than die.
 */
export async function runAgentCli(
  which: AgentCli,
  prompt: string,
  opts: RunOptions & { cwd?: string; timeoutSecs?: number } = {},
): Promise<CliRunResult> {
  const paths = await detectClis();
  const exe = which === 'claude_code' ? paths.claude_code : paths.codex;
  if (!exe) {
    return { ok: false, text: '', error: `${CLI_LABEL[which]} is not installed on this computer.` };
  }
  // NEVER RUN A BRIDGE THAT IS BILLING AN API KEY. The user connected a subscription precisely so
  // they would not be charged per message; running anyway would be the one failure this feature
  // cannot have. Returned as an error rather than thrown, because callers here are background jobs
  // that must degrade rather than die.
  const blocked = await guardSubscription(which, exe);
  if (blocked) return { ok: false, text: '', error: blocked };

  const args = which === 'claude_code' ? buildClaudeArgs(prompt, opts) : buildCodexArgs(prompt, opts);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<string>('agent_cli_run', {
      exe,
      args,
      cwd: opts.cwd ?? null,
      clearEnv: STRIPPED_ENV,
      timeoutSecs: opts.timeoutSecs ?? 300,
      // Both kept off the command line. Codex still takes its prompt as an argument, so only the
      // Claude path uses stdin here.
      systemPrompt: which === 'claude_code' ? (opts.systemPrompt ?? null) : null,
      stdinText: which === 'claude_code' ? prompt : null,
    });
    return parseClaudeJson(raw);
  } catch (e) {
    return { ok: false, text: '', error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Streaming, for the chat ─────────────────────────────────────────────────
//
// runAgentCli returns only when the CLI is finished, which is right for a background job and wrong
// for a conversation: the user watches a spinner and then a whole reply lands at once. Krew streams
// everything else, so a bridged chat that did not would feel broken rather than merely different.
//
// `--output-format stream-json` emits one JSON object per line. Only a few of them carry text a
// person should see; the rest are bookkeeping, and forwarding those to the chat would spray tool
// plumbing across the answer.

export function buildClaudeStreamArgs(_prompt: string, opts: RunOptions = {}): string[] {
  const args = [
    // The prompt comes down stdin — see buildClaudeArgs for why.
    '-p',
    '--output-format', 'stream-json',
    // Without this the "stream" is one object at the end, which defeats the point entirely.
    '--include-partial-messages',
    // stream-json input is not used, but the CLI requires the pair to be stated explicitly.
    '--verbose',
  ];
  if (opts.model) args.push('--model', opts.model);
  if (opts.sessionId) args.push('--resume', opts.sessionId);
  args.push('--allowedTools', (opts.allowedTools ?? []).join(' '));
  return args;
}

/** What Windows will actually accept on a command line, with room to spare for the exe path. */
export const ARGV_LIMIT = 30000;

/**
 * How long the command line these args produce will be.
 *
 * Quoting adds a couple of characters per argument; the exact figure does not matter because the
 * limit is 32,767 and this is checked against 30,000. What matters is that nothing enormous can
 * creep back into argv without a test noticing.
 */
export function argvLength(args: string[]): number {
  return args.reduce((n, a) => n + a.length + 3, 0);
}

export interface StreamPiece {
  /**
   * Where this text came from, and it matters more than it looks.
   *
   * 'delta' — a few characters as they are written.
   * 'whole' — the complete message, repeated. The CLI emits BOTH: the deltas as it goes, and then
   *           an `assistant` line carrying the entire answer again. Appending both is how the reply
   *           ends up printed twice, which is exactly what happened the first time this was run
   *           against the real CLI ("12345" became "1234512345"). The caller must take 'whole' only
   *           when it has seen no deltas at all — see streamAgentCli.
   */
  kind?: 'delta' | 'whole';
  /** Text to append to the visible answer. Empty for lines that are pure bookkeeping. */
  text: string;
  /** Present on the line that carries it, so the next turn can continue the conversation. */
  sessionId?: string;
  /** Set when the CLI reported a failure rather than an answer. */
  error?: string;
  done?: boolean;
}

/**
 * Read one line of the stream.
 *
 * WHAT COUNTS AS TEXT. The CLI emits assistant messages, tool calls, tool results, usage totals and
 * a final result envelope. Only the assistant's own words belong in the bubble — a tool_use block
 * rendered as text is how an answer ends up with JSON in the middle of it.
 *
 * The final `result` line repeats the whole answer. It is deliberately NOT emitted as text: it
 * would double every reply that had already streamed.
 */
export function parseStreamLine(line: string): StreamPiece {
  let o: Record<string, unknown>;
  try { o = JSON.parse(line) as Record<string, unknown>; }
  catch { return { text: '' }; }        // a warning line, or a partial write — not an answer

  const type = String(o.type ?? '');
  const sessionId = typeof o.session_id === 'string' ? o.session_id : undefined;

  if (type === 'result') {
    if (o.is_error === true) {
      const status = typeof o.api_error_status === 'number' ? ` (HTTP ${o.api_error_status})` : '';
      const reason = typeof o.terminal_reason === 'string' ? o.terminal_reason : 'the agent reported an error';
      return { text: '', sessionId, error: `${reason}${status}`, done: true };
    }
    return { text: '', sessionId, done: true };
  }

  // The incremental form: a delta carrying a few characters of the answer.
  if (type === 'stream_event') {
    const ev = (o.event ?? {}) as Record<string, unknown>;
    const delta = (ev.delta ?? {}) as Record<string, unknown>;
    if (String(ev.type ?? '') === 'content_block_delta' && typeof delta.text === 'string') {
      return { kind: 'delta', text: delta.text, sessionId };
    }
    return { text: '', sessionId };
  }

  // The WHOLE assistant message, which the CLI sends IN ADDITION to the deltas rather than instead
  // of them. Marked, not dropped: it is the only text there is when partial messages are
  // unavailable, and the only text there is a duplicate when they are not.
  if (type === 'assistant') {
    const msg = (o.message ?? {}) as Record<string, unknown>;
    const content = Array.isArray(msg.content) ? msg.content : [];
    const text = content
      .filter((b): b is { type: string; text: string } =>
        !!b && typeof b === 'object' && (b as { type?: string }).type === 'text')
      .map((b) => b.text)
      .join('');
    return { kind: 'whole', text, sessionId };
  }

  return { text: '', sessionId };
}

export interface StreamHandle { sessionId?: string; text: string; error?: string }

/**
 * Ask the CLI and stream the answer.
 *
 * `onText` is called with each new fragment. Resolves when the CLI finishes; never throws, because
 * the caller is a chat turn that has to end tidily whatever happened.
 */
export async function streamAgentCli(
  which: AgentCli,
  prompt: string,
  onText: (chunk: string) => void,
  opts: RunOptions & { cwd?: string; timeoutSecs?: number } = {},
): Promise<StreamHandle> {
  const paths = await detectClis();
  const exe = which === 'claude_code' ? paths.claude_code : paths.codex;
  if (!exe) return { text: '', error: `${CLI_LABEL[which]} is not installed on this computer.` };
  if (which !== 'claude_code') {
    // Codex has never been run here; claiming to stream it would be a guess.
    return { text: '', error: 'Streaming is only wired up for Claude Code so far.' };
  }

  // The same guard as runAgentCli, and for the same reason. These two functions are every route
  // from the app to a CLI, so between them they are every place this can be enforced — and the
  // chat is the one that would spend the most money before anyone noticed.
  const blocked = await guardSubscription(which, exe);
  if (blocked) return { text: '', error: blocked };

  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const id = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let text = '';
  let sessionId: string | undefined;
  let error: string | undefined;
  // Whether the CLI is actually streaming. If it is, the whole-message lines are duplicates of what
  // has already been shown and must be ignored; if it is not, they are the only answer there is.
  let sawDelta = false;

  const offs: (() => void)[] = [];
  const finished = new Promise<void>((resolve) => {
    listen<{ id: string; line: string }>('agent-cli-chunk', (e) => {
      if (e.payload?.id !== id) return;
      const p = parseStreamLine(e.payload.line);
      if (p.sessionId) sessionId = p.sessionId;
      if (p.error) error = p.error;
      if (p.kind === 'delta') sawDelta = true;
      // The duplication guard. Measured against the real CLI: without it a five-line answer
      // arrived twice.
      if (p.kind === 'whole' && sawDelta) return;
      if (p.text) { text += p.text; onText(p.text); }
    }).then((f) => offs.push(f));

    listen<{ id: string; error: string }>('agent-cli-error', (e) => {
      if (e.payload?.id !== id) return;
      error = e.payload.error;
      resolve();
    }).then((f) => offs.push(f));

    listen<{ id: string; stderr: string }>('agent-cli-done', (e) => {
      if (e.payload?.id !== id) return;
      // stderr only becomes the error when nothing was produced — the CLI writes warnings there
      // during perfectly good runs, and surfacing those as failures would be its own bug.
      if (!text.trim() && !error && e.payload.stderr?.trim()) error = e.payload.stderr.trim().slice(0, 400);
      resolve();
    }).then((f) => offs.push(f));
  });

  try {
    await invoke('agent_cli_stream', {
      id, exe,
      args: buildClaudeStreamArgs(prompt, opts),
      cwd: opts.cwd ?? null,
      clearEnv: STRIPPED_ENV,
      timeoutSecs: opts.timeoutSecs ?? 600,
      systemPrompt: opts.systemPrompt ?? null,
      stdinText: prompt,
    });
    await finished;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    for (const off of offs) { try { off(); } catch { /* ignore */ } }
  }

  if (!text.trim() && !error) error = 'the agent returned an empty answer';
  return { text, sessionId, error };
}

// ── Setting it up, for someone who has never opened a terminal ────────────────
//
// THE GAP THIS CLOSES. Everything above assumes the CLI is already there. For the people this
// product is built for it is not, and "npm install -g @anthropic-ai/claude-code" is three
// impossible steps: know what a terminal is, have Node, and know what to do when npm prints a
// permissions error. The app installs it instead — its own Node, its own folder, nothing on the
// user's PATH and nothing needing Administrator. See agent_cli_install in Rust.

export interface CliInstallProgress { which: AgentCli; step: string; pct: number }

/**
 * Install a bridge for the user. Resolves with the path it landed at.
 *
 * `onProgress` is fed from the Rust side, including a ticking counter while npm is silent — an
 * install of this size says nothing for minutes and a bar that does not move reads as a hang.
 */
export async function installCli(
  which: AgentCli,
  onProgress?: (p: CliInstallProgress) => void,
): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  let off: (() => void) | null = null;
  if (onProgress) {
    off = await listen<CliInstallProgress>('agent_cli_progress', (e) => {
      if (e.payload?.which === which) onProgress(e.payload);
    });
  }
  try {
    const path = await invoke<string>('agent_cli_install', { which });
    clearAuthCache();
    // The cache is what `availableClis` reads. Left stale, the menu would go on saying "not
    // installed" about something that just finished installing.
    await detectClis({ force: true });
    return path;
  } finally {
    try { off?.(); } catch { /* ignore */ }
  }
}

/** Remove a bridge this app installed. Never touches a copy the user installed themselves. */
export async function uninstallCli(which: AgentCli): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('agent_cli_uninstall', { which });
  await detectClis({ force: true });
}

/**
 * Whether the user is SIGNED IN, and to what.
 *
 * `subscription` is the field that matters most and the one nothing asked about before. Claude Code
 * prefers an API key over the user's login when both are present — so a CLI can be installed,
 * "working", and quietly billing per token instead of using the subscription the whole bridge
 * exists to use. `authMethod: 'claude.ai'` is the good case; anything else is worth saying out loud.
 */
export interface CliAuth {
  state: 'signed_in' | 'signed_out' | 'unknown';
  email?: string;
  plan?: string;
  /** True when it is running on the user's SUBSCRIPTION rather than a metered API key. */
  subscription?: boolean;
  detail?: string;
  /** ms since epoch, from the credential file. Lets the panel warn before a task fails. */
  expiresAt?: number;
  refreshExpiresAt?: number;
  /** Which signals agreed — 'cli', 'file', or 'both'. 'both' is the only fully evidenced answer. */
  source?: 'cli' | 'file' | 'both';
}

/** The non-secret half of the CLI's own credential file. Never carries a token — see the Rust
 *  `agent_cli_credentials`, which cannot return one. */
export interface CliCredentials {
  found: boolean;
  reason?: string;
  /** The OAuth block is present — for Claude Code that block IS the subscription login. */
  oauth?: boolean;
  subscriptionType?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  rateLimitTier?: string;
  scopeCount?: number;
  /** Codex only, and the case worth being certain about: a metered key is configured. */
  apiKeyPresent?: boolean;
  /** Codex only: the file's shape was read from documentation, never confirmed on a real install. */
  verified?: boolean;
}

/**
 * Two signals, one answer.
 *
 * Asking the CLI is asking a program to describe itself; reading the file it wrote is evidence.
 * On the money question they are combined, because being wrong costs the user real money and one
 * source is not enough. Pure and exported so it can be tested without a machine that has either
 * CLI installed.
 */
export function mergeAuth(cli: CliAuth, file: CliCredentials | null): CliAuth {
  const out: CliAuth = { ...cli };
  if (!file?.found) return { ...out, source: 'cli' };

  out.source = cli.state === 'unknown' ? 'file' : 'both';
  if (file.expiresAt) out.expiresAt = file.expiresAt;
  if (file.refreshTokenExpiresAt) out.refreshExpiresAt = file.refreshTokenExpiresAt;
  if (!out.plan && file.subscriptionType) out.plan = file.subscriptionType;

  // A credential file the CLI itself wrote, carrying an OAuth block and a subscription type, is
  // stronger evidence of "on the subscription" than a status line — so it can promote an unknown.
  if (file.oauth && file.subscriptionType && out.subscription === undefined) out.subscription = true;
  // Codex's metered path is the one case where the file is decisive on its own.
  if (file.apiKeyPresent) out.subscription = false;
  // The CLI could not be asked, but its file says it is signed in.
  if (out.state === 'unknown' && file.oauth) out.state = 'signed_in';
  return out;
}

export type Verdict = 'subscription' | 'api_key' | 'signed_out' | 'unknown';

/**
 * Is this bridge safe to run, and what do we tell the user if not.
 *
 * ── WHY THIS BLOCKS ON `api_key` AND ONLY WARNS ON `unknown` ─────────────────
 *
 * The roadmap's rule is "a bridge that cannot prove it is on the subscription is a broken bridge",
 * and the strictest reading — refuse unless proven — is the wrong one to put in the RUN path. The
 * status output is a format we do not control: one CLI update that renames a field would turn every
 * working install into a dead one, which is a worse failure than the one being prevented.
 *
 * So the split is:
 *   - `api_key`  → REFUSE. Positively detected, costs the user money per message, and is exactly
 *                  what the whole feature exists to avoid. There is no reading where running is right.
 *   - `unknown`  → run, and let the panel say it could not be confirmed. Ambiguity is not evidence
 *                  of harm, and bricking a working bridge on a parsing change is not safety.
 *
 * The SETUP PANEL is the strict half: it never claims "Ready" without positive evidence. The
 * runtime refuses only what it can prove is wrong. Together that is "never silently metered"
 * without "breaks on a field rename".
 */
export function subscriptionVerdict(auth: CliAuth): { verdict: Verdict; message?: string } {
  if (auth.state === 'signed_out') {
    return { verdict: 'signed_out', message: 'Not signed in. Open the AI menu at the top of the window and sign in.' };
  }
  if (auth.subscription === false) {
    return {
      verdict: 'api_key',
      message: 'This is signed in with an API key, which is billed per message, not with the '
             + 'subscription you pay for. adris has not run it. Sign in again from the AI menu at '
             + 'the top of the window to switch it to your subscription.',
    };
  }
  if (auth.subscription === true) return { verdict: 'subscription' };
  return { verdict: 'unknown' };
}

/** Days until the sign-in has to be renewed, or null when nothing says. */
export function daysUntilExpiry(auth: CliAuth, now = Date.now()): number | null {
  // The REFRESH token is the one that ends the session. The access token expiring is routine and
  // renewed silently; warning about it would cry wolf every few hours.
  const t = auth.refreshExpiresAt;
  if (!t || !Number.isFinite(t)) return null;
  return Math.floor((t - now) / 86_400_000);
}

export function parseAuthStatus(which: AgentCli, raw: string): CliAuth {
  const text = (raw || '').trim();
  if (!text) return { state: 'unknown' };
  if (which === 'claude_code') {
    try {
      const j = JSON.parse(text) as {
        loggedIn?: boolean; authMethod?: string; email?: string; subscriptionType?: string;
      };
      if (typeof j.loggedIn === 'boolean') {
        return {
          state: j.loggedIn ? 'signed_in' : 'signed_out',
          email: j.email,
          plan: j.subscriptionType,
          // 'claude.ai' means the login. An api-key method is the case worth warning about.
          subscription: j.authMethod === 'claude.ai',
          detail: j.authMethod,
        };
      }
    } catch { /* not JSON — fall through to the text reading below */ }
  }
  // Codex prints prose here, and so does Claude Code when something went wrong before it could
  // produce JSON. Read it leniently rather than calling a readable answer an error.
  const lower = text.toLowerCase();
  const signedOut = /not (logged|signed) in|no (credentials|account)|please (log|sign) in|unauthenticated/.test(lower);
  const signedIn = !signedOut && /(logged|signed) in|account:|authenticated/.test(lower);
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  return {
    state: signedOut ? 'signed_out' : signedIn ? 'signed_in' : 'unknown',
    email,
    subscription: signedIn ? true : undefined,
    detail: text.slice(0, 200),
  };
}

/** The non-secret half of the credential file the CLI itself wrote. */
export async function readCliCredentials(which: AgentCli): Promise<CliCredentials | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return JSON.parse(await invoke<string>('agent_cli_credentials', { which })) as CliCredentials;
  } catch { return null; }
}

export async function cliAuthStatus(which: AgentCli, exe: string): Promise<CliAuth> {
  let fromCli: CliAuth;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<string>('agent_cli_auth_status', { exe, which });
    fromCli = parseAuthStatus(which, raw);
  } catch (e) {
    fromCli = { state: 'unknown', detail: e instanceof Error ? e.message : String(e) };
  }
  // Both signals, always. Asking the CLI is asking a program to describe itself; its credential
  // file is evidence. On the question of who is being billed, one source is not enough.
  return mergeAuth(fromCli, await readCliCredentials(which));
}

// ── The guard on the run path ────────────────────────────────────────────────
//
// Checked here rather than at the four call sites, because every bridged call in the app —
// the Krew chat, Coder, Guard scans, automations, the Quick Bar, Studio — reaches the CLI through
// `runAgentCli` or `streamAgentCli`. A check at one of those is a check at all of them, and a
// check placed anywhere else is one somebody will forget to copy.
//
// CACHED, because it costs a subprocess spawn. Doing it per message would add ~1s to every turn to
// re-answer a question whose answer changes when the user signs in and essentially never otherwise.
// The cache is cleared on sign-in and on install, which are the only two events that change it.

const AUTH_TTL_MS = 10 * 60 * 1000;
let authCache: { which: AgentCli; at: number; auth: CliAuth } | null = null;

/** Forget the cached sign-in state — call after anything that could change it. */
export function clearAuthCache(): void { authCache = null; }

/**
 * Refuse to run a bridge that is positively known to be billing an API key.
 *
 * Returns an error string to show the user, or null to proceed. See `subscriptionVerdict` for why
 * this blocks `api_key` and lets `unknown` through — the short version is that refusing what we
 * cannot parse would turn one CLI field rename into a dead feature for everybody.
 */
export async function guardSubscription(which: AgentCli, exe: string): Promise<string | null> {
  const fresh = authCache && authCache.which === which && Date.now() - authCache.at < AUTH_TTL_MS;
  const auth = fresh ? authCache!.auth : await cliAuthStatus(which, exe);
  if (!fresh) authCache = { which, at: Date.now(), auth };
  const { verdict, message } = subscriptionVerdict(auth);
  return verdict === 'api_key' ? (message ?? 'This bridge is billing an API key.') : null;
}

/**
 * Open the CLI's own sign-in in a window the user can see.
 *
 * Deliberately visible — signing in is a conversation the CLI has with the user, and hiding it is
 * how the app comes to look like it did nothing. The caller must warn first: an unexplained black
 * window is alarming to exactly the person this feature exists for.
 */
export async function cliLogin(which: AgentCli, exe: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('agent_cli_login', { exe, which });
  // Signing in is the one event that changes the answer the guard caches.
  clearAuthCache();
}

// ── How much of the subscription has been used ───────────────────────────────
//
// WHY THE APP SHOWS THIS AT ALL. Someone on a ₹400 Codex or ₹2,000 Claude plan is routing adris
// through a budget they can feel, so "how much have I used?" is a real question with a real
// consequence — and answering it used to mean leaving the app and going to look at a website.
//
// WHAT IT CAN AND CANNOT SAY, stated once so the UI never overclaims: Claude Code records what each
// turn COST in tokens, and nothing on this machine records what the plan's ceiling is. So this
// reports USE, honestly, and never a percentage of a limit it cannot see. A made-up "83% of your
// weekly quota" would be worse than no number at all.

export interface UsageCell { in: number; out: number; cr: number; cw: number; n: number }
export interface UsageBucket extends UsageCell { h: number }   // h = start of the hour, ms
export interface CliUsage {
  ok: boolean;
  reason?: string;
  detail?: string;
  since?: number;
  files?: number;
  turns?: number;
  buckets?: UsageBucket[];
  models?: Record<string, UsageCell>;
}

export async function readCliUsage(which: AgentCli, days = 7): Promise<CliUsage> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const sinceMs = Date.now() - days * 86_400_000;
    return JSON.parse(await invoke<string>('agent_cli_usage', { which, sinceMs })) as CliUsage;
  } catch (e) {
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}

export const emptyCell = (): UsageCell => ({ in: 0, out: 0, cr: 0, cw: 0, n: 0 });

export function addCell(a: UsageCell, b: UsageCell): UsageCell {
  return { in: a.in + b.in, out: a.out + b.out, cr: a.cr + b.cr, cw: a.cw + b.cw, n: a.n + b.n };
}

/**
 * Hourly buckets rolled into local calendar days.
 *
 * LOCAL, not UTC, and that is the whole reason this is a function rather than a division. The
 * buckets arrive as UTC hours; a user in IST who worked at 2am would otherwise see that work land
 * on the previous day, and "yesterday" is a word people check against their own memory.
 *
 * Every day in the range is returned, including empty ones — a chart that silently omits quiet days
 * compresses time and makes a burst look like steady use.
 */
export function rollUpDaily(buckets: UsageBucket[], days: number, now = Date.now()): Array<UsageCell & { day: number }> {
  const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = startOfDay(now);
  const out: Array<UsageCell & { day: number }> = [];
  for (let i = days - 1; i >= 0; i--) out.push({ ...emptyCell(), day: today - i * 86_400_000 });
  const index = new Map(out.map((d) => [d.day, d]));
  for (const b of buckets) {
    const slot = index.get(startOfDay(b.h));
    if (!slot) continue;   // older than the window the caller asked to draw
    slot.in += b.in; slot.out += b.out; slot.cr += b.cr; slot.cw += b.cw; slot.n += b.n;
  }
  return out;
}

/** Everything in the range, added up. */
export function totalUsage(buckets: UsageBucket[]): UsageCell {
  return buckets.reduce<UsageCell>((a, b) => addCell(a, b), emptyCell());
}

/** Just the hours that fall on today, locally. */
export function todayUsage(buckets: UsageBucket[], now = Date.now()): UsageCell {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  return totalUsage(buckets.filter((b) => b.h >= start));
}

/**
 * A token count a non-technical person can read.
 *
 * Nobody outside this industry knows what a token is, and 944,500,000 is not a number anyone parses
 * at a glance. Short forms keep the shape of the number without asking for arithmetic.
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

/** "Opus 5" out of "claude-opus-5" — the model list is for recognising, not for copying. */
export function prettyModel(id: string): string {
  return id
    .replace(/^(claude|anthropic|openai|gpt)[-/]/i, '')
    .replace(/-(\d{8})$/, '')
    .split(/[-_]/)
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .trim() || id;
}

// ─── The window that actually matters ────────────────────────────────────────
//
// WHAT WAS WRONG WITH "TODAY". The usage panel showed today and this week, and a day is not a unit
// any of these plans use. Claude's allowance resets on a rolling FIVE-HOUR window, with a second
// limit over seven days. So a user who has just been told "58k today" still cannot answer the only
// question they actually have — *can I keep working right now, or should I wait?*
//
// ── WHY THERE IS NO PERCENTAGE BY DEFAULT ───────────────────────────────────
//
// Checked properly rather than assumed: the credential file holds `rateLimitTier` and
// `subscriptionType` — a tier NAME, not a remaining count — and no transcript carries a rate-limit
// header. Claude Code's own `/usage` fetches the number live using the OAuth token, and using that
// token ourselves is exactly what this product refuses to do (see the subscription rules: adris
// spawns the official client precisely so it never holds the token).
//
// So the denominator is genuinely not ours to know. Two honest options, and both are taken:
//   - Report the NUMERATOR precisely — replies and tokens in the live window, and when it resets.
//     That is real, local, and directly comparable to what the user knows about their own plan.
//   - Let the user tell us their limit if they know it. Then the percentage is THEIR number, and
//     it is labelled as theirs. A percentage against a figure we guessed would be a number they
//     trust and we invented, which is worse than no number at all.

export interface UsageWindow {
  /** ms since epoch when this window began. */
  from: number;
  /** ms since epoch when the oldest usage in it falls out and room frees up. */
  resetsAt: number;
  used: UsageCell;
  /** Set only when the user has told us their own allowance. Never guessed. */
  percent?: number;
}

export const FIVE_HOURS = 5 * 60 * 60 * 1000;
export const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Usage inside a rolling window, and when it next frees up.
 *
 * `resetsAt` is the honest part and the fiddly one. A rolling window does not reset all at once —
 * room comes back as the OLDEST activity ages out of it. So the reset is one span after the
 * earliest bucket still inside the window, not one span after "now". Reporting "resets in 5 hours"
 * to somebody who has been working steadily would be wrong every single time.
 */
export function usageWindow(buckets: UsageBucket[], span: number, now = Date.now(), limitReplies?: number): UsageWindow {
  const from = now - span;
  const inside = buckets.filter((b) => b.h >= from - 3_600_000);   // the hour a bucket starts may straddle
  const used = totalUsage(inside);
  const oldest = inside.length ? Math.min(...inside.map((b) => b.h)) : now;
  return {
    from,
    // Nothing used means nothing to wait for — the window is already as free as it gets.
    resetsAt: inside.length ? oldest + span : now,
    used,
    percent: limitReplies && limitReplies > 0
      ? Math.min(100, Math.round((used.n / limitReplies) * 100))
      : undefined,
  };
}

/** "2h 14m", or "now" when there is nothing to wait for. Written for someone deciding whether to
 *  carry on or make a cup of tea, which is the actual decision. */
export function untilReset(resetsAt: number, now = Date.now()): string {
  const ms = resetsAt - now;
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

const LIMIT_KEY = 'nv-cli-limits';

/**
 * The user's own stated allowance, if they have told us.
 *
 * Stored per bridge because the two plans are unrelated. Deliberately NOT pre-filled with
 * Anthropic's or OpenAI's published numbers: those change, they differ by model and by message
 * size, and a stale default presented as fact is exactly the "number they trust and we invented"
 * this whole section exists to avoid.
 */
export function getReplyLimits(): Partial<Record<AgentCli, { session?: number; week?: number }>> {
  try { return JSON.parse(localStorage.getItem(LIMIT_KEY) || '{}'); } catch { return {}; }
}

export function setReplyLimit(which: AgentCli, field: 'session' | 'week', value: number | null): void {
  try {
    const all = getReplyLimits();
    const cur = all[which] ?? {};
    if (value && value > 0) cur[field] = value; else delete cur[field];
    all[which] = cur;
    localStorage.setItem(LIMIT_KEY, JSON.stringify(all));
  } catch { /* quota — the windows still work, only the percentage is lost */ }
}

/**
 * Sign out of the CLI itself — NOT the same as "stop using it in adris".
 *
 * Signing out removes the credential the CLI keeps for the whole computer, so the user's terminal
 * session stops working too. Almost nobody means that when they say "disconnect", so the panel
 * makes it a separate, explicitly-labelled choice rather than the obvious button.
 */
export async function cliLogout(which: AgentCli, exe: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  const out = await invoke<string>('agent_cli_logout', { exe, which });
  clearAuthCache();
  return out;
}
