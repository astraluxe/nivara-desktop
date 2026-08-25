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

export function buildClaudeArgs(prompt: string, opts: RunOptions = {}): string[] {
  const args = ['-p', prompt, '--output-format', 'json'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.sessionId) args.push('--resume', opts.sessionId);
  if (opts.systemPrompt) args.push('--append-system-prompt', opts.systemPrompt);
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

export function loadCachedClis(): CliPaths | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as CliPaths;
    return p && typeof p.claude_code === 'string' ? p : null;
  } catch { return null; }
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
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(clean)); } catch { /* quota */ }
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
  const args = which === 'claude_code' ? buildClaudeArgs(prompt, opts) : buildCodexArgs(prompt, opts);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<string>('agent_cli_run', {
      exe,
      args,
      cwd: opts.cwd ?? null,
      clearEnv: STRIPPED_ENV,
      timeoutSecs: opts.timeoutSecs ?? 300,
    });
    return parseClaudeJson(raw);
  } catch (e) {
    return { ok: false, text: '', error: e instanceof Error ? e.message : String(e) };
  }
}
