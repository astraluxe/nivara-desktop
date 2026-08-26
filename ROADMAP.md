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

## Where this is right now

**Version in the tree: 1.67.0** — builds clean, not yet produced as an `.exe`. Last released: 1.66.0.

**1.60.0 and 1.61.0 both matter.** 1.59.0 shipped the Office feature with the boss unable to reach
it (see below), and 1.61.0 is the first build where Office work happens *where the user can see it*.

| # | Item | State | Evidence |
|---|---|---|---|
| — | UI pass | ✅ released 1.58.0 | screenshotted in both themes |
| 1 | Scan what's installed | ✅ **done** | 182 shortcuts → 45 apps; 61 assertions |
| 2 | Word / Excel / PowerPoint | ✅ **done, visible** | all three open, write, save, stay on screen; template branding verified |
| 3 | Agent cursor | ✅ **done** | follows REAL progress; new design in 1.65.0 — full-screen overlay, CSS-transform travel, ghost trail, per-department colour, progress ticks |
| 5 | Several agents at once | ✅ **done** | 55 assertions: parallel, dependency, chain, failure, cycle, stop |
| 6 | Mid-task instructions | ✅ **done** | folded in at step boundaries, taken once |
| — | Copilot: limit + attachments | ✅ **done** | the limit is the user's; a dropped attachment refuses |
| — | Open any installed application | ✅ **done** | `launch_application`, from the scanned list only |
| — | Info page | ✅ **done** | every feature above written up for a non-technical reader |
| 4 | Claude Code bridge | ✅ **done** | background jobs and the chat both; streaming verified against the real CLI |
| 7 | Coder | 🟡 **part** | folder, icons and the **Krew→Coder plan handoff** done; VS Code parity not |
| — | Boss produces dependency-aware plans | ✅ **done** | `plan_workflow` accepts `needs`, orders by dependency; 66 assertions |
| — | Node download survives a filtered network | ✅ **done** | mirrored through adris.tech, every attempt named on failure |
| — | Truly concurrent delegation | ✅ **done** | bubbles have an identity; independent stages run together |
| 3c | Clicking in software with no API | ❌ **not built** | input synthesis refused by a safety check — UI Automation is the right design |
| 8 | Browser for non-technical users | ✅ **done** | both runtimes mirrored at tag v0.0.1; adris.tech/dl serves them (HTTP 206 measured) |
| 9 | Antivirus flags the installer | ❌ **needs a certificate** | parked at the owner's request; one free mitigation applied |

### The lesson that cost a release

1.59.0 shipped a working Office feature the user could not use. `create_office_document` was built,
tested against real Word, and verified producing branded documents — and when the user asked for a
Word proposal the boss replied **"I cannot create or save files directly to your computer."**

The tool was never added to the boss's system-tool allowlist, which lived as an inline literal 4,800
lines into `KrewChat.tsx`. Nothing was broken; the agent was describing the tools it could see.
**Every test written for it passed.** None exercised `executeTool(name, args)` → a file on disk —
the only path a user ever takes.

Two things now prevent a repeat, both wired into `npm run build` / the suite:
`scripts/check-boss-tools.mjs` (every boss tool name is real — a typo filters to nothing, silently;
the capabilities people ask the boss for directly are present; the shared list has not drifted back
to a literal) and `harness/officeDispatch.mjs` (drives the real tool to a real document).

**The rule this produces, and it governs everything below: a feature is not done when the module
works. It is done when the thing the user types produces the thing they asked for.**

### A second rule, from the same week

**The user decides limits about their own things.** The outreach daily cap was a number adris picked,
presented as a rule. It is their mailbox, their domain, their list. adris owes them the *reason* for
a safe default — not the ceiling.

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

## One choice, in the title bar ✅ (1.66.0)

**adris.tech is pay-per-use.** Claude Code and Codex plug in through the user's own subscription,
their own key plugs in through Connect Apps, and a local model needs neither. All four are the same
decision — *where does the AI run* — and it was being made in four different places: a picker in
Guard, another in Settings, one in the Krew connection bar, and the bridge toggle.

Four controls, one setting (`nv-ai-source`). Someone who chose "my own key" in one of them could
still be spending adris.tech credit somewhere else, and there was **nowhere to look to find out
which was true**.

`AiSourceMenu` in the title bar is now the only control. It lists what this machine can actually
offer, each with **what it costs in the user's terms** — *included in your subscription*, *pay per
use*, *billed by OpenAI*, *free* — because that is the thing they actually want to know. A
subscription or a local model shows in the accent colour, since it is the state they should be
pleased to see.

**The pill rows are gone from every module (1.67.0).** `ConnectionBar` — shown at the top of BOTH
Krew and Coder — rendered Local / Own Key / adris.tech / OmniRoute buttons setting the same value
the title-bar menu sets. Four ways to make one decision, on two screens.

