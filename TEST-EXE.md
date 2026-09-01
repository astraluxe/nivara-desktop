# TEST-EXE — what to check in the built app

The build already proves a lot on its own: **35 unit suites (1,500+ assertions)**, **19 build
checks**, and browser suites that drive the real panels, real Office and real PowerPoint. None of
that can prove the app is *good to use* — that needs a person, on a real machine, with real work.

This is that list. Work down it, mark each row, and anything not **Pass** tells us exactly where to
look. **Please put the version you tested at the top of your notes** — a fault fixed in 1.83 is
still there in 1.82, and knowing which build you were on saves a wrong diagnosis.

Legend: **Pass** · **Fail** (describe what happened) · **Odd** (works, but wrong somehow) · **N/A**

---

## 0. First things — do these before anything else

| # | Test | What should happen | Result |
|---|------|--------------------|--------|
| 0.1 | Install over an existing adris | No abort/retry/ignore box about `exo-node.exe`. Installs straight through | |
| 0.2 | Settings → About / Updates | Shows the version you just installed, not an older one | |
| 0.3 | Settings → What's new | Describes **this** version, and the entries match what you actually see | |
| 0.4 | Sign in | Your plan is correct, and your name is right | |
| 0.5 | Close from the tray, then check Task Manager | No `exo-node.exe` left running | |

---

## 1. Presentations — heaviest changes in 1.82–1.83

| # | Test | What should happen | Result |
|---|------|--------------------|--------|
| 1.1 | Attach a Word document with figures, ask for a PPT | Setup card appears; **"Decide for me"** is already selected | |
| 1.2 | Leave it on "Decide for me" and generate | Picks a sensible length from your document; status says roughly how many | |
| 1.3 | The finished deck in chat | Varied layouts — not 15 identical bullet slides | |
| 1.4 | **The last slide** | The deck **ends**: a recap, then a closing slide. Never stops mid-topic | |
| 1.5 | The slide count you were told vs what you got | They match, or it says why they differ | |
| 1.6 | Your document's pictures | On the slides, not missing | |
| 1.7 | Choose **Microsoft PowerPoint** as the destination | Opens in real PowerPoint. No "repair" dialog | |
| 1.8 | **Compare chat vs PowerPoint side by side** | Same slides, same content, same order. Nothing present in one and missing in the other | |
| 1.9 | Any chart slide, in PowerPoint | A real chart you can click and edit — not a flat picture, not an empty slide | |
| 1.10 | Any pricing / timeline / team / comparison slide, in PowerPoint | Carries its content. **These were empty before 1.82** | |
| 1.11 | Text on a slide with a long heading | Fits the slide. Nothing runs off the edge or is cut off | |
| 1.12 | Search the deck for a long dash ( — ) | None anywhere | |
| 1.13 | In PowerPoint: **File → Info → Properties** | Author is **you** (or blank). Never "adris.tech", never "PptxGenJS Presentation" | |
| 1.14 | Any section divider slide | Numbered (01 / 04). Never the word "SECTION" | |
| 1.15 | Set the slide count manually to 20 | Honoured; the dial goes past 24 | |
| 1.16 | Tick "Follow my outline & slide count exactly" | "Decide for me" switches off; your number is used | |
| 1.17 | Ask in chat to change the deck ("make it navy", "remove slide 4") | Applies to the deck already there | |

### 1b. The one I could not reproduce — please watch for this

| # | Test | What should happen | Result |
|---|------|--------------------|--------|
| 1.18 | Make a deck, go to **another chat**, come back to the deck chat | The deck is still there and the app stays responsive | |
| 1.19 | Close the app entirely, reopen, open the deck chat | Deck still there. **Everything still clickable** | |
| 1.20 | If it *does* go blank or freeze | **Tell me the version and what you did just before.** If a message appears saying the deck could not be saved, copy it out — that message is new, and it names the reason | |

---

## 2. Research and links — the IAN failures

| # | Test | What should happen | Result |
|---|------|--------------------|--------|
| 2.1 | Paste a URL and ask it to research that page | It reports on **your** URL. If it follows a link elsewhere it says so | |
| 2.2 | Watch for "I cannot browse the internet" / "my knowledge cutoff" | Should **never** stand as the answer. It goes back and does the work | |
| 2.3 | Watch for a failure blamed on a site you never named | Should not happen; if it does, a line underneath names the real site | |
| 2.4 | Ask for a figure that genuinely is not published | "The page loaded and does not publish that" is the **right** answer. "The page would not load" is not | |
| 2.5 | A long research task | Something always comes back in chat. Never silence | |

---

## 3. The AI source — "run on what I chose"

| # | Test | What should happen | Result |
|---|------|--------------------|--------|
| 3.1 | Title-bar menu → pick **your own key** | Chat answers on that key | |
| 3.2 | Pick **Local model** | Answers locally; works with Wi-Fi off | |
| 3.3 | Pick **Your Claude Code / Codex** | Runs on the subscription. Never asks for an API key | |
| 3.4 | Pick **adris.tech** | Usage moves in Account | |
| 3.5 | Turn Wi-Fi off with your own key selected | Stays on your key. Must **not** silently switch to adris.tech | |
| 3.6 | Disconnect the key in Connect Apps, then send a message | A message says it fell back and why. Never silent | |
| 3.7 | The title bar vs what actually answered | Always agree | |
| 3.8 | Change the source, then use Coder / an automation / the Quick Bar | All follow the same choice | |

