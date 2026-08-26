// ─── The agent cursor ────────────────────────────────────────────────────────
//
// A department-coloured pointer that moves around the screen with a label saying what the agent is
// doing — "Meera · reading your pricing sheet" — so work happening on the user's machine is
// something they WATCH rather than something they are told about afterwards.
//
// ── IT DOES NOT TAKE THE REAL POINTER ────────────────────────────────────────
//
// This draws a cursor. It does not move the user's. An agent fighting for the mouse is intolerable
// and breaks the instant they touch the trackpad — and the standing rule is that adris never shifts
// the user off what they are working on. A transparent, click-through, always-on-top window means
// the user sees everything and keeps their machine, and it is the only way several agents can be
// visible at once, which one real pointer could never do.
//
// ── WHY TWO WINDOWS ──────────────────────────────────────────────────────────
//
// `agentcursor` is click-through, always. Every click passes through it to whatever is underneath,
// which is what makes it safe to leave on top of the user's work.
//
// But a question needs to be CLICKED. Turning click-through off would make the whole transparent
// sheet swallow clicks across the entire screen. So the question is a second, small, ordinary
// window — `agentask` — that appears just below the cursor and takes its own clicks. Two windows,
// each with one job.
//
// ── WHY BELOW THE CURSOR, AND NOT IN THE ADRIS WINDOW ────────────────────────
//
// The user's eyes are on the application being worked in. A prompt that opens in a different window
// — possibly behind the one they are looking at — is a prompt that gets missed, and a stalled agent
// looks exactly like a hung one.

import { emit, listen } from '@tauri-apps/api/event';

export interface CursorPos { x: number; y: number }

export interface CursorState {
  visible: boolean;
  x: number;
  y: number;
  /** Department colour, e.g. "124 92 255". Drawn as rgb(...). */
  rgb: string;
  agent: string;
  /** Never a bare "working…" — say what is actually happening. */
  doing: string;
  /** Draw the click ripple. */
  clicking?: boolean;
  /** How far through the job, for the progress ticks on the label. Omit when unknown. */
  step?: number;
  total?: number;
}

export interface AgentQuestion {
  id: string;
  agent: string;
  rgb: string;
  /** The question, in the user's language, not the agent's. */
  question: string;
  /** Why it cannot decide alone — one short line. Optional but almost always worth it. */
  because?: string;
  /** Real options where they exist. Free text is the fallback, not the default. */
  options?: { id: string; label: string; detail?: string }[];
  /** Where to put the window: just below the cursor. */
  at: CursorPos;
  /** Remember the answer so this is asked once, not every run. */
  rememberAs?: string;
}

export const CURSOR_EVENT = 'nv-agent-cursor';
export const ASK_EVENT = 'nv-agent-ask';
export const ANSWER_EVENT = 'nv-agent-answer';

/** Where the pointer's tip sits inside its own 460x120 block. The component draws at this offset. */
const TIP_INSET = 10;

// The overlay is sized to the screen ONCE, then never moved again.
//
// It used to be a small window moved to each point — which cannot be animated, because a window
// position is set rather than transitioned. Every step was a jump, and the label could be clipped
// at a screen edge. Covering the screen and moving the pointer INSIDE it with a CSS transform gives
// one smooth movement at any distance, handled by the compositor.
let sized = false;
async function sizeToScreen(w: Awaited<ReturnType<typeof windowFor>>): Promise<void> {
  if (sized || !w) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const { LogicalSize, LogicalPosition } = await import('@tauri-apps/api/dpi');
    const s = JSON.parse(await invoke<string>('agent_screen')) as { w: number; h: number };
    if (!(s.w > 0 && s.h > 0)) return;
    await w.setPosition(new LogicalPosition(0, 0));
    await w.setSize(new LogicalSize(s.w, s.h));
    sized = true;
  } catch { /* an unsized overlay still draws, just clipped to its default size */ }
}

async function windowFor(label: string) {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  return WebviewWindow.getByLabel(label);
}

/**
 * Put the overlay where it belongs and make sure it cannot be clicked.
 *
 * setIgnoreCursorEvents is re-applied on every show rather than once at startup: it is the single
 * property that, if it were ever lost, would leave an invisible sheet swallowing the user's clicks
 * across the whole screen. Cheap to repeat, catastrophic to miss.
 */
export async function showCursor(state: Omit<CursorState, 'visible'>): Promise<void> {
  try {
    const w = await windowFor('agentcursor');
    if (!w) return;
    await sizeToScreen(w);
    // Re-applied every time, not once at startup: this is the one property whose loss would leave a
    // transparent full-screen sheet swallowing the user's clicks. Cheap to repeat, catastrophic to
    // miss.
    await w.setIgnoreCursorEvents(true);
    await w.setAlwaysOnTop(true);
    // The point is sent as DATA and the component positions itself with a transform. The window
    // itself no longer moves — see sizeToScreen.
    await emit(CURSOR_EVENT, {
      ...state,
      x: Math.round(state.x - TIP_INSET),
      y: Math.round(state.y - TIP_INSET),
      visible: true,
    });
    if (!(await w.isVisible())) await w.show();
  } catch { /* the overlay is never allowed to break the task it is describing */ }
}