What survives is everything *below* those buttons: the setup panels. Connecting a key, ranking the
models that key can actually call, downloading a local model, installing OmniRoute — none of it is a
duplicate, and all of it still has to live somewhere. The menu opens them by name through
`AI_SETUP_EVENT`, so **choosing something that needs setting up takes the user straight to it**
rather than leaving them hunting for a panel whose button no longer exists.

**Both CLIs are always listed, installed or not.** A menu that silently omits Codex leaves someone
who pays for Codex with no way to know the app supports it — "it is not here" and "it is not
installed" look identical when the row is missing. The uninstalled one is dimmed, unselectable, and
says what to do.

**"Automatic" became "Choose for me."** The old label told the user nothing — the owner's own
reaction was *"idk what that is"* — so it now says what it will do and in what order: your
subscription, then your own key, then adris.tech.

**Real brand marks, not lettered squares.** The logos people actually recognise — Anthropic's
burst, OpenAI's knot, Gemini's spark, our own chevron — drawn from the paths those companies
publish. They already existed inside `ConnectApps` and nothing else could reach them, so they moved
to `components/ui/BrandLogo` and both places share one list.

**Colour is off by default and on in this menu.** In a dense integrations list a row of brand
colours competes with the app's own accent and with each other; monochrome reads as part of the
interface. In the AI menu the user is choosing between *companies*, and the hue is half of what
makes a logo recognisable, so it is turned on there.

`Automatic` and `Local model` get drawn marks instead — they are not companies, and borrowing
somebody's logo for them would be worse than drawing what they mean.

`AiSourcePicker` still renders wherever it did, but as a **statement rather than a second switch**:
it says what is in force and points at the title bar. The "which key" chooser is gone — the menu
lists every connected key as its own entry, so a second chooser was the same competing-control
problem in miniature. The "which local model" chooser stays, because nothing else offers it and it
refines a choice already made rather than making it again.

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

## The UI pass ✅ RELEASED in 1.58.0

The exe worked and looked about ten years older than it was. This was a **visual pass only**: tokens,
spacing, typography, motion, chrome. Kept here because the rules below govern any future pass. Reference point is Supabase's site — dense, confident, dark,
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

### 1. Scan what's installed on the PC ✅ DONE

`src/lib/installedApps.ts` + `scan_installed_apps` in lib.rs + the `list_installed_apps` agent tool.

**The roadmap was wrong about where this came from.** It said "same shape as the existing browser
detection" — there is no such shape. Browser detection is hardcoded path guessing (`lib.rs:4096`,
`4347`); the codebase had no registry access at all and no registry crate. This was new ground.

**And the registry turned out to be the wrong primary source.** Measured on a real machine, not
assumed:

| Source | Raw | Usable | Names look like |
|---|---|---|---|
| Registry `Uninstall` keys | 182 | 51 after filtering | `Microsoft Office Home and Student 2021 - en-gb` (twice — one per language pack) |
| Start Menu shortcuts | 182 | 99 with a real `.exe` | `Word`, `Excel` |

The Start Menu **is** the list of things a person can click, labelled the way they say it. So
shortcuts are the source and the registry is demoted to what it is actually good at: version and
publisher, matched on install folder rather than on name.

**The distinction that matters for item 2:** "is Word installed" and "can Word be automated" are
different questions. The answer is in `HKEY_CLASSES_ROOT` — a registered COM server has a
`LocalServer32` path, an unregistered one has nothing. On the test machine Word/Excel/PowerPoint
answer and **Outlook does not**, because Home and Student does not ship it. An installed-apps list
alone would have got that wrong and had an agent offer to send mail through Outlook.

**End-to-end result on the real machine:** 182 shortcuts → **45 applications**, no junk, no
duplicates, correctly grouped, and the automation line reads
`Can be driven directly (real Microsoft Office automation): word, excel, powerpoint.`

Four problems only the real data exposed, all now fixed and covered by tests: `Global Flags` ×4 and
`WinDbg` ×2 (same name, different paths — now deduped by name as well as by path); ARM and ARM64
builds offered on an x64 laptop (**offering software that cannot execute is the same failure as
offering software that is not installed**); helper entries like `About Java`, `Reload Configuration`
and `Office Language Preferences`; and SDK debugging tools drowning the `other` bucket, now
classified as development rather than deleted.

**48 unit assertions**, all suites pass. The committed fixture reproduces the *shapes* found in the
real scan rather than the scan itself — a list of someone's installed software is their business,
not the repository's.

**Verified through the agent tool, not just the module.** `harness/officeDispatch.mjs` calls
`executeTool('list_installed_apps', ...)` with `invoke` stubbed to really spawn PowerShell, so every
layer above Rust is the shipped code. It reports Word and states that Office can be driven.

### 2. Drive Word, Excel and PowerPoint ✅ DONE — and the work is VISIBLE

