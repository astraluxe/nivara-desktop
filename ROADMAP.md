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

**Version in the tree: 1.79.0** — builds clean (17 checks + tsc + vite), all suites pass.
**Last released: 1.77.0.**

**The commercial model is settled and the pricing page is live.** Bundled monthly tiers — Free /
Business / Growth / Enterprise — with a 1/3/6/12-month term switcher, top-ups, a pilot request and
an enterprise request. Payments are deliberately held: checkout does not exist yet, so no button
takes a card. Free is a **one-time** allowance, not a monthly one, and no GST is claimed anywhere.

**1.78.0 also carries a round of things that had never worked at all.** Mesh's engine had been
returning 404 for every user since the feature shipped; eleven brand logos were invisible in one
theme or the other; the Brain filled with duplicate figures from any document attached twice;
Settings reported v1.27.1 for fifty-one releases; and every file in the Coder tree drew the same
grey dot. Each was found by measuring rather than reading, and each now has a build check or a
suite behind it.

**1.78.0 is about the app doing the work instead of talking about it.** A user attached a document
with five figures and asked for a PowerPoint; a model replied that it was a text-based AI, could not
create .pptx files, and had received no files — all false. Naming PowerPoint now goes to the
deterministic builder rather than to an agent that can refuse; a refusal is detected and overridden;
the deck defaults to the PowerPoint the business already owns; and answers carry one-click reply
buttons. A new build check also found a **shipped** regex whose word boundaries had become backspace
bytes, which had silently disabled every in-chat deck edit.

**1.77.0 fixes two things 1.76.0 shipped broken, both found by the owner rather than by us.** The
rail's Word / Excel / PowerPoint buttons were dead — the launcher was handed a command name instead
of a path, and the error was swallowed. And the deck card never asked where the presentation should
go, while the `.pptx` writer quietly dropped pictures on four of the six layouts they get placed on.
Both are now driven against the shipped components in a real browser, and both have a build check
standing behind them.

**Three un-released builds are stacked up, and that matters for reading bug reports.** 1.67.0 removed
the connection pills; 1.68.0 reconnected the menu to the chat and added its second layer; 1.69.0
hardened the subscription guarantee and rebuilt the composer.
A report about the app made against the released `.exe` is a report about **1.66.0**, where the
pills are still on screen — so "I still see Local / Own key / adris.tech in Krew" is true of the
build the owner is running and not of the tree. **Nothing below is in a user's hands until an
`.exe` is cut.**

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
| 4 | Claude Code / Codex bridge | ✅ **done** | background jobs and the chat both; streaming verified against the real CLI |
| — | One control governs the whole app | ✅ **done (1.68.0)** | 15 assertions over the pref→chat mapping; menu + both second screens screenshotted |
| — | Menu's second layer (which local model, which model on a key) | ✅ **done (1.68.0)** | driven in a real Chrome: model list fetched from a key, non-chat models filtered, current one marked |
| — | Bridge set up FOR the user (no terminal) | ✅ **done (1.68.0)** | install + sign-in + "signed in with WHAT" check; 14 assertions against the real CLI. Codex 🟡 — written, not yet run |
| — | Bridge runs on the **subscription**, not an API key | 🟡 **necessary work done, NOT proved** | env stripped (measured), official CLI spawned, `authMethod` surfaced — but usage has never been **seen** landing on the Claude.ai account. See §"THE SUBSCRIPTION, NEVER AN API KEY" |
| 7 | Coder | 🟡 **part** | folder, icons, **Krew→Coder handoff**, AI-menu obedience done. "VS Code parity" now scoped into C1–C6 — see §7 |
| — | Boss produces dependency-aware plans | ✅ **done** | `plan_workflow` accepts `needs`, orders by dependency; 66 assertions |
| — | Node download survives a filtered network | ✅ **done** | mirrored through adris.tech, every attempt named on failure |
| — | Truly concurrent delegation | ✅ **done** | bubbles have an identity; independent stages run together |
| 3c | Clicking in software with no API | ❌ **not built** | input synthesis refused by a safety check — UI Automation is the right design |
| 8 | Browser for non-technical users | ✅ **done** | both runtimes mirrored at tag v0.0.1; adris.tech/dl serves them (HTTP 206 measured) |
| 9 | Antivirus flags the installer | ❌ **needs a certificate** | parked at the owner's request; one free mitigation applied |

### What is NOT done — the queue, in order

**Status key:** ❌ not started · 🟡 partly done / built but unproven · ⏸ blocked, waiting on
something outside the code · ✅ done and seen working.

**The rule this table exists to enforce:** ✅ means *seen working*, not written. Anything
believed-to-work-but-unverified stays 🟡 however many tests pass.