export async function hideCursor(): Promise<void> {
  try {
    await emit(CURSOR_EVENT, { visible: false });
    const w = await windowFor('agentcursor');
    if (w) await w.hide();
  } catch { /* ignore */ }
}

/**
 * Move the drawn cursor along a path, so it travels rather than teleports.
 *
 * The point is legibility, not realism: a pointer that jumps from one side of the screen to the
 * other tells the user nothing about what just happened, while one that moves lets them follow it.
 */
export async function moveCursorTo(
  _from: CursorPos, to: CursorPos, state: Omit<CursorState, 'visible' | 'x' | 'y'>,
): Promise<void> {
  // ONE emit. The travel is a CSS transition in the component, so stepping the position from here
  // would fight it — each new value would restart the transition and the result is the stutter this
  // replaced. The `from` argument is kept so callers do not all have to change.
  await showCursor({ ...state, ...to });
}

/** A visible click, for when something really was clicked. */
export async function flashClick(at: CursorPos, state: Omit<CursorState, 'visible' | 'x' | 'y'>): Promise<void> {
  await showCursor({ ...state, ...at, clicking: true });
  await new Promise((r) => setTimeout(r, 320));
  await showCursor({ ...state, ...at, clicking: false });
}

// ── Asking the user ──────────────────────────────────────────────────────────

const REMEMBER_KEY = 'nv-agent-answers';

function loadRemembered(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}'); } catch { return {}; }
}

export function rememberedAnswer(key: string): string | null {
  if (!key) return null;
  const v = loadRemembered()[key];
  return typeof v === 'string' && v ? v : null;
}

export function forgetAnswer(key: string): void {
  try {
    const all = loadRemembered();
    delete all[key];
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

function remember(key: string, value: string): void {
  if (!key || !value) return;
  try {
    const all = loadRemembered();
    all[key] = value;
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(all));
  } catch { /* quota */ }
}

export interface AskResult {
  /** What the user chose, or typed. Empty when nobody answered. */
  answer: string;
  /** True when nobody answered in time. NOT a guess — see below. */
  timedOut: boolean;
  /** True when the answer came from a previous run rather than from the user just now. */
  remembered: boolean;
}

/**
 * Hold, and ask.
 *
 * THE RULE THAT MATTERS MOST: an unanswered question times out into a HOLD, never into a guess.
 * The whole reason this exists is that an agent posting to the wrong account, or emailing from the
 * wrong mailbox, is worse than an agent that stopped and waited. `timedOut` is returned so the
 * caller stops and says it is waiting — it must never be treated as "no preference, carry on".
 */
export async function askUser(q: AgentQuestion, timeoutMs = 120000): Promise<AskResult> {
  // Asked once, not every run.
  if (q.rememberAs) {
    const prior = rememberedAnswer(q.rememberAs);
    if (prior) return { answer: prior, timedOut: false, remembered: true };
  }

  // Typed as a plain variable rather than inferred: the only assignment happens inside a .then()
  // callback, so TypeScript narrows it to `never` by the time the finally block runs.
  let unlisten: null | (() => void) = null;
  try {
    const w = await windowFor('agentask');
    if (!w) return { answer: '', timedOut: true, remembered: false };
    const { LogicalPosition } = await import('@tauri-apps/api/dpi');

    // Just below the cursor, nudged left so a question near the right edge is not off-screen.
    await w.setPosition(new LogicalPosition(
      Math.round(Math.max(8, q.at.x - 40)),
      Math.round(q.at.y + 28),
    ));
    await w.setAlwaysOnTop(true);
    await emit(ASK_EVENT, q);
    await w.show();
    await w.setFocus();

    const answer = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      listen<{ id: string; answer: string }>(ANSWER_EVENT, (e) => {
        if (e.payload?.id !== q.id) return;
        clearTimeout(timer);
        resolve(String(e.payload.answer ?? ''));
      }).then((fn) => { unlisten = fn; });
    });

    await w.hide();
    if (answer === null) return { answer: '', timedOut: true, remembered: false };
    if (q.rememberAs && answer) remember(q.rememberAs, answer);
    return { answer, timedOut: false, remembered: false };
  } catch {
    // A broken overlay must not become a silent decision.
    return { answer: '', timedOut: true, remembered: false };
  } finally {
    try { (unlisten as null | (() => void))?.(); } catch { /* ignore */ }
  }
}

/** Listener side, used by the two overlay windows. */
export function onCursor(fn: (s: CursorState) => void): Promise<() => void> {
  return listen<CursorState>(CURSOR_EVENT, (e) => fn(e.payload));
}
export function onAsk(fn: (q: AgentQuestion) => void): Promise<() => void> {
  return listen<AgentQuestion>(ASK_EVENT, (e) => fn(e.payload));
}
export function sendAnswer(id: string, answer: string): Promise<void> {
  return emit(ANSWER_EVENT, { id, answer });
}
