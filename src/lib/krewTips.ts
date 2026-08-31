// ─── What the empty chat says ────────────────────────────────────────────────
//
// WHAT THIS REPLACES. One line, the same every time: "No apps connected. Link Gmail, GitHub, Notion
// & more for real actions." A nag rather than an invitation, shown to someone who has just opened
// the product and does not yet know what it can do — and shown identically on the hundredth launch
// as on the first.
//
// The blank chat is the most valuable teaching surface in the app and it was spending that surface
// on one sentence. This is 150+ specific, true things the user can act on now.
//
// ── THE RULES THESE ARE WRITTEN TO ───────────────────────────────────────────
//
// 1. HARDCODED, never generated. No model call, so it is instant, works offline, costs nothing —
//    and every line can be checked for truth before it ships. A tip describing a feature that does
//    not exist is the app lying to the user in its calmest voice.
// 2. ONE thing, and what it gets you. Not "adris is powerful" — "Type /scan on a LinkedIn page and
//    adris reads your connections into a list you can write to."
// 3. Never advertise what they already have. Someone with nine apps connected must not be told to
//    connect apps; that is the nag this replaces, wearing a different hat.
// 4. Readable in three seconds. It sits above a text box, not on a help page.
// 5. If it names an action, the action is one click away.
//
// ── THE FILE MOST LIKELY TO ROT ──────────────────────────────────────────────
//
// Every `cmd` here must exist in SLASH_COMMANDS and every `nav` must be a real module.
// `scripts/check-tips.mjs` enforces exactly that on every build, because a tip promising a command
// that was renamed six months ago is worse than no tip at all — and nothing else would catch it.

/** When a tip is worth showing. Anything not listed is always eligible. */
export type TipWhen =
  | 'always'
  | 'no-apps'      // nothing connected yet
  | 'has-apps'     // at least one app connected
  | 'no-key'       // no BYOK model key
  | 'no-cli'       // neither Claude Code nor Codex installed
  | 'has-cli'      // one of them is
  | 'no-local';    // no local model downloaded

export interface Tip {
  /** Stable id — used to remember what has already been shown. Never reuse one. */
  id: string;
  text: string;
  /** A slash command to run. Must exist in SLASH_COMMANDS. */
  cmd?: string;
  /** A module to open. Must be a real module. */
  nav?: string;
  when?: TipWhen;
}

