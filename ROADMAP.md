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

**Version in the tree: 1.61.0** — builds clean, not yet produced as an `.exe`. Last released: 1.59.0.

1.60.0 carries the fix for the boss denying `create_office_document`, plus the two guards that
stop it happening again. **If you build nothing else, build this one** — 1.59.0 has the Office
feature but the boss cannot reach it.

| # | Item | State | Evidence |
|---|---|---|---|
| — | UI pass | ✅ **released** in 1.58.0 | screenshotted in both themes |
| — | Outreach copilot counts | ✅ **released** in 1.58.0 | 11 assertions on the real numbers |
| 1 | Scan what's installed | ✅ **done** | 182 shortcuts → 45 apps on a real machine; 48 assertions |
| 2 | Drive Word / Excel / PowerPoint | ✅ **done** | real files made **and read back**; a real `.dotx` template's branding verified in the output; 36 + 13 assertions |
| 4 | Claude Code / Codex bridge | 🟡 **half** | works against the real CLI — background jobs use the subscription; **Krew chat does not yet**; Codex untested |
| 3 | Agent cursor | ❌ **not started** | specified in detail below, including the ask-the-user window |
| 5 | Several agents at once | ❌ **not started** | specified in detail below |
| 6 | Mid-task instructions | ❌ **not started** | — |

### The lesson that cost a release

1.59.0 shipped a working Office feature that the user could not use. `create_office_document` was
built, tested against real Word, and verified producing branded documents — and when the user asked
for a Word proposal the boss replied **"I cannot create or save files directly to your computer."**

The tool was never added to the boss's system-tool allowlist, which lived as an inline literal 4,800
lines into `KrewChat.tsx`. Nothing was broken; the agent was describing the tools it could see.
**Every test I had written passed.** None of them exercised `executeTool(name, args)` → a file on
disk — the only path a user ever takes.

Two things now prevent a repeat, and both are wired into `npm run build` / the test suite:
`scripts/check-boss-tools.mjs` (asserts every boss tool name is real, that the capabilities people
ask the boss for directly are present, and that the shared list has not drifted back to a literal)
and `harness/officeDispatch.mjs` (drives the real tool to a real document).

**The rule this produces: a feature is not done when the module works. It is done when the thing
the user types produces the thing they asked for.**

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

### 1. Scan what's installed on the PC ✅ code complete, 🟡 not yet run in a real build

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

**Still to verify in a real build:** the Rust command has only been `cargo check`ed. The PowerShell
it runs was executed directly and produces correct output, but the two have not yet been exercised
together through `invoke`.

### 2. Drive Word, Excel and PowerPoint ✅ built and proven on a real machine, 🟡 not in a build yet

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

### 3. The agent cursor — NOT STARTED

A visible, department-coloured cursor that **moves around the screen and does the work**, with a
label saying what it is doing ("Meera · reading your pricing sheet").

**Design correction, stated up front: do NOT take over the real Windows cursor.** An agent fighting
the user for the mouse is infuriating and breaks the instant they touch the trackpad — and the
owner's rule is that **adris must never shift the user off the software they are working in**. So
this is a transparent, click-through, always-on-top overlay window: the user *sees* the work happen
and keeps their machine. It also means several agents can be visible at once, which the real cursor
could never do.

#### 3a. When the cursor gets stuck, it ASKS — right there, not in the app

The requirement, in the owner's words: the agent is clicking through a real task and hits something
only the user can answer — *which Google account?* Their X is on one account and their LinkedIn on
another. Today an agent would guess, and a wrong guess here posts to the wrong account.

So the cursor **holds**, and a small window opens **directly below the cursor** — over whatever app
the work is happening in, **not** inside the adris window — with the question and the options it can
see. The user answers, and the cursor carries on.

Why below the cursor and not in the exe: the user's eyes are on the app being worked in. A prompt
that appears in a different window, possibly behind the one they are looking at, is a prompt that
gets missed — and a stalled agent that looks like a hung agent.

