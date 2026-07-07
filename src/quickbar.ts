// adris.tech Quick Bar — the always-on-top mini chat window (second Tauri webview).
// Lives at the top-center of the screen. Collapsed it's a single input bar; submitting
// expands it in place (never opens the main window). It shares the app's origin, so the
// user's theme (nv-theme), Brain (knowledgeStore) and Supabase session are all available
// directly from localStorage — no IPC with the main window needed. AI streaming reuses
// the same `krew_ai_stream` Rust command the app uses; its events are emitted app-wide,
// so we filter by our own callId.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, currentMonitor, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { credentialStore } from './lib/krewDb';
import { brain, nodeToMarkdown } from './lib/knowledgeStore';

const win = getCurrentWindow();

const WIDTH = 640;
const COLLAPSED_H = 66;   // bar + window margins
const EXPANDED_H = 560;

const root    = document.getElementById('qbRoot')!;
const input   = document.getElementById('qbInput') as HTMLInputElement;
const sendBtn = document.getElementById('qbSend') as HTMLButtonElement;
const msgsEl  = document.getElementById('qbMsgs')!;
const emptyEl = document.getElementById('qbEmpty')!;
const statusEl = document.getElementById('qbStatus')!;
const chevron = document.getElementById('qbChevron')!;

let expanded = false;
let busy = false;
let callSeq = 0;
const history: { role: string; content: string }[] = [];

// ── Theme: mirror the app's choice, live ─────────────────────────────────────
function applyTheme() {
  const ink = localStorage.getItem('nv-theme') === 'ink';
  document.documentElement.classList.toggle('ink', ink);
}
applyTheme();
// storage events fire in OTHER windows of the same origin — free cross-window sync.
window.addEventListener('storage', (e) => { if (e.key === 'nv-theme') applyTheme(); });

// ── Position: top-center of the current monitor (just below the camera) ─────
async function positionTopCenter() {
  try {
    const mon = await currentMonitor();
    if (!mon) return;
    const sf = mon.scaleFactor || 1;
    const x = Math.round(mon.position.x + (mon.size.width - WIDTH * sf) / 2);
    const y = Math.round(mon.position.y + 8 * sf);
    await win.setPosition(new PhysicalPosition(x, y));
  } catch { /* best effort */ }
}

// ── Expand / collapse in place ───────────────────────────────────────────────
async function setExpanded(on: boolean) {
  expanded = on;
  root.classList.toggle('expanded', on);
  chevron.style.transform = on ? 'rotate(180deg)' : '';
  try { await win.setSize(new LogicalSize(WIDTH, on ? EXPANDED_H : COLLAPSED_H)); } catch { /* ignore */ }
}