`src/lib/officeCom.ts` + `office_automation` in lib.rs + the `create_office_document` agent tool.

**Verified by producing real files and reading them back**, not by the script reporting success:

| | Result |
|---|---|
| Word | Title / Heading 1 / Normal / two bulleted paragraphs (ListType 2), 14,589 bytes |
| Excel | `00123` kept its leading zeros, `1-2` did **not** become a date, header bolded, columns autofit |
| PowerPoint | 2 slides, titles and bullets correct, 36,026 bytes |
| **Template** | A `.dotx` defining Heading 1 as Georgia 22pt red produced **Georgia 22pt red** — not Word's default Calibri |
| Leftover processes | **0** |

Timings on this machine: Word ~7s, Excel ~4s, PowerPoint ~3s.

#### It happens where the user can see it (v1.61.0)

The first version was headless: `$app.Visible = $false`, the file appeared, and nobody saw it happen.
For someone who has never trusted software to do their work, watching a document being written is
the entire difference between "the computer produced a file somewhere" and "I saw it happen".

**Visible is not a flag flip. Three things change together, or the feature deletes its own output:**

| Headless | Visible |
|---|---|
| `Visible = $false` | shown **and** brought to front with `Activate()` |
| `Quit()` after saving | **left open** — the document is handed over |
| sweeps and kills any Office process it started | **must not sweep** — it would kill the window the user was asked to look at |

Headless keeps all three, so anything running unattended still cannot leak processes. Either way
nothing is stopped by name: `taskkill /IM WINWORD.EXE` would close the file the user has open and
unsaved in another window.

**Verified live:** all three opened, wrote, saved, and were still on screen afterwards with real
window titles (`visible - Word`, `visible - Excel`, `visible - PowerPoint`), 0 processes leaked.

#### Design, because a document nobody would send is not done either

All read back out of the saved files:

- **Word** types block by block with a beat between, so it reads as writing rather than a paste.
- **Excel** gets a real header — accent fill, white text, 20px row — plus **frozen panes** and
  **autofilter**. On a 200-row lead list that is the difference between a dump and something a
  person can work in. Cells are still written as text, so `00123` keeps its zeros.
- **PowerPoint** is **16:9** (720x405). The default on many installs is still 4:3, which looks a
  decade old on any screen or projector made this century.

#### Four things the real run found that reasoning did not

1. **`$para.Range.Text = ...` destroys the document.** It replaces the paragraph MARK along with the
   text, so each block swallowed the one before it — five blocks produced *one* paragraph. The
   second attempt, `Range.InsertAfter`, kept all five but applied **every style to the wrong
   paragraph**: the title came back as Heading 1 and the last bullet as Normal. Only setting the
   style and then typing through `Application.Selection` — what Word does when a person types — is
   correct. All three were tried against real Word; only reading the saved file showed the difference.
2. **Style names are translated.** `Styles.Item("Heading 1")` throws on a German or French Office.
   Built-in style **IDs** (`wdStyleHeading1` = -2) are the same everywhere. This would only ever
   have failed on someone else's machine.
3. **Office COM leaves invisible processes running.** The first test left two `WINWORD`/`EXCEL`
   processes behind; unchecked they accumulate until the machine is out of memory. Each script now
   records which PIDs existed *before* it started and stops only ones that are new and still alive.
   **Never by name** — `taskkill /IM WINWORD.EXE` would close the document the user has open and
   unsaved in front of them.
4. **The injection guard was too strict and would have refused ordinary documents.** It rejected any
   payload containing `'@` — including the perfectly normal `bob'@example.com`. A single-quoted
   here-string is only closed by `'@` at the *start of a line*, and the payload is always one line,
   so the real invariant is "no newlines". Caught by a test written to prove the guard worked.

#### Why model-written text cannot become a command

The content comes from a language model and ends up inside a PowerShell script. It is **never
interpolated into code**. Per document kind there is one fixed script that never varies, and the
content travels beside it as JSON in a single-quoted here-string, which interpolates nothing — no
`$variables`, no `$(subexpressions)`, no backticks. A test asserts that two completely different
documents produce **byte-identical code**, and that `$(Remove-Item C:\ -Recurse)` lands in the
document as literal text. It does: it is visible in the .docx that was read back.

#### Honesty about which engine made the file

`engineNote()` exists to enforce "never imply Office when it wasn't". Without real Office the tool
refuses to pretend, routes the agent to `generate_document`, and states that the file will **not**
carry the user's template — because someone who believes it did will send an unbranded proposal to
a client.

**Not implemented: the LibreOffice middle path.** The roadmap called for it, and LibreOffice is not
installed on the machine this was built against, so it could not be tested. Shipping an untested
path that claims to work is exactly the failure this file's status rule exists to prevent — so the
fallback goes straight to the built-in generator, and says so. `libreoffice` is already detected by
the scan, so the branch has somewhere to attach when it can be tested.

