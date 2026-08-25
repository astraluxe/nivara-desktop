# adris.tech desktop — roadmap

Everything planned for the `.exe`, why, and what state it's in. This is the file to read before
starting work and to update when finishing any.

**Why it lives here and not in `NIVARA/`:** the NIVARA root is the `nivara-website` repo, which
auto-deploys to the public site on push — anything there is world-readable. This is the exe's own
repo, which is also where the code it describes lives.

**Status honesty rule, carried over from ADRIS-OS/plan.md:** ✅ means *seen working*, not written.
Anything believed-to-work-but-unverified is 🟡. That rule exists because it was broken once and
cost real time.

---

## The decision this roadmap rests on

**Windows is the product surface, not a new OS.** `ADRIS-OS/` is on hold — not deleted, and its
plan.md stays as a full record. The reasoning:

- Asking a non-technical business owner to change operating system is the highest-friction thing
  you can ask of them.
- The "does my Tally still work" problem — named in ADRIS-OS/plan.md §12b as the biggest commercial
  barrier in India — **does not exist on Windows**. Tally just runs.
- Everything genuinely valuable in adris OS (agents driving real software) works *better* on
  Windows, because that is where the user's real software already is: Word, Excel, Tally, their
  bank portal, their ERP.
- adris OS is months of work. The items below are weeks.

adris OS was the right idea for a user who has nothing. These users have Windows and Office
already — meet them there.

---

## HARD RULE — adris.tech never stores user data

**This is not a feature. It is the reason the product exists, and it is not negotiable.**

Everything runs on the user's own machine: their files, their mailbox, their customer list, their
model keys. adris.tech does not receive, log, or retain their content — and that must remain true
of every feature added from here.

**Why it matters more once Claude Code / Codex are wired in.** Those tools have their own data
handling, which is theirs and not ours. The moment adris becomes a bridge to them, the honest
position is:

- work adris does locally stays local, always
- work handed to an external brain follows *that* provider's terms, and the user is told so plainly
  before it is handed over — not buried in a settings page
- the user chooses per task, and the local path always exists

That split is a genuine competitive advantage over a pure Claude/Codex wrapper, and it evaporates
the moment it stops being strictly true. **Any change that would send user content to an adris
server needs an explicit decision from the owner, not a default.**

---

## Now — the UI

The exe works and looks about ten years older than it is. This is a **visual pass only**: tokens,
spacing, typography, motion, chrome. Reference point is Supabase's site — dense, confident, dark,
with real hierarchy — in the existing adris colours.

### Rules for the pass, so nothing breaks

`KrewChat.tsx` alone is **15,474 lines**. Restructuring it is how a working product breaks, so:

1. **No logic changes.** No handlers, no state, no data flow, no agent code. Styling only.
2. **Token-first.** Most of the win comes from `src/index.css` and `tailwind.config.js` — surfaces,
   elevation, radii, motion — which lift every screen at once without touching a component.
3. **Component work only where tokens can't reach**, in this order of risk:
   `TitleBar` → `Sidebar` → chat message bubbles → panels/modals.
4. **`tsc` + `vite build` clean after every step**, and the three existing guard scripts
   (`check-dept-colours`, `check-agent-roster`, `check-delegation-rule`) must keep passing — they
   run as part of `npm run build`.
5. **Never touch** `LoginScreen`, `AuthContext`, `supabase.ts` (standing rule), or the department
   colour values (a build check enforces their separation).

### Pass 1 — done, and seen working 🟡→✅

Screenshotted in both themes before being called finished (`npm run visual`, below). Not launched in
the real `.exe` yet, so it is ✅ *as rendered*, not ✅ *as shipped*.