| # | Item | Status | Done already | Still to do | Blocked on |
|---|---|---|---|---|---|
| **S1** | Prove the bridge bills the **SUBSCRIPTION**, not an API key | 🟡 **code done (1.69.0)** | `--claudeai` passed explicitly; `agent_cli_credentials` reads the file as a second, independent check and **cannot return a token**; both signals merged; the run path **refuses** a detected API key at the one choke point every call passes through; expiry warned at 14 days. 35 assertions, and **driven end to end against the real CLI + real credential file** — verdict `subscription`, source `both`, nothing leaked | **SEE usage land on the Claude.ai account, not the API dashboard** — the one part code cannot prove | needs a live billing check by the owner |
| **U1** | The composer: one surface, floating controls, Fast/Advanced as a menu | ✅ **done (1.69.0)** | six bordered boxes became one surface; mic/attach/Brain/expand/Research are borderless and float on it; the Fast–Advanced segmented toggle is now the same pill-and-sheet as the title-bar menu, opening upward; screenshotted in both themes | — | — |
| **S2** | Show how much of the subscription has been used | 🟡 **Claude Code done (1.69.0)** | reads `~/.claude/projects/**` on this machine — no network, works offline; **1,992 duplicate turns removed** from a 7-day window, without which every figure would be ~double; hourly buckets, local-day rollup, per-model split; 485 ms over 127 MB; screenshotted in both themes with **real** numbers | **Codex** — it keeps history in SQLite and the schema has not been read on a signed-in install | Codex being installed |
| **F1** | ~150 hardcoded tips in the empty chat | ✅ **done (1.69.0)** | **152 tips** in `lib/krewTips.ts`, covering the whole product; rotation with no repeat in a session and a "another tip" control; tips suppressed for anything already set up; 40+ are one click from doing the thing; `scripts/check-tips.mjs` in the build proves every command and module named is real; 30 assertions; rendered and screenshotted | — | — |
| **F3.1** | Say what the agent is doing, in the silence before the answer | ✅ **already shipped** | the waiting box has been reading the live bus for releases — real headline, real detail, a live clock that survives a backgrounded window. **The roadmap was out of date, not the code** | — | — |
| **F2** | Faces for all 56 agents | ⏸ | the full design brief is written and ready to send | integrate the returned component across chat header, bubbles, agent grid, council | the design coming back |
| **F3.3** | Several agents visibly running at once | ✅ **done (1.69.0)** | **the activity bus was a single slot** — parallel agents overwrote each other, so three agents rendered as one flickering between three names. Now a map keyed by agent; the waiting box lists the whole crew with each one's department colour and what it is doing. 20 assertions | — | — |
| **F3.2** | Working state on the avatar | ✅ **done (1.69.0)** | a 2.5s halo in the agent's own department colour, on the avatar of whoever is actually working — read from the same bus as the waiting box. `prefers-reduced-motion` swaps it for a static ring. **Not blocked on F2 after all**: it wraps the current initials avatar and will wrap a face unchanged | — | — |
| **F5** | Prove parallel agents **on screen** | 🟡 | 55 assertions at the logic level | one real request needing three agents, watched end to end | nothing — a test pass, not a build |
| **C3** | Coder: git status in the tree + a diff view | ✅ **done (1.69.0)** | `git_status` (porcelain `-z`) and `git_diff_file` in Rust; letters in the tree, a dot on folders containing changes, branch + change count, and a read-only unified diff in the editor pane. 39 assertions. **C1 (tabs) and C2 (search) were already built — the roadmap was stale** | — | — |
| **F4** | Hermes — the model, and the agent | 🟡 **both added, neither proven** | **the model:** Hermes 3 8B / 70B in the Models catalogue with published sizes. **the agent:** `bulk_runner` — Hermes.Runner, 57th on the roster, for repetitive work over a whole list where consistency beats cleverness | probe the model on a real download; **per-agent model routing** so Hermes.Runner prefers the local Hermes when installed | a multi-GB download |
| **T1** | **The Shelf** — a right rail, and free software instead of a subscription | ✅ **done, one entry proven end to end (1.69.0)** | the rail (never expands, tooltip opens leftward), an 8-tool catalogue naming the paid product each replaces, Docker detect/install/run/stop/remove in Rust, a readiness poll so nothing opens at a dead port, the confirm dialog, the tool's own UI embedded, and **AI-native tools that run on the model chosen in the title bar**. **72 assertions.** n8n **pulled, run and seen answering**, with the model variables confirmed inside the live container | the other 10 catalogue entries are **plausible but untested**, and say so in the UI | nothing |
| **T1b** | The Shelf without Docker — a Node tier | ❌ **RESEARCHED AND DROPPED** | Docker is a wall for the exact person this is for: 600 MB, WSL2, a restart, admin rights, and a paid licence above ~250 staff. **The Node runtime adris already provisions can run a whole tier of tools with none of that** — **the research says no.** 24 candidates queried on npm: only **2** are genuinely runnable business apps, and installing the better of them (n8n) took **1,149 packages and was still unfinished at 14 minutes** — against ~2 minutes for the same tool via Docker. A tier of two, one of which takes a quarter of an hour, is worse than the honest Docker path. **T1c is worth far more** | the Docker path stands as the honest one | — |
| **T1c** | **Compose support** — the ERP and CRM that businesses actually want | ✅ **done, verified (1.69.0)** | compose files **generated from the catalogue, never accepted**; `tool_compose_up/down`; the image gate extended to cover every image a file names; specs for **Odoo, Dolibarr, EspoCRM, Kimai**. **Odoo installed for real** — app + PostgreSQL up from a generated file, answering 303 to its own setup. 30 more assertions | ERPNext, Twenty, Zammad need more than app+database — listed honestly, no half-working spec | — |
| **R1** | The isometric "team room" | ❌ **BUILT TWICE, REMOVED** | built in three.js, rebuilt as a 2D canvas, furnished with props and characters — and the owner's verdict on both was that it looked bad. **Removed from the product entirely (1.72.0)**: `OfficeRoom`, `isoRoom`, `OfficeFlat`, `officeLayout` and their suites are deleted, and the Office tab is the org chart again. Shipping a screen the owner would not show anyone is worse than not having one. three.js went with it — **705 kB off the bundle** | a room worth looking at needs real character art, not procedural boxes | **assets.** `arturitu/the-delegation` is the target look and its models are **CC BY-NC — unusable commercially**; the route is permission from the author or commissioned art |
| **T1d** | Real logos on the Shelf, and a chat list that is a list | ✅ **done, verified (1.71.0)** | the rail drew **two-letter initials** — a catalogue of real software reading as abbreviations. All 18 marks now come from each project's own published asset via `scripts/build-tool-logos.mjs`, **never drawn from memory** (the Claude mark was drawn by eye twice and wrong twice). Five projects publish only WORDMARKS, illegible at 18px — their square app icons are used instead. Every mark sits on one neutral tile, because three of them were near-black on a dark rail and three carried their own background. Plus the Krew chat list: each row was a **two-line bordered card**; it is now one line — department dot, title, time — with the row's controls taking the time's place on hover so **nothing moves** (asserted at 0.00px). `check-tool-coverage` now fails the build on a tool with no logo | the 16 Connect Apps brand logos are still separate and still need owner assets | — |
| **W1** | **The website, after the exe** | ✅ **LIVE** | pushed and verified against production: `/bridge` (a whole page for the subscription pitch), the home bridge band and hero line, two new docs topics (bridge setup, the Shelf, Docker's licence threshold), 48/43 agents → **57**, and the `Bridge` nav item on all 30 pages. All 38 routes loaded in a real browser — zero overflow, zero console errors | **W1-1 pricing (owner is deciding)**, W1-5 selling the licence, W1-7 checkout, W1-8 account | — |
| **X1** | Shortcuts must not answer a question nobody asked | ✅ **done (1.76.0)** | the deck shortcut ran **before the boss** and one of its rules was, in effect, *"the text contains ppt, therefore build a deck"*. So *"give me a script to follow to present the ppt"* put the BUILDER form on screen instead of writing the script — reported repeatedly — and *"use Microsoft PowerPoint"* never reached the boss that could have driven the real PowerPoint. Now `lib/deckRouting.ts`: `office` when the user names their own app, `build` only when unambiguous, **`boss` for everything else**. **38 assertions on the exact sentences reported** | the same audit for the other pre-boss shortcuts (lead-fill, schedule, deck-edit) | — |
| **T1e** | The right rail without Docker | ✅ **done, now actually working (1.77.0)** | all 17 Shelf tools need Docker, which is a real wall for the person this is built for. **Word, Excel and PowerPoint sit at the top of the rail** — already installed, nothing to set up. **1.76.0 shipped them dead**: the click called `launch_application` with the command NAME (`winword`), the Rust side requires a real file (`path.is_file()`), and the caller wrapped it in `catch {}` — so every click failed and said nothing. The owner found it: *"i clicked on word and nth happened"*. The path now comes from the machine scan (`officeApps`, which will not mistake **WordPad** for Word), a failed launch is shown to the person who clicked, and `check-app-launch.mjs` fails the build on a literal exe or an empty catch. **11 assertions driving the real rail in a browser** | LibreOffice as the free fallback for machines with no Office | — |
| **X2** | Pictures out of the user's own document | ✅ **done (1.76.0)** | a deck built from a paper that HAS diagrams and contains none of them is missing the part the reader needed. `lib/docImages.ts` lifts them out: **DOCX** from `word/media` (it is a zip), **PDF** by walking each page's drawing operators and redrawing each painted image to a canvas. Bullets, rules, spacers and the header logo repeated on every page are filtered out; capped at 12, in document order. They reach the deck and are deliberately kept OUT of the vision payload, so a twelve-figure report does not multiply the cost of every message. **Also fixed: a .docx attachment was read with `readAsText`, which on a zip is mojibake** — every Word file the user attached arrived as nonsense. **34 assertions + 12 against a real .docx built in the test** | scanned PDFs where the figure IS the page | — |
| **X3** | Where the presentation should go, and the pictures arriving there | ✅ **done (1.77.0)** | the deck card had the destination as a fact, not a question — `const format: 'html' = 'html'` — so someone who owned PowerPoint, or asked for it outright, got the chat deck and no way to say otherwise. It now **asks, but only when PowerPoint is really on the machine** (an option that cannot work is worse than no option); choosing it writes a real `.pptx` from the same spec and opens it in their own PowerPoint, keeping the chat deck as the record and the thing follow-up edits act on. **And the pictures now survive the trip**: the `.pptx` writer drew `imageData` on **two** of the six layouts the placer targets, so figures lifted out of a document were on the slide in chat and gone in PowerPoint, silently. `LAYOUTS_WITH_IMAGE` is now shared by the placer and both renderers, `two-column` is off the list (neither renderer draws a picture there), and an explicit *"put it on slide 4"* converts a layout that has no image slot rather than dropping the picture. **Proved by building a real .pptx, unzipping it and finding the image inside — 19 + 11 assertions** | placing a figure NEXT to the text it belongs with, rather than in document order | — |
| **X4** | A refusal is never the answer, and the user's own app comes first | ✅ **done (1.78.0)** | a user attached a .docx with five figures and asked for "the proper ppt in microsoft power point". Naming the app sent the request to an AGENT, which called `list_installed_apps`, returned nothing, then answered *"I cannot create or send a .pptx file — I am a text-based AI … no files were received in this chat"* and asked them to paste the document back. Every clause false. Now: naming PowerPoint reaches the **deterministic builder**, which cannot decline; `lib/refusalGuard.ts` detects that class of reply and runs the builder on the same material (**30 assertions, weighted towards the honest answers that must survive**); and the deck card **defaults to the PowerPoint the business already owns** — our in-chat deck is the fallback for machines without it, not the default in spite of one | the same "installed app first" default for Word and Excel documents | — |
| **X5** | Answer without retyping | ✅ **done (1.78.0)** | the reply buttons only fired on 2–5 **numbered** lines inside the last 900 characters, so the shapes people actually get — *"PowerPoint or here in the chat?"*, *"shall I add speaker notes?"*, `say "extend the deck"` — produced nothing and the answer had to be typed out again. `lib/quickReplies.ts` reads either/or questions, bulleted and lettered lists, yes/no offers (sending the agent's **own words** back so it knows what "yes" meant) and phrases the agent told the user to say. **29 assertions, and the cases where nothing must appear carry equal weight** — a button under every message is furniture nobody reads | buttons on the cards, not just on prose answers | — |
| **X6** | The escape that was eaten, and had shipped | ✅ **done (1.78.0)** | `scripts/check-source-chars.mjs` (new, in the build) found `deckRouting.ts` carrying a **literal backspace byte (0x08) where `\b` should have been** — a shell ate the escape in an earlier session. It was the last line of `isDeckEdit`, so **every in-chat deck edit** ("put my logo on slide 1", "remove slide 4") returned false and fell through to the boss. Nothing failed loudly; the feature simply never worked. The check is negative-tested by putting the exact bug back. Also `scripts/check-chat-affordances.mjs`, which asserts the nine wiring points **and** that the refusal guard runs *before* the answer is committed | — | — |
| **X7** | Mesh could never have worked | ✅ **done (1.78.0)** | connecting a second laptop with the room code did nothing. The transport was fine — two clients on one Supabase presence channel pair in under a second, tested against the real project — but the engine it needs, `exo-node.exe`, **was never uploaded to any release**: the download URL returned 302 → 404 for every user since Mesh shipped. It also pointed at GitHub, which this ISP blocks. Now published, served through `www.adris.tech/dl/`, and added to the release script. Two dead ends went with it: pressing Connect **downloaded the engine and then stopped** (a second press was the undocumented answer), and a null machine-probe made the button do nothing at all, silently | let Mesh pair before the engine is installed, so the pairing and the pooling fail separately | — |
| **X8** | Logos that vanish in one theme | ✅ **done (1.78.0)** | the AI menu draws brand marks at full colour, and **eleven of twenty-three fell below the 3:1 floor** on one of the two backgrounds — OpenAI, GitHub, Notion, X, Vercel and Slack were a hole in the dark menu; NVIDIA, Airtable, Shopify and Claude washed out on paper. Nobody had looked at both themes. The eleven now take a per-theme CSS variable, so a mark repaints the instant the theme flips, and the five **monochrome** brands get white rather than the mid-grey a bare contrast test would settle for. `check-brand-contrast.mjs` re-measures every mark on both surfaces | — | — |
| **X9** | The Brain filling up with a document's figures | ✅ **done (1.78.0)** | the same Word file attached twice, and the Pictures folder filled with the same figures again. Two faults: **every** image was saved, including the figures we extracted ourselves — one report with a dozen diagrams became the picture library — and `addUniqueNode` does the opposite of dedupe, keeping both and renaming the newcomer "figure 1 (2)". Now only pictures the user attached are kept, deduplicated **by their bytes** (a filename cannot do this job: two figures are both "image1.png") | offer to save a document figure when the user asks for it by name | — |
| **X10** | Settings said v1.27.1 for fifty-one releases | ✅ **done (1.78.0)** | the "What's new" version was a hand-typed string on a panel whose only job is to say what changed. It is derived from `package.json` through Vite now, the notes are this release's, and **the update check moved from the very bottom of Settings to the top** — it is the one thing people come to Settings looking for | — | — |
| **C1** | Coder that reads as a code editor | ✅ **first pass (1.78.0)** | it had the pieces — tree, editor, terminal, assistant — and none of the furniture. **Every file in the tree drew the same grey middle-dot**, so it could be read but never scanned. Now: a language chip per file (`lib/fileIcons.ts`, whole-name rules beating extensions so `package.json` is npm and not "some JSON"), an **activity bar** down the left edge, a collapsible tree, and a **status bar**. The chips are drawn as filled blocks with the label knocked out, because colouring the text failed for twelve of the hues on the light theme — measured | editor tabs for open files; a Problems panel; git decorations in the gutter | — |
| **F-film** | The product film, rebuilt as code | 🟡 **built, awaiting the owner's eye** | `adris Film.dc.html` is a scene PLAN whose renderer (`animations-v3.jsx`, `world.js`, `piece.jsx`, `support.js`) **does not exist in this repo**, so it drew nothing; and the film on the homepage is a **43 MB .mp4** — the heaviest thing the site serves, and un-editable without a re-render. `adris-film.html` tells the same story in ~40 KB of HTML and CSS: eleven beats in ~44s (was ten in 59s), at most six words a beat, and two new scenes the old cut had no way to show — **a deck being designed inside a real PowerPoint window**, and **the bridge** ("already paying for AI? plug it in"). Sharp at any size, editable in place, no network | the owner sees it and says yes or no before it goes near the site | **owner review** |
| **L-usage** | Pay-per-use: metering that can actually bill | 🟡 **plumbing done, prices not set (1.73.0)** | audited Supabase and found `token_usage` could not bill: no input/output split, the model **hardcoded** on every row, no record of whose key paid, `cost_rupees` 0 on all 900 rows, and **RLS letting a customer UPDATE and DELETE their own usage**. Migration `harden_token_usage_for_pay_per_use` closes the hole and adds the columns; Rust records the real source and model; `usageMeter.ts` prices it (**47 assertions**); `UsagePanel` shows it. Caught a bug that would have **billed nobody** — the source was mapped on write and again on read, and the mapper did not accept its own output | **the owner sets the prices** — `RATE_CARD` is empty on purpose and every screen says so rather than showing an invented figure | real provider token counts (today's are estimated from character count) |
| **L1–L10** → **P0–P16** | Pricing page + pay-per-use, exe and website | 📋 **PLANNED — the owner's pricing draft is now in this file** | the commercial model is written down in full (four tiers, term ladder, top-ups, pilot, FAQ) and the coding plan **P0–P16** is derived from it below | all of it | **P0 first: Studio is sold on the pricing table and is not reachable in the app.** Then GST, cancellation terms, and the currency convention — all owner/CA calls |
| — | Codex install + sign-in verified on a real machine | ✅ **verified (1.69.0)** | **installed for real (0.150.1)** through our own npm-into-our-own-folder path. Found that Codex ships **no native binary in its own bin** — it arrives via an optional platform package — so detection would have said "not installed" straight after installing it. Fixed, native binary preferred, and `login status` → "Not logged in" parsed correctly | sign in once to see a signed-in state | — |
| — | 16 brand logos in Connect Apps | ⏸ | Claude's traced and verified; the audit is done | trace and integrate the rest | **owner supplying the assets** |


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

### Removing the pills broke the menu, and it shipped that way ⚠️ → ✅ (1.68.0)

**This is the lesson from §"the lesson that cost a release", happening again to a different
feature, and it is worth writing down in full because the shape is identical.**

Krew and Coder each hold a `mode` / `provider` / `modelName` / `localModel` quartet. Every model
call, batch size, stall timeout, quota check and error message in those files is written against
it — around forty sites in `KrewChat.tsx` alone. **The pill row was the only thing that ever wrote
it.** Deleting the pills removed the writer and left every reader in place.

The bridge branch survived, because `streamTurn` reads `nv-ai-source` directly on every turn. So
the menu governed **exactly one** of its seven entries. Choosing *adris.tech*, *your NVIDIA key* or
*Local model* wrote the preference, relabelled the title bar — and the chat went on answering from
whatever `nv-krew-connection` last held, which on a fresh machine is `nivara`.

A user could set the menu to their own free NVIDIA key, watch the title bar say so, and spend
adris.tech credit on every message. **That is precisely the failure the single control was
introduced to prevent**, reintroduced by the change that was meant to complete it.

Why nothing caught it: the removal was correct, the menu was correct, the preference was correct,
and the chat was correct — *in isolation*. Nothing anywhere could state which mode the chat was
actually in. **Which is the rule again: a feature is not done when the module works, it is done
when the thing the user chooses produces the thing they asked for.**

The fix is deliberately small and testable:

- `lib/chatConnection.ts` — a **pure** function, `chatConnectionFor(pref, avail)`, with type-only
  imports. No Tauri, no Supabase, no localStorage, so it runs in node.
- `hooks/useAiSourceSync.ts` — applies it on mount and on every `nv-ai-source` change, in ONE place
  used by both screens so they cannot drift apart again.
- `harness/chatConnection.test.mjs` — **15 assertions**, wired into `npm run test:ui`. Every menu
  entry reaches the chat; an explicitly chosen model follows its own key and is dropped on
  fallback; each unhonourable choice falls back rather than breaking; `auto` means the same thing
  here as in `resolveAiSource`.

**What it deliberately does not touch:** the chat's own key lookup, its route-by-key-prefix safety
net (`nvapi-` can never reach OpenAI however the dropdown is set) and its dead-model repair. Those
were hard-won. The hook writes only what the pills wrote.

**The bridge maps to `own_key`, on purpose.** Every use of `mode` outside the model call itself
asks one of two questions — *does this spend the adris.tech allowance* (no, so it must not be
`nivara`) and *how much work should one request carry* (less than the hosted model, which
`own_key` already means). The call itself never reaches that code: `streamTurn`'s bridge branch
returns first.

### Two smaller bugs found in the same read

- **`getAiSource` dropped `cli` on the way out.** `setAiSource` stored it, the reader threw it
  away, and the bridge fell back to `avail.clis[0]`. Someone with both installed who deliberately
  chose Codex was put back on Claude Code at the next reload — with the menu still *showing* Codex,
  because `currentChoiceId` matches on mode when the exact match fails. A preference that cannot
  survive a restart is not a preference.
- **`AiSourcePicker` read the preference once, at mount.** Its entire remaining job is to say what
  is in force, and with Guard or Settings already open it went on naming the old source after the
  menu changed. It also had no `agent_cli` row, so the lookup fell through to `OPTIONS[0]` and told
  a user on their own Claude Code subscription that the source was "Automatic".

### The migration this needed, which is the same bug pointing the other way

An existing user who set the pills to *adris.tech* has `nv-ai-source` still at its `auto` default —
they never opened the title-bar menu, because it did not govern the chat. Wiring the menu up
without thinking about that would read `auto`, resolve it to "your own key", and **move them off
the source they chose, silently, on the first launch after an update**.

That is the same failure as the one above, in the opposite direction: a decision the user made,
overridden by the app without telling them. So `getAiSource` falls back to the old
`nv-krew-connection` value when the preference has never been written. **Their setting wins;
`auto` only ever applies to someone who never made one.**

### The second layer: what is behind each source (1.68.0)

Choosing a *source* is one decision. Which model on it is another, and it lived in a panel bolted
to the top of Krew and Coder — so from Brain, Guard or Settings the menu could offer "Local model"
and "your NVIDIA key" with **no way to see what was behind either**. `AI_SETUP_EVENT` is only heard
while the component that owns those panels is mounted, so from anywhere else the menu's setup rows
did nothing at all.

The detail now comes to the menu. Same sheet, one step deeper, a back row rather than a chevron:

- **Local model** → what is downloaded, with **sizes** — the one number that separates the quick
  small model from the capable big one without asking anyone to know what a parameter count is.
  Picking one starts the engine immediately, so the cold-load cost (half a minute for a 14B) is
  paid while reading the menu rather than while waiting for an answer. Nothing downloaded → the
  route to the Models page.
- **A key** → the models **that key can actually call**, asked of the provider, not a hardcoded
  list that rots. Ranked into plain tiers, with the measured speed from `modelHealth` where it
  exists. Non-chat models (embeddings, vision, safety) are filtered out. The choice is written to
  the credential as well as the preference, because the chat treats the credential as the single
  truth for which model is answering — a choice living only in the preference would be overwritten
  by the repair effect. Providers with no catalogue (Claude, Gemini, a user-run OmniRoute) say so
  rather than inventing a list.
- **Claude Code / Codex** → what the bridge means, and the honest data split (see the HARD RULE
  below) stated **where the choice is made**, not buried in settings. Not installed → the exact
  install command.
- **No key yet** → NVIDIA and Groq give keys away free, which is the fact that changes the usual
  "own key means paying for an account" reaction. Plus the route to OmniRoute.

**OmniRoute's installer was nearly orphaned by this and was kept deliberately.** Its one-button
install/start panel lives inside `ConnectionBar` and has no home outside Krew and Coder. The
connect screen navigates to Krew *first*, then fires `AI_SETUP_EVENT`, because the listener only
exists once that component is mounted. Deleting the event would have stranded a working feature.

### Setting the bridge up FOR the user ✅ (1.68.0)

**The bridge was the best thing in the app and the hardest thing to reach.** Anyone already paying
for Claude Code or Codex can run the whole of adris on it and be charged nothing here. The
instruction for getting there was a line of shell to copy: `npm install -g @anthropic-ai/claude-code`.

For the person this product is built for that is three impossible steps — know what a terminal is,
have Node, and know what to do when npm prints a permissions error. **A feature that requires a
terminal does not exist for this audience.**

It is three buttons now, and each appears only when it is the next thing to do:

| Step | What the user does | What actually happens |
|---|---|---|
| **Install** | one button | `provision_node` (pinned Node 20, our folder), then `npm install` into `app_data/agent-cli`. No PATH change, no Administrator, no terminal. |
| **Sign in** | one button | The CLI's own `auth login` in a **visible** console — the one place in the app a console is right, because signing in is a conversation. The panel warns first: *"a small black window, then your browser"*. |
| — | nothing | It names the account and plan, and polls until the sign-in completes rather than asking them to come back and press something. |

**Why not `npm install -g`.** A global install needs a writable npm prefix and often Administrator,
and on a locked-down work machine it fails in a way nobody here can read. Our own folder always
works, is removable from the same screen, and cannot disturb whatever Node the user's employer put
on the machine. `agent_cli_detect` looks there first — **a copy this app installed is the copy it
should use**, since it provisioned the Node it runs under.

**Only a copy adris installed can be removed from adris.** Someone who installed Claude Code
themselves must not find an adris button that deletes it, so the Remove row is hidden unless the
executable in use is inside our folder.

#### The check nothing was doing: signed in with WHAT

`claude auth status --json` returns `loggedIn`, `email`, `subscriptionType` **and `authMethod`** —
and the last one is the one that matters. Claude Code prefers `ANTHROPIC_API_KEY` over the user's
login whenever both are present. So a bridge can be installed, signed in, answering questions —
**and billing per token instead of using the subscription the whole feature exists to use.**

Nothing asked before. The panel now says so plainly when `authMethod` is not `claude.ai`.
`harness/agentCliSetup.test.mjs` covers it with the real CLI's real output (14 assertions),
including the rule that **a garbled answer must never read as "signed in"** — defaulting to success
on unrecognised output is how a user is told everything is fine and then meets a CLI error on their
first message.

**Codex is 🟡, not ✅.** Its install and login paths are written from its documented interface;
Claude Code's were verified against the real CLI (2.1.247) on this machine. Codex is not installed
here, so its `login status` output is parsed leniently rather than exactly. **Install it once and
confirm before calling it done.**

---

### Every module obeys the one control ✅ (1.68.0) — and five did not

**`krew_ai_stream` is the Rust command nearly every screen uses, and its match on `mode` ends
`_ => emit_error("Unknown mode: {mode}")`. It has never heard of `agent_cli`.**

So a screen that resolves the AI source correctly and then hands the result straight over does not
fall back or degrade — it shows the user **"Unknown mode: agent_cli"**. `callAiOnce` in
`automationRunner` had the interception, which is why Guard scans, automations and the outreach
copilot were fine. **Five screens did not have it:**

| Screen | What choosing "Your Claude Code" did |
|---|---|
| Creator screen | Unknown mode: agent_cli |
| Research screen | Unknown mode: agent_cli |
| Automation module's own runner | Unknown mode: agent_cli |
| Studio (3 separate call sites) | Unknown mode: agent_cli |
| Quick Bar | Unknown mode: agent_cli — and it had dropped `cli` from its own `resolveAuth` |

The option the whole product strategy rests on broke five screens, silently.

**Fixed with one shared helper**, `bridgeAnswer(src, messages, systemPrompt, onChunk)` in
`aiSource.ts`. It returns `null` when the bridge is not the chosen source, so "carry on as before"
is the default and the call site is two lines. One helper rather than five copies, **because five
copies is how the sixth caller gets written without one.**

**And a build check so it cannot come back:** `scripts/check-ai-source.mjs`, wired into
`npm run build`. Any file invoking `krew_ai_stream` must also contain a bridge interception. It
currently reports *7 screens, all of them handle the bridge*.

#### The full audit, for the record

Every path to a model in the app, and how it reaches the title-bar choice:

- **Krew chat, Coder chat** — `useAiSourceSync` writes the mode; `streamTurn` reads the preference
  live for the bridge.
- **Guard scans, automations, outreach copilot, reply-scanning, contract reads, document verify** —
  all funnel through `callAutomationAI` → `callAiOnce` → `resolveAiSource`, bridge included.
- **Creator, Research, Automation module, Studio ×3, Quick Bar** — `resolveAiSource` + `bridgeAnswer`.
- **Brain, krewTools, docgen, deck maker, skill graph, Office, Head, Mesh** — no direct model call.
  They either run deterministically or take an injected `aiCall`, and the only supplier of that
  injection is the Krew chat.

### The Claude logo was wrong twice

First a chevron, which was not Anthropic's logo at all. Then the wordmark "A" — a real Anthropic
asset, but the wrong one: what people recognise in a 16px row is the burst. **This document already
claimed it was the burst while the code drew the letter.**

It is now traced from the PNG the owner supplied, not drawn from memory: radial sampling of the
alpha channel, simplified, then **checked by rasterising the result back and comparing it to the
original pixel for pixel — 96.9% overlap**. If it ever needs redoing, trace the asset again rather
than adjusting it by eye. Approximating by eye is how the first two got here.

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

**The marks were audited by rendering them, not by reading the source.** Every `case` in
`BrandLogo` was extracted, rendered at 112px in a real Chrome and looked at. That is the only way
to find a path that parses fine and draws a garbled blob — which four of them do. The audit and
what it found is in the next section.

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

## THE SUBSCRIPTION, NEVER AN API KEY — the rule the bridge lives or dies by 🟡

**The owner's instruction, and it is not negotiable: both Claude Code and Codex must run on the
user's SUBSCRIPTION. Never an API key. That is the only reason a user wants this.**

If the bridge quietly bills per token, the entire proposition inverts: instead of "adris runs on
what you already pay for", it becomes "adris found a new way to charge you". A user who believes
the first and gets the second will not come back, and would be right not to.

### Why this is the whole commercial argument in India

**Codex is about ₹400/month here. Claude is about ₹2,000/month.** Those are the numbers that make
the bridge the product's strongest pitch in its primary market, not a power-user extra:

- A small business owner on **₹400/month** gets a full working month of agent time. Nothing adris
  could resell in tokens comes close, and nothing a competitor charges per seat does either.
- It means the honest sentence on the pricing page is: **"buy the licence, plug in the ₹400
  subscription you may already have, and our AI costs you nothing."** That is a far easier thing to
  sell in this market than a metered balance a buyer has to estimate.
- It also reframes pay-per-use (see the licence section) as **the convenience option for people who
  do not want to think about it**, rather than the default everyone is pushed onto.

**And it raises the stakes on everything below.** Someone paying ₹400 a month is exactly the person
for whom an accidental API bill is not an annoyance but a serious problem. The verification work in
this section is not defensive engineering — it is the difference between the pitch being true and
the product being a liability to the customer.

### What is already correct

- **`STRIPPED_ENV` clears `ANTHROPIC_API_KEY` on every spawn.** Measured: with it set, the call
  returned HTTP 401 after three minutes; cleared, the same call succeeded in 6.3 s. Claude Code
  *prefers* an API key over the user's login whenever both are present, so this is the difference
  between the subscription and a surprise bill.
- **We spawn the official CLI and never touch its token.** This matters more than it looks — see
  the ToS note below.
- **The sign-in panel already warns** when `authMethod` is not `claude.ai`.

### What must change — the actual coding work

**1. Ask for the subscription EXPLICITLY, on both.**

Verified on the real CLI (2.1.247) on this machine:

```
claude auth login --claudeai   Use Claude subscription (default)
claude auth login --console    Use Anthropic Console (API usage billing) instead
```

The flag we want is the default — but *"the default"* is a thing that changes between versions, and
this is the one setting we cannot afford to be wrong about. **Pass `--claudeai` explicitly.** Never
pass `--console`, and treat a user who is on it as a problem to surface, not a state to accept.

For Codex the equivalent split is `codex login` (ChatGPT sign-in, bills to the plan) versus
`codex login --api-key` (metered). **Only ever the former.**

**2. Verify from the credential file, not from the CLI's word alone.**

Confirmed on this machine — `~/.claude/.credentials.json` holds:

```
claudeAiOauth:
  accessToken, refreshToken, expiresAt, refreshTokenExpiresAt
  scopes[]
  subscriptionType = "pro"
  rateLimitTier
```

The key is literally named `claudeAiOauth` and carries `subscriptionType`. That is a **stronger**
signal than parsing `auth status`, and it is a second, independent check on the thing that matters
most. Codex's equivalent is `~/.codex/auth.json`. **Read, never write, never copy.**

**3. THE ONE THAT COULD COST A USER REAL MONEY.**

[anthropics/claude-code#43333](https://github.com/anthropics/claude-code/issues/43333) —
***"`claude -p` with OAuth (no API key) bills as API usage, not Max subscription"***.

Reported: print mode ignored the OAuth subscription credentials in `~/.claude/.credentials.json`
and routed through API billing anyway. Usage appeared on the platform dashboard rather than the
Claude.ai one. **One user reported $1,800+ in unexpected charges over two days.** Reproduction was
`env -u ANTHROPIC_API_KEY claude -p --output-format json "say hi"` — which is, almost exactly, what
our bridge does. The issue is **closed**, so presumably fixed, but:

> **Our bridge runs `-p` print mode. Everything above about stripping the environment is necessary
> and NOT sufficient. Being signed in to a subscription does not prove the usage lands on it.**

So the requirement is: **verify where the usage actually appears — on the Claude.ai account, not the
API dashboard — before this ships, and re-check on every CLI upgrade.** This is the roadmap's own
"✅ means seen working" rule applied to the single most expensive thing in the product. A test
asserting "we passed the right flag" proves nothing here.

**4. Refuse rather than fall back silently.**

If subscription auth cannot be *proved*, the bridge must say so and stop — not quietly run on
something metered. The existing rule ("a bridge that is chosen but broken must SAY so") extends:
**a bridge that cannot prove it is on the subscription is a broken bridge.**

**5. Warn on expiry before it becomes a mystery.** The OAuth token has `expiresAt` and
`refreshTokenExpiresAt`. A refresh token that has run out means the next task fails with a CLI error
nobody here can read. Check it, and say "sign in again" while it is still a sentence rather than a
support call.

### The hard architectural rule this produces

**adris never extracts, stores, forwards or reuses the user's OAuth token. It runs the official
client and lets that client use its own credentials.**

This is not squeamishness. Anthropic's terms state that Pro/Max subscription tokens are for use with
official Anthropic clients, and several community projects work by lifting the token out of
`~/.claude/.credentials.json` and calling the API with it directly. **That design is off-limits
here** — it puts the user's account at risk to save us a subprocess, and adris cannot be the reason
someone's subscription gets terminated. Spawning the real CLI is both the safer engineering choice
and the compliant one. **Reading `subscriptionType` to verify is fine; taking `accessToken` is not.**

### Prior art to read before writing any of it

Not to copy — to learn which parts are hard and where the sharp edges are. **Every link, with what
to take from each, is in §"Reference library" below**, kept in one place so it does not drift out of
step with itself.

**Start with [anthropics/claude-code#43333](https://github.com/anthropics/claude-code/issues/43333)**
— the `-p` billing bug, the exact repro, and the $1,800 story. Nothing else in the list changes the
design as much as that one does.

**`claude setup-token`** also exists on the real CLI — *"Set up a long-lived authentication token
(requires Claude subscription)"*. Worth evaluating as the unattended path, **but only after #43333's
billing question is settled**, because a long-lived token that bills the wrong way is the same bug
with a longer fuse.

### What shipped in 1.69.0

| Piece | Where | Note |
|---|---|---|
| `--claudeai` passed explicitly | `agent_cli_login` | The flag IS the default today. Passed anyway, because "the default" changes between versions and this is the one setting the product cannot be wrong about. `--console` never appears |
| `agent_cli_credentials` | Rust | Reads the file the CLI itself wrote. Returns a **fixed set of non-secret fields** and **cannot** return `accessToken` — not "does not", cannot, so no future caller or log line can leak it through |
| `mergeAuth` + `subscriptionVerdict` | `agentCli.ts`, pure | Two signals, one answer. Asking the CLI is asking a program to describe itself; its credential file is evidence |
| The refusal | `runAgentCli` / `streamAgentCli` | **Every** bridged call in the app reaches a CLI through one of these two, so a guard here is a guard everywhere. Cached 10 min — checking per message would add a subprocess spawn per turn — and cleared on install and sign-in, the only two events that change the answer |
| Expiry warning | the panel | Counted from the **refresh** token. The access token expires every few hours and renews silently; warning on it would cry wolf daily and train the user to ignore the one warning that matters |

**The deliberate asymmetry, written down so it is not "fixed" later:** the run path refuses a
**detected** API key and lets **unknown** through. Refusing what cannot be parsed would turn one CLI
field rename into a dead feature for every user — a worse failure than the one being prevented. The
setup panel is the strict half: it never says "Ready" without positive evidence, and says plainly
when it could not confirm.

**Verified end to end on a real machine**, not against fixtures: the real `claude auth status
--json` and the real `~/.claude/.credentials.json` were driven through the shipped parsing —
CLI and file agreed, `source: both`, verdict `subscription`, 16 days to expiry, and a check
confirmed no token appeared anywhere in the merged output.

### Showing what the subscription has been used (S2, 1.69.0)

**The question the app could not answer.** Someone routing adris through a ₹400 Codex or ₹2,000
Claude plan is spending a budget they can feel, so "how much have I used?" is a real question — and
until now answering it meant leaving the app for a website.

**Where the numbers come from.** Claude Code writes a JSONL transcript per session under
`~/.claude/projects/**`, and every assistant turn carries a `message.usage` block with four token
counts, the model and a timestamp. So this is **not an API call**: no network, works offline, and it
is the user's own machine reporting on itself.

**Three findings from running it on real data, all of which changed the code:**

| Finding | Consequence |
|---|---|
| **1,992 of 4,371 usage lines in a 7-day window were duplicates** — the same turn is written into more than one transcript when a session is resumed | Counting lines rather than `requestId` would have shown the user **roughly double** their real usage. Deduped by request id |
| 30 files, **127 MB** | Parsing all of it per panel-open is unusable. Files whose mtime predates the window are never opened, and the rest are streamed a line at a time. **485 ms** for 7 days |
| `<synthetic>` appeared as a model with 2,000 output tokens | Claude Code's own placeholder for a turn no model produced. It would have been listed to the user as a model they had chosen. Filtered |

**What it deliberately does not read.** Those transcripts are the user's actual conversations. The
command copies out exactly six things per line — timestamp, model, four token counts — plus an id
used only for deduplication. `message.content` is never touched. The result is **aggregated to
hourly buckets before it leaves Rust**, so there is no per-message record to leak even by accident.
That is the HARD RULE applied to *reading*, not only to sending.

**What it will not claim.** Claude Code records what each turn COST; nothing on the machine records
what the plan's CEILING is. So the panel reports **use** and never a percentage of a limit it cannot
see — "83% of your weekly quota" would be a number the user trusts and that is wrong, which is the
one outcome this feature must avoid. The panel says so in plain words.

**The chart is scaled to output tokens on purpose.** Cache reads dwarf everything else by two orders
of magnitude — 944M against 2.1M in the real data — so a chart scaled to them is one spike and six
flat lines. Output is what the model actually produced for the user.

### Definition of done

- [ ] Claude signs in with `--claudeai` explicitly; `--console` is never passed
- [ ] Codex signs in with `codex login`; `--api-key` is never passed
- [ ] `subscriptionType` read from the credential file as an independent second check
- [ ] The panel refuses, with a plain sentence, when subscription auth cannot be proved
- [ ] Token expiry warned about before it fails
- [ ] **Usage seen landing on the Claude.ai / ChatGPT account and NOT the API dashboard** — for
      both, on a real machine, on the current CLI version
- [ ] No code path anywhere reads `accessToken` out of the credential file

**The last two are the ones that make this real. Everything above them is preparation.**

---

## The prompt for Claude Code — subscription-only bridge auth

**Give this verbatim.**

> I have a Windows desktop app (Tauri + React + Rust) that bridges to the user's own **Claude Code**
> and **OpenAI Codex** CLIs, so the app's AI work runs on the coding subscription the user already
> pays for. I spawn the official CLI as a subprocess and read its stdout.
>
> **The hard requirement: it must run on the user's SUBSCRIPTION and never on a metered API key.**
> If it silently bills per token, the entire feature is worse than not existing. Design the auth
> layer for that guarantee.
>
> **What I already do:**
> - Strip `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`,
>   `OPENAI_BASE_URL`, `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT` from every
>   spawn (measured: with the API key present the CLI prefers it over the user's login).
> - Spawn the real `claude.exe` directly rather than the npm `.cmd` shim, with the prompt as a single
>   argument, because CreateProcess ignores PATHEXT and cmd.exe imposes an 8191-char command line.
> - Run `claude auth status --json` and read `loggedIn` / `authMethod` / `subscriptionType`.
> - Call `claude -p` (print mode) with `--output-format stream-json` for streaming.
>
> **What I need you to design:**
>
> 1. **Sign-in that can only ever produce subscription auth.** `claude auth login --claudeai` is
>    documented as the subscription path and `--console` as the API-billing path; Codex has
>    `codex login` versus `codex login --api-key`. Make the wrong one unreachable, and handle a user
>    who is *already* signed in the wrong way.
> 2. **Independent verification, not just the CLI's word.** `~/.claude/.credentials.json` contains a
>    `claudeAiOauth` object with `subscriptionType`, `expiresAt` and `refreshTokenExpiresAt`;
>    Codex uses `~/.codex/auth.json`. Read these to confirm. **Read only — never copy, forward or
>    reuse `accessToken`**, because Anthropic's terms restrict subscription tokens to official
>    clients and I spawn their client precisely so I never hold the token.
> 3. **Address anthropics/claude-code#43333** — `claude -p` with OAuth and no API key was reported
>    billing as API usage rather than against the Max subscription, with one user reporting $1,800+
>    in surprise charges. It is closed, but my bridge uses exactly that call shape. Tell me **how to
>    verify at runtime which billing path a request actually took**, and what to do if it cannot be
>    determined.
> 4. **Fail loudly.** If subscription auth cannot be proved, refuse and explain — never fall back to
>    something metered. My users are non-technical business owners; the message must be a plain
>    sentence and an action, not a CLI error.
> 5. **Expiry.** Warn before the refresh token runs out, while it is still a sentence rather than a
>    failed overnight task.
>
> **Deliverables:** the Rust `#[tauri::command]` functions and the TypeScript wrapper, plus a
> `harness/*.test.mjs` unit suite over the pure parsing (Node, no browser). Please state plainly
> which parts you verified against a real CLI and which are written from documentation — I have
> Claude Code 2.1.247 installed and Codex not installed, and I would rather have "unverified" marked
> than assumed.

---

## "It doesn't feel like I have a team" 📋 PLANNED, NOT BUILT

**The owner's words, and they are the whole brief:** *"the agents do work but it still doesn't give
me the feel I got a team working for me."*

This is not a cosmetics request. adris's entire claim is **you have a team**, and the screen
currently says *you have a text box*. A business owner paying for software that claims to run a
department should be able to look at it and believe that. Right now the chat is a blank field, a
two-letter grey circle, and silence while work happens.

**Judgement to hold on to throughout: premium, not playful.** This is used in front of clients, in
an office, by people whose work is serious. Anything that reads as a game, a toy, or a chatbot
mascot makes the product *less* credible, not more. The reference is a trading terminal or a good
CRM, not Clippy.

### F1 — The empty state ✅ DONE (1.69.0)

**Shipped: 152 tips.** `src/lib/krewTips.ts` holds them, `components/krew/TipBar.tsx` shows them,
`scripts/check-tips.mjs` keeps them honest, and `harness/krewTips.test.mjs` covers the rules
(30 assertions).

**The rule that mattered most, and the one the old line broke:** never advertise what the user
already has. Someone with nine apps connected is never told to connect apps — that was the entire
problem with *"No apps connected. Link Gmail, GitHub, Notion & more"*, shown identically on the
hundredth launch as on the first. Tips carry a `when` condition and the test asserts a fully
set-up user sees none of the set-up tips and still has 100+ left to read.

**The build check is the part that will still be earning its place in a year.** Every `cmd` a tip
names must exist in `SLASH_COMMANDS` and every `nav` must be a real module — read from the source
of truth, not duplicated. It also enforces unique ids (a duplicate silently suppresses a different
tip forever), a floor on the count, and a length range. This is the file most likely to rot, and a
tip promising a command renamed six months ago is the app lying to the user in its calmest voice —
exactly what happened when the Info page documented `/findleads` and `/repair-table` while
neither existed.

**Written to the original brief:** hardcoded so it is instant, offline and checkable; one thing per
tip and what it gets you; readable in three seconds; clickable where there is something to click.

---

<details><summary>The original plan, kept for the reasoning</summary>

### F1 — The empty state: ~150 tips instead of one nag

Today the blank chat shows **"No apps connected. Link Gmail, GitHub, Notion & more"** — one line,
the same every time, and it is a *nag* rather than an *invitation*. Replace it with a rotating tip
drawn from a hardcoded set of **150-200**, each teaching one specific, true thing the user can act
on now.

- **Hardcoded, not generated.** No model call, works offline, instant, and every line can be checked
  for truth before it ships. A tip that describes a feature which does not exist is worse than no tip.
- **Each tip names ONE thing and what it gets you.** Not "adris is powerful" - *"Type `/scan` on a
  LinkedIn page and adris reads your connections into a list you can write to."*
- **Coverage, so it teaches the whole product:** Connect Apps integrations, the Claude Code / Codex
  bridge, own-key and the free NVIDIA/Groq keys, local models and offline working, slash commands,
  the Brain, automations, Office (Word/Excel/PowerPoint), outreach, Guard, the agent roster, Coder,
  the Quick Bar, Studio, Vault, keyboard shortcuts.
- **Rules:** never repeat within a session; never show a tip for something already set up (do not
  advertise Connect Apps to someone with nine apps connected); one line, readable in three seconds;
  where a tip has an action, it is clickable and does the thing.
- **A build check**, in the shape of `check-boss-tools.mjs`: every feature, command and module named
  in a tip must actually exist. **This is the file most likely to rot**, and a tip promising a
  command that was renamed is the app lying to the user in its calmest voice.

</details>

### F2 — Give the agents a face ⏸ WAITING ON THE DESIGN

Today: `AR` in a coloured circle. **56 agents**, 11 departments.

**The constraint that decides the whole design: there are 56 of them.** Fifty-six bespoke
illustrations cannot be drawn, kept consistent, restyled, or shipped at a sane file size. So the
answer must be a **system** - a small set of parameterised parts that compose into 56 distinct,
recognisable characters - not an illustration set.

Requirements any design has to meet:

- **Inline SVG only.** No external files, no CDN, no image requests. The app runs offline and the
  webview has no network guarantee.
- **Legible at 24px.** That is the size in a chat bubble, which is where it is seen most. A face
  with fine detail becomes grey mush; test at 24 before anything else.
- **Both themes.** Light and dark, using the existing `nv-*` tokens. Never a hardcoded background.
- **Carries the department colour.** `deptColor()` already gives every agent one; the avatar must
  use it rather than fight it, so a Sales agent still reads as Sales at a glance.
- **A total budget of about 40 KB** for the whole set. Achievable with shared parts and per-agent
  parameters, impossible with 56 drawings.
- **Neutral and professional.** These represent an assistant doing your accounts, not a character.
  Nothing that implies a specific real person.

**The prompt to give Claude Design is written out in full below**, so it is not lost and can be
re-run when the set needs extending.

### F3 — The room is alive while work happens 🟡 MOSTLY DONE (1.69.0)

**F3.1 was already shipped and the roadmap was wrong about it.** The waiting box has been reading
the live activity bus for releases — the real headline, the real detail, and a clock that repaints
when the window comes back rather than freezing. Written up here as ❌ because nobody had checked.
*Reading the code before planning against it is the cheap half of this job.*

**F3.3 was a bug, not a missing feature — and it was the important one.**

`agentActivity.ts` held `let current: AgentActivity | null`. **One slot.** Independent agents
genuinely do run at the same time — the delegation code has done it for releases and carries 55
assertions — and every one of them calls `setActivity`. With one slot they overwrote each other,
so the screen showed whichever wrote most recently, **flickering between three names in the same
box**.

So the single strongest thing this product does, and the direct answer to *"it doesn't feel like I
have a team"*, was never missing. It was being drawn one agent at a time, over and over, in one box.

The bus is now a map keyed by agent. `getActivity()` still returns the newest, so **every existing
caller is unchanged**; `getActivities()` returns the whole crew, and the waiting box lists everyone
working with their department colour and what they are doing.

**The trap this opened, and closed.** `setActivity(null)` means "the run is over" and clears
everything — correct when the turn ends, and wrong for a single agent finishing early. The browser
human-check flow did exactly that, which was harmless with one slot and would have wiped every other
agent's line the moment two things ran at once. It now retires only its own key via
`endActivity()`. **20 assertions**, including that ending the newest promotes somebody still
working rather than blanking the box, and that a late write after Stop is still refused.

---

<details><summary>The original plan, kept for the reasoning</summary>

### F3 — The room is alive while work happens

The gap the owner actually felt. Between "send" and the first word of the answer there is **nothing**
- and that is exactly the moment the product should feel like a team picking up the work.

What it must NOT be: a spinner, a bouncing-dots chatbot cliche, or decoration that says nothing.

What it should be, in order of value:

1. **The agent shows it is working, and at what.** `lib/agentActivity.ts` already carries real
   progress - the sheet being read, the query being run, a live clock. **The feeling of a team comes
   from specificity.** "Reading leads-august.xlsx, 240 rows" is worth more than any animation.
2. **The avatar has a working state.** A small, slow, looping motion on the agent that is active -
   enough to read as "this one is busy", never enough to pull the eye off the text.
3. **When several agents run at once, you can SEE that.** This is the single strongest "I have a
   team" moment the product owns, and it is currently invisible. Parallel delegation already works
   (55 assertions); nothing on screen conveys it.
4. **Handover is visible.** When the boss passes work to a specialist, that moment should be legible.

**Hard rules:**
- `prefers-reduced-motion` is honoured completely - every animation off, nothing breaks.
- **Nothing animates when nothing is happening.** A screen that moves while idle is a screensaver.
- Never animate the text as it streams. Reading is the job.
- CPU cost near zero. This runs beside a local 14B model on a business laptop; a canvas loop that
  fights it for a core is a bug, not a feature.

</details>

### F4 — Hermes as a downloadable worker ❌ NOT STARTED

**Request:** offer Hermes for download, and use it for spawned sub-agents when it is there.

Hermes is tuned for **tool-calling and structured output**, which is exactly what a spawned
sub-agent does - and it is the weakness of most small local models (see the measured note on
`llama-3.3-70b` timing out where the lightning model answered in 0.5s). A local model that can be
trusted to return clean JSON is worth more here than a bigger one that cannot.

- Add it to the Models catalogue with a **real, measured** size and a truthful description.
- **Do not claim it works until it has been run.** The standing lesson: model catalogues lie, so
  models are **PROBED, not trusted**.
- Wire it as the preferred local model for sub-agent spawning **when installed**, never as a
  requirement.

### F5 — Several agents at once 🟡 BUILT, NEVER WATCHED

`plan_workflow` and parallel delegation carry **55 assertions** at the logic level. What has never
been done is the thing the roadmap's own rule demands: **the user types one request that needs three
agents, and watches three agents do it.** Until that has been seen, this is a 🟡 whatever the test
count says.

It feeds straight into F3.3 - this is the feature that best delivers "I have a team", and the reason
it does not land today is that it is invisible rather than absent.

### Order to build it in

**F1 → F3.1 → F2 → F3.2/3.3 → F5 → F4.**

F1 is self-contained, needs no design input, and fixes the blank screen immediately. F3.1 is mostly
wiring existing real progress into the quiet moment. F2 waits on the design coming back. F5 is a
test pass, not a build. F4 is independent and can slot in anywhere.

---

## The Shelf — free software instead of a subscription 📋 T1

**The idea, in the owner's words:** *"a non-tech person won't know how to install from GitHub, but
our agents will."*

**The commercial argument, which is the real one.** A small business pays for a CRM, a helpdesk, an
invoicing tool, a booking system — often ₹2,000–₹10,000 a month, each. Genuinely good, genuinely
free versions of all of them exist and are actively maintained. They are unreachable because their
README opens with *"clone the repo and run docker compose up"*, and for the person this product is
for that is a wall. **It is the reason they end up paying for worse software.**

adris already has the two things needed to cross that wall: agents that know how, and a window to
put the result in.

### This is ADRIS-OS §12e, carried to Windows

The design is not new — `ADRIS-OS/plan.md` §12e worked it out for Linux, and its rules are the good
part. They carry over unchanged:

| Rule from §12e | Why it still holds on Windows |
|---|---|
| **Never build from source. Never run an install script.** | *"`curl \| sh` and unattended `make` are how a one-click installer becomes a way to own the machine."* Nothing has changed about that |
| **Only install what the project itself published** | The same trust model as any app store |
| **Catalogue-gated, not arbitrary URLs** | Until there is a sandbox, an agent must not be able to install "whatever the model said" |
| **When nothing is installable, say so** | Silence gets read as success |
| **Match this machine positively** | The real bug §12e caught: it picked an `arm-64` build on x86-64 because the pattern `/arm64/` did not match `arm-64`. An asset must *look like this machine*, not merely fail to look like another |

**What changes is the runtime, because Windows has no apt.** The Linux ladder was apt → .deb →
AppImage. The Windows ladder is:

| Route | Verdict |
|---|---|
| **An official Docker image the project publishes** | **The one to build on.** It is the sandbox *and* the runtime: dependencies live inside it, nothing is installed on the user's Windows, removal is one command, and the app arrives with a web UI on a port — which is exactly the thing adris can put in a window |
| A prebuilt Windows `.exe` / `.msi` on Releases | Possible, and deliberately **not first**. Installing an unsigned binary from the internet on a business owner's machine is the highest-risk thing in this whole document, and it modifies their real Windows |
| Anything needing a build | **Refused**, per §12e |

**Docker is what makes "give it a proper UI on our screen" almost free.** These apps are web apps.
A container publishes a port; adris shows that port in a panel. The user gets the tool's own real
interface without ever seeing a terminal, a compose file, or a port number.

### The right rail

A **narrow, always-visible rail on the right edge** — icons only, never expanding. Hovering shows
the name in a tooltip; clicking opens that tool. It deliberately does not expand: a rail that pushes
the work sideways every time the mouse crosses it is a rail people learn to avoid.

It holds the tools that are installed, plus one control that opens the catalogue. Hermes (F4) and
anything else added later live here too — **it is the shelf for everything that is not a core
module**, which is why it is worth building before the things that will sit on it.

### What ships in the catalogue

Curated, and small on purpose. Every entry names **the paid thing it replaces**, because that is the
sentence that means something to the buyer:

| Tool | Replaces | Licence |
|---|---|---|
| **Vikunja** | Asana, Trello | AGPL-3.0 |
| **Focalboard** | Notion boards, Trello | MIT |
| **Invoice Ninja** | FreshBooks, Zoho Invoice | Elastic 2.0 |
| **Cal.com** | Calendly | AGPL-3.0 |
| **Chatwoot** | Intercom, Zendesk | MIT |
| **Baserow** | Airtable | MIT |
| **Metabase** | Tableau, Power BI | AGPL-3.0 |
| **Documenso** | DocuSign | AGPL-3.0 |

**Licences are shown, not hidden.** Several of these are AGPL, which is fine for a business running
its own copy and is not fine to bundle into a product we sell. adris **runs** them on the user's
machine as their own installation — it does not redistribute them — and the catalogue says so.

### Honesty rules, from the same place §12e got them

- **"Starting up…" until the port genuinely answers.** A container that has been created is not a
  working app. Opening a window at a port nothing is listening on is the exact failure §12a records.
- **Docker missing and Docker not running are different sentences**, because the user can act on
  one and not the other. One says "install Docker Desktop", the other says "start it".
- **Nothing is installed without the user pressing the button.** An agent may *suggest* a tool and
  may open the catalogue at it. It may not install one. That line is not about capability; it is
  about who is responsible for what ends up on the machine.
- **No host folders are mounted** into a container by default. The tool gets its own storage and
  nothing else.

### Staged, because the whole thing is not one release

| # | Stage | State |
|---|---|---|
| **T1** | The rail, the catalogue, Docker detect / install / run / stop, the embedded panel | this release |
| **T2** | Agents can *recommend* from the catalogue and open it at a tool | next |
| **T3** | The tool's data reachable by agents — the Tally lesson from §12b: **reading a business's data is worth more than running its software** | after T2 |
| **T4** | Anything outside the catalogue | **needs a sandbox story first.** §12e's judgement, unchanged |

---

### What shipped in 1.69.0

| Piece | Note |
|---|---|
| **The rail** | 44px, right edge, on **every** screen — outside `<main>`, because a shelf you can only see while standing in front of it is a cupboard. **It never expands.** The name arrives as a tooltip that opens *leftward* (a tooltip growing rightward from the right edge is half off-screen, exactly for the longest names that needed it). A green dot for running, amber for starting, and a 280ms delay so sweeping past does not fire four tooltips |
| **The catalogue** | 8 tools, each leading with **what it replaces** — "Instead of Asana or Trello" — because that is the sentence that means something to a buyer. Licence and repo on every card: several are AGPL, which is fine to *run* and not fine to bundle, and hiding that would be the problem |
| **`isAllowedImage`** | §12e rule 3, made unreachable rather than merely followed. Nothing outside the catalogue is ever pulled — checked in the catalogue *and* again at the moment of the act. A model can produce a string that looks exactly like an image name; it cannot cause a pull |
| **Docker** | detect / install / run / stop / remove. Containers are named `adris-tool-*` — built in Rust from the id, never accepted from the caller — so nothing outside that namespace can be created or destroyed through these commands. **No host folders are mounted**; each tool gets a named volume and nothing else |
| **The readiness poll** | §12a's exact failure prevented: a container that has been *created* is not a working app. `ready` is only ever set because something answered on the port. Three minutes before it is called a failure, because Invoice Ninja really does build a database on first run |
| **The confirm dialog** | Software from the internet arriving on a business owner's computer. It says what will happen, who published it, and under what licence — **before**. It is also the line that keeps agents out: the button exists, and only a person can press it |

**Verified against this machine's real state.** Docker CLI 29.2.1 is installed and the **daemon is
not running** — which turned out to be the most valuable case to have. The advice logic was driven
against the real `docker --version` and `docker info` and produced *"Docker is not running · start
Docker Desktop · nothing needs downloading"*, with **no instruction to install something already
installed**. A test asserts the headline never contains "install", which caught the first wording.

**What is NOT proven: a real pull and run.** No image has been fetched, because the daemon is down.
Everything up to that point is verified; the pull, the port publish and the embedded panel are
written and unrun. **They stay 🟡 until an image has actually come down and answered** — that is the
same standard applied to Codex, and it is the standard this roadmap exists to enforce.

**T2–T4 unchanged:** agents may recommend but not install (T2), reading a tool's data matters more
than running it (T3, and §12b's Tally lesson), and anything outside the catalogue needs a sandbox
story first (T4).

### "A non-technical person will not have Docker" — the honest answer 📋 T1b

**The owner is right, and it is the biggest hole in the Shelf as built.** The whole point of this
feature is that a business owner should not have to be technical, and the current first screen says
*"Docker Desktop is needed for this"* — which for that person is the same wall as
*"clone the repo and run docker compose up"*, wearing a different coat.

**What Docker Desktop actually asks of them,** stated plainly rather than waved past:

| What | Why it is a wall |
|---|---|
| A ~600 MB download and an installer | Fine on office broadband, painful on a phone hotspot |
| **WSL2**, and usually **a restart** | The restart is the killer. Someone trying software for the first time does not reboot their working machine for it |
| **Administrator rights** | On a managed office laptop they may simply not have them, and no amount of good UI fixes that |
| **A paid licence** above ~250 staff or ~$10M revenue | Docker Desktop is not free for larger businesses. Recommending it to one without saying so would be handing them a licence problem |

**So Docker cannot be the price of entry. It has to be the price of the heavy tools only.**

### T1b-5 — the research is done, and the answer is NO ❌→✅ (decided)

**The roadmap said to start here, and said why: "the tier is only worth building if Tier 1 has
anything good, and a page of two mediocre tools is worse than sending everyone to Docker."** That
was the right instruction. Having done it, **the tier is not there**, and this section exists so it
is not re-imagined in three months.

#### What was actually checked

The npm registry was queried for **24 candidate business tools** — does the package exist, does it
carry a `bin` that can be started, how big is it, and is anybody using it. Not remembered: asked.

| Result | Count | What they turned out to be |
|---|---|---|
| Genuinely a runnable business app | **2** | **n8n**, **Directus** |
| A scaffolder wearing a bin | 6 | `formbricks` → bin is `init`; `@medusajs/medusa-cli`, `twenty`, `budibase` (11 downloads a week), `ghost-cli`, `@strapi/strapi` — these *create a project*, they do not run an app |
| A framework, not a product | 4 | `payload`, `@keystone-6/core`, `keystone`, `medusa` — you build with them |
| A developer tool, not a business one | 2 | `verdaccio`, `json-server` |
| Library only, no bin — cannot be started | 6 | `nocodb`, `ghost`, `outline`, `typebot`, `appsmith`, `medusa` |
| Not on npm at all | 4 | `@requarks/wiki`, `docmost`, `teable`, `@calcom/cal.com` |

**Two.** And a tier of two is not a tier.

#### And then the better of the two was installed, which settled it

`npm install n8n` into a clean folder, no Docker:

- **1,149 packages.**
- **Killed at 14 minutes, still not finished.** `node bin/n8n --version` answered `2.36.8`, so it had
  got far enough to load — but `n8n start` produced no output and never bound its port.
- The **same tool via Docker pulled and answered in about two minutes**, and is running on this
  machine right now.

The install was interrupted, so "npm cannot run n8n" is not proven and is not claimed. What *is*
proven is enough: **a one-click install that has not finished after fourteen minutes is not a
one-click install**, and that is the whole premise of the tier.

#### The decision

**Do not build the Node tier.** It would be two tools, one of which takes a quarter of an hour to
arrive, presented as the easy path. That is a worse experience than the honest Docker one, and it
would cost weeks.

**What to do instead, with the effort that would have gone into it:**

1. **Make the Docker step as good as it can be.** It is a one-time ten minutes for a runtime that
   then installs everything in about two minutes each. Guide it properly: what it is, what it costs,
   the restart, the licence threshold — already done in 1.69.0 — and then a walkthrough.
2. **T1c — compose support** is worth far more than a Node tier. Every ERP and CRM a business
   actually wants needs a database, so **the single `docker run` is the real ceiling**, not Docker
   itself. That is the work that turns eight listed ERP entries into eight installable ones.
3. **Revisit only if** a genuinely good standalone Node business app appears, or if Directus turns
   out to install quickly. Directus was the other candidate and has not been timed.

**The honest framing for the user stays the same either way:** Docker is a ten-minute one-off, and
adris says so plainly rather than pretending there is no cost.


#### Two tiers, and the first one needs nothing

| Tier | Runtime | Needs | Examples |
|---|---|---|---|
| **1 — Node tools** | **The Node runtime adris already provisions** | **Nothing. No Docker, no admin, no restart.** | Focalboard-style boards, invoicing, small CRMs, anything published to npm |
| **2 — Docker tools** | Docker Desktop | The wall above | Chatwoot, Metabase, Invoice Ninja — real databases and background workers |

**Tier 1 is the important realisation and it costs almost nothing to build**, because the machinery
already exists and is already proven: `provision_node` downloads a pinned Node 20 into adris's own
folder, and `agent_cli_install` already uses it to `npm install` into an app-data directory with no
terminal, no PATH change and no Administrator. **That is exactly the same shape a Node business tool
needs.** The Claude Code installer and a Tier-1 Shelf install are the same mechanism pointed at a
different package.

So the Shelf's default answer becomes: *here are the tools that work right now on your computer*,
and Docker is a **second page** for the heavier ones — offered, explained, never in the way.

#### What the Docker page should say when it is reached

Not "Docker Desktop is needed". Something closer to:

> These bigger tools need Docker — a free program that keeps them separate from the rest of your
> computer. It takes about ten minutes and one restart, and adris can walk you through it. **The
> tools above need none of this.**

And it must say the licence thing out loud: **free for personal use and small businesses; a paid
licence above roughly 250 staff or $10M revenue.** A business owner finding that out from Docker
rather than from us is a trust problem we created.

#### Should adris install Docker Desktop itself?

**Probably not, and this is a judgement worth recording rather than re-deciding later.** It is
technically possible — the installer is signed, and `winget install Docker.DockerDesktop` exists.
But it needs Administrator and a restart, and an app that silently takes admin rights and reboots a
business owner's machine has crossed a line that is very hard to walk back. **Offer the download,
explain the steps, let them press the buttons.** Revisit only if real users get stuck at it.

#### Where this leaves the current build

The Shelf works, and its Docker path is proven end to end with n8n. What it is missing is the tier
that needs no Docker at all — which is the one most of its users will actually be on.

| # | Item | State |
|---|---|---|
| T1b-1 | A `runtime: 'node' \| 'docker'` field on a catalogue entry | ❌ |
| T1b-2 | Node install/run/stop, reusing `provision_node` and the `agent_cli_install` shape | ❌ |
| T1b-3 | The catalogue leading with what runs **now**, Docker tools behind a second page | ❌ |
| T1b-4 | Honest Docker copy, including the licence threshold | ❌ |
| T1b-5 | Vetting which good business tools genuinely ship a runnable npm package | ❌ — **do this first**, because it decides whether Tier 1 has anything worth showing |

**T1b-5 is the one to start with, and it is research rather than code.** The tier is only worth
building if there are genuinely good Tier-1 tools; a page of two mediocre ones would be worse than
sending everyone to Docker. That has not been checked, and it should not be assumed.

---

### Installing Codex found two more things reading could not

**Installed for real: `@openai/codex` 0.150.1**, through the same npm-into-our-own-folder path the
installer uses.

| Found | Why it mattered |
|---|---|
| **Codex ships no `codex.exe` in its own bin.** Its package contains a single `codex.js`, and the real native binary arrives through an **optional platform dependency** at `@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe` | `agent_cli_detect` looked only under the package's own bin, so a correctly installed Codex was **invisible** — the menu would have said "not installed" immediately after installing it, with nothing to say why. The native binary is now preferred, with `codex.js` as a last resort, because a `.js` cannot be spawned directly on Windows |
| **The metered flag is `--with-api-key`, not `--api-key`** | Written from documentation and wrong. The code never passed it either way, so behaviour was correct — but the comment naming the thing we must never do named the wrong thing |

**Verified end to end:** the native binary runs (`codex-cli 0.150.1`), `codex login status`
returns *"Not logged in"*, and `parseAuthStatus` reads that as `signed_out` — so the panel offers
sign-in rather than claiming Ready. The only step left is signing in, which needs the owner's
ChatGPT account.

### Disconnecting — two different things, kept apart

The owner asked for a way to disconnect Claude Code or Codex. There are **two things a person can
mean by that, and they are not close:**

1. **Stop adris using it.** A preference. Reversible in a click, changes nothing outside adris — and
   it is what almost everybody means.
2. **Sign out of the CLI.** Removes the credential the CLI keeps for the **whole computer**, so
   their terminal Claude Code stops working too.

Doing (2) when they meant (1) breaks a tool they use elsewhere, and connecting adris is no reason to
expect that. So (1) is the plain button, and (2) is a quieter one behind a confirm that says what it
affects — *"this signs you out on this whole computer, not just in adris"* — and points back at (1).

`claude auth logout` and `codex logout` both exist and were confirmed on the real CLIs.

### Usage: the percentage question, answered properly

The owner asked for **"how much of the weekly and hourly limit is left"**. Checked rather than
assumed, and the answer has two halves.

**The denominator genuinely is not available.** `~/.claude/.credentials.json` holds
`rateLimitTier: "default_claude_ai"` and `subscriptionType: "pro"` — a tier **name**, not a
remaining count. No transcript carries a rate-limit header. Claude Code's own `/usage` fetches the
number live using the OAuth token, and **using that token is the one thing this product refuses to
do**. So a percentage against a figure we invented would be a number the user trusts and we made up.

**But "today" was the wrong unit, and that was a real mistake.** These plans reset on a rolling
**five-hour** window with a second limit over **seven days**. A calendar day is not a unit any of
them use, so "58k today" could not answer the only question the user actually has: *can I keep
working now, or should I wait?*

So the panel now shows:

- **This 5 hours** — replies used, and **when room frees up**. The reset is one span after the
  *oldest* usage still in the window, not one span after now: a rolling window frees up gradually,
  and telling somebody who has been working steadily "resets in 5 hours" would be wrong every time.
- **This week** — the seven-day rolling window.
- **A percentage the moment the user supplies their own limit**, and never before. Their plan page
  says what they get; this turns it into a bar. Deliberately **not** pre-filled with Anthropic's or
  OpenAI's published figures — those change, differ by model and message size, and a stale default
  presented as fact is the invented number this section exists to avoid.

**17 assertions**, including that an unused window reads as free rather than as a fault, and that a
zero limit is treated as no limit rather than a divide-by-zero.

### T1c — compose, and the readiness rule it corrected ✅ (1.69.0)

**The ceiling was never Docker.** It was that `docker run` starts ONE container, and every ERP and
CRM a business actually wants needs a database beside it. That is now lifted.

| Piece | Note |
|---|---|
| `composeFileFor` | **Generated from the catalogue, never accepted from a caller.** This matters more than anywhere else in the Shelf: a compose file names several images, mounts, ports and networks at once, so accepting one would hand over far more than `docker run` ever could. There is no path by which a model or an agent can put a compose file in front of adris |
| The gate, extended | `isAllowedImage` protected the app image. `composeAllowed` covers **every** image a generated file names — a support image is exactly the thing that gets added later without anyone re-checking. Support images are a fixed vocabulary, **pinned to a major version** so an upstream change cannot silently alter what a user's data lives in |
| `tool_compose_up` / `down` | Project-named `adris-<id>`, so every container, network and volume is clearly ours. `down --volumes` on remove, because a removal that quietly left the customer database on disk would not mean what the word means |
| Stop and remove | Route through compose when there is a compose file. Stopping only the app would leave its database running; removing only the app would leave the data behind |

**Verified by installing Odoo for real:** the generated file, both containers up, and Odoo answering.

#### Two more bugs that only a database-backed app could have found

| Found | Fix |
|---|---|
| **Odoo 500s on every page** with `KeyError: 'ir.http'`. It was connected to Postgres fine — but adris had **pre-created an empty database**, and Odoo builds its own through a first-run wizard. It found a database with no Odoo schema | `dbEnv` now **overrides** the generated defaults rather than adding to them, and Odoo's spec leaves Postgres with only its own default database |
| **The readiness rule was wrong.** "Any HTTP response counts" was right for n8n, which serves 404 at `/` while working perfectly. It was wrong here: a broken Odoo answered **500** on every request, and adris would have marked it "Running" and framed a broken page | `tool_ready` now rejects **5xx**. A 5xx means the server is up and the application is not working — which on a first run usually means it is still building its database. Waiting is right; declaring it ready is not |

The second one is the more important lesson: **"a server answered" and "the app works" are not the
same question**, and only a tool with a database behind it was ever going to show that.

After the fix Odoo answered **HTTP 303** — a redirect to its own database manager, which is exactly
what a usable fresh Odoo does.

#### What is still not installable, and why it is listed anyway

**ERPNext, Twenty and Zammad** need more than an app plus a database — a site-creation step, extra
worker processes, an ordered first run. They are listed with a note rather than given a half-working
spec, because a compose file that starts containers and leaves no usable site is the Vikunja crash
loop again with more moving parts. **ERPNext is the most valuable entry on this shelf** for an Indian
business — Indian-built, GST-aware, the credible answer to §12b's "does my Tally still work" — and
that is a reason to do it properly, not quickly.

### What running it actually taught — four bugs no amount of reading would have found

**Docker Desktop was started and a real image pulled.** Everything below was found in the twenty
minutes after that, and every one of them would have shipped as a one-click install that produces a
crash loop.

| # | Found | Fix |
|---|---|---|
| 1 | **Vikunja pulls, starts, and crash-loops** on `service.publicurl is required when cors.enable is true` | `requiredEnv` on the catalogue entry — configuration a tool refuses to start without, with `{{url}}` filled in at install time because the port is only known then |
| 2 | **`{{.Ports}}` is EMPTY when a container is not running** | The port parser must yield *nothing*, not zero. A stopped tool with `hostPort: 0` would have been handed to the readiness poll and to a URL |
| 3 | **`restarting` is a crash loop, not "stopped"** | Its own phase and its own sentence — *"Keeps stopping"* — plus `tool_logs`, because "keeps stopping" alone is not actionable and the container's own line says exactly what is wrong |
| 4 | **The data path is per-tool.** A single hardcoded `/data` made Vikunja fail on `permission denied` — a second failure hiding behind the first | `dataPath` per entry |

**And then Vikunja was removed anyway.** After both fixes it still failed on
`[process uid=1000, dir owner uid=0]` — a fresh named volume is root-owned and Vikunja runs as
1000, which needs per-tool user mapping. That is more than a one-click entry can honestly carry.
**§12e rule 4: when something is not installable, say so.** A catalogue entry that produces a crash
loop is worse than no entry, because the user cannot tell whether they did it wrong. It comes back
when it has been made to work.

### The catalogue now says what has been tested

Every entry carries `verified`, and the UI says plainly when one has not been run on Windows:
*"Not yet tested by us on Windows. It should work, and if it does not, tell us rather than assuming
you did something wrong."* **That is the ✅-means-seen-working rule applied to a catalogue** — an
entry only read about is a claim.

**n8n is verified.** Pulled, started, answered on its port, and confirmed with the chosen model's
variables live inside the container.

### Tools that run on the model you chose

The first eight entries are standalone — a CRM is a CRM with or without a model. Three more are
AI-native (**Open WebUI**, **Flowise**, **n8n**), and a chat workspace with no model behind it is an
empty box. So they take their model from the **same title-bar choice as the rest of adris**;
otherwise the user would be configuring a second AI source inside a third-party app, which is the
competing-control problem the title-bar menu exists to end, reintroduced one container at a time.

**The two refusals are the important part**, and both are about not giving away something that is
not ours to give:

- **adris.tech is refused.** The hosted model is reached with the user's own *session token*, which
  identifies them to us. Handing that to a third-party container so it can spend their balance
  would be giving away a credential issued for adris, to software adris does not control.
- **Claude Code / Codex is refused.** A CLI on the host is not an HTTP endpoint; there is nothing a
  container could be told. Building a bridge to expose a subscription over a port would also breach
  the terms that subscription runs under.

An own key and a local model are both passed through, with the user told which in the confirm
dialog. **Verified live:** the variables landed inside the running container, and
`host.docker.internal` resolved to 192.168.65.254 with the connection *refused* rather than
unreachable — which is the proof the route works and simply nothing is listening on 11434.

**A container is only ever handed the variables its own entry declared** (`allowedEnvKeys`) — the
same gate as `isAllowedImage`, applied to configuration instead of images.

## The isometric "team room" — R1 ✅ BUILT AND VERIFIED (1.69.0)

The owner found [arturitu/the-delegation](https://github.com/arturitu/the-delegation) — *"a no-code
3D playground to explore, design, and interact with Agentic AI systems"* — and it is the right
instinct. An office you can look at, with characters in it doing the work, is a far more direct
answer to *"it doesn't feel like I have a team"* than any avatar in a chat list.

**Decision: we build our own, learning from that repo. We do not email for permission and we do not
ship their assets.**

### What we may and may not take — the line, stated once

| | |
|---|---|
| **Their source code** is **MIT** | We may read it, learn from it, and even use it with attribution. The instanced-animation system and the pathfinding are the genuinely hard parts and they are MIT |
| **Their `/models` — `.glb`, `.gltf`, textures, environment maps** are **CC BY-NC 4.0** | *"You may not use the material for commercial purposes."* adris is sold. **These never enter the repo, not even to prototype against** |
| **The look** — an isometric office with little characters at desks | **Not owned by anyone.** A visual genre is not copyrightable; a specific model is. Building our own office in that style is completely fine |

**The practical rule for whoever writes this:** if a file came from their `/models` directory, it
does not go in our tree — not in a branch, not "just to test the camera". Prototype against a grey
box or a free CC0 placeholder. Getting this wrong in software people pay for is a legal problem, not
a technical one — the same call already made on Postiz and AGPL.

### "Not full 3D, not top-down" — the owner's ask has a name

The owner: *"instead of making it complete 3D we show the office in not complete 3D manner but not
complete top down view."* That is **isometric** (strictly, axonometric): a camera at a fixed angle,
about 30–45° above the floor, using an **orthographic** projection so there is no perspective
distortion. You see the tops of the desks *and* the fronts of the people. It is the look of a good
management-sim game, and it is exactly the middle ground being described.

**This is a better choice than free-look 3D on every axis that matters to us:**

- **Cheaper to run.** A fixed camera means no perspective recomputation, aggressive culling, and a
  scene we can tune once for the one angle it will ever be seen from. This matters because it runs
  beside a local 14B model on a business laptop.
- **Far cheaper to make.** Isometric office kits — desks, chairs, plants, partitions — are widely
  available with genuine commercial licences, and are much simpler to model than assets that must
  hold up from any angle.
- **It reads at small sizes**, which free-look 3D does not.
- **It cannot be broken by the user.** No flying the camera through a wall, no upside-down office.
- **It looks deliberate.** A fixed, composed angle reads as design. A free orbit camera reads as a
  3D file viewer, which is exactly the "not premium" feeling to avoid.

**Camera, precisely** — the owner asked for *"zooming in and out... zoom out is allowed but not
completely"*:

- Orthographic camera, fixed elevation and azimuth.
- **Zoom is clamped at both ends.** Out far enough to see the whole floor, never far enough for the
  office to become a dot in a void. In close enough to see one agent at their desk, never far enough
  to inspect a texture.
- **Pan is clamped to the floor bounds**, so the room can never be pushed off screen.
- Optional: 90° snap rotation between the four isometric corners. Nice, not required — and it
  doubles the asset work if anything is faked as a sprite, so decide before modelling.

### Two ways to render it, and which to pick

| Approach | What it is | Verdict |
|---|---|---|
| **Real 3D at a locked isometric camera** | three.js, orthographic camera, glTF characters, instanced animation | **Recommended.** Animation, per-agent department tints and lighting come free, and the camera lock delivers the isometric look without the cost of free-look |
| **Pre-rendered sprites / layered SVG** | Draw the office once per angle; characters are sprite sheets | Smallest and fastest, but every new pose or agent is new artwork, and 56 agents makes that unbounded. **Rejected for the same reason as 56 hand-drawn avatars** |

**three.js `WebGPURenderer` auto-falls back to WebGL2**, so Tauri's WebView2 is covered either way
and there is no bet to place on WebGPU availability.

### It does not replace the avatars

3D is the wrong tool at 24×24 px, which is where a user sees an agent 95% of the time. These are two
different jobs and both are needed:

- **F2, inline SVG avatars** — chat list, agent grid, council. Small, instant, offline, ~40 KB.
- **R1, the isometric room** — its own screen, a place you *go and look at*. Idle when nothing runs;
  agents at their desks when they are working; someone walking a result over when the boss
  delegates. **This is the "I have a team" screen.**

The chat stays where work happens. The room is where you see that it is happening.

### Constraints that must hold

| Item | Requirement | Met? |
|---|---|---|
| **Bundle size** | three.js plus rigged characters is **megabytes, not kilobytes**, and the installer already has an antivirus problem (§9) that size makes worse. **Lazy-load the whole module** — nothing loads until the room is opened, ever | ✅ dynamic `import('three')`, its own **705 kB** chunk, confirmed in the build output. The main bundle is unchanged |
| **Cost while working** | **Pause the render loop when the room is not the visible module**, and drop to a low frame rate when idle. A 3D scene quietly eating a core during a long agent task is a bug, not a feature | ✅ **2 fps** when nobody is working, 60 only while someone is; `visibilitychange` cancels the frame entirely when the window is hidden (a WebView throttles the timer unpredictably rather than stopping it) |
| **56 characters** | Instanced animation, as the reference repo does. Not 56 draw calls | ✅ `InstancedMesh` throughout — 57 desks, legs, people, heads and glow discs are **5 draw calls** |
| **Colour** | The 11 department colours drive per-character tints, so the room agrees with the rest of the app | ✅ read from the same `--nv-dept-*` tokens as every other surface, and **re-read when the theme is switched with the room open** |
| **Accessibility / low-end** | `prefers-reduced-motion` honoured, plus a plain opt-out. **A static illustrated room is a perfectly good fallback and must exist** — this cannot be the only way to see your team | ✅ `prefers-reduced-motion` gives a still room rather than a broken one, and **`OfficeFlat` is the same office drawn as flat SVG** — no GPU, no render loop. It is what a machine with no WebGL gets instead of a sentence, and it is also a plain **"Simple view"** opt-out for anyone who does not want a 3D scene running, remembered per machine. It is genuinely the SAME room: same floor plan, same clusters, same department colours, same desks lit, and the same camera — `isoProject` is derived from `ISO_AZIMUTH`/`ISO_ELEVATION`, so the two views cannot drift apart, and 16 assertions hold them together |
| **It must mean something** | Every visible state maps to real work: at the desk = running, walking = handover, idle = idle. **A room that animates regardless of what is happening is a screensaver**, and worse than no room at all | ✅ every lit desk is a live entry on the same activity bus the chat's waiting box reads, so the two cannot disagree. Nothing animates on a timer. Walking/handover is R2 |

### Ordering — and what the plan got wrong

The plan above said R1 was *"weeks of work and needs assets that do not exist yet"*, and put it last.
**Both halves of that were wrong, and the reason is worth keeping.**

It needed no assets at all. The moment the rule *"nothing of theirs enters the tree"* was taken
seriously, the only option left was to generate every shape from numbers — and a desk is a box, a
person is a capsule and a sphere, a floor is a bigger box. The asset dependency that made this look
expensive was created entirely by assuming we needed models. **The constraint made it cheap.**

### What was built

| Piece | Where | Note |
|---|---|---|
| The floor plan | `src/lib/officeLayout.ts` | **Pure arithmetic, no GPU.** Departments cluster, clusters wrap into bands rather than running off the floor, everything re-centres on the origin whatever the roster does. `planOffice`, `clampZoom`, `clampPan`, `cameraPosition` |
| The room | `src/modules/OfficeRoom.tsx` | three.js behind a **dynamic import**, so it lands in its own 705 kB chunk and costs nothing until the room is opened |
| Arithmetic tests | `harness/officeLayout.test.mjs` | **53 assertions** — nobody seated twice, no two desks in one spot, every desk on the floor, a 40-person department wraps, the camera is *genuinely* isometric and not merely tilted |
| The same room, flat | `src/modules/OfficeFlat.tsx` | **No GPU and no render loop.** SVG, so it scales to any window with no redraw and the labels are real text. Used both as the no-WebGL fallback and as a "Simple view" the user can choose |
| Browser tests | `harness/office-room.mjs` | **15 assertions on real pixels** — departments are many hues and not one, hovering names a real agent, the floor follows the theme both ways, and the simple view draws the whole roster, *stops the 3D scene*, and is remembered across a reload |

### The four bugs, because each one rendered perfectly while being wrong

This is the honest part. Every one of these produced a room that drew without throwing.

1. **`vertexColors: true` on an instanced material.** That flag makes the material look for a colour
   attribute on the *geometry*, which an InstancedMesh has not got, so `setColorAt` was ignored and
   all 57 people rendered grey. The flag has to be **off** for per-instance colour to work at all.
2. **`renderer.setSize(w, h, false)`.** With `updateStyle` off, three sets the canvas width/height
   *attributes* to `w × devicePixelRatio` and never sets a CSS size — so on a 2× display the element
   laid out at twice its container, anchored top-left, and the room appeared shoved into the
   bottom-right corner. It looks exactly like a camera bug and is not one.
3. **`deptColor()` returns a CSS variable reference**, `rgb(var(--nv-dept-sales))`, which `THREE.Color`
   cannot parse — it fails silently and leaves white. It has to be resolved against the live document.
4. **And then the resolver itself shipped with the `\s` eaten out of its character class** — `[s,]`
   instead of `[\s,]` — so `"142 205 51"` never split, every channel was `NaN`, and all 57 agents
   fell back to boss purple. **Four screenshots in, still wrong, and nothing had ever thrown.**

The lesson that got acted on: **the parsing was pulled out of the renderer into `parseChannels` and
`tokenName` in `officeLayout.ts`, where it is asserted 14 ways.** Colour that a GPU consumes is still
just string parsing, and string parsing belongs somewhere it can be tested without a GPU.

### Three things found on the way that were nothing to do with the room

- **`className="nv-surface"` styles nothing.** `--nv-surface` is a CSS *variable*; there is no class
  of that name. The tooltip shipped fully transparent, and an outreach popup had shipped the same way
  once before. Now `scripts/check-classes.mjs` fails the build on any `nv-` class that does not exist,
  and says which real class was meant. **The floating-panel class is `nv-sheet`; the static one is `nv-card`.**
- **Five check scripts existed and nothing ran them** — `check-ai-callers`, `check-office-graph`,
  `check-tool-coverage`, `check-ui-reachable` are now in `npm run build`. `check-external-urls` is
  deliberately **not**: it hits the real internet, so it stays a manual pre-release step.
- **A finished screen with no way to open it.** The room was written, wired into `App.tsx`, given a
  `Module` id and rendered correctly — and there was **no sidebar button and no entry in the
  `nv-navigate` allowlist**, so `/office` would have done nothing either. A whole screen, complete
  and invisible, with nothing failing anywhere. Fixed (sidebar entry, `/office`, and `/shelf` for
  the Shelf, which had the same gap), and `check-ui-reachable` now fails the build on **any module
  that cannot be opened** — the same check that already caught an AI provider nobody could select.

### R2, and why it is not R1

Walking characters and a navmesh (`three-pathfinding`) were deliberately left out. They are real work
and buy nothing until there is somewhere worth walking between — the question a user actually has is
*"is anything happening right now"*, and a desk that lights up answers it completely.

---

## Reference library — links worth keeping

**Saved here so they are not lost between sessions.** Read the licence column before using anything.

### The isometric room (R1)

| Link | What it is | Licence / note |
|---|---|---|
| [arturitu/the-delegation](https://github.com/arturitu/the-delegation) | The reference. 3D agent office, three.js + WebGPU, React Flow UI, instanced animation, three-pathfinding | **Code MIT — usable. `/models` assets CC BY-NC 4.0 — NOT usable commercially** |
| [three.js](https://threejs.org/) | The renderer | MIT |
| [WebGPU → WebGL2 fallback notes](https://www.utsubo.com/blog/webgpu-threejs-migration-guide) | `WebGPURenderer` picks its backend at runtime and falls back to WebGL2 — no branching needed | reference |
| [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/) | What WebView2 is on Windows, and why Chromium features are available | reference |
| `three-pathfinding` | Navmesh walking for characters — what makes "walking a result over" possible | check its licence before adding |

### The subscription bridge (S1)

| Link | What it is |
|---|---|
| [anthropics/claude-code#43333](https://github.com/anthropics/claude-code/issues/43333) | **Read first.** `claude -p` with OAuth billed as API usage, not the Max subscription. One user reported $1,800+ in two days. Our bridge uses `-p` |
| [anthropics/claude-code#7477](https://github.com/anthropics/claude-code/issues/7477) | `CLAUDE_CODE_OAUTH_TOKEN` (subscription) vs `ANTHROPIC_API_KEY` (metered) |
| [claude-code-action setup docs](https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md) | Anthropic's own split: `claude_code_oauth_token` vs `anthropic_api_key`. The naming to follow |
| [griffinmartin/opencode-claude-auth](https://github.com/griffinmartin/opencode-claude-auth) | Reuses existing Claude Code credentials rather than forcing a second login |
| [weidwonder/claude_agent_sdk_oauth_demo](https://github.com/weidwonder/claude_agent_sdk_oauth_demo) | Pro-account OAuth with the agent SDK |
| [OpenAI Codex auth](https://developers.openai.com/codex/auth) | `codex login` → OAuth → `~/.codex/auth.json`; requests hit chatgpt.com and **bill the plan** |
| [Codex CI/CD auth](https://developers.openai.com/codex/auth/ci-cd-auth) | Keeping a Codex session alive unattended — closest to our case |
| [numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) | ChatGPT Plus/Pro OAuth via OpenAI's official method |

**Reminder on all of the above: adris never extracts, stores or reuses an OAuth token.** Several of
these projects work by lifting `accessToken` out of the credential file and calling the API with it.
We spawn the official client instead — safer for the user's account, and the compliant reading of
Anthropic's terms. Read them for *how the auth works*, not for that pattern.

---

## The prompt for Claude Design - agent avatars

**Give this verbatim.** It is written to produce a system that survives 56 agents rather than 56
drawings, which is the thing most likely to go wrong.

> I need an avatar system for **56 AI agents** in a Windows desktop business application. Each agent
> is a named specialist - Arjun the chief of staff, a bookkeeper, a researcher, a contract checker,
> a support agent - and together they are presented as a team the user has hired.
>
> **Do not design 56 avatars. Design a system that generates 56.** A small set of composable parts
> with parameters, so an agent added later gets a consistent avatar for free.
>
> **Hard requirements:**
> - **Inline SVG only.** No external images, no fonts, no network requests - the app runs offline.
> - **Must be legible at 24x24 px.** That is the primary size, in a chat bubble. Design at 24 first
>   and check it before scaling up. It also appears at 40px and 96px.
> - **About 40 KB total** for the whole set. Shared `<defs>`/`<symbol>` plus per-agent parameters,
>   not 56 separate drawings.
> - **Works on light and dark backgrounds.** No baked-in background colour; use `currentColor` and
>   passed-in values so the host app can theme it.
> - **Takes one accent colour per agent** (their department colour) and uses it as part of the
>   identity, so a Sales agent reads as Sales at a glance. The departments are: Boss, Content,
>   Marketing, Sales, Support, Designer, Data, Engineer, PM, Ops, Council.
> - **Distinguishable.** Two agents side by side must not be mistakable for each other. Vary the
>   silhouette, not just the hue.
>
> **Tone - this matters more than anything above:** these are professionals in a business tool used
> in front of clients. **Premium and calm, not playful.** No cartoon mascots, no big eyes, no gaming
> aesthetic, nothing that reads as a chatbot toy. Aim for the quality of a good financial terminal or
> a high-end CRM. Abstract-but-human is welcome - it does not have to be a literal face if something
> else conveys "a person who does this job" better. It must not resemble any real person.
>
> **Also design two states:**
> 1. **Idle** - completely still.
> 2. **Working** - a slow, subtle loop that reads as "this one is busy" from the corner of the eye
>    without pulling attention away from text being read beside it. CSS animation only, cheap enough
>    to run beside a local LLM. Must fall back to the idle state under `prefers-reduced-motion`.
>
> **Deliverable:** one self-contained React/TSX component taking
> `{ agentKey, department, accentColor, size, state }`, plus the shared SVG defs. Show me the full
> 56-agent grid at 24px and at 96px, in both light and dark, so I can check legibility and
> distinctness.

---

## The website, after the exe — W1 📋 PLANNED, DELIBERATELY NOT NOW

**Order, set by the owner and not to be reversed: finish the exe → test the exe → then the website.**

The reason is not preference. Everything below describes features that are **built but unreleased**
— three stacked builds, nothing in a user's hands. A website that describes them is a website that
lies until an `.exe` ships, and it would be describing behaviour that testing has not yet confirmed.
**Ship, test, then say.**

### What has changed in the product that the site does not know about

| Since the site was written | The site currently says |
|---|---|
| One AI source for the whole app, in the title bar | nothing — the pill rows it was built around are gone |
| **The bridge: run adris on your own Claude or Codex subscription** | nothing. This is the **strongest commercial line the product has** and the site does not mention it |
| ₹400 Codex / ₹2,000 Claude changes the pitch in India | nothing |
| The Shelf — free business software instead of subscriptions | nothing |
| Usage visible per 5-hour and weekly window | nothing |
| Local models, offline working | thin |
| 57 agents, several visibly working at once | an older count |
| Coder shows what an agent changed to your project | nothing |
| pay-per-use | the site still sells **subscription tiers** |

### The pages, and what each needs

| # | Page | Change | Depends on |
|---|---|---|---|
| W1-1 | **Pricing** | The big one. Tier table → licence + pay-per-use, and **say the bridge out loud**: *"already pay for Claude or ChatGPT? plug it in and our AI costs you nothing."* Hiding that to protect revenue would be the same dishonesty the app refuses everywhere else | **L1–L10 decisions** |
| W1-2 | **Home** | The pitch is no longer "an AI office". It is *"your team, running on software you already pay for, on your own computer"* | nothing |
| W1-3 | **Features / product** | The bridge, the Shelf, usage, the agent count, Coder's diff view | the exe shipping |
| W1-4 | **A page for the bridge alone** | It deserves one. It is the reason to choose adris over a wrapper, and it needs the honest data split spelled out | the exe shipping |
| W1-5 | **Download** | Sell the licence, then hand over the exe. Today it just hands over the exe | L7 licence issuing |
| W1-6 | **Docs / guide** | The Shelf, the bridge setup, what needs Docker and what does not | T1b |
| W1-7 | **Checkout + webhook** | `razorpay-webhook` and the plan grants are subscription-shaped. A one-time licence plus top-ups is a different shape | **L6, and a decision first** |
| W1-8 | **Account** | Licence state and balance, once those exist | L7, L8 |

### Two things that must not slip

- **Do not describe anything as available until an `.exe` carries it.** Three builds are stacked up
  right now; a site written against the tree rather than against the release is a site that is wrong
  the day it goes live.
- **The AGPL and licence honesty carries over.** The Shelf page must say those tools are the user's
  own installations, run on their machine — adris does not redistribute them. And Docker Desktop's
  own licence threshold belongs on the page that recommends it, not discovered later.

**Where it lives:** the NIVARA root, which is the `nivara-website` repo and auto-deploys on push.
Nothing there is private, so nothing unreleased should be described there either.

---

## What adris SELLS — licence + pay-per-use 📋 PLANNED, NOT BUILT

**Nothing in this section is written yet. It is planned here so the shape is agreed before any code
is, and because the exe and the website have to change together.**

### The model, in one paragraph

adris is **software you buy a licence for**. The licence is for the *hands* — real Word and Excel,
the browser, your files, your mailbox, the agents, the automations. The *brain* is yours to choose:
plug in **your own Claude Code or Codex subscription** (the bridge, now one button — see above), or
your own API key, or a local model, and adris costs you nothing beyond the licence. If you would
rather not choose, **adris.tech's own AI is pay-per-use** and you are billed for what you actually
run.

**Why this is the right shape and not a subscription:**

- It is the only story that stays true to the HARD RULE below. We are not reselling somebody
  else's tokens with a margin; we are selling the software that does the work.
- The customer's existing Claude/ChatGPT spend is **larger than anything we could sell them**.
  Competing with it is a losing trade; plugging into it is a reason to buy.
- **The Indian numbers make this decisive, not marginal.** Codex is about **₹400/month** here and
  Claude about **₹2,000/month**. A buyer on ₹400 gets a full month of agent time for less than
  adris could ever resell it — so the pricing page's strongest line is *"plug in the subscription
  you already have and our AI costs you nothing."* Pay-per-use becomes the **convenience** option
  for people who would rather not think about it, not the road everyone is pushed down.
  See §"THE SUBSCRIPTION, NEVER AN API KEY".
- A small business owner understands "buy the software, top up if you use our AI". A tiered
  monthly subscription for an app they might use twice a week is the thing they cancel.

### Where every change lands

### The pricing page, finished — and the dead button in it

| # | Item | State | Notes |
|---|---|---|---|
| **L5b** | Term switcher, and the page opens on the annual plan | ✅ **live** | 1/3/6/12 months above the cards, changing the number the buyer is actually reading rather than leaving them to work it out from a table further down. **The page opens on 12 months** — the plan being recommended — and the annual figures are in the MARKUP too, so with JavaScript off the page does not contradict its own control. Every figure asserted against the plan; totals round the monthly price first and then multiply, because that is how a customer checks it (multiplying the unrounded figure gave ₹47,995 where the plan says ₹47,994) |
| **L8b** | "Manage plan" for a customer who has already paid | ✅ **live** | `markCurrentPlan` and `openSubPanel` existed and had gone dead when the 2025 cards were buried — so somebody who had paid came back to a page still inviting them to buy. **Nothing new was built:** the same function finds the new card, marks it, and "Manage plan" opens the same subscription panel (renewal date read from Razorpay, and cancelling). Workspace owners get `/team-dashboard`, where seats and email invitations already live |
| **X12** | The dead Manage plan button | ✅ **fixed** | It did nothing. The panel is appended to `<body>` at click time and **the rule that buries the 2025 page hid it with `!important`**, which beats the inline `display:flex` that opens it — so the click ran, the panel was built, the request went out, and nothing appeared. My own rule, and the same dead-control failure this file keeps recording. The rule now has a `[data-overlay]` hook rather than a list of ids, and the pay-tester banner — equally invisible, nobody had noticed — declares it too. **Negative-tested** |
| **X13** | The owner was being metered on a plan that no longer exists | ✅ **fixed (1.79.0)** | `admin_level` unlocked the Head module and granted no entitlement, so the account carrying `plan: 'solo'` was shown and metered as such. `tierForAccount()` reads the whole account: **head and admin are Enterprise** — not a perk, but because they are the ones who must reproduce any customer report on any tier without an allowance running out. An ordinary account is never promoted, and half the assertions are on that |

**What the pricing page now shows a business, in order:** the four tiers with a term switcher · the
bridge ("already paying for Claude or ChatGPT? plug it in") · what the app actually does, grounded in
the ten modules that are reachable in the shipped exe · the four questions asked before price (data,
overspend, what it runs on, how to leave) · the ladder · top-ups · the pilot request · the enterprise
request · the FAQ. **Studio is deliberately absent** — it exists in the source, is not routed, and a
pricing page is the last place to advertise something nobody can open.

**Still not built, and still only this:** self-serve checkout (L6) and licence issuing (L7). The model
is decided, so they are no longer blocked on a decision — they are blocked on the owner saying go,
because they move real money.

### What 1.79.0 added

| # | Item | State | Notes |
|---|---|---|---|
| **X11** | A run that stops mid-work now says so | ✅ **done (1.79.0)** | Reported: "check this portfolio page and find how much they invested in each" made several searches and **nothing came back to the chat**. The boss loop gets six steps; a research task spends them on searching, the loop condition goes false, and there was nothing between the last tool result and the end of the turn. The empty-turn recovery did not catch it because an earlier "Let me look at their page…" counts as output. It is now made to stop searching and write up what it has — and if that comes back empty too, it says how many steps ran and that nothing was invented. `lib/runWrapUp.ts`, **33 assertions**, and the change is **60 lines added, 0 removed** so nothing on the working path moved |
| **L5** | The pricing page | ✅ **live (1.79.0)** | Four tiers, the term switcher, top-ups, the pilot and enterprise requests, and a grounded list of what the app does. Payments held. **76 assertions in a browser** |
| **L1–L4, L10** | Entitlement in the exe | ✅ **done (1.78.0)** | see the table below |
| **L8** | Balance | 🟡 **exe only** | The allowance panel is in Account; there is still nothing on the website, and top-ups do not exist to be bought |
| **L6, L7, L9** | Checkout, licence issuing, download page | ❌ **not built** | L6 is no longer blocked on the MODEL — that is decided — but it moves real money and wants the owner's go-ahead before Razorpay is wired to term-upfront billing |

**Two rules this round produced, both learned by breaking something:**

1. **Never read `users.plan` for display outside AuthContext.** Its realtime subscription is what
   fixed "the payment went through and the exe never updated". A second cached copy rebuilds that
   bug somewhere new. `check-plan-source.mjs` enforces it, with UpgradeModal and guardWatch
   allow-listed because their reads ARE the post-payment poll.
2. **Never use a string as a `String.replace` replacement when it contains `$`.** `$'` means
   "everything after the match": a patch script truncated itself and spliced a copy of the page in
   after it, and the browser reported one syntax error a hundred lines from the cause. Use a
   replacer function.

### Where L1–L10 actually stands — 31 Aug 2026

**Six of the ten are done and in the build.** The four that are not are all downstream of one
decision nobody but the owner can make: whether adris sells a **licence plus top-ups** (what this
section was originally written for) or **bundled monthly tiers** (what the pricing draft above
describes). They are different products. L6 needs that answer before it can be built, and L7, L8
and L9 sit behind L6.

| # | Where | What has to change | State |
|---|---|---|---|
| L1 | **exe** — title bar | The badge showed "Free / Solo / Builder / Team" — names the pricing page does not use — inches from a menu offering pay-per-use, and never said how much was left. It now reads the tier and the **tasks remaining** from `lib/entitlement.ts`, turns amber at four fifths and red at zero, carries the reset date and the offline state in its tooltip, and opens the account screen. | ✅ **done (1.78.0)** |
| L2 | **exe** — new licence screen | `components/LicencePanel.tsx`, on the account screen. What you are on, what it covers (in tasks, images, runs, seats, Mesh devices), three meters for what is left, the reset date, **which machine this is tied to**, and the entitlement state. The key box is honest that redemption is not switched on yet rather than pretending to accept one — L7 is the server half and is not built. | ✅ **done (1.78.0)** |
| L3 | **exe** — metering | `consumesAllowance` delegates to `billingSource` rather than inventing a second rule — own key, the Claude/Codex bridge and local models cost us nothing and so consume nothing. **17 assertions**, including that 180,000 own-key tokens cost the customer zero. | ✅ **done (1.78.0)** |
| L4 | **exe** — offline grace | The last verification is cached and honoured for **14 days**. Inside a day it reads Active; past that, "Active — offline" and the app says plainly that we could not check in and nothing is wrong. Past the window it degrades to "needs checking" and still never locks: own key and local models never needed us. A machine whose clock runs fast is never punished for it. | ✅ **done (1.78.0)** |
| L5 | **website** — pricing page | The four tiers, the 1/3/6/12-month ladder, the top-up tables and the FAQ are written and **live behind the hold**, so lifting it is deleting one block. The bridge is said out loud. Every allowance also lives in `entitlement.ts`, so the page and the meter cannot disagree. Both states verified in a real browser. | ✅ **built, held (1.78.0)** |
| L6 | **website** — checkout | Unchanged, and deliberately: `razorpay-webhook` is written around recurring subscriptions, and a term paid upfront is a different shape. **The owner has to choose between the licence+top-up model this section was written for and the bundled-tier model the pricing draft describes** — they are different products and building both is waste. | ❌ **blocked on a decision** |
| L7 | **website** — licence issuing | Minting a key on purchase, binding it and letting the exe verify it is a new table and a new edge function. The exe half is ready — `entitlement.ts` already models binding and the licence screen already shows it — so this is server work waiting on L6. | ❌ **not built** |
| L8 | **website** — balance | The allowance is visible in the app (L2), read from the real `token_usage` rows. There is still nowhere on the website to see it or top it up, and top-ups do not exist to be bought. | 🟡 **in the exe, not on the website** |
| L9 | **website** — download page | The download page still hands over the exe without a plan choice. Small work, but it should follow the page it sells from (L5) coming out of hold. | ❌ **not built** |
| L10 | **both** — the plan words | One vocabulary, from `entitlement.ts`, in the title bar, the account screen and the Coder bar. **The trap:** `business` means opposite things in the two schemes — the old Team (most generous paid plan) and the new Business (cheapest) — so reading a stored value with the new vocabulary would have silently downgraded every existing Team customer. `tierOf` takes the vocabulary explicitly, and a test says so. | ✅ **done (1.78.0)** |

### Decisions the owner has to make before any of it is written

These are not implementation details; each one changes what gets built.

1. **Perpetual licence or annual?** Perpetual is easier to sell and harder to sustain; annual funds
   the work but is a subscription by another name.
2. **How is the licence bound?** Per machine, per person, or per business. Per machine is the
   easiest to enforce and the most annoying when someone buys a new laptop.
3. **What does a "unit" of pay-per-use mean to the buyer?** Not tokens — nobody outside this
   industry knows what a token is. A task? A document? A minute? **It has to be countable by the
   person paying.**
4. **Top-up or post-paid?** Pre-paid balance is safer for us and clearer for them. Post-paid needs
   a card on file and a credit decision.
5. **What happens when the balance runs out mid-task?** The honest answer is that it stops and says
   so — and the local/own-key path is always still there, which is the argument for the whole design.
6. **Does the licence gate any feature, or only support and updates?** Gating features splits the
   product into editions and doubles the surface. Recommendation: **it does not** — one product, the
   licence is the right to use it.

### The rule this section must not break

Everything here has to survive the HARD RULE below: **adris.tech never stores user data.** Metering
means counting *usage*, not keeping *content*. A billing record may say "one document, 14:22
Tuesday". It may never contain the document. If a billing design needs the content, the design is
wrong.

**Do not start the website until the exe is launched.** The two must change together, and a
half-migrated pricing page is worse than an old one.

---
## Pricing — the bundled licence model 📋 THE OWNER'S DRAFT

**Added at the owner's request, 31 Aug 2026, and kept as written.** The wording, the numbers and the
order are the owner's; the only change is that the tab-separated tables are laid out as Markdown so
they render. Nothing below has been built. **Read "What this draft settles — and what it reverses"
after it, because it changes decisions this file had already recorded.**

---

### adris.tech — Pricing Plan (Bundled License Model)

Draft for website. Review the "Before you publish" checklist at the end before this goes live.

#### 1. The four tiers

|  | Free | Business | Growth ⭐ Most Popular | Enterprise |
|---|---|---|---|---|
| **Price (India)** | ₹0 forever | ₹9,999/mo | ₹19,999/mo | Custom |
| **Price (International)** | $0 | $99/mo | $199/mo | Custom |
| **Seats** | Up to 2 | Up to 10 | Up to 25 | Unlimited |
| **Monthly AI capacity** | 300K tokens (~300 tasks) | 8M tokens (~8,000 tasks) | 25M tokens (~25,000 tasks) | Custom token pool |
| **AI-generated images/mo** | 10 | 100 | 400 | Unlimited (fair use) |
| **Cloud automation runs/mo** | 3 | 1,500 | 5,000 | Unlimited (fair use) |
| **All 8 modules (Krew, Coder, Studio, Vault, Models, Mesh, Brain, Guard)** | Core modules, capped | ✓ Full access | ✓ Full access | ✓ Full access |
| **Guard security scanner** | ✗ | ✓ | ✓ | ✓ |
| **Mesh devices** | 1 | 25 | 50 | Unlimited |
| **SSO + admin controls** | ✗ | ✗ | ✓ | ✓ |
| **Team workspace** | ✗ | Basic | ✓ | ✓ + custom roles |
| **Support** | Community (docs + email) | Standard (business hours) | Priority | Dedicated CSM + SLA |
| **Billing** | — | Self-serve | Self-serve | PO / NET-30, GST invoice |

Positioning line for the page: "Same AI model on every plan — plans differ only in how much monthly
capacity and which modules you get. Start free, prove it works, scale when it pays for itself."

#### 2. Free tier — "Explore"

₹0 / $0, forever. No credit card.

Enough to genuinely test real workflows, not just click through a demo:

- 300 AI tasks/month (~300K tokens) — resets monthly, not a one-time trial
- 10 AI-generated images/month
- 3 cloud automation runs/month
- Full Krew agent library, capped usage
- Coder, Deck & PPT Maker, Studio — available, capped
- Local models — unlimited, free, runs on your own machine
- Bring your own API key (Gemini/OpenAI/Claude) — unlimited, doesn't touch the monthly cap

Not included: Guard, SSO, multi-device Mesh beyond 1 device, priority support.

#### 3. Term commitment — discount ladder

Discount applies to the license price only. Billed upfront for the full term.

**Business**

| Term | Discount | Effective price | Billed as |
|---|---|---|---|
| 1 month | — | ₹9,999/mo | ₹9,999 monthly |
| 3 months | 10% off | ₹8,999/mo | ₹26,997 every 3 months |
| 6 months | 20% off | ₹7,999/mo | ₹47,994 every 6 months |
| 12 months | 35% off (~4 months free) | ₹6,499/mo | ₹77,988 billed annually |

**Growth**

| Term | Discount | Effective price | Billed as |
|---|---|---|---|
| 1 month | — | ₹19,999/mo | ₹19,999 monthly |
| 3 months | 10% off | ₹17,999/mo | ₹53,997 every 3 months |
| 6 months | 20% off | ₹15,999/mo | ₹95,994 every 6 months |
| 12 months | 35% off (~4 months free) | ₹12,999/mo | ₹1,55,988 billed annually |

Enterprise: term and discount negotiated per contract, typically annual minimum.

Suggested annual callout: "Lock in today's rate for 12 months — insulated from future AI pricing
changes." (Honest hook: underlying model pricing is scheduled to change in the industry from time to
time, so a locked annual rate is a real, not invented, benefit.)

#### 4. If a team goes over its monthly bundle

No hard cutoff mid-workflow. Teams can enable auto-top-up or buy manually; admins can also set a
hard spending cap per workspace.

| Token top-up | Price (India) | Price (Intl) |
|---|---|---|
| 5M tokens | ₹599 | $6 |
| 20M tokens | ₹2,199 | $22 |
| 100M tokens | ₹9,999 | $99 |

| Image top-up | Price (India) | Price (Intl) |
|---|---|---|
| 50 images | ₹499 | $5 |
| 200 images | ₹1,799 | $18 |

| Automation run top-up | Price (India) | Price (Intl) |
|---|---|---|
| 500 runs | ₹999 | $10 |

#### 5. Pilot program — "Run a Pilot Before You Roll Out"

For companies (5+ employees) evaluating adris for a team-wide rollout, not a single user.

- 21-day guided pilot, full Growth-tier feature access
- Usage cap sized for a real proof of concept: 2,000,000 tokens · 50 AI images · 200 automation runs
- 1:1 onboarding call + dedicated setup support
- Live usage dashboard so the pilot's actual cost/usage is visible to your team, not a black box
- No credit card required to start
- Conversion incentive: convert to a paid license within 30 days of the pilot ending and your pilot
  period counts toward your first term

CTA button: Request a Pilot → Form fields: Company name · Team size · Primary use case · Timeline to decide · Work email

#### 6. FAQ (for the pricing page)

**What is a token, and how does it relate to tasks?** A token is roughly ¾ of a word. One typical
task — a caption, a short research answer, a code review — uses around 1,000 tokens. Non-technical
teams can think in tasks; technical teams can budget in tokens.

**What happens if we go over our monthly allowance?** You're never blocked mid-task. Enable
auto-top-up, or buy a top-up pack manually. Admins can also set a hard spending cap so usage never
exceeds an approved budget.

**Can we use our own Gemini, OpenAI, or Claude key instead?** Yes, on every paid plan. Usage on your
own key never counts against your monthly allowance. You can also run models entirely on your own
hardware, for free.

**What counts as an AI task?** Roughly one meaningful AI request. Simple requests use less of your
allowance; deep analysis of large documents uses more. Estimates are a guide, not a hard counter.

**Do local automations count toward our quota?** No. Automations that run entirely on your machine
don't consume cloud allowance.

**Can we cancel or downgrade?** Plans renew automatically at the end of the committed term. You can
cancel or downgrade any time, effective at the next renewal. [Confirm your refund/early-termination
policy with legal before publishing — see checklist below.]

**Is GST included in these prices?** Prices shown are exclusive of applicable GST. A GST-compliant
invoice is provided with every business license. [Confirm applicable GST treatment with your CA
before publishing — see checklist below.]

**Where does our data go?** Same architecture as the rest of adris: conversations, credentials, and
your knowledge graph stay local-first on your own machines. Cloud sync is off by default and only
applies to what you explicitly enable (e.g., cloud automations).

#### 7. Before you publish — checklist

A few things worth a second pass before this goes live, since none of these are things I can
finalize for you:

- **GST specifics.** Have your CA confirm the correct GST treatment for a hybrid license +
  usage-based SaaS product, and how it applies differently to the India vs international pricing.
- **Cancellation / refund terms.** The FAQ above leaves this generic on purpose ("confirm your
  policy") — decide what happens if a company cancels mid-term on an annual plan, and have that
  reviewed alongside your Terms of Service.
- **"Unlimited" language.** Enterprise usage is marked "unlimited (fair use)" rather than flatly
  unlimited — keep it that way. Unqualified "unlimited" claims are the kind of thing that draws
  customer complaints and, in some jurisdictions, regulatory attention if usage is ever actually
  capped or throttled behind the scenes.
- **Naming the underlying AI model publicly.** This draft doesn't name Gemini or any specific model
  on the public page, deliberately — if you switch or blend providers later, a public page that says
  "powered by Gemini Flash-Lite 3.1" creates a support/expectations problem. Consider keeping it
  generic ("adris runs on fast, cost-efficient, regularly-updated AI models") unless there's a
  specific brand reason you want to name the provider.
- **Currency conversion.** The $ prices here follow your site's existing ₹100≈$1 simplified
  conversion (matching your current Solo/Builder/Team pattern) rather than the live market rate —
  confirm that's still the convention you want as the rupee moves.

I'm not a lawyer or tax advisor, so items 1–3 specifically need a real legal/CA review, not just my
drafting — the numbers and structure are solid, but the compliance language should be signed off by
someone qualified before it's public.

---

### What this draft settles — and what it REVERSES

The section above this one ("What adris SELLS — licence + pay-per-use") was written around a
different shape, and left **six decisions open**. The draft answers most of them. Where it answers
them *differently*, the draft wins — but it has to be said out loud, or someone will build the old
shape from the old section.

| Old open decision | What the draft decides |
|---|---|
| 1. Perpetual licence or annual? | **Neither** — a monthly subscription with a 1/3/6/12-month term ladder, billed upfront |
| 3. What is a "unit" to the buyer? | **A task** on the surface, **a token** underneath: "~1,000 tokens ≈ one task", both shown |
| 4. Top-up or post-paid? | **Bundled allowance + top-ups**, auto or manual, with an admin hard cap |
| 5. What happens when it runs out? | **Never blocked mid-task** — top up, or fall back to your own key / local, which are free |
| 6. Does the licence gate features? | **Yes — reversed.** The old text recommended *one product, no gating*. The draft gates **Guard, SSO, team workspace, Mesh device count** and caps everything on Free |
| 2. How is the licence bound? | **Still open** — the draft says *seats* (2/10/25/∞), which implies per-person within a workspace, but binding and enforcement are not specified |

**What does NOT change:** the bridge argument, and the HARD RULE. "Usage on your own key never counts
against your allowance" is the same sentence as *"plug in the Claude or Codex subscription you already
have and our AI costs you nothing"* — and it is already true in code: `billingSource` marks only the
`adris` source billable, so own-key, bridge and local paths cost nothing and must consume nothing.
Metering still counts *usage*, never *content*.

### P0 — the blocker to settle before the page is written

**The pricing table sells Studio. Studio is not reachable in the app.**

`src/modules/StudioModule.tsx` exists — about 1,700 lines — and is **imported by nothing**.
`"studio"` is not in the `Module` union in `components/Sidebar.tsx`, so there is no route, no
sidebar entry and no way for any user to open it. The draft sells it twice: in the "All 8 modules"
row and in the Free tier's "Coder, Deck & PPT Maker, Studio — available, capped".

Two honest options, and only two:

1. **Ship Studio** — route it, add the sidebar entry, and let `check-ui-reachable.mjs` prove it.
2. **Take it off the pricing page** and count seven modules.

Publishing a page that sells a module nobody can open is the same failure as the rail's dead Word
button, except a customer pays for it first. The other seven — Krew, Coder, Vault, Models, Mesh,
Brain, Guard — are all present in the sidebar and reachable.

### Where pay-per-use ACTUALLY stands today — audited in the code, 31 Aug 2026

Not the plan; **what is in the repo right now**. Every row was checked by reading the file named in
it. "Connected" means the pieces on either side actually call each other, not that both exist.

| Piece | Where it lives | exe | website | Supabase | State |
|---|---|---|---|---|---|
| **Usage table** | `token_usage` | writes | — | ✅ hardened | ✅ **ready.** Input/output split, `source`, `model_used`, and RLS that no longer lets a customer edit their own bill |
| **Recording usage** | `lib.rs::track_token_usage`, `App.tsx:327`, `lib/tokenTracker.ts` | ✅ calls it | — | ✅ writes | ✅ **connected.** Every chat turn records tokens with its real source and model |
| **Who pays** | `lib/usageMeter.ts::billingSource` | ✅ | — | ✅ | ✅ **ready.** Only `source === 'adris'` is billable, so own-key / bridge / local cost nothing — the same sentence as the pricing FAQ, enforced in code |
| **Pricing the usage** | `usageMeter.ts::RATE_CARD` | ✅ reads | — | — | ⚠️ **empty on purpose.** `RATE_CARD = {}`, `RATE_VERSION = 'unset'`, and every screen checks `pricesAreSet()` before showing money. **Blocked on the owner setting prices** |
| **Seeing your usage** | `components/UsagePanel.tsx` | ✅ in Account | ❌ nowhere | ✅ reads real rows | 🟡 **half.** It reads the real table and respects `usage_period_start`. There is **no equivalent on the website**, and it shows tokens, not the tasks/images/runs the pricing page sells |
| **Monthly period** | `users.usage_period_start` | ✅ read | — | ✅ | ✅ **connected.** Both the token and image counters honour it |
| **Image allowance** | `lib/imageQuota.ts`, `IMAGE_QUOTA_EXHAUSTED` | ✅ counts + refuses | ❌ | ✅ | 🟡 **counts, does not sell.** The server can refuse an image and the deck falls back to stock photos honestly — but there is no top-up and no per-tier number |
| **Automation runs** | `planConfig.cloudAutomations` | ⚠️ limit only | ❌ | ❌ | ❌ **not counted.** A per-plan NUMBER exists; nothing anywhere increments a counter against it |
| **Plan limits** | `lib/planConfig.ts` | ✅ enforced | ❌ | ✅ plan on user | 🟡 **wrong names.** Real, enforced limits (tokens, Mesh devices, Guard, decks) — but the plans are `free / explore / solo / builder / business / custom`, **not** Free / Business / Growth / Enterprise |
| **Taking money** | `razorpay-webhook` (v16) | — | 🟡 checkout exists | ✅ signed, audited | 🟡 **subscription-shaped.** Hardened (signature verification, `payment_events`, expiry cron) but written for recurring subscriptions, not a 3/6/12-month term paid upfront |
| **Top-ups** | — | ❌ | ❌ | ❌ | ❌ **nothing.** No ledger, no purchase, no auto-top-up, no admin cap |
| **Seats / workspace** | — | ❌ | ❌ | ❌ | ❌ **nothing.** There is no workspace model at all; every limit today is per USER |
| **Pricing page** | `pricing.html` | — | 🔒 **locked** | — | 🔒 **held.** The old plans are hidden behind a "we're rebuilding our pricing" notice; the original markup is intact underneath and lifting it is deleting one block |
| **Account / balance** | `modules/AccountPanel.tsx` | 🟡 usage only | ❌ | ✅ | 🟡 **exe only.** No balance, no top-up, nothing on the website |

**The short version:** *counting* is done and genuinely connected end to end — the exe records real
usage with its real source, Supabase stores it safely, and the app shows it. **Charging** is not
started: no prices, no ledger, no top-ups, no seats, and the checkout is the wrong shape.

**What can be built next without waiting for any decision** (everything else needs the owner):

| # | Buildable today | Why it is unblocked |
|---|---|---|
| **P2** | The allowance ledger — granted / consumed / topped-up per period | The shape is decided by the pricing draft; it needs no price to exist |
| **P3** | `remaining()` in `usageMeter.ts` — tasks, images and runs left, and the reset date | Reads the table that is already correct; shows counts, not money |
| **P10** | Turn `UsagePanel` into the allowance panel, in tasks first and tokens underneath | The FAQ already defines the wording ("~1,000 tokens ≈ one task") |
| **P11** | The honest out-of-allowance path — never stop mid-task, offer the top-up, point at own-key/local | Decision 5 is already answered in the draft |
| **Runs** | Actually count automation runs against `cloudAutomations` | The limit exists and is enforced nowhere; counting it is the missing half |
| **P12** | Rename the plans everywhere, in one pass | Blocked only on P0 (Studio) and the owner confirming the four names |

### Coding the pricing page and pay-per-use — P1–P16

Ordered so nothing is built on something undecided. **Nothing here is written yet.** Where an item
replaces an L-number from the previous section, it says so.

| # | Where | What | Depends on | Replaces |
|---|---|---|---|---|
| **P1** | supabase | **Plan + subscription schema.** Four tiers, seats, term (1/3/6/12), term price, term start/end, renewal flag. The existing `PLAN_CONFIG` is already subscription-shaped, so this is closer to the current code than the old licence plan was | P0 | — |
| **P2** | supabase | **The allowance ledger.** Per workspace per period: tokens, images, automation runs — granted, consumed, topped up, resets on. Built on the hardened `token_usage` from **L-usage (1.73.0)**, which already carries the input/output split, the model and the source | P1 | L8 |
| **P3** | exe | **Allowance maths in `usageMeter.ts`.** It prices rupees-per-token today; the bundle needs *remaining* — tokens left, images left, runs left, days to reset. `RATE_CARD` stays empty until the owner sets top-up prices | P2 | — |
| **P4** | exe | **The source rule, unchanged and enforced.** Only `source === 'adris'` consumes allowance. `billingSource` already guarantees it; add the assertion so the FAQ promise cannot rot | P3 | L3 |
| **P5** | supabase | **Top-ups + auto-top-up + the admin hard cap.** One-time purchases that add to the ledger, a per-workspace ceiling that usage can never exceed, and the toggle between them | P2, P8 | — |
| **P6** | both | **Seats and the team workspace.** 2/10/25/unlimited, invite and remove, Basic vs full vs custom roles. This is new surface — there is no workspace model in the app today | P1 | — |
| **P7** | both | **Feature gates: Guard, SSO, Mesh device count, team workspace.** The draft reverses "no gating", so these become real gates with real upgrade paths. Each gate needs an honest empty state saying what it is and what unlocks it — never a dead button | P1, P0 | L10 |
| **P8** | website | **Checkout for a TERM, billed upfront.** `razorpay-webhook` is written around recurring subscriptions; 3/6/12 months paid in advance is closer to a one-time order that grants a period. The webhook is already hardened (signature verification, `payment_events`, the expiry cron) — extend it, do not start again | P1 | L6 |
| **P9** | website | **GST invoice + international pricing.** ₹100≈$1 by the site's existing convention. **Blocked on the CA review in the checklist** | P8 | — |
| **P10** | exe | **The usage panel becomes the allowance panel.** `UsagePanel` (1.73.0) shows spend; it should show *tasks left, images left, runs left, resets in N days* — tasks first, tokens underneath, exactly as the FAQ explains them | P3 | L1 |
| **P11** | exe | **Running out, honestly.** Never stop mid-task. When the allowance is gone: say so, offer the top-up, and **point at your own key or a local model, which are free** — that sentence is the whole product argument, so it belongs at the moment it is most useful | P3, P5 | — |
| **P12** | both | **The plan words.** `PLAN_CONFIG`, `PLAN_LABELS`, the upgrade modals and every quota string say free/explore/solo/builder/business/custom. The new names are **Free / Business / Growth / Enterprise**. Every one of these is user-visible and every one will read wrong on the day the page changes | P1 | L10 |
| **P13** | exe | **Offline grace.** The plan must keep working with no internet for a sensible window. adris runs on machines with bad connections; a check that fails closed on dropped Wi-Fi is a support call | P1 | L4 |
| **P14** | website | **The pricing page itself (W1-1).** Four tiers, the term ladder, the top-up tables, the FAQ, the positioning line. Keep the model name off it, per the checklist — which also matches the code, where the fast path hardcodes one model that may change | P0, P12 | L5 |
| **P15** | website | **The pilot programme.** 21 days, Growth features, the stated caps, and the form (company, team size, use case, timeline, work email). The "live usage dashboard" it promises is P10 pointed at a pilot workspace | P6, P10 | — |
| **P16** | website | **Account, balance, and a download page that sells first.** Where a customer sees their allowance, buys a top-up, and manages seats. Today the download page just hands over the exe | P2, P8 | L7, L9 |

**Order to build in:** P0 (decide) → P1, P2 (the data) → P3, P4 (metering that is honest) → P10, P11
(what the user sees in the exe) → P8, P9 (taking money) → P12 (the words, everywhere, in one pass) →
P14, P16 (the public pages) → P6, P7 (teams and gates) → P5, P13, P15.

**The rule that still governs all of it:** adris.tech never stores user data. A billing record may say
"one document, 14:22 Tuesday". It may never contain the document. If a billing design needs the
content, the design is wrong.



---
## Connect Apps — the brand-mark audit 🟡 (1.68.0)

**How it was checked:** every `case` in `components/ui/BrandLogo.tsx` extracted, rendered at 112px
in a real Chrome, and looked at. Reading the source cannot find a path that parses fine and draws a
garbled blob — and four of them do. Rebuild the sheet the same way after any change here.

Connect Apps offers 31 services. `BrandLogo` has 28 marks (plus our own). They fall into four
groups, and only the first is finished.

**Correct — leave alone (17).** Gemini, OpenAI, Gmail, Google, Notion, Slack, GitHub, X/Twitter,
LinkedIn, Reddit, Stripe, Discord, Figma, Vercel, Instagram, NVIDIA, and our own `adris` chevron.

**Wrong — the path draws something that is not the logo (5).**

| id | what it draws now |
|---|---|
| `claude` | ✅ **fixed in 1.68.0** — was the wordmark "A", now the traced burst |
| `brave` | a garbled blob; the real mark is a lion's head |
| `linear` | a jagged mess; the real mark is a set of diagonal bars |
| `airtable` | renders as a plain chevron, nothing like Airtable's stacked table |
| `shopify` | a shopping bag with a stray cut, not Shopify's bag |
| `groq` | a generic circled "Q"; Groq's mark is an angular glyph |

**Placeholders — never real logos, invented to fill a hole (6).** `serper` (a magnifier),
`runway` (a play button in a rectangle), `elevenlabs` (three bars), `heygen` (a person with a play
button), `did` (a person in a frame), `higgsfield` (dots around a centre). These are honest
drawings of *what the service does* rather than wrong logos, which is the better failure — but they
are not the marks people recognise.

**Missing entirely — these render as a lettered square (5).** `telegram`, `twilio`, `hubspot`,
`jira`, `crunchbase`.

**What is needed:** the owner supplies the real asset (PNG or SVG) for the eleven in the second and
third groups, plus the five missing ones. **Trace them, do not approximate them** — that is the
rule the Claude logo produced, having been wrong twice by eye. The tracer used for it is radial
sampling of the alpha channel plus a rasterise-and-compare fidelity check; it works for any mark
that is star-shaped about its centre, and a general contour tracer is needed for the ones that are
not (Brave's lion, Shopify's bag).

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

**Done (v1.66.0):** the **Krew → Coder plan handoff**, and it does not switch modules on its own.

**Done (v1.68.0):** Coder's chat obeys the title-bar AI menu like every other screen
(`useAiSourceSync`) — it previously kept a connection state nothing could write.

#### "Parity with VS Code" is not a task, and treating it as one is why it has not moved

It has sat at 🟡 through eight releases because it is written as an unbounded comparison to a
product with a thousand engineer-years in it. **We are never going to match VS Code and we do not
need to** — the person this app is for does not use VS Code. Coder exists so an agent's work is
*visible and editable*, not so a professional developer switches editors.

So it is scoped below into things that can each be finished, in the order they are worth doing.
Today: Monaco, a file tree, a terminal, quick-open, the Krew handoff.

| # | Item | Status | Why it earns its place | Size |
|---|---|---|---|---|
| C1 | **Tabs for open files** | ✅ **already built** | The single biggest gap. One file at a time makes "check what the agent changed across three files" impossible, which is the main thing anyone does here. | S |
| C2 | **Search across files** | ✅ **already built** | Second biggest. Monaco has find-in-file; there is no find-in-project, so a rename cannot be checked. | M |
| C3 | **Git status in the tree + a diff view** | ✅ **done (1.69.0)** | **The one that matters most for an agent editor.** The question is always "what did it change?" — and today that is unanswerable inside the app. Arguably belongs above C2. | M |
| C4 | **Command palette** | ❌ | Monaco already ships one; it is mostly switching it on and feeding it our commands. | S |
| C5 | **Problems panel** | ❌ | Needs a language server to be worth anything. Without one it lists nothing. | L |
| C6 | **Breadcrumbs, split view** | ❌ | Comfort. Real, but nobody buys the product for them. | M |
| — | Monaco, file tree, terminal, quick-open | ✅ | The editor itself works | — |
| — | Krew → Coder plan handoff | ✅ | 1.66.0; never switches modules on its own | — |
| — | Obeys the title-bar AI menu | ✅ | 1.68.0, via `useAiSourceSync` | — |

**C1, C2 and C3 are all done** — C1 and C2 turned out to already be built, and C3 shipped in 1.69.0.
That is the set that answers *"what did the agent do to my project"*, which is the only reason this
module exists. **What is left is comfort, not capability:** C4 is a small win, C6 is polish, and C5
needs a language server and should not be started before the licence work.

**Embedding VS Code itself is not an option** — it is an Electron app, not a component. But
`monaco-editor` already carries far more than is switched on, and most of the remaining gap is
chrome around it rather than the editor.

#### Still true, and still the rule

**It must never switch modules on its own.** Being thrown into an editor mid-conversation is exactly
the "do not shift the user off what they are working on" rule, applied to adris itself.

#### What shipped in 1.69.0 — and what was already there

**C1 and C2 were already built.** The tab bar (active state, close button, middle-click, Ctrl+W) and
project-wide search (`search_in_files` in Rust, wired to QuickOpen with a debounce) have both been
in the tree for releases. **The roadmap was stale, not the code** — the same as F3.1. Reading before
planning is the cheap half of this job, and it has now paid twice in one session.

**C3 was genuinely missing, and it is the one that matters.** There was no git anywhere in the Rust —
zero occurrences. So the question Coder exists to answer, *what did the agent change*, could only be
answered by leaving the app and opening a terminal.

| Piece | Note |
|---|---|
| `git_status` | `--porcelain=v1 -z`. **The `-z` is not optional**: without it git QUOTES any path containing a space or a non-ASCII character, and this project's own path has spaces in it. Paths are converted to absolute in Rust, so exactly one place knows that git speaks repo-relative and the tree speaks absolute |
| `git_diff_file` | Three cases, and conflating them makes the view lie: a normal diff; a **staged-only** file whose `git diff` is empty and needs `--cached`; and an **untracked** file that has no diff at all, where showing "no changes" for a file the agent just created would be the exact opposite of the truth |
| Not-a-repo / no-git | **Answers, not errors.** The user can act on one and not the other, so they are never collapsed together |
| The tree | A letter per file in the colours developers already read, and a **dot on any folder containing a change** — without it a change three levels down is invisible until you happen to expand the right branch, which for files an *agent* chose is most of the time |
| The diff view | Read-only unified, in the editor pane. Side-by-side would halve a pane already sharing the window with a tree, a chat and a terminal — and the question is "what changed", not "let me merge this by hand" |

**The failure this was written to avoid, and the reason for 39 assertions.** Git returns absolute
forward-slash paths; `list_dir` returns absolute Windows backslash paths; Windows ignores case.
Compare those three as they come and **the tree lights up nothing at all while every file is
genuinely modified** — a failure that is indistinguishable from "no changes", which is the most
misleading possible output for a feature whose entire job is showing changes. Every path on both
sides goes through `normPath` first.

**A second one, caught by a test rather than by eye:** `+++ b/file` and `--- a/file` begin with
`+` and `-`, so checking the content markers before the file headers paints two header lines as a
real addition and a real deletion in **every** diff — and the +/− counts are then wrong by one each,
forever. Verified against this repo's own `git diff`: `+63 −5`, headers grey.

**Still not built:** C4 (a general command palette — QuickOpen is files + search, not commands),
C5 (problems panel, needs a language server), C6 (breadcrumbs, split view).

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

### What the title-bar menu already assumes about it

The menu is built for pay-per-use and says so — *pay per use* is the cost line on the adris.tech
row, sitting beside *included in your subscription*, *billed by NVIDIA* and *free*. **That is the
whole commercial argument on one screen**: the user can see that the cheapest option is the one
they already own, and choose it.

Two things follow, and neither is built yet:

- **Only the adris.tech row should ever meter.** Every other source — a CLI subscription, an own
  key, a local model — costs adris nothing and must be charged nothing. `chatConnectionFor` already
  encodes this: the bridge maps to `own_key`, never `nivara`, precisely so it cannot touch the
  allowance. Usage billing must be built on the same distinction rather than on a second one.
- **The plan badge in the title bar** (Free / Solo / Builder / Team) is a subscription artefact
  sitting inches from a menu that says "pay per use". Under usage billing it should show *balance*
  or come out. It is the most visible contradiction of the two.

**Still deferred at the owner's instruction.** Nothing in 1.68.0 meters, prices, or charges.

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