export const TIPS: Tip[] = [
  // ── Getting work out of it on day one ──────────────────────────────────────
  { id: 'leads-guided', text: 'Type /leads to be walked through finding customers — pick the city, the size and the seniority, and get a checked list back.', cmd: 'leads' },
  { id: 'scan-warm', text: 'Already on LinkedIn? /scan reads the people you are connected to into a list you can write to. Warm leads beat cold ones.', cmd: 'scan' },
  { id: 'outreach-copilot', text: '/outreach drafts a different message for every person on your list, then walks you through sending them one at a time.', cmd: 'outreach' },
  { id: 'verify-links', text: 'A lead list full of guessed links is worse than a short true one. /verify opens every LinkedIn and checks it.', cmd: 'verify' },
  { id: 'enrich-gaps', text: '/enrich fills in the missing phone, email and LinkedIn for people you already have — in one pass.', cmd: 'enrich' },
  { id: 'continue-outreach', text: 'Stopped halfway through a campaign? /continue reopens it exactly where you left off.', cmd: 'continue' },
  { id: 'refine-msgs', text: 'Messages sound too generic? /refine rewrites them — tell it how you want to sound and it applies that to all of them.', cmd: 'refine' },
  { id: 'verifylinks-fix', text: '/verifylinks checks every profile link you have saved and repairs the wrong ones.', cmd: 'verifylinks' },
  { id: 'draft-both', text: '/draft writes both a LinkedIn message and a short email for your list, tailored by what each company does.', cmd: 'draft' },
  { id: 'email-list', text: '/email sends a genuinely personalised email to everyone on a list — one each, not a mail-merge — and tells you who it went to.', cmd: 'email' },

  // ── Office, the thing people do not expect ─────────────────────────────────
  { id: 'office-word', text: 'Ask for a proposal in Word and you get a real .docx, opened on your screen — not a chat message you have to copy out.' },
  { id: 'office-excel', text: 'adris drives real Excel. Ask it to build the sheet and it opens, fills and saves it while you watch.' },
  { id: 'office-ppt', text: 'Ask for a presentation and you get a real slide deck you can open, edit and send.' },
  { id: 'office-read', text: 'Attach a spreadsheet and ask a question about it. adris reads the actual rows, not a summary of them.' },
  { id: 'office-branded', text: 'Documents come out with your own branding once you have told adris what your business is.' },
  { id: 'deck-make', text: '/deck builds a presentation you can edit in the app and export when it is right.', cmd: 'deck' },

  // ── The bridge: the cheapest way to run this ───────────────────────────────
  { id: 'bridge-what', text: 'Already pay for Claude or ChatGPT? Plug that subscription in and adris runs on it — you are charged nothing here.', when: 'no-cli' },
  { id: 'bridge-install', text: 'adris can install Claude Code or Codex for you — no terminal, nothing added to your system. Open the menu at the top of the window.', when: 'no-cli' },
  { id: 'bridge-cheap', text: 'A Codex subscription is about ₹400 a month. That is a full month of agent work for less than adris could ever sell you.', when: 'no-cli' },
  { id: 'bridge-usage', text: 'Running on your own subscription? The menu at the top shows how much of it you have used this week.', when: 'has-cli' },
  { id: 'bridge-sub-only', text: 'adris only ever signs your bridge in with your subscription, never an API key — and refuses to run if it detects one.', when: 'has-cli' },
  { id: 'bridge-both', text: 'Claude Code and Codex both work. Pick whichever you already pay for from the menu at the top of the window.' },

  // ── Where the AI runs ──────────────────────────────────────────────────────
  { id: 'source-one', text: 'The menu at the top of the window decides where AI runs — for the chat, Guard, automations and everything else. One setting, not five.' },
  { id: 'key-free', text: 'NVIDIA and Groq give away API keys for free. Connect one and adris costs you nothing to run.', when: 'no-key', nav: 'connect' },
  { id: 'key-choose-model', text: 'Connected a key? The menu at the top lists the models it can actually call, with how fast each one answered when tested.' },
  { id: 'local-offline', text: 'Download a local model and adris works with no internet at all — nothing leaves your computer.', when: 'no-local', nav: 'models' },
  { id: 'local-free', text: 'A local model costs nothing per message, forever. It is slower, and for a lot of work that does not matter.', when: 'no-local', nav: 'models' },
  { id: 'local-pick', text: 'More than one model downloaded? Choose which one answers from the menu at the top of the window.' },
  { id: 'models-page', text: 'The Models page shows what is downloaded, how big each one is, and what your machine can comfortably run.', nav: 'models' },

  // ── Connect Apps ───────────────────────────────────────────────────────────
  { id: 'connect-first', text: 'Connect Gmail and adris can read the emails that need a reply and draft them for you.', when: 'no-apps', nav: 'connect' },
  { id: 'connect-notion', text: 'Connect Notion and adris can read and write your pages directly.', nav: 'connect' },
  { id: 'connect-slack', text: 'Connect Slack and adris can post updates to your channels itself.', nav: 'connect' },
  { id: 'connect-github', text: 'Connect GitHub and adris can read issues, open pull requests and check what changed.', nav: 'connect' },
  { id: 'connect-linear', text: 'Connect Linear and adris can file and update issues without you leaving the chat.', nav: 'connect' },
  { id: 'connect-airtable', text: 'Connect Airtable and your bases become something adris can read and fill.', nav: 'connect' },
  { id: 'connect-linkedin', text: 'Connect LinkedIn and adris can read your connections, check messages and draft replies.', nav: 'connect' },
  { id: 'connect-stripe', text: 'Connect Stripe and you can ask adris about payments and customers in plain English.', nav: 'connect' },
  { id: 'connect-mcp', text: '/mcp connects any MCP server by URL — its tools become things adris can use.', cmd: 'mcp' },
  { id: 'connect-inbox', text: '/inbox summarises the Gmail that actually needs a reply, and ignores the rest.', cmd: 'inbox', when: 'has-apps' },
  { id: 'connect-many', text: 'Every app you connect becomes a thing the agents can genuinely do, not just talk about.', nav: 'connect' },

  // ── The Brain ──────────────────────────────────────────────────────────────
  { id: 'brain-what', text: 'The Brain is what adris remembers about your business. The more it knows, the less you have to re-explain.', nav: 'brain' },
  { id: 'brain-attach', text: 'Attach a file to a message and adris keeps it in the Brain, so you never have to attach it twice.' },
  { id: 'brain-pick', text: 'The Brain button beside the message box pulls anything you have saved straight into the conversation.' },
  { id: 'brain-linked', text: 'Notes in the Brain link to each other, so pulling in one brings the connected context with it.', nav: 'brain' },
  { id: 'brain-search', text: 'The Brain is searchable. Ask it what you saved about a customer six weeks ago.', nav: 'brain' },
  { id: 'brain-skills', text: '/skills shows what adris has taught itself to do from watching your work.', cmd: 'skills' },
  { id: 'brain-images', text: 'Pictures you generate or paste are saved in the Brain, so a deck can reuse your real logo.', nav: 'brain' },

  // ── Agents and the team ────────────────────────────────────────────────────
  { id: 'agents-browse', text: '/agents lets you switch to a specialist — a bookkeeper, a researcher, a contract checker.', cmd: 'agents' },
  { id: 'agents-boss', text: 'Arjun is the chief of staff. Give him the whole job and he hands the pieces to the right specialists.' },
  { id: 'agents-parallel', text: 'A job that needs three specialists runs all three at once, not one after another.' },
  { id: 'agents-midtask', text: 'You can add an instruction while agents are working. It gets folded in at the next step rather than restarting.' },
  { id: 'agents-council', text: '/council brings five advisers who argue a decision out using what they know about your business.', cmd: 'council' },
  { id: 'agents-handover', text: '/handover opens a task\'s work order so you can edit it before the team runs it.', cmd: 'handover' },
  { id: 'agents-specialist', text: 'There is a specialist for most of it — outreach, invoices, contracts, support replies, reports.', cmd: 'agents' },

  // ── Plan and Office (the module) ───────────────────────────────────────────
  { id: 'plan-open', text: '/plan opens your month day by day, so the work has an order instead of a pile.', cmd: 'plan' },
  { id: 'plan-new', text: 'No plan yet? /newplan has an agent ask about your business and write one you can actually work through.', cmd: 'newplan' },
  { id: 'plan-today', text: 'The Office page shows what today looks like, and what the agents did while you were away.' },

  // ── Automations ────────────────────────────────────────────────────────────
  { id: 'auto-build', text: '/automate turns "every Monday, email me last week\'s numbers" into something that actually runs.', cmd: 'automate' },
  { id: 'auto-visual', text: 'The automation builder draws the flow, so you can see what runs when — and change it.', nav: 'automation' },
  { id: 'auto-schedule', text: 'Automations run on a schedule whether the app is in front of you or not.', nav: 'automation' },
  { id: 'auto-branch', text: 'Automations can branch and loop — "for each row, if the deal is over ₹50,000, do this".', nav: 'automation' },

  // ── Guard, Vault, Mesh ─────────────────────────────────────────────────────
  { id: 'guard-contract', text: 'Guard reads a contract and tells you what is unusual in it, in plain English.', nav: 'guard' },
  { id: 'guard-scan', text: 'Guard checks your machine and your setup for the things that commonly go wrong.', nav: 'guard' },
  { id: 'vault-dns', text: 'Vault changes how your computer resolves addresses, to block a category of tracking at the source.', nav: 'vault' },
  { id: 'mesh-what', text: 'Mesh pools spare memory across machines you own, for work one of them could not do alone.', nav: 'mesh' },

  // ── Coder ──────────────────────────────────────────────────────────────────
  { id: 'coder-open', text: '/coder opens a real editor, so you can see and change what an agent wrote.', cmd: 'coder' },
  { id: 'coder-handoff', text: 'A plan made in the chat can be handed to Coder and built there — it never switches you over on its own.' },
  { id: 'coder-terminal', text: 'Coder has a real terminal. Commands an agent suggests can be run and watched.', nav: 'coder' },

  // ── Studio and the free tools ──────────────────────────────────────────────
  { id: 'studio-open', text: '/studio opens the good free tools for marketing work in one place.', cmd: 'studio' },
  { id: 'studio-image', text: '/image makes a logo, a graphic or an illustration without leaving the chat.', cmd: 'image' },
  { id: 'studio-post', text: '/post drafts a LinkedIn or X post about anything you have been working on.', cmd: 'post' },

  // ── Research ───────────────────────────────────────────────────────────────
  { id: 'research-deep', text: '/research opens a workspace for the long questions — competitors, a market, a person.', cmd: 'research' },
  { id: 'research-advanced', text: 'Switch the composer to Advanced and adris opens a real browser you can watch, and drops anything it cannot confirm.' },
  { id: 'research-fast', text: 'Fast mode is right for most questions. Save Advanced for when the answer has to be exactly right.' },
  { id: 'summarize-file', text: '/summarize pulls the key points out of anything you have saved.', cmd: 'summarize' },

  // ── The chat itself ────────────────────────────────────────────────────────
  { id: 'chat-slash', text: 'Type / in the message box to see everything adris can do, without remembering any of it.' },
  { id: 'chat-paste', text: 'Paste a screenshot straight into the message box. adris reads it.' },
  { id: 'chat-expand', text: 'Writing something long? The expand button makes the message box tall enough to read.' },
  { id: 'chat-mic', text: 'The microphone types for you. Useful when the thought is longer than your patience for typing.' },
  { id: 'chat-attach', text: 'Attach a spreadsheet, a PDF or a document and ask about what is inside it.' },
  { id: 'chat-stop', text: 'Stop works properly. A task you stop does not quietly finish in the background.' },
  { id: 'chat-quickbar', text: 'There is a small always-on-top chat you can leave open beside your other work.' },
  { id: 'chat-reply', text: '/reply drafts an answer to anything you paste in — an email, a message, a review.', cmd: 'reply' },
  { id: 'chat-linkedin-msgs', text: '/linkedin reads your LinkedIn messages and drafts answers. It never sends on its own.', cmd: 'linkedin' },
  { id: 'chat-manual', text: '/manual is the whole guide, ordered around the work you actually do.', cmd: 'manual' },

  // ── Honesty and control, which is the product's actual argument ────────────
  { id: 'trust-local', text: 'Your files, your mailbox and your customer list stay on this computer. adris.tech never receives them.' },
  { id: 'trust-nosend', text: 'adris never sends an email or a message without showing it to you first.' },
  { id: 'trust-limits', text: 'Limits about your own mailbox and your own list are yours to set. adris suggests a safe default and explains why.' },
  { id: 'trust-cost', text: 'The menu at the top always says what the current setup costs you — included, free, or pay per use.' },
  { id: 'trust-offline', text: 'On a local model adris works completely offline — internet unplugged, nothing sent anywhere.' },

  // ── Small things people are pleased to find ────────────────────────────────
  { id: 'small-theme', text: 'There is a light theme. The sun icon in the sidebar switches it.' },
  { id: 'small-conversations', text: 'Every conversation is saved and searchable. Nothing is lost when you close the app.' },
  { id: 'small-todo', text: 'Tasks adris starts appear in the to-do panel, so a long job is something you can walk away from.' },
  { id: 'small-resume', text: 'Close the app mid-task and the work is still there when you come back.' },
  { id: 'small-repair', text: 'A saved table gone wrong? /repair-table fixes the rows without you retyping them.', cmd: 'repair-table' },
  { id: 'small-settings', text: 'Settings has the things worth changing and not much else.', nav: 'settings' },
  { id: 'small-autopilot', text: '/autopilot lets adris explore a site it has not seen before and learn how to use it.', cmd: 'autopilot' },

  // ── Ways of working that get more out of it ────────────────────────────────
  { id: 'howto-specific', text: 'Say what you want, not how to do it. "Find me 20 logistics companies in Pune" beats a list of steps.' },
  { id: 'howto-context', text: 'Tell adris about your business once. Every agent uses it from then on.' },
  { id: 'howto-attach-first', text: 'Attach the file before you ask. The answer is better when it can see the real data.' },
  { id: 'howto-fewer', text: 'Asking for 10 good leads works better than asking for 100. You can always ask again.' },
  { id: 'howto-sector', text: 'Naming a sector makes lead searches far more accurate than "anyone who might need us".' },
  { id: 'howto-review', text: 'Read the first draft before letting a campaign run. It is the cheapest quality check there is.' },
  { id: 'howto-name-file', text: 'Ask for the output as a document and you get a file you can send, instead of text you have to reformat.' },
  { id: 'howto-followup', text: 'Reply "make it shorter" or "more formal" and adris rewrites it. You are not stuck with the first answer.' },
  { id: 'howto-ask-why', text: 'Ask an agent why it did something. It can explain its reasoning, not just show the result.' },
  { id: 'howto-council-hard', text: 'Stuck on a decision rather than a task? That is what /council is for.', cmd: 'council' },

  // ── More of the work people actually bring ─────────────────────────────────
  { id: 'work-invoice', text: 'Ask adris to chase unpaid invoices. It drafts the reminder and tells you who it is going to.' },
  { id: 'work-quote', text: 'Ask for a quote or an estimate and you get a document you can send, with your own numbers in it.' },
  { id: 'work-minutes', text: 'Paste meeting notes and ask for the actions. You get a list with owners, not a summary.' },
  { id: 'work-jobspec', text: 'Hiring? Ask for a job description for the role and adris writes one you can post.' },
  { id: 'work-competitor', text: 'Ask what a competitor has been doing lately. adris looks and reports what it can confirm.' },
  { id: 'work-pricing', text: 'Ask the council whether to raise your prices. Five advisers argue it using what they know about you.', cmd: 'council' },
  { id: 'work-translate', text: 'Ask for anything in another language. There is a specialist for translation.' },
  { id: 'work-support', text: 'Paste an angry customer email. adris drafts a calm reply you can edit before sending.' },
  { id: 'work-review', text: 'Bad review? Ask for a reply that answers it without sounding defensive.' },
  { id: 'work-report', text: 'Ask for last week as a report and you get a document, not a wall of chat.' },
  { id: 'work-cleanlist', text: 'Give adris a messy spreadsheet of contacts and ask it to clean and de-duplicate it.' },
  { id: 'work-followup', text: 'Ask who has not replied yet and adris checks the campaign rather than guessing.' },
  { id: 'work-caption', text: 'Ask for captions for a set of photos and you get one per photo, not one for all of them.' },
  { id: 'work-thumbnail', text: 'There is a specialist for thumbnails and one for images. /agents shows the whole team.', cmd: 'agents' },
  { id: 'work-legal', text: 'There is an agent for contracts and one for legal drafting. Neither replaces a lawyer, and both save the first hour.' },

  // ── Outreach, in more detail ───────────────────────────────────────────────
  { id: 'out-oneeach', text: 'Outreach writes a different message per person. If two look identical, tell it and it rewrites them.' },
  { id: 'out-proof', text: 'A contact is only marked as sent once the send is actually confirmed. Never on hope.' },
  { id: 'out-cap', text: 'The daily send limit is yours to set. adris suggests a safe number and tells you why.' },
  { id: 'out-reply', text: 'Mark someone as replied and adris reads the thread and suggests what to say next.' },
  { id: 'out-multi', text: 'Running more than one campaign? Each keeps its own list, purpose and progress.' },
  { id: 'out-mailbox', text: 'Outreach can send from your own work mailbox, so replies come back to you, not to us.' },
  { id: 'out-linkedin-open', text: 'Copy a message and adris opens that person\'s LinkedIn chat, ready to paste.' },

  // ── Files and documents ────────────────────────────────────────────────────
  { id: 'file-pdf', text: 'Attach a PDF and ask what is in it. Contracts, invoices, reports — it reads the real file.' },
  { id: 'file-many', text: 'Attach several files at once and ask a question that spans all of them.' },
  { id: 'file-excel-write', text: 'Ask adris to add a column and work out the totals. It edits the real spreadsheet.' },
  { id: 'file-brand', text: 'Tell adris your colours and logo once and documents come out looking like yours.' },
  { id: 'file-export', text: 'Anything adris makes can be saved as a real file — Word, Excel, PowerPoint or PDF.' },

  // ── Setup that pays off ────────────────────────────────────────────────────
  { id: 'setup-tellabout', text: 'Spend two minutes telling adris what your business does. Every answer after that gets better.' },
  { id: 'setup-city', text: 'Tell adris where you are. Lead searches stop returning companies on the wrong continent.' },
  { id: 'setup-scale', text: 'Say how big your business is. It stops suggesting enterprise tactics to a two-person shop.' },
  { id: 'setup-brain-first', text: 'Put your pricing, your services and your best case study in the Brain. Then never explain them again.', nav: 'brain' },
  { id: 'setup-mailbox', text: 'Connect your work mailbox once and outreach can send from it, with replies coming to you.', nav: 'connect' },

  // ── When something goes wrong ──────────────────────────────────────────────
  { id: 'fix-slow', text: 'A local model taking a minute to answer is normal. It is loading itself into memory first.' },
  { id: 'fix-model', text: 'Answers gone strange? The menu at the top shows which model is answering. Some are much better at lists than others.' },
  { id: 'fix-ratelimit', text: 'A free key that stops answering is usually rate-limited, not broken. adris waits it out and says so.' },
  { id: 'fix-network', text: 'If the connection drops mid-task adris reconnects and carries on rather than losing the work.' },
  { id: 'fix-empty', text: 'An agent that returns nothing has usually gone quiet, not failed. Send it again.' },
  { id: 'fix-toolong', text: 'A document too big for the model? Ask for it in parts. adris will tell you when that is the problem.' },
  { id: 'fix-guard', text: 'Something odd on the machine? Guard checks the usual suspects and explains what it finds.', nav: 'guard' },

  // ── Understanding what it is doing ─────────────────────────────────────────
  { id: 'see-tools', text: 'Every tool an agent uses is shown in the conversation. You can open it and see exactly what it did.' },
  { id: 'see-browser', text: 'In Advanced mode the browser is real and on your screen. You can watch it work.' },
  { id: 'see-cursor', text: 'When agents drive your software you can see where they are working on screen.' },
  { id: 'see-plan', text: 'Give the boss a big job and it shows you the plan before it starts, so you can change it.' },
  { id: 'see-who', text: 'Each reply is signed by the agent that wrote it, so you know who did what.' },
  { id: 'see-cost', text: 'The badge at the top always says whether the current setup costs you anything.' },
];