**36 unit assertions** covering engine choice, the honesty sentences, spec validation, the injection
property, and the "only our own PIDs" rule.

### 3. The agent cursor ✅ DONE — wired to real work

`src/lib/agentCursor.ts` (the API), `src/components/overlay/AgentCursorView.tsx` +
`AgentAskView.tsx` (the two windows), `src/lib/officeCursor.ts` (what drives it), declared in
`tauri.conf.json` and `capabilities/default.json`.

**It draws a cursor; it does not take the user's.** An agent fighting for the mouse breaks the
moment they touch the trackpad. A transparent, click-through, always-on-top window means they see
everything and keep their machine — and it is the only way several agents can be visible at once.

**Two windows, because click-through and clickable are opposites.** `agentcursor` passes every click
through to the work beneath. A *question* must be clicked, and turning click-through off would make
a transparent sheet swallow clicks across the whole screen — so the question is a second small
window opening just below the cursor. `setIgnoreCursorEvents(true)` is re-applied on every show:
losing it once would leave an invisible sheet eating the user's clicks everywhere.

#### Why the window is full screen (1.65.0)

The first version made the overlay a small window and MOVED THE WINDOW to each point. A window
position is set, not transitioned, so every step was a jump — which is exactly how it looked. It
also meant the label could be clipped at a screen edge.

The window now covers the screen and the pointer is placed inside it with a CSS transform, which IS
transitionable: travel between two points is one smooth movement the compositor handles, at any
distance. That is only acceptable because the sheet is click-through at both levels —
`setIgnoreCursorEvents` on the window, re-applied on every show, and `pointer-events:none` in
`overlay.css`.

**A bug the screenshot caught, and reasoning would not have:** the entrance animation used
`transform: scale()` on the same element that carries the position. A CSS animation beats an inline
style, so it silently replaced the `translate()` and pinned the whole overlay to the top-left corner
— while the ghost trail, which has no animation, went to the right place. The entrance is opacity
only now, and the scale lives on the pointer beneath it.

#### The black box, and the four layers of transparency (fixed in 1.64.0)

First real run: Word opened and typed correctly, and the cursor appeared **on a black rectangle**
with the label below it.

`index.css` sets `html, body, #root { background: var(--nv-bg) }` — an opaque near-black, right for
every normal screen. The overlay windows import that stylesheet for the design tokens and the fonts,
so `#root` painted a solid rectangle filling the window and the cursor was drawn in its corner.

**A transparent Tauri window is only transparent if all four layers are: the window flag, `html`,
`body`, and the React root.** Three of those live in a stylesheet written for a different purpose,
and missing any one gives a black box. `src/overlay.css` now resets them, is imported *after*
index.css so it wins, and also kills scrollbars — a scrollbar in an overlay is a grey strip sitting
on the user's desktop.

#### THE PROGRESS IS REAL, AND THAT IS THE WHOLE POINT

Office automation is one PowerShell call that returns only at the end. The easy version of this
would have ANIMATED a cursor over that opaque call — motion invented to look busy while the real
work happened invisibly. On a product whose pitch is "watch it happen", that is the exact lie that
would matter.

So the script appends a line per real step to a file, `read_progress` reads it, and the cursor
follows what actually happened. **Measured on a real run**, streaming live while Word typed:

```
[+3600ms] opened   Word is open
[+4800ms] typing 1/7  Proposal for Acme Manufacturing
[+5200ms] typing 2/7  What adris.tech does
   … one line per block, 400ms apart, matching the real typing delay …
[+8400ms] saving   watched.docx
```

and the Word window was really at `x=234 y=94 w=1152 h=592`, with every computed cursor point
landing **inside** it and travelling **downward** as the document was written (y: 290→332→375→417→
459→502→544). A half-written progress line mid-poll is skipped and picked up complete on the next.

**Asking, when only the user can answer** — which Google account, when their X and LinkedIn are on
different ones: real choices where they exist (free text is the fallback, not the default),
**remembered** so it is asked once, and **an unanswered question times out into a HOLD, never a
guess** — `askUser` returns `timedOut` so the caller stops and says it is waiting.

**Seen working:** `npm run visual -- cursor` screenshots the real components over a mock Word
window. The overlay is a Tauri window, so it only appears inside the built exe — the screenshot is
how it is checked without one.

### 4. Claude Code / Codex bridge ✅ DONE — the chat streams through it too

`src/lib/agentCli.ts` + `agent_cli_detect` / `agent_cli_run` in lib.rs + the `agent_cli` mode in
`aiSource.ts` + the switch in the title bar.

#### The finding the whole thing rests on

Claude Code **prefers `ANTHROPIC_API_KEY` over the user's claude.ai login** whenever both are
present, and says so in a warning most people would scroll past. Measured on this machine:

| Environment | Result |
|---|---|
| `ANTHROPIC_API_KEY` set | **HTTP 401** after 3 minutes of retries |
| same call, variable cleared | **succeeded in 6.3s** |