// ── Brain context: naive relevance — shared knowledge makes answers personal ─
function brainContext(query: string): string {
  try {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
    if (!terms.length) return '';
    const scored = brain.all().nodes
      .map((n) => {
        const hay = (n.title + ' ' + nodeToMarkdown(n.body)).toLowerCase();
        const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
        return { n, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (!scored.length) return '';
    return '\n\n## From the user\'s Brain (their saved knowledge — use it, do not re-research)\n' +
      scored.map(({ n }) => `### ${n.title}\n${nodeToMarkdown(n.body).slice(0, 700)}`).join('\n\n');
  } catch { return ''; }
}

// ── Minimal, safe markdown rendering for replies ─────────────────────────────
function renderMd(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}

function addBubble(cls: 'user' | 'ai', html: string): HTMLElement {
  emptyEl.style.display = 'none';
  const el = document.createElement('div');
  el.className = 'qb-m ' + cls;
  el.innerHTML = html;
  msgsEl.appendChild(el);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  return el;
}

// ── Auth + creds (same resolution order as the app: BYOK first, else adris AI) ─
function sessionToken(): string | null {
  try {
    const raw = localStorage.getItem('sb-xkkqcqsacgdrfwbwdqsp-auth-token');
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s?.access_token ?? null;
  } catch { return null; }
}

async function resolveAuth(): Promise<{ mode: string; apiKey: string | null; provider: string | null; token: string | null }> {
  try {
    const services = await credentialStore.list().catch(() => [] as string[]);
    for (const [svc, p] of [['gemini', 'gemini'], ['openai', 'openai'], ['claude', 'claude']]) {
      if (services.includes(svc)) {
        const d = await credentialStore.get(svc).catch(() => null) as Record<string, string> | null;
        if (d?.api_key) return { mode: 'own_key', apiKey: d.api_key, provider: p, token: null };
      }
    }
  } catch { /* fall through to adris AI */ }
  return { mode: 'nivara', apiKey: null, provider: null, token: sessionToken() };
}

// ── Send ─────────────────────────────────────────────────────────────────────
async function send() {
  const text = input.value.trim();
  if (!text || busy) return;
  busy = true;
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;
  statusEl.textContent = 'Thinking…';
  if (!expanded) await setExpanded(true);

  addBubble('user', renderMd(text));
  history.push({ role: 'user', content: text });
  const aiEl = addBubble('ai', '<span class="thinking"><i>.</i><i>.</i><i>.</i></span>');

  const callId = 'qb-' + Date.now() + '-' + (++callSeq);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const systemPrompt =
    'You are adris — the quick-access assistant of the adris.tech desktop app, answering from a small always-on-top bar. ' +
    'Be genuinely useful and CONCISE: short paragraphs, get to the point, no filler. Use **bold** and `code` sparingly. ' +
    'You have no tools in this bar. For heavy work (building lead lists, browsing the web live, running automations), ' +
    'give your best direct answer AND tell the user that task runs better in the full app (they can click the open-app arrow). ' +
    'Never invent facts, links or contact details. Today is ' + today + '.' +
    brainContext(text);

  let received = '';
  const done = { cleanup: () => {} };
  try {
    const auth = await resolveAuth();
    await new Promise<void>(async (resolve, reject) => {
      const u1 = await listen<{ id: string; text: string }>('krew-chunk', (e) => {
        if (e.payload.id !== callId) return;
        received += e.payload.text;
        aiEl.innerHTML = renderMd(received);
        msgsEl.scrollTop = msgsEl.scrollHeight;
      });
      const u2 = await listen<{ id: string }>('krew-done', (e) => {
        if (e.payload.id !== callId) return;
        done.cleanup(); resolve();
      });
      const u3 = await listen<{ id: string; error: string }>('krew-error', (e) => {
        if (e.payload.id !== callId) return;
        done.cleanup(); reject(new Error(e.payload.error));
      });
      done.cleanup = () => { u1(); u2(); u3(); };

      invoke('krew_ai_stream', {
        callId,
        mode: auth.mode,
        systemPrompt,
        messages: history.slice(-8),
        apiKey: auth.apiKey,
        provider: auth.provider,
        localModel: null,
        modelName: null,
        baseUrl: null,
        sessionToken: auth.token,
      }).catch((e) => { done.cleanup(); reject(e as Error); });
    });
    history.push({ role: 'assistant', content: received });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    aiEl.innerHTML = /not signed in|401|jwt/i.test(msg)
      ? 'Please sign in to the adris.tech app first — then the quick bar works from anywhere.'
      : 'Something went wrong: ' + renderMd(msg.slice(0, 200));
  } finally {
    busy = false;
    input.disabled = false;
    sendBtn.disabled = false;
    statusEl.textContent = 'Connected to your Brain';
    input.focus();
  }
}

// ── Wire the controls ────────────────────────────────────────────────────────
sendBtn.addEventListener('click', send);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
document.getElementById('qbToggle')!.addEventListener('click', () => {
  // In overlay mode (opened from the badge over an app), collapsing means "done here" —
  // return the window to its desktop-bar position and layer.
  if (overlayMode && expanded) { exitOverlay(); return; }
  setExpanded(!expanded);
});
document.getElementById('qbClear')!.addEventListener('click', () => {
  history.length = 0;
  msgsEl.querySelectorAll('.qb-m').forEach((m) => m.remove());
  emptyEl.style.display = '';
});
document.getElementById('qbHide')!.addEventListener('click', async () => {
  // If hidden while in overlay mode, restore desktop-bar state first so the next
  // show() (Settings toggle / next launch) brings back the bar, not a stray overlay.
  if (overlayMode) await exitOverlay();
  win.hide();
});
document.getElementById('qbOpenApp')!.addEventListener('click', async () => {
  try {
    const main = await WebviewWindow.getByLabel('main');
    if (main) { await main.show(); await main.unminimize(); await main.setFocus(); }
  } catch { /* main window not available */ }
});

// Settings toggle in the main app flips this live.
listen<{ on: boolean }>('nv-quickbar-toggle', async (e) => {
  if (e.payload.on) { await positionTopCenter(); await win.show(); }
  else { await win.hide(); }
});

// ── Overlay mode — opened from the corner badge while the user is in an app ──
// The bar normally lives on the DESKTOP layer (always-on-bottom). When the user
// clicks the Grammarly-style badge over an application, this same window jumps to
// the TOP layer next to the badge, expanded, so the chat floats over the app.
// Collapsing it returns it to its desktop-bar life (top-center, bottom layer).
let overlayMode = false;

async function enterOverlay() {
  overlayMode = true;
  try {
    await win.setAlwaysOnBottom(false);
    await win.setAlwaysOnTop(true);
    const mon = await currentMonitor();
    if (mon) {
      const sf = mon.scaleFactor || 1;
      const x = Math.round(mon.position.x + mon.size.width - WIDTH * sf - 76 * sf); // left of the badge
      const y = Math.round(mon.position.y + mon.size.height * 0.32);
      await win.setPosition(new PhysicalPosition(x, y));
    }
  } catch { /* still usable even if layering calls fail */ }
  await setExpanded(true);
  await win.show();
  // Re-assert topmost AFTER show — Windows can drop the flag on a window that was
  // hidden when it was set (same quirk that made the badge sit behind apps).
  try { await win.setAlwaysOnTop(true); } catch { /* best effort */ }
  await win.setFocus().catch(() => {});
  input.focus();
}

async function exitOverlay() {
  overlayMode = false;
  try {
    await win.setAlwaysOnTop(false);
    await win.setAlwaysOnBottom(true);
  } catch { /* ignore */ }
  await setExpanded(false);
  await positionTopCenter();
}

listen('nv-quickbadge-open', () => { enterOverlay(); });

// ── Boot ─────────────────────────────────────────────────────────────────────
(async function init() {
  await setExpanded(false);
  await positionTopCenter();
  if (localStorage.getItem('nv-quickbar') !== 'off') {
    await win.show();
  }
})();