Design notes for when this is built:
- It must be a **separate always-on-top Tauri window**, positioned at the cursor. The existing Quick
  Bar (a second webview sharing localStorage) is the closest thing already in the codebase and is
  the pattern to copy.
- Offer **real choices, not a text box**, wherever possible — the accounts actually signed in, read
  from the browser profile, are a list the user recognises. Falling back to free text is fine.
- The answer must be **remembered** ("X posts go from the personal account, LinkedIn from the work
  one") in the shared Krew profile, so the same question is asked once, not every run.
- A question must **time out into a hold, never into a guess.** If nobody answers, the task waits
  and says it is waiting — it does not pick one.

### 3b. Everything visible in the chat as it happens

Whatever the cursor is doing must also be legible in the chat — **while** the task runs, not only
when it finishes. This is the existing `src/lib/agentActivity.ts` rule (never a bare "thinking…";
name the sheet, the filter, the query, with a live clock) extended to cursor work.

### 4. Claude Code / Codex bridge ✅ working against the real CLI, 🟡 partial coverage

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

- **Krew chat still streams through the old path.** `KrewChat.tsx` has its own `krew_ai_stream`
  plumbing, and the CLI answers in one piece rather than streaming. Routing it means either
  buffering (losing the live feel) or moving to `--output-format stream-json`. That is the next
  step, and it is the difference between "background work uses your subscription" and "the whole
  app does".
- **Codex is not installed here, so it is not offered.** `buildCodexArgs` is the documented shape
  and has never been run. `detectClis()` simply will not return it until it exists and can be tested.
- **The tool allow-list is empty by default** — deliberate. The bridge buys *thinking*; the hands
  are adris's own tools, which the user already approves through the normal flow.
- **Terms of use are still unchecked.** The roadmap flagged this and it remains open: whether
  driving these CLIs programmatically fits each provider's terms is a question for a person, not a
  thing to discover after launch.

**35 unit assertions**, including that an error envelope carrying `subtype: "success"` — which the
real 401 does — is never mistaken for an empty answer.

### 5. Several agents working at once — NOT STARTED

Multiple agents on real work simultaneously, each with its own cursor and colour, without fighting
over one browser window or one Word instance. Builds on 1–3.

The hard parts, none of which are the UI:
- **One browser, many agents.** The existing agent-browser is a single CDP session on port 9223.
  Two agents driving it at once would interleave clicks. Needs either a tab per agent with a lock,
  or a profile per agent.
- **One Office, many agents.** Word COM is a single application object per process. Two documents at
  once is fine; two agents editing the *same* document is not.
- **The user is also using the machine.** Nothing here may steal focus or the clipboard.

#### 5a. Agents must hand work to each other, in the form the user actually wants

The owner's example, and it is the right test: a lead-gen run should not just print a list in the
chat. If the user wants it **in Excel**, the list goes to Excel — using the spreadsheet software on
their own machine (item 2 already does this), and only falling back to showing it in the exe if no
such software exists.

So the rule is: **the deliverable decides the destination, not the agent that produced it.** A
researcher finishing a list should be able to hand it to the document agent without the user
re-asking, and the chat should say where it went and offer to open it.

`save_to_brain` / `recall_from_brain` already move facts between agents. What is missing is passing a
*deliverable* — a table, a draft, a list — with an intended destination attached.

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

### 6. Mid-task instructions — small, high value
Today a running task can't be added to; the user waits for it to finish, then asks again. It should
absorb a new instruction *while running* — the way a person would when you lean over and add
something. Very often what the user remembers is an addition, not a correction.

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

**Why the mirroring exists** (measured on a real Indian ISP, not assumed):
`objects.githubusercontent.com` and `release-assets.githubusercontent.com` accept a TCP connection
on 443 and then never complete the TLS handshake — SNI filtering. Every GitHub release file is
served from those two hosts, so the updater could not even read `latest.json` and told users to
check a connection that was fine. Everything therefore downloads via `www.adris.tech/dl/<file>`.
Use `www` — the apex 307-redirects and drops the CORS header, which kills the fetch.

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