If the app inherits that variable from anywhere — a shell profile, a launcher, another tool — the
bridge silently bills an API key instead of the subscription the user is paying for, which is the
exact opposite of why it exists. `STRIPPED_ENV` clears it and five siblings on **every** spawn.

#### Proven end to end, our arg builder → the real `claude.exe` → our parser

- plain call → `BRIDGE_OK` in 10.2s, cost reported back
- **session continuity** → turn two recalled `4712` from turn one via `--resume`
- **24,000-character prompt** → went through as a single argument

That last one is why the real `.exe` is spawned rather than `claude`. On Windows npm installs
`claude` as a **.cmd shim**, and CreateProcess does not apply PATHEXT, so spawning `claude` fails
outright; going through cmd.exe to reach the shim would reintroduce quoting and its
**8191-character** command line, which that prompt exceeds. The shim only execs
`.../claude-code/bin/claude.exe`, so that is what gets spawned.

#### The switch would have been a trap

`automationRunner` passes the resolved mode straight into `krew_ai_stream`, which has never heard of
`agent_cli` and would reject it — so turning the button on would have broken every automation. The
bridge is intercepted in `callAiOnce` before anything reaches Rust. **Every background job in the
app comes through that one function**, so a single branch turns Guard scans, automations, contract
reads and outreach follow-ups over to the user's own subscription.

#### What is NOT done yet, stated plainly

- ~~Krew chat still streams through the old path.~~ **Done.** `agent_cli_stream` in Rust runs the
  CLI with `--output-format stream-json --include-partial-messages` and forwards each line as an
  event; `streamAgentCli` assembles it. The branch sits at the top of `streamTurn`, which is the
  single choke point every model call in Krew passes through, and reads the preference **live** so
  the title-bar menu takes effect on the very next message rather than the next remount.

  **A bug found only by running it against the real CLI:** the answer arrived **twice**. The CLI
  emits the deltas *and then* a whole `assistant` message carrying the same text — a five-line reply
  came out as `1234512345`. The whole-message line is now marked and taken **only** when no deltas
  were seen, which is also what keeps it working if partials are ever unavailable. Both directions
  are asserted in the tests.

  A chosen-but-broken bridge **throws rather than falling back**. Quietly using the hosted model
  would spend adris.tech credit without saying the subscription they picked was not used — the exact
  thing the menu exists to make visible.
- **Codex is not installed here, so it is not offered.** `buildCodexArgs` is the documented shape
  and has never been run. `detectClis()` simply will not return it until it exists and can be tested.
- **The tool allow-list is empty by default** — deliberate. The bridge buys *thinking*; the hands
  are adris's own tools, which the user already approves through the normal flow.
- **Terms of use are still unchecked.** The roadmap flagged this and it remains open: whether
  driving these CLIs programmatically fits each provider's terms is a question for a person, not a
  thing to discover after launch.

**35 unit assertions**, including that an error envelope carrying `subtype: "success"` — which the
real 401 does — is never mistaken for an empty answer.

### 5. Several agents working at once ✅ DONE

`src/lib/agentSchedule.ts`, with **55 assertions**.

Exactly the requirement as stated: **if three agents can each work without the others finishing, all
three run at once; if one will answer better with what another found, it waits — and actually
RECEIVES that work**, because waiting that buys nothing is just being slow.

| Case | Behaviour |
|---|---|
| three independent steps | all three start immediately |
| a step needing one other | waits, then runs with that step's output in its context |
| a step needing two | waits for **both**, receives both |
| a chain a→b→c | each waits for its own input, and sees it, not the one before |
| a step fails | what needed it is **blocked** and says which step let it down; the chain is followed outward; **unrelated work carries on** |
| a cycle | refused **before anything starts**, naming the loop — never a run that silently hangs |
| a dependency nobody produces | same, caught up front |
| Stop | in-flight work is awaited so nothing is half-written; nothing new starts |

**The ceiling is 3, and it is not arbitrary.** There is ONE agent browser (a single CDP session — two
agents driving it interleave their clicks) and ONE Word application object per process. Unlimited
parallelism does not make work faster, it makes it collide. The real fix is a resource claim per
agent; until that exists the ceiling is what keeps the office honest.

**Still to do:** have the boss produce plans in this shape. The scheduler is done and tested with 55
assertions, and `runPlan` accepts mid-task instructions; what feeds it is the last piece.


#### The boss now produces plans in this shape ✅

`planFromDelegations()` converts what `plan_workflow` hands over into a Plan, and `runWaves()`
groups it. Authority order for a dependency:

1. an explicit `needs` on the delegation — accepting **either a step number or an agent_key**,
   because a model will use whichever it happened to be thinking in;
2. otherwise `{{prev}}` means "I need the step before me" — which is exactly what it has always
   meant, so **every existing prompt keeps its current behaviour**;
