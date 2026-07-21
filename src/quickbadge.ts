// adris.tech Quick Badge — the Grammarly-style corner logo (third tiny webview).
// Layering does the "desktop vs application" detection naturally:
//   • the quick BAR window is always-on-BOTTOM → visible only on the desktop;
//   • this BADGE is always-on-TOP → the one adris presence floating over applications.
// Left-click opens the chat as an overlay over the current app (the quickbar window
// switches to overlay mode via the `nv-quickbadge-open` event). Right-click shows a
// snooze menu (1 h / 24 h / off) by temporarily growing this tiny window.
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow, currentMonitor, primaryMonitor, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const win = getCurrentWindow();

const BADGE_W = 56, BADGE_H = 56;      // logical, includes hover margin
const MENU_W = 210, MENU_H = 190;
const SNOOZE_KEY = 'nv-quickbadge-snooze-until';

const badgeEl = document.getElementById('badge')!;
const menuEl  = document.getElementById('menu')!;
let menuOpen = false;
let reshowTimer: ReturnType<typeof setTimeout> | null = null;

// ── Theme sync (same key as the app; storage events fire cross-window) ──────
function applyTheme() {
  document.documentElement.classList.toggle('ink', localStorage.getItem('nv-theme') === 'ink');
}
applyTheme();
window.addEventListener('storage', (e) => { if (e.key === 'nv-theme') applyTheme(); });

// ── Position: right edge, upper third — Grammarly territory ─────────────────
// currentMonitor() can return null for a still-HIDDEN window (it's derived from the
// window's position) — that silently skipped positioning before. Fall back to the
// primary monitor so the badge always lands at a real corner.
const POS_KEY = 'nv-quickbadge-pos';
/** A position the user dragged the badge to, if it is still on a real monitor. */
function savedPos(): { x: number; y: number } | null {
  try {
    const r = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) return { x: Math.round(r.x), y: Math.round(r.y) };
  } catch { /* ignore */ }
  return null;
}
async function positionCorner() {
  try {
    const mon = (await currentMonitor().catch(() => null)) || (await primaryMonitor().catch(() => null));
    if (!mon) return;
    // A position the user chose wins over the default corner — but only if it still lands on the
    // monitor. Screens change (docking, a laptop opened without its external display) and a stale
    // coordinate would otherwise park the badge off-screen, which reads as "the badge is gone".
    const sp = savedPos();
    if (sp) {
      const w = mon.size.width, h = mon.size.height, ox = mon.position.x, oy = mon.position.y;
      const onScreen = sp.x >= ox - 20 && sp.y >= oy - 20 && sp.x <= ox + w - 20 && sp.y <= oy + h - 20;
      if (onScreen) { await win.setPosition(new PhysicalPosition(sp.x, sp.y)); return; }
      try { localStorage.removeItem(POS_KEY); } catch { /* ignore */ }
    }
    const sf = mon.scaleFactor || 1;
    const x = Math.round(mon.position.x + mon.size.width - BADGE_W * sf - 10 * sf);
    const y = Math.round(mon.position.y + mon.size.height * 0.32);
    await win.setPosition(new PhysicalPosition(x, y));
  } catch { /* best effort */ }
}

// ── Snooze bookkeeping ───────────────────────────────────────────────────────
function snoozedUntil(): number {
  const t = parseInt(localStorage.getItem(SNOOZE_KEY) || '0', 10);
  return Number.isFinite(t) ? t : 0;
}

// Windows quirk: a window created hidden and shown later can silently LOSE its
// always-on-top flag — the badge then sits BEHIND maximized apps (looks like it
// never appeared). Re-assert topmost after every show, and keep re-asserting on
// an interval while visible — widget apps like Grammarly do effectively the same.
async function assertOnTop() {
  try { await win.setAlwaysOnTop(true); } catch { /* best effort */ }
}
// Watchdog: every 10s enforce the CORRECT state in both directions — show + re-top
// when the badge should be visible (heals a silently-lost window), hide when the
// user disabled/snoozed it (undoes the Rust driver's unconditional show; Rust can't
// read localStorage, so this script owns the off/snooze decision).
setInterval(async () => {
  try {
    if (menuOpen) return;
    const disabled = localStorage.getItem('nv-quickbar') === 'off' || snoozedUntil() > Date.now();
    const vis = await win.isVisible().catch(() => false);
    if (disabled) { if (vis) await win.hide(); return; }
    if (!vis) {
      await positionCorner();
      try { await win.show(); } catch { /* retry next tick */ }
    }
    await assertOnTop();
  } catch { /* ignore */ }
}, 10_000);