| Area | What changed |
|---|---|
| Palette | The greys were perfectly neutral (10/10/10, 20/20/20, 30/30/30) — the reason the app read as a default rather than a design. Now carries 2–4 points of violet per channel, borrowed from the accent. Not visible as blue; visible as deliberate. Contrast unchanged (~18:1). |
| Elevation | Did not exist. Three steps (`--nv-e1/2/3`), each a tight contact shadow plus a soft ambient one, plus `--nv-lip` for the hairline of light on a raised edge. Light theme gets much weaker shadows — on white, heavy shadow reads as dirt. |
| Radius | Four steps (`--nv-r-sm/r/lg/xl`) so corners stop being whatever each component's author typed. |
| Motion | One curve, three speeds. `.transition-fast` (several hundred elements) kept its properties and changed only its curve — plain `ease` accelerates slowly out of rest, which is what made hovers feel a beat behind the cursor. |
| Title bar | Gradient plus a lit top edge so it reads as the lid of the window. Module name set off by a rule instead of a slash. Plan badge is an accent pill, not a grey box. |
| Sidebar | A flat tonal step off the content ground. Selected items gained an inset ring — a tinted fill alone reads as a highlight, the ring makes it an object. Resting items dropped to `faint`, widening the gap between selected / hovered / idle. |
| Chat | User bubble was 12px — below the app's own 13px body size, so the user's words were the smallest text on a screen made of their words. Now 13px with real padding and a shadow. Agent badge gained a ring in its department colour. |
| Composer | Same 12px→13px correction, plus `.nv-field`: a real focus halo instead of a 1px border change. |
| Disclosure carets | The literal `▲`/`▼` characters replaced by one rotating SVG (`src/components/ui/Caret.tsx`). They rendered in whatever glyph the font carried, never matched the text beside them, sat off the baseline, and jump-cut where everything else transitions. |
| Scrollbars | 3px was genuinely hard to grab and the one place breaking the app's own 24px-target rule. Now an 8px track with a 4px thumb inside it. |
| Focus & selection | 2px ring with a halo, visible on every background in both themes; `::selection` is branded rather than browser-default blue. |
| Reduced motion | `prefers-reduced-motion` now honoured app-wide, degrading to instant state changes rather than to nothing. |

**Deliberately not done:** message entrance animations. On a restored thread they replay on every
message at once and fight scroll restoration — the cost outweighs the effect.

**Still open, and visible in the screenshots:** every module in the rail shows a green "active" dot
permanently, so eleven dots say nothing. Removing them is a visual call the owner should make.

### `npm run visual` — how this was checked

`vite.visual.config.ts` + `harness/visual.tsx` mount the **real** TitleBar and Sidebar in a browser
and screenshot both themes at 2× (`harness/shoot.mjs`). AuthContext is aliased to a stub
(`harness/auth-stub.tsx`) so no Supabase session is needed — the real file is never touched, per the
standing rule.

Two things worth keeping in mind when using it:

- **Set the theme through `localStorage`, not by adding the `paper` class.** Sidebar owns the theme
  via its own `useTheme`, which reads that key on mount and rewrites the class from it. Setting the
  class directly produced two byte-identical screenshots — which is how this was caught.
- Playwright launches **its own** Chrome with a throwaway profile. It never attaches to, and never
  closes, the browser the user is working in.

**A pre-existing build warning, so it is not re-investigated:** `Expected identifier but found "-"`
comes from Tailwind's content scanner reading the regex character class `[-:\s]` at
`KrewChat.tsx:11732` and generating a junk rule from it. Harmless, and older than this pass.

---

## After the UI, in order

### 1. Scan what's installed on the PC — ~1 day
Registry (`Uninstall` keys) + Start Menu shortcuts → a list of real applications with real paths.
Everything below depends on knowing what exists. Same shape as the existing browser detection.

### 2. Drive Word, Excel and PowerPoint — 2–3 days
**The highest-value item in this document.** Windows exposes full COM automation, and
`krew_execute_command` already runs arbitrary commands, so the plumbing exists:

```powershell
$word = New-Object -ComObject Word.Application
$word.Visible = $true
$doc = $word.Documents.Add("C:\...\proposal.dotx")   # the user's own template
```

Why it beats generating files ourselves (`docgen.ts`, `pptxgenjs`): **the user's template, fonts and
branding work, because it is genuinely Word.** Output is a real `.docx`, not an approximation.

- Must fall back to LibreOffice / the existing generator when Office isn't installed — say which
  was used, never imply Office when it wasn't.
- Templates are the point: "use my proposal template" is the demo that sells this.

### 3. Agent cursor — ~2 days
A visible, department-coloured cursor showing what an agent is doing, with a label
("Meera · reading your pricing sheet").

**Design correction, stated up front: do NOT move the real Windows cursor.** An agent fighting the
user for the mouse is infuriating and breaks the moment they touch the trackpad. This is a
transparent always-on-top overlay window — the user *sees* the work and keeps their machine. Same
feeling, none of the fight, and it lets agents run while they carry on working.

### 4. Claude Code / Codex bridge — 1–2 weeks
Both ship CLIs that can be driven headlessly. adris becomes the *hands* — multi-app, multi-tab,
real Office, visible cursor — while the user's own subscription is the *brain*.

Strategically the strongest item here: it ends token resale, the user's budget is far larger than
any plan adris could offer, and revenue becomes a licence for the bridge.

**Check before betting on it:** whether programmatic driving fits those providers' terms, and the
not-installed path. Neither looks like a blocker; both are cheaper to check now than after launch.
Also see the hard rule above — this is exactly where it bites.

### 5. Multiple tabs / parallel agents — 1–2 weeks
Several agents working at once, each visible, without them fighting over one browser or one window.
Builds on 1–3.

### 6. Mid-task instructions — small, high value
Today a running task can't be added to; the user waits for it to finish, then asks again. It should
absorb a new instruction *while running* — the way a person would when you lean over and add
something. Very often what the user remembers is an addition, not a correction.

---

## Fixed in passing

### The outreach copilot's counts ✅

**It was never a bug, and the interface said it was one.** Reported as: "40 ready · 110 not" on a
150-contact campaign, plus "today 0/40 email · 0/20 LinkedIn", plus both channels offered on a
campaign with no LinkedIn profiles in it.

What was actually true:

- **The caps are pacing, not a plan limit.** `SEND_DEFAULTS` in `src/lib/outreachSender.ts` —
  40 emails and 20 LinkedIn messages a day. They exist so the user's own mailbox and LinkedIn
  account do not get restricted. Nothing about a tier or a subscription.
- **The 110 were not failures.** They were tomorrow. But they were pooled with the genuinely stuck
  ones under one "not" number, and opening the list showed *today's email limit is used up* repeated
  a hundred times, which reads as a hundred errors.
- **Both channels were always offered**, so switching LinkedIn on added a pile of "no profile"
  skips and inflated the same number with people who were never reachable that way.

The fix is entirely in what is said:

- `summariseSkips()` splits the list into **deferred** (today's pace — nothing to fix) and
  **blocked** (no address, no draft, a placeholder left in), and groups the blocked ones by reason,
  biggest first. Forty identical lines become one line saying forty.
- The summary line now reads **"40 ready · 107 tomorrow · 3 need a fix"**.
- The deferred count gets its own sentence naming the caps, so the reason is on screen rather than
  buried behind a disclosure triangle.
- `channelReach()` marks a channel **"· none in this list"** when nobody can receive on it. It still
  toggles — profiles can be added later, and disabling it would just look broken — but it no longer
  lets the user switch it on and then blames them for the result.
- `CAP_REASON` names the two cap sentences, so telling them apart is not a literal string match that
  breaks the day someone rewords them.

Covered by 11 new assertions in `harness/outreachSender.test.mjs`, built on the user's real
numbers — 150 contacts, a cap of 40, three genuinely broken. All 114 unit assertions and all four
browser suites pass.