3. otherwise the step depends on nothing.

That third line is the whole win, and it is backwards compatible. It also fixes a real failure: a
model that lists the writer before the researcher used to get exactly that, and the writer opened
with an empty `{{prev}}`. The steps are now reordered onto the dependency graph before anything runs.

**Truly concurrent execution is NOT done, and the reason is honest:** delegation bubbles stream into
"the last message" in `KrewChat.tsx`, so two agents streaming at once would interleave into one
bubble. Running the waves in order is correct either way — which makes real concurrency a *rendering*
change later rather than a scheduling one.

### 6. Mid-task instructions ✅ DONE — wired into runPlan

`src/lib/midTask.ts`, plus a `takeInstructions` hook on `runPlan`.

What people remember mid-task is almost always an **addition**, not a correction — "also cc my
partner", "skip the ones in Mumbai". A person leaning over your desk would just say it.

**Folded in at step boundaries, never mid-step.** Interrupting an agent halfway through writing a
document to hand it a new brief produces something written half to each. The next step is the
earliest point the instruction can be honoured *completely* — the difference between "added" and
"half-added" — and the user is told which, because an instruction that looks ignored is worse than
one that was refused.

Taken **once**, by the first step to ask: handed to two parallel steps, "also cc my partner" becomes
two copies of everything. The text says plainly that it arrived later than the original brief and
wins where they disagree — a model given two briefs with no ordering will average them.

**Still to do:** let the chat box add to a running task instead of queueing a new one.

### 7. Coder — make it a real editor, and connect it to Krew — PARTLY STARTED

**Done (v1.60.0):**
- The open folder was a dead label. Once a folder was open there was no way to switch to another or
  get back to an empty editor — the only route out was restarting the app. It is a button now, with
  a close beside it.
- The Explorer's `+` and `▤` were bare text characters at 11–13px with no hit area. A glyph is not
  an icon: it renders in whatever the font supplies and never lines up with what sits beside it.
  Drawn icons in 24px targets now.

**Not done — the bigger half:**
- **Parity with VS Code.** Today: Monaco, a file tree, a terminal, quick-open. Missing: tabs for
  open files, a command palette, search across files, git status in the tree, a problems panel,
  breadcrumbs, split view. Embedding VS Code itself is not an option — it is an Electron app, not a
  component — but `monaco-editor` already carries far more than is currently switched on, and most
  of the gap is chrome around it rather than the editor.
- **Krew's plan must reach Coder.** The requirement: *only* when the user asks to code, the plan
  Krew produced is handed to Coder and the work follows it. Today the two modules do not talk. The
  seam is the existing plan/work-order structure plus the `nv-navigate` event that slash commands
  already use to move between modules — so the shape is: Krew produces a plan → the user says code
  it → navigate to Coder carrying the plan → Coder's AI chat works through its steps.
  **It must never switch modules on its own.** Being thrown into an editor mid-conversation is
  exactly the "do not shift the user off what they are working on" rule, applied to adris itself.

### 8. The browser for non-technical users ✅ DONE

Reported: for some users the agent browser never appears, blamed at the time on "node not
downloaded". Nothing was missing from the design — `provision_node()` downloads a pinned Node and
unpacks it automatically. **A download was failing in silence.**

Almost certainly the ISP problem already documented for GitHub release assets: hosts that accept a
TCP connection on 443 and then never complete the TLS handshake. The people this product is for
cannot diagnose that, and the app told them nothing.

**Done:**
- `download_with_mirrors()` tries **nodejs.org first, then `www.adris.tech/dl/`** — the same route
  the updater already uses to get around exactly this.
- A **240-second timeout per source**, so a black-holed connection fails instead of hanging forever.
  That hang *was* the silent failure.
- A response under 1 KB is treated as a failure, not as a Node runtime — a captive portal or an
  error page returning HTTP 200 would otherwise be unpacked as an archive.
- The error **names every URL tried and what each one said**. "Download failed" tells a
  non-technical user nothing they can act on.

**The mirror is live and measured.** Both runtimes are attached to a GitHub release tagged
**`v0.0.1`** — deliberately not an app release, and a tag that never moves, so it never has to be
re-uploaded when a version ships. The `/dl` edge proxy in the website repo already accepts `.zip`
and fetches by tag, so nothing there needed changing.

The mirror URLs are pinned with `?v=0.0.1`. **Without the pin they would default to `latest`** — the
newest *app* release — and would 404 the first time one shipped without the zip attached.

Verified end to end from this machine:

```
https://www.adris.tech/dl/node-v24.9.0-win-x64.zip?v=0.0.1   HTTP 206, 1,048,576 bytes
https://www.adris.tech/dl/node-v20.18.1-win-x64.zip?v=0.0.1  HTTP 206,   262,144 bytes
https://www.adris.tech/dl/../secrets.txt?v=0.0.1             HTTP 404  (traversal refused)
```