---

## 4. The Info page — must match the app

| # | Test | What should happen | Result |
|---|------|--------------------|--------|
| 4.1 | Info → "Choosing what the app runs on" | Describes the **title-bar menu**. No mention of a "connection bar" | |
| 4.2 | Every AI source it lists | All six are really in the menu | |
| 4.3 | Pick any slash command it documents and type it | Exists and runs | |
| 4.4 | Any module it tells you to open | Opens | |
| 4.5 | Anything it describes that you cannot find | **Write it down** — that is the failure this section is for | |

---

## 5. Office files and the right rail

| # | Test | What should happen | Result |
|---|------|--------------------|--------|
| 5.1 | Right rail → Word | Real Word opens. If it cannot, it says why | |
| 5.2 | Right rail → Excel, PowerPoint | Same | |
| 5.3 | Ask for a spreadsheet | A real .xlsx that Excel opens without complaint | |
| 5.4 | Ask for a document | A real .docx | |
| 5.5 | Ask for a PDF | Opens, and the layout is right | |
| 5.6 | Ask for a file when Office is **not** installed | Falls back to building it in chat. Never "I cannot create files" | |

---

## 6. Everything else that must not have broken

| # | Test | What should happen | Result |
|---|------|--------------------|--------|
| 6.1 | Krew chat, ordinary question | Answers; quick-reply buttons appear underneath | |
| 6.2 | `/leads`, `/scan`, `/outreach` | Run as before | |
| 6.3 | Outreach Copilot | Opens, drafts, "Copy & open chat" works | |
| 6.4 | Brain — save a note, a file, a picture | All land; no duplicate images | |
| 6.5 | Coder — open a folder, edit, see git status | Works | |
| 6.6 | Automations — build one and run it | Runs | |
| 6.7 | Guard, Vault, Mesh, Models, Studio | Each opens and does its main job | |
| 6.8 | Quick Bar | Opens, shares your theme and login | |
| 6.9 | Account | Allowance, plan and reset date are right for your plan | |
| 6.10 | Head dashboard (owner only) | Loads; pilot requests visible | |

---

## 7. Pricing and plan — the app must match the website

| # | Test | What should happen | Result |
|---|------|--------------------|--------|
| 7.1 | Your plan in the app vs adris.tech/pricing | Same name, same limits | |
| 7.2 | Account limits vs what the page sells | App never enforces **less** than was sold | |
| 7.3 | Priority support (Growth and above) | Shows founder@adris.tech with your plan in the subject | |
| 7.4 | Website → Manage plan | Opens the panel | |
| 7.5 | Anything the page claims that the app does not do | **Write it down** | |


---

## 8. Options, the title bar, and figures — new in 1.85.0

| # | Test | What should happen | Result |
|---|------|--------------------|--------|
| 8.1 | Ask something that makes an agent offer you options at the end | A card appears with two to four choices | |
| 8.2 | Tap one and confirm | **A real answer arrives in the conversation.** Not your own words echoed inside the card, not nothing | |
| 8.3 | Look at what was sent | Your message appears in the thread as if you had typed it | |
| 8.4 | If an answer ever ends in brackets and quotes | Should not happen — a half-written options block is now stripped. If you see one, copy it out | |
| 8.5 | Launch the app and look at the title bar **immediately** | Names the source you actually chose. Never "Connect your own key" when you have one connected | |
| 8.6 | The title bar on your own key | Shows the key **and** the model beside it (e.g. "Your NVIDIA key · llama-3.3-70b-instruct") | |
| 8.7 | Compare the title bar with what actually answers | Always the same. If they differ, say which was which | |
| 8.8 | Attach a document with diagrams, ask about one | The diagram is **shown in the reply**, with a caption saying what to look at | |
| 8.9 | Attach several documents that each have a "figure 3", then ask | It either shows the right one or shows none. **Never the wrong diagram** — that is the failure to report | |
| 8.10 | An ordinary answer with no attachments | No stray image frames, no change to how text renders | |
---

## How to report a failure

One line is enough, but these four things make it fixable:

1. **Version** — Settings → About.
2. **What you did**, in order.
3. **What happened** vs what you expected.
4. **Anything on screen** — copy the exact wording of any error.

If the app freezes: say whether it was **blank**, or showed content but ignored clicks, and whether
restarting cleared it. Those are different faults with different causes, and the distinction is
genuinely the most useful thing you can tell me.

---

## Known and not fixed

Being straight about what is still open, so nothing here is a surprise:

| Item | Status |
|------|--------|
| The blank/frozen deck chat | A fault that produces exactly those symptoms is fixed in **1.84.0** (a single internal error could permanently jam the app until restart). It could **not be reproduced here**, so it is not confirmed as *the* cause. Row 1.20 exists for this |
| A saved deck is stored twice over | ~6.7 MB per deck, every picture held twice. Wasteful; measurement did not show it as the cause of the freeze, so it was left rather than rewritten on a hunch |
| The stray "404" on a research task | The URL returns 200. Where the 404 came from is still unknown |
| Self-serve checkout | Not built. Payments are deliberately locked |
| Starter tier + Razorpay | Starter has no Razorpay plan key — **must be fixed before checkout opens**, or a Starter payment grants nothing |
| Single sign-on | Not built, and removed from the pricing page for that reason |