/** Everything the selector needs to know about the user's setup. */
export interface TipContext {
  appsConnected: number;
  hasModelKey: boolean;
  hasCli: boolean;
  hasLocalModel: boolean;
}

/** Is this tip worth showing to someone in this state? */
export function tipApplies(tip: Tip, ctx: TipContext): boolean {
  switch (tip.when) {
    // NEVER ADVERTISE WHAT THEY ALREADY HAVE. Telling someone with nine apps connected to connect
    // apps is the nag this whole file replaces, wearing a different hat.
    case 'no-apps':  return ctx.appsConnected === 0;
    case 'has-apps': return ctx.appsConnected > 0;
    case 'no-key':   return !ctx.hasModelKey;
    case 'no-cli':   return !ctx.hasCli;
    case 'has-cli':  return ctx.hasCli;
    case 'no-local': return !ctx.hasLocalModel;
    default:         return true;
  }
}

/**
 * Pick the next tip.
 *
 * `seen` is the ids already shown this session, so a user does not get the same line twice in a
 * row — the fastest way to make a rotating tip feel like a static one. When everything eligible has
 * been shown the list starts again rather than going blank: an empty space where a tip was is worse
 * than a repeat.
 */
export function pickTip(ctx: TipContext, seen: string[], rand = Math.random): Tip | null {
  const eligible = TIPS.filter((t) => tipApplies(t, ctx));
  if (!eligible.length) return null;
  const unseen = eligible.filter((t) => !seen.includes(t.id));
  const pool = unseen.length ? unseen : eligible;
  return pool[Math.floor(rand() * pool.length)] ?? pool[0];
}