Range requests work, so a resumed download does too.

**Also worth doing:** bundle Node in the installer. ~30 MB, and it removes this problem *and* the
antivirus signal from downloading an executable at runtime. One decision, two problems.

### 9. Antivirus flags the installer — NOT FIXED, and it needs money not code

Reported: free antivirus stopped the installer on a real user's machine, then allowed it. That is a
**reputation** problem, not a bug, and it will get worse as the app does more.

**The cause.** `build-signed.ps1` signs the update manifest with a Tauri **updater key** — that
proves an update came from you, and Windows has never heard of it. There is **no Authenticode code
signature**, so to Windows and to every antivirus this is an unknown publisher. An unsigned
executable that spawns PowerShell, downloads Node at runtime and enumerates processes is the exact
heuristic profile of something unwanted. Everything adris does for good reasons looks, from the
outside, like the things malware does.

**Fixed already, and free:** `-ExecutionPolicy Bypass` is gone from the `-Command` spawn path. It
does nothing there — execution policy governs script *files* — while being one of the most reliable
heuristic triggers in existence. The `-File` callers still pass it, where it genuinely matters.

**What actually fixes it, in order of effect:**

1. **An Authenticode code-signing certificate.** OV is roughly $200–400/year and reputation builds
   over weeks; **EV** is roughly $400–600/year and carries SmartScreen reputation **immediately**.
   For a paid product sold to businesses this is not optional — it is the cost of not being
   quarantined. This is the single highest-value non-code item in this document.
2. **Submit the signed installer to the major vendors as a false positive.** Microsoft, Avast/AVG,
   Norton and McAfee all take submissions and most clear within days.
3. **Stop downloading executables at runtime where possible.** Bundling Node (~30 MB) removes both
   the antivirus signal *and* item 8's silent download failure. One decision, two problems.
4. **Keep the PowerShell surface small and named.** Two commands with documented contracts
   (`scan_installed_apps` reads only; `office_automation` writes documents) beats one general
   "run anything", both for review and for anyone reverse-engineering the binary.

**Do not:** obfuscate, pack, or otherwise try to look less like what it is. That makes the score
worse, not better, and it is the wrong instinct for a product whose entire pitch is that it does not
touch the user's data.

---

## The website has to change too — NOT STARTED

**adris.tech is pay-per-use now.** The site still sells subscription tiers, and the exe already says
"pay per use" in the AI menu, so the two now contradict each other in front of the same user.

This is the **website repo** (the NIVARA root), not this one, and it is listed here so it is not
forgotten while the exe moves:

- **Pricing page** — replace the tier table with pay-per-use. What a unit costs, what a typical
  month looks like, and no monthly commitment.
- **Say the cheaper option out loud.** Someone who already pays for Claude Code or Codex can plug it
  in and spend nothing here. Hiding that to protect revenue would be the same dishonesty the app
  refuses everywhere else — and it is the strongest reason to choose adris over a wrapper.
- **Checkout and the webhook** — `razorpay-webhook` and the plan grants are written around
  subscriptions. Usage billing is a different shape and needs deciding before it is built.
- **The exe's plan badge** currently reads Free/Solo/Builder/Team. It has to mean something under
  pay-per-use or come out.

**Do not start this until the exe is launched.** The two must change together, and a half-migrated
pricing page is worse than an old one.

---

## Cutting a release — what the script does and does not do

**`scripts/build-signed.ps1` READS the version, it does not bump it.** It takes
`(Get-Content src-tauri/tauri.conf.json | ConvertFrom-Json).version` and builds whatever it finds,
so **forgetting to bump silently rebuilds and re-uploads the version already out there.** The bump
is a manual edit first, every time.

A bump touches **exactly two files**:

- `package.json`
- `src-tauri/tauri.conf.json`

And deliberately **not**:

- **`src-tauri/Cargo.toml`** — sits on its own scheme (currently `1.7.6`) and has never been moved
  for a release. Leave it alone; matching it to the app version would be a change of its own.
- **`latest.json`** — the script regenerates it after the build, because it has to carry the real
  signature of the `.exe` that was just produced. Hand-editing it produces a manifest whose
  signature does not match the installer, and the updater rejects it.

Then `build-signed.ps1` does the rest by itself: signs, writes `latest.json`, commits
`chore(release): v<version>`, tags, creates the GitHub release, uploads the assets, and mirrors the
manifest to the hosts that are actually reachable. **Release notes are hardcoded** to "Bug fixes and
improvements" in the script — if a release deserves real notes, that is an edit to the script or to
the release afterwards, not something a bump can express.

### The signing failure, and the Windows rule behind it

A four-minute build of 1.65.0 ended with **"Wrong password for that key"** — after prompting for a
password inside a script that was never meant to be interactive.