async function applyVisibility() {
  if (reshowTimer) { clearTimeout(reshowTimer); reshowTimer = null; }
  if (localStorage.getItem('nv-quickbar') === 'off') { await win.hide(); return; }
  const until = snoozedUntil();
  const now = Date.now();
  if (until > now) {
    await win.hide();
    // Re-appear when the snooze lapses (if the app is still running).
    reshowTimer = setTimeout(applyVisibility, Math.min(until - now, 24 * 3600 * 1000) + 1000);
    return;
  }
  await positionCorner();
  try { await win.show(); } catch { /* retry below */ }
  await assertOnTop();
  // Belt & braces: re-assert once more after the window is actually mapped —
  // the immediate call can land before Windows finishes showing it.
  setTimeout(assertOnTop, 800);
}

async function snooze(ms: number) {
  localStorage.setItem(SNOOZE_KEY, String(Date.now() + ms));
  await closeMenu();
  await applyVisibility();
}

// ── Snooze menu: grow the window, show the list, shrink back ────────────────
async function openMenu() {
  if (menuOpen) return;
  menuOpen = true;
  try {
    // Grow LEFT/DOWN from the badge corner so the menu stays on-screen.
    const mon = await currentMonitor();
    const sf = mon?.scaleFactor || 1;
    if (mon) {
      const x = Math.round(mon.position.x + mon.size.width - MENU_W * sf - 10 * sf);
      const y = Math.round(mon.position.y + mon.size.height * 0.32);
      await win.setSize(new LogicalSize(MENU_W, MENU_H));
      await win.setPosition(new PhysicalPosition(x, y));
    }
  } catch { /* keep going — menu still shows inside whatever size we have */ }
  menuEl.classList.add('open');
  badgeEl.style.display = 'none';
}

async function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  menuEl.classList.remove('open');
  badgeEl.style.display = '';
  try { await win.setSize(new LogicalSize(BADGE_W, BADGE_H)); } catch { /* ignore */ }
  await positionCorner();
}

// ── Wiring ───────────────────────────────────────────────────────────────────
// Drag to move, click to open. The badge used to be pinned to one spot, which is unusable when it
// lands over something the user needs (or off-screen on a different-sized display). A movement
// threshold keeps a normal click working: below it this is a click, above it a drag.
let dragStart: { x: number; y: number } | null = null;
let didDrag = false;
badgeEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragStart = { x: e.screenX, y: e.screenY };
  didDrag = false;
});
window.addEventListener('mousemove', async (e) => {
  if (!dragStart) return;
  if (!didDrag && Math.hypot(e.screenX - dragStart.x, e.screenY - dragStart.y) < 4) return;
  if (!didDrag) {
    didDrag = true;
    // Hand off to the OS window drag: it tracks the cursor even outside our tiny window, which a
    // manual setPosition loop cannot do reliably.
    try { await win.startDragging(); } catch { /* ignore */ }
  }
});
window.addEventListener('mouseup', async () => {
  if (dragStart && didDrag) {
    // Remember where they put it.
    try {
      const p = await win.outerPosition();
      localStorage.setItem(POS_KEY, JSON.stringify({ x: p.x, y: p.y }));
    } catch { /* ignore */ }
  }
  dragStart = null;
});
badgeEl.addEventListener('click', () => {
  if (didDrag) { didDrag = false; return; }   // that was a move, not a click
  // Open the chat overlay over whatever app the user is in.
  emit('nv-quickbadge-open', {}).catch(() => {});
});
badgeEl.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(); });

document.getElementById('miOpen')!.addEventListener('click', async () => {
  await closeMenu();
  emit('nv-quickbadge-open', {}).catch(() => {});
});
document.getElementById('miApp')!.addEventListener('click', async () => {
  await closeMenu();
  try {
    const main = await WebviewWindow.getByLabel('main');
    if (main) { await main.show(); await main.unminimize(); await main.setFocus(); }
  } catch { /* main window not available */ }
});
document.getElementById('miHour')!.addEventListener('click', () => snooze(60 * 60 * 1000));
document.getElementById('miDay')!.addEventListener('click', () => snooze(24 * 60 * 60 * 1000));
document.getElementById('miOff')!.addEventListener('click', async () => {
  // Same switch the Settings toggle uses — bar + badge both go away, everywhere.
  localStorage.setItem('nv-quickbar', 'off');
  emit('nv-quickbar-toggle', { on: false }).catch(() => {});
  await closeMenu();
  await win.hide();
});

// Click elsewhere in the (grown) window closes the menu.
document.body.addEventListener('click', (e) => {
  if (menuOpen && !menuEl.contains(e.target as Node)) closeMenu();
});
window.addEventListener('blur', () => { if (menuOpen) closeMenu(); });

// Settings toggle flips the badge live, same event as the bar.
listen<{ on: boolean }>('nv-quickbar-toggle', async (e) => {
  if (e.payload.on) { localStorage.removeItem(SNOOZE_KEY); await applyVisibility(); }
  else { await win.hide(); }
});

// ── Boot ─────────────────────────────────────────────────────────────────────
// Retry a couple of times: at cold start (especially autostart at login) the
// monitor layout / window mapping may not be ready on the first attempt.
applyVisibility();
setTimeout(applyVisibility, 2000);
setTimeout(applyVisibility, 6000);