The script set:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY          = <the key>
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
```

**On Windows, setting an environment variable to an empty string DELETES it.** There is no such
thing as a variable that exists with no value. Demonstrated:

```
$env:NV_DEMO = "something"   ->  exists = True
$env:NV_DEMO = ""            ->  exists = False
```

So the key was set and the password variable silently did not exist. Tauri found a key, needed a
password, could not find one, and fell back to an interactive prompt — where whatever it received
was wrong. The key's password genuinely **is** empty, which is precisely the one value the
environment cannot carry.

**Fixed, and it took three goes because there were three separate bugs stacked on each other:**

1. **The environment cannot carry an empty password**, as above. The key no longer goes through the
   environment at all; the build runs unsigned and signing happens afterwards.
2. **Not setting the variables is not enough — they must be actively cleared.** A shell that ran the
   old script still carries `TAURI_SIGNING_PRIVATE_KEY` for the life of that window, and it broke
   the next run twice over: `tauri build` found a key and prompted again, and then `signer sign`
   refused with *"--private-key-path cannot be used with --private-key"*, because the leftover
   variable **is** `--private-key` as far as the CLI is concerned. The script now removes both at
   the top, so a run no longer depends on what was typed in that window earlier.
3. **PowerShell 5.1 drops an empty-string argument to a native executable.** `--password ""` passes
   *nothing*, so the CLI read the `.exe` path as the password and then reported the FILE argument
   missing. This is why the script's original fallback never worked either — same line, and its
   failure was hidden behind the earlier error. `--password '""'` passes two literal quote
   characters, which the CLI parses as an empty string. Both forms were measured against the real
   key: `'""'` produces a valid `.sig`, `""` does not.

**A fourth one, which the fix for the first three caused.** `tauri.conf.json` carries an updater
`pubkey`, so the bundler ALWAYS attempts to sign. With the private key deliberately kept out of the
environment it now stops with *"A public key has been found, but no private key"* — **after** writing
the installer. Its own log says so: `Finished 1 bundle at …_x64-setup.exe`.

The script treated that non-zero exit as a failed build, threw away a good four-minute compile, and
stopped before the signing step it was about to perform itself. It now asks the honest question —
**is there an installer?** A real failure produces none and still stops the run.

**And a good signature is never thrown away before a replacement exists.** The first attempt at this
deleted the `.sig`, then failed — destroying a valid signature the build had just produced. It is
moved aside now and only removed once a new one is on disk.

An existing `.sig` is deleted before re-signing, because a signature must match the exact `.exe`
about to be uploaded and a stale one is worse than none.

`-SkipBuild` was added for exactly this situation: the `.exe` is already built and only the signing
and publishing steps need to run again, without paying for another four-minute compile.

**Why the mirroring exists** (measured on a real Indian ISP, not assumed):
`objects.githubusercontent.com` and `release-assets.githubusercontent.com` accept a TCP connection
on 443 and then never complete the TLS handshake — SNI filtering. Every GitHub release file is
served from those two hosts, so the updater could not even read `latest.json` and told users to
check a connection that was fine. Everything therefore downloads via `www.adris.tech/dl/<file>`.
Use `www` — the apex 307-redirects and drops the CORS header, which kills the fetch.

---

## Fixed in passing

### The outreach daily limit, and a file that could vanish ✅ (v1.61.0)

Two separate things, both raised by the owner, both about honesty rather than mechanics.

**The daily limit was not adris's to set.** `SEND_DEFAULTS` capped sending at 40 emails and 20
LinkedIn messages a day and the interface presented that as a rule. It is the user's mailbox, their
domain, their LinkedIn account and their list — a five-year-old domain mailing warm contacts can
comfortably do far more than 40, and a brand-new one should probably do less. **adris does not know
which they have.** What adris owes them is the reason for a safe starting point, not the ceiling.

`loadDailyCaps()` / `saveDailyCaps()` now hold the user's own numbers, edited **inline where the
count is shown** — the moment someone asks "why has it only queued 40?" is the moment it should be
changeable, not three screens away and not a support question about a restriction adris invented.
The only hard edges: `0` and nonsense fall back to the safe **default** rather than to 1 (someone who
fat-fingers a zero should get a sane limit back, not a limit of one), and an absurd number is clamped
to 2000, keeping the intent.

**An attached file could be delivered as nothing at all.** Attachments ride the SMTP path correctly —
`buildSendQueue` puts the campaign-wide file on every candidate, a contact's own file beats it, and
`smtp_send_email` carries `attachmentPath`. But the **browser compose fallback** (used when SMTP is
not set up) carries only to/subject/body. Sending through it with an attachment set would deliver a
message whose entire point — *"here is the brochure"* — was missing, **and report it as sent**. The
contact then receives a mail referring to a document that is not there and the user never finds out.

It now refuses, and says the one thing they can act on: attachments need their own mailbox (SMTP).
LinkedIn correctly never carries one, because it cannot.

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
