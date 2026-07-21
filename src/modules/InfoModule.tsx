import { useState, useEffect, useRef } from 'react';

// ─── The manual ───────────────────────────────────────────────────────────────
// Written as one continuous page rather than a stack of dropdowns: someone who has
// just installed adris.tech should be able to read this top to bottom and come away
// knowing what the app does and how to get real work out of it. Every section that
// describes a workflow carries a concrete example instead of an abstract summary.

const SECTIONS: { id: string; label: string }[] = [
  { id: 'what',       label: 'What adris.tech is' },
  { id: 'start',      label: 'Getting started' },
  { id: 'krew',       label: 'Krew — your agent team' },
  { id: 'commands',   label: 'Slash commands' },
  { id: 'autopilot',  label: 'Web Autopilot' },
  { id: 'brain',      label: 'Brain — shared memory' },
  { id: 'todo',       label: 'To-do' },
  { id: 'linkedin',   label: 'Worked example: LinkedIn outreach' },
  { id: 'models',     label: 'Models — running AI locally' },
  { id: 'coder',      label: 'Coder' },
  { id: 'studio',     label: 'Studio & decks' },
  { id: 'automation', label: 'Automations' },
  { id: 'connect',    label: 'Connect apps & MCP' },
  { id: 'vault',      label: 'Vault' },
  { id: 'mesh',       label: 'Mesh' },
  { id: 'quickbar',   label: 'Quick Bar' },
  { id: 'guard',      label: 'Guard — security watch' },
  { id: 'whatsnew',   label: 'What’s new' },
  { id: 'rules',      label: 'How things actually work' },
  { id: 'privacy',    label: 'Privacy' },
  { id: 'trouble',    label: 'When something goes wrong' },
];

/** A precise question-and-answer pair — the sort of detail that saves a support message. */
function QA({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="my-3.5 pl-3.5 border-l-2 border-nv-border">
      <p className="text-[12.5px] font-semibold text-nv-text mb-1">{q}</p>
      <div className="text-[12.5px] leading-[1.7] text-nv-muted">{children}</div>
    </div>
  );
}

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-6 text-[19px] font-semibold text-nv-text mt-11 mb-3 pb-2 border-b border-nv-border">
      {children}
    </h2>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[14px] font-semibold text-nv-text mt-6 mb-2">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-[1.75] text-nv-muted mb-3">{children}</p>;
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="text-[13px] leading-[1.75] text-nv-muted mb-1.5">{children}</li>;
}
/** Something the user literally types or clicks. */
function K({ children }: { children: React.ReactNode }) {
  return <code className="text-[12px] font-mono text-accent bg-accent/10 border border-accent/20 rounded px-1 py-[1px]">{children}</code>;
}
/** A real worked example — deliberately set apart from the prose. */
function Example({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="my-4 rounded-xl border border-nv-border bg-nv-surface/70 overflow-hidden">
      <div className="px-3.5 py-1.5 border-b border-nv-border bg-nv-surface2/50">
        <span className="text-[9px] font-mono uppercase tracking-wider text-accent">Example · {title}</span>
      </div>
      <div className="px-3.5 py-3 text-[12.5px] leading-[1.7] text-nv-muted">{children}</div>
    </div>
  );
}
/** Command reference rows — the command, what it's called, and what it actually does. */
/** A command row. The optional 4th entry is a concrete "type this" example — the fastest way for
 *  someone to understand what a command actually does is to see one real use of it. */
function CmdTable({ rows }: { rows: [string, string, string, string?][] }) {
  return (
    <div className="my-3 rounded-xl border border-nv-border overflow-hidden">
      {rows.map(([cmd, name, desc, example], i) => (
        <div
          key={cmd}
          className={`px-3.5 py-2.5 ${i % 2 ? 'bg-nv-surface/40' : ''} ${i ? 'border-t border-nv-border/70' : ''}`}
        >
          <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
            <code className="text-[12px] font-mono text-accent">{cmd}</code>
            <span className="text-[12px] font-medium text-nv-text">{name}</span>
          </div>
          <p className="text-[12px] leading-[1.65] text-nv-muted">{desc}</p>
          {example && (
            <p className="mt-1.5 text-[11.5px] leading-[1.6] text-nv-faint">
              <span className="text-nv-muted">Example: </span>
              <span className="font-mono text-nv-muted">{example}</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 border-l-2 border-accent/50 pl-3.5 py-1">
      <p className="text-[12.5px] leading-[1.7] text-nv-muted italic">{children}</p>
    </div>
  );
}

export default function InfoModule() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Highlight whichever section is being read, so the contents list doubles as a
  // progress marker on a long page.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]?.target.id) setActive(vis[0].target.id);
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  function go(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Contents — a long page needs a spine, but it stays out of the way */}
      <nav className="hidden lg:block w-56 shrink-0 border-r border-nv-border overflow-y-auto py-8 px-3">
        <p className="text-[9px] font-mono uppercase tracking-wider text-nv-faint px-2 mb-2">Contents</p>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => go(s.id)}
            className={`w-full text-left text-[11.5px] leading-snug px-2 py-1.5 rounded-md transition-fast break-words ${
              active === s.id ? 'text-accent bg-accent/10 font-medium' : 'text-nv-faint hover:text-nv-muted hover:bg-nv-surface2/50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <article className="max-w-[720px] mx-auto px-7 py-10 pb-24">
          <p className="text-[10px] font-mono uppercase tracking-wider text-accent mb-2">User manual</p>
          <h1 className="text-[30px] font-semibold text-nv-text leading-tight mb-3">How adris.tech works</h1>
          <p className="text-[14px] leading-[1.7] text-nv-muted">
            Everything the app can do, written to be read from start to finish. If you only have five
            minutes, read <button onClick={() => go('krew')} className="text-accent hover:underline">Krew</button> and the{' '}
            <button onClick={() => go('linkedin')} className="text-accent hover:underline">LinkedIn worked example</button> —
            between them they cover how most people use adris.tech day to day.
          </p>

          <H id="what">What adris.tech is</H>
          <P>
            adris.tech is a private AI office that runs on your own computer. Instead of a single
            chatbot you get a team of specialist agents — a researcher, a writer, a sales assistant, a
            coder and others — that share one memory and can use real tools: a browser, your files and
            your connected accounts.
          </P>
          <P>
            The important word is <span className="text-nv-text">private</span>. Your files, notes and saved
            lists live on this machine. When you run a local model nothing leaves the computer at all.
            When you use the hosted AI, only the text of that request is sent — your documents are not
            uploaded and nothing is used for training.
          </P>

          <H id="start">Getting started</H>
          <P>
            Sign in once with your adris.tech account. Your plan sets how much hosted AI you can use each
            month and which models you can download. Everything else works the same on every plan.
          </P>
          <H3>The connection bar</H3>
          <P>At the top of Krew is a bar that decides which brain answers you. It has three modes:</P>
          <ul className="list-disc pl-5 mb-3">
            <Li><span className="text-nv-text">adris.tech</span> — the hosted AI. Nothing to set up; counts against your monthly usage.</Li>
            <Li><span className="text-nv-text">Own key</span> — your own OpenAI, Gemini or Anthropic key. Billed by them, unlimited by us.</Li>
            <Li><span className="text-nv-text">Local</span> — a model running on your own hardware. Free, fully offline, as fast as your machine allows.</Li>
          </ul>
          <Note>
            If you ever see “monthly limit reached”, switch the bar to Own key or Local and carry on
            working. You do not have to upgrade to keep using the app.
          </Note>

          <H id="krew">Krew — your agent team</H>
          <P>
            Krew is the main screen. Type what you want in plain English and the right specialist picks
            it up: ask for competitor research and the researcher answers, ask for a LinkedIn post and
            the writer answers. Use <span className="text-nv-text">Switch</span> above the message box if you want
            to choose the agent yourself.
          </P>
          <H3>Attaching your own files</H3>
          <P>
            Drag a file into the message box, or pick one you have already saved in your Brain. The agent
            reads it before answering. This is the single biggest difference between generic output and
            something specific to your business.
          </P>
          <Example title="Attaching context">
            Attach <K>PRODUCT.md</K> — a page describing what you sell — and ask{' '}
            <span className="text-nv-text">“which of these connections would actually care about this?”</span> The
            answer references your real product instead of inventing one. Attach two Brain files together
            and adris.tech also links them in your Brain, because using them together says they belong
            together.
          </Example>
          <H3>Skills</H3>
          <P>
            The <span className="text-nv-text">Skill lib</span> button holds reusable abilities you can switch on,
            such as a house writing style or a research method. Once installed, every agent uses them
            automatically.
          </P>

          <H id="commands">Slash commands</H>
          <P>
            Type <K>/</K> in the message box to see everything available. Commands are shortcuts, not a
            separate language — you can always ask in plain words instead. Every command in the app is
            listed below, grouped by what it's for.
          </P>
          <P>
            When a command needs one of your files a picker appears. It has a search box, so it stays
            usable when you have hundreds of saved files — start typing and it narrows down.
          </P>

          <H3>Finding and preparing leads</H3>
          <CmdTable rows={[
            ['/findleads', 'Find prospects', 'Researches brand-new leads that fit what you sell — real companies from open sources, not invented names.', 'Find new prospects for my product and add them to Tech leads.md'],
            ['/scan', 'Scan LinkedIn connections', 'Opens LinkedIn and reads your existing connections, saving names, headlines and profile links to the Brain note “LinkedIn connections”. About fifty per run; later runs skip anyone already saved.', 'Scan my LinkedIn connections — then “scan the next 50” for more'],
            ['/expand', 'Add more leads', 'Grows a list you already have with additional people of the same type, instead of starting a new list.', 'Add more prospects to Tech leads.md — new people only'],
            ['/enrich', 'Fill contacts', 'Goes through a list and fills in the gaps — missing LinkedIn URLs, phone numbers and email addresses — in a single pass.', 'Fill in the missing phone and email for the people in Tech leads.md'],
            ['/verify', 'Verify LinkedIn', 'Opens every LinkedIn link in a lead list and checks it really belongs to that person. Leaves a field blank rather than guessing.', 'Go to Tech leads.md and verify each and every LinkedIn'],
          ]} />

          <H3>LinkedIn messages and outreach</H3>
          <CmdTable rows={[
            ['/linkedin', 'Check LinkedIn messages', 'Opens your LinkedIn inbox, reads each conversation in full, and drafts a reply only where something is genuinely still outstanding. Add your availability in the same sentence and it will answer proposed times against it. Nothing is ever sent for you.', 'Check my LinkedIn messages — I’m free Wednesday after 1:30 PM IST'],
            ['—', 'Send a drafted reply', 'After it drafts replies, say this to have it type that reply into the person’s LinkedIn chat box. It stops there — you read it and press Send yourself.', 'Send the reply to Kevin'],
            ['/outreach', 'Send outreach (copilot)', 'Writes a personal message for each saved connection and opens the copilot that walks you through sending them one by one. Skips anyone you have already messaged.', 'Draft outreach for my LinkedIn connections'],
            ['/continue', 'Continue outreach', 'Reopens the outreach copilot exactly where you left off, with everyone’s status intact.', '/continue'],
            ['/verifylinks', 'Fix outreach links', 'Checks every saved profile link in your outreach list and repairs the wrong or missing ones by searching LinkedIn for the right person.', 'Verify and fix the outreach links'],
            ['/draft', 'Draft outreach', 'Writes the DMs or emails for a list without opening the sending copilot — useful when you just want the text.', 'Write a LinkedIn DM and a short cold email for the people in Tech leads.md'],
            ['/email', 'Email a list', 'Sends a personalised email to everyone on a list, written individually rather than mail-merged.', 'Email everyone in Tech leads.md a personalised message'],
            ['/reply', 'Draft a reply', 'Drafts a response to a message or email you paste in.', 'Draft a reply to this: <paste the message>'],
            ['/inbox', 'Check inbox', 'Reads your Gmail and summarises what actually needs a reply.', 'Check my Gmail inbox and summarise what needs a reply'],
          ]} />

          <H3>Making things</H3>
          <CmdTable rows={[
            ['/deck', 'Make a presentation', 'Builds a slide deck you can edit in place and export as a PDF.', 'Make a presentation about our Q3 product launch'],
            ['/image', 'Generate an image', 'Creates an image, logo or graphic. Saved to the Pictures folder in your Brain.', 'Generate an image of a minimal logo for a coffee brand'],
            ['/post', 'Write a post', 'Drafts a post for LinkedIn, X or another platform, tailored to that platform’s style.', 'Write a LinkedIn post about shipping our first release'],
            ['/summarize', 'Summarise', 'Condenses a page, file or block of text down to what matters.', 'Summarise this: <paste text, or attach a file>'],
            ['/automate', 'Build automation', 'Describe a repeating job in words and it builds the automation for you.', 'Build an automation that emails me a summary of my inbox every morning'],
          ]} />

          <H3>Research and agents</H3>
          <CmdTable rows={[
            ['/research', 'Deep research', 'Opens the Research workspace: plans searches, reads your competitors’ websites and writes a full competitive report with tables.', 'Research my competitors — I run a local-first AI desktop app in India'],
            ['/agents', 'Browse agents', 'Shows every specialist agent so you can switch to one or add another.', '/agents'],
            ['/skills', 'Learned skills', 'Opens the Brain filtered to what Krew has taught itself — each “Skill” note is a website task it worked out once and can now repeat.', '/skills'],
            ['/autopilot', 'Toggle Web Autopilot', 'Turns Web Autopilot on or off (the same switch as Settings → Advanced). See the Web Autopilot section below for what it changes.', '/autopilot'],
          ]} />

          <H3>Fixing your saved data</H3>
          <CmdTable rows={[
            ['/repair-table', 'Repair a broken table', 'Picks a Brain note and rebuilds a table whose rows have run together onto one line, so it reads as a proper table again. Only the line breaks are rebuilt — no cell is edited, reordered or removed — and running it on a note that is already fine changes nothing.', 'Repair the table in LinkedIn connections'],
          ]} />
          <Note>
            If a table ever looks like one enormous row with pipes through the middle of it, this is the
            fix. Pick the note, run it, and open the Brain to check the result — it will tell you exactly
            how many rows it recovered.
          </Note>

          <H3>Opening a part of the app</H3>
          <P>These simply jump you to a module — the same as clicking it in the sidebar.</P>
          <CmdTable rows={[
            ['/brain', 'Open Brain', 'Your knowledge graph — every note, list and file your agents share.'],
            ['/coder', 'Open Coder', 'The AI code editor.'],
            ['/models', 'Models', 'The local and cloud AI model catalogue.'],
            ['/automations', 'Automation builder', 'The visual flow builder for automations.'],
            ['/mesh', 'Open Mesh', 'Join machines together to run models too big for one computer.'],
            ['/vault', 'Open Vault', 'DNS and connection privacy.'],
            ['/guard', 'Open Guard', 'Compliance checks and threat scanning.'],
            ['/connect', 'Connect apps', 'Link Gmail, LinkedIn, Notion, Slack and the rest.'],
            ['/mcp', 'Connect MCP server', 'Add any MCP server by URL and use its tools inside Krew.'],
            ['/settings', 'Settings', 'App preferences, stored on this device.'],
          ]} />

          <H id="autopilot">Web Autopilot — sites we did not build a button for</H>
          <P>
            Krew has purpose-built support for LinkedIn, Gmail, Calendar, Notion and the rest. Web
            Autopilot covers everything else: turn it on and Krew will work through a site it has no
            specific integration for — reading the page to work out which fields and buttons matter,
            filling them in, and attaching a file from your computer if the form needs one.
          </P>
          <P>
            It is <span className="text-nv-text">off by default</span>. Turn it on in{' '}
            <span className="text-nv-text">Settings → Advanced</span>, or just type <K>/autopilot</K>.
          </P>
          <Example title="What it looks like">
            You say <K>Fill in the supplier registration form on example.com with our company details</K>.
            Krew opens the page, reads it, fills what it can, and stops at anything it does not know —
            asking you directly rather than guessing. When you answer, it carries on from where it
            stopped. Before the form is actually submitted it shows you exactly what will happen and
            waits for you to approve.
          </Example>
          <P>
            It reads a form properly before touching it — every field’s label, whether it is required,
            what is already filled in, and for a dropdown the actual list of choices — then uses the
            right control for each one: typing into text boxes, picking from dropdowns, ticking
            checkboxes, choosing radio buttons, attaching files. Ticking is set to the state it wants
            rather than clicked, so running the same step twice cannot undo it.
          </P>
          <Note>
            It never submits, sends, pays or deletes anything on its own — those always stop for your
            approval, whether the task is new or a skill it has run before. Searching your computer for
            a file is limited to Desktop, Downloads, Documents and Pictures.
          </Note>
          <P>
            There are things it will not do at all, however it is asked: creating accounts in bulk or
            under a false identity, getting around CAPTCHAs, paywalls or login walls, harvesting
            personal data at scale, signing into an account that is not yours, posting fake reviews or
            engagement, or impersonating a real person or company. It will say so rather than quietly
            attempt a workaround.
          </P>
          <P>
            Once you approve a task, Krew writes down how it did it as a{' '}
            <span className="text-nv-text">Skill</span> note in your Brain — not a vague description
            but a numbered recipe: the page to start from, which field takes which value, what it must
            ask you for each time, what is always the same, and which step is the one that needs your
            approval. The next similar request follows that instead of working the page out again.
            Type <K>/skills</K> to see what it has learned, and edit a recipe like any other note if
            you want to correct a step.
          </P>
          <Example title="A skill after one approved run">
            <span className="font-mono text-[11px]">SITE: supplier portal · INPUTS: company name, GST
            number (ask each time) · FIXED: Country = India · STEPS: 1 fill Company name · 2 select
            Country · 3 tick I accept the terms · 4 click Submit ← needs approval</span>
          </Example>

          <H id="brain">Brain — shared memory</H>
          <P>
            Brain is the app's long-term memory: notes joined by links, drawn as a graph. Every agent can
            read from it and write to it, which is why you do not have to explain your business again in
            every new chat.
          </P>
          <P>
            Things arrive there on their own — scanned connections, lead tables, drafted posts, generated
            images, files you attach — and you can write notes yourself. Click a note to open, edit or
            delete it, and drag the cards to arrange them however makes sense to you.
          </P>
          <Note>
            By default, related work updates the note that already exists rather than creating a new one
            each time, so your lists do not fragment. You can change this in Settings, and you can
            override it for a single request by saying “continue the existing list”.
          </Note>

          <H id="todo">To-do</H>
          <P>The <span className="text-nv-text">To-do</span> tab next to Skill lib holds two kinds of item.</P>
          <P>
            The first is your own tasks. Type one and press Enter; tick it off when it is done and it is
            crossed out. You can set a priority and a due date on the same line as you type:
          </P>
          <Example title="Adding a task">
            Typing <K>Reply to Sonali !high today</K> creates a task called “Reply to Sonali”, marks it high
            priority and sets it due today. The filters along the top — All, Today, Overdue, Done — show
            just what matters now, and anything overdue turns red.
          </Example>
          <P>
            The second kind appears by itself. When you leave a piece of work unfinished, adris.tech puts
            a card at the top of the list with a <span className="text-nv-text">Continue</span> button — for
            example an outreach campaign with people still to message. These cards survive closing the
            window, deleting the chat and restarting the app, so there is always a way back to unfinished
            work.
          </P>
          <P>
            Krew adds these itself when a request leaves something genuinely outstanding — one per person
            still waiting on a reply, say, rather than a single vague reminder. Where a task is about a
            specific page, <span className="text-nv-text">Continue</span> opens that page directly: reading
            your LinkedIn messages creates one to-do per pending reply, and each one takes you straight to
            that person’s chat. Asking Krew to add something to your to-do never requires connecting any
            account — the list lives on this computer.
          </P>
          <P>
            Ticking something off <span className="text-nv-text">never deletes it</span>. It moves to the
            Done tab and stays there, so you keep a record of what you got through. Remove an item for
            good with the <span className="text-nv-text">✕</span> beside it — always visible on a
            completed task — or clear the whole Done list at once from the button at the bottom.
          </P>
          <P>
            Krew may also offer a <span className="text-nv-text">Next up</span> card in the chat after
            finishing something — one obvious follow-on step you can accept with a click, or ignore
            entirely and type whatever you actually want instead.
          </P>

          <H id="linkedin">Worked example: LinkedIn outreach</H>
          <P>
            This is the workflow most people run, and it is worth reading in full because it shows how the
            pieces fit together. The goal: message a few hundred of your existing connections with
            something genuinely personal, without ever messaging the same person twice.
          </P>
          <H3>Step 1 — scan your connections</H3>
          <P>
            Type <K>/scan</K>. A browser window opens, loads your connections and reads the real names and
            headlines from the page. They are saved to a Brain note called{' '}
            <span className="text-nv-text">LinkedIn connections</span>, and the window closes on its own when it
            finishes. If you are not signed in to LinkedIn, sign in once in that window — it is remembered
            from then on.
          </P>
          <P>
            A scan reads about fifty people at a time. Run it again later and it scrolls past everyone
            already saved, collects the next fifty, and appends them to the same note. Nobody is ever saved
            twice.
          </P>
          <H3>Step 2 — draft the messages</H3>
          <P>
            Attach the document describing what you do and type <K>/outreach</K>. Each message is written
            individually: it greets the person by first name, refers to something real from their own
            headline, and ends with one low-pressure ask. Nothing is sent automatically.
          </P>
          <H3>Step 3 — send</H3>
          <P>
            The outreach copilot opens. For each person press{' '}
            <span className="text-nv-text">Copy message &amp; open chat</span>: the message is copied and their
            LinkedIn chat opens, so you paste with Ctrl+V and send. Every message can be edited first. Mark
            each one as sent as you go — that is what keeps the next run honest.
          </P>
          <Note>
            LinkedIn is not automated on purpose. Tools that send messages for you put your account at real
            risk of restriction. adris.tech does everything except the final keystroke.
          </Note>
          <H3>Step 4 — when they reply</H3>
          <P>
            Type <K>/linkedin</K>, or just say what you want in your own words. Krew opens your inbox and
            reads each conversation <span className="text-nv-text">in full</span> — not just the last
            message — so it can tell the difference between a thread that still needs something from you
            and one where everything is already settled. It drafts a reply only where something is
            genuinely outstanding.
          </P>
          <Example title="Replying with your availability">
            Say <K>Check my LinkedIn messages — I’m free Wednesday after 1:30 PM IST</K>. If someone
            proposed “Mon–Wed, 10am–2pm EST”, the reply answers those actual times against yours and
            shows both zones, rather than inventing a slot. Each pending reply also becomes a to-do
            linked straight to that person’s chat.
          </Example>
          <P>
            When you are happy with a draft, say <K>Send the reply to Kevin</K> and it types that message
            into their chat box — and stops. You read it and press Send yourself.
          </P>
          <H3>Doing it again next week — and why nobody is messaged twice</H3>
          <P>
            This is what makes the workflow safe to repeat, and it needs nothing from you: no attaching
            files, no keeping track yourself.
          </P>
          <ul className="list-disc pl-5 mb-3">
            <Li>A new <K>/scan</K> skips everyone already in your connections note and saves only new people.</Li>
            <Li>A new <K>/outreach</K> skips everyone you have marked as messaged and drafts only for the rest.</Li>
            <Li>There is one running campaign rather than one per run, so your progress keeps adding up instead of resetting.</Li>
          </ul>
          <Example title="700 connections, fifty at a time">
            Week 1 — <K>/scan</K> saves 50 people; <K>/outreach</K> drafts 50 messages; you send them and mark them sent.<br />
            Week 2 — <K>/scan</K> saves people 51–100, skipping the first 50; <K>/outreach</K> drafts 50 new
            messages and leaves last week's alone.<br />
            Carry on to the end of the list. If you run <K>/outreach</K> without scanning anyone new,
            adris.tech tells you everyone has already been messaged instead of repeating people.
          </Example>
          <P>
            One honest limitation: every scan has to scroll past what is already saved, so once you are
            several hundred deep a scan takes noticeably longer. It still works — it is simply slower the
            further down your list you go.
          </P>

          <H id="models">Models — running AI locally</H>
          <P>
            The Models tab is a catalogue of open models you can download and run on this machine. Local
            models cost nothing to run, work with no internet, and send nothing anywhere.
          </P>
          <P>
            Each card shows how much memory the model needs, so you can see at a glance what your computer
            can handle. Press <span className="text-nv-text">Pull</span> to download; you get live progress in
            gigabytes and a <span className="text-nv-text">Cancel</span> button that stops the download and removes
            the partial file. Downloaded models appear under My Models and can be chosen in the connection
            bar.
          </P>
          <Note>
            A rough guide: a 4B model runs comfortably on almost any laptop, 12B wants around 12&nbsp;GB of
            memory, and 27B wants 24&nbsp;GB or more. One that fits your machine feels fast; one that does not
            will crawl.
          </Note>

          <H id="coder">Coder</H>
          <P>
            A full code editor with an AI pair beside it. Open a folder, describe the change you want, and
            the agent edits the real files while you watch each change land in the editor. It has a
            built-in terminal, so it can install packages and run tests as it works.
          </P>

          <H id="studio">Studio &amp; decks</H>
          <P>
            Ask for a presentation in plain words and you get a real slide deck back. Edit it in place —
            click any text to change it, recolour it, add or remove slides — and export it as a PDF. Your
            own pictures and logo can be placed on slides, and on paid plans slides can carry
            AI-generated imagery. Studio also makes videos, screen recordings and banners.
          </P>
          <Example title="Making a deck">
            <span className="text-nv-text">“Make a 10-slide investor deck from PRODUCT.md, use our brand colours,
            put our logo on every slide.”</span> Then refine it by talking: “make slide 4 about pricing”,
            “remove the last slide”, “put this photo on slide 2”.
          </Example>

          <H id="automation">Automations</H>
          <P>
            Work that should happen without you asking. Build it as a simple form or by drawing a flow on a
            canvas, with branches, loops and steps that run in parallel. A daily inbox summary or a weekly
            report takes a few minutes to set up. In Settings you choose whether automations run only while
            the app is open or continue in the background.
          </P>

          <H id="connect">Connect apps &amp; MCP</H>
          <P>
            Connect Gmail, Notion, Slack, GitHub, Linear, Airtable, LinkedIn and others, and your agents can
            use them directly — reading your inbox, filing a page in Notion, opening an issue. Connect an
            account once and it is remembered.
          </P>
          <P>
            adris.tech also speaks MCP, an open standard for AI tools. Paste the address of any MCP server
            and its tools join everything else your agents can use.
          </P>

          <H id="vault">Vault</H>
          <P>
            Vault protects the connection itself by switching your computer to private DNS, so the sites you
            visit are not visible to your network provider. Toggle it from Vault or the tray icon. It checks
            that a server is actually reachable before switching, so turning it on cannot leave you without
            internet.
          </P>

          <H id="mesh">Mesh</H>
          <P>
            Mesh joins several computers together so they can run a model too large for any one of them. If
            you have more than one machine, this is how you run the big models without buying hardware.
          </P>

          <H id="quickbar">Quick Bar</H>
          <P>
            A small always-on-top window for quick questions without opening the full app. It shares your
            account, your Brain and your theme, and can start automatically when your computer does.
          </P>

          <H id="guard">Guard — security watch</H>
          <P>
            Guard is the security analyst a small business normally cannot afford. It has four parts,
            and it is worth knowing which of them run on their own and which you start yourself.
          </P>
          <H3>Inbox watch — the automatic one</H3>
          <P>
            Turn on <span className="text-nv-text">Watch my inbox</span> in Guard and, while adris.tech is
            open, it checks for new mail every ten minutes. Anything that looks like phishing, a spoofed
            sender or payment fraud raises a warning banner at the top of the app and a desktop
            notification, and is written to the event trail.
          </P>
          <ul className="list-disc pl-5 mb-3">
            <Li>It needs Gmail connected in Connect Apps, using an app password rather than your main password.</Li>
            <Li>Each message is judged once. You will never be warned twice about the same email.</Li>
            <Li>It only reads mail that is still unread, and at most eight new messages per check.</Li>
            <Li>It runs only while the app is open — this is not a server watching your inbox overnight.</Li>
            <Li><span className="text-nv-text">Check now</span> forces an immediate pass if you don't want to wait.</Li>
          </ul>
          <H3>Contract scanner, vulnerabilities, compliance — you start these</H3>
          <P>
            The contract scanner reads an agreement and tells you in plain English what you are actually
            committing to and which clauses are worth pushing back on. Vulnerabilities reads the
            dependency files in your GitHub repositories and reports only the CVEs that affect the
            versions you really use. Compliance checks code, config or policy documents against the
            requirements you pick, and gives you a pass or warning for each with what to fix.
          </P>
          <H3>What a "check" costs you</H3>
          <P>
            On Solo, Guard includes <span className="text-nv-text">50 checks a month</span>, and everything
            Guard does draws from that one pool — a contract scan, a compliance run, a vulnerability
            briefing, or a suspicious email that needed a closer look. When the pool is empty Guard stops
            until the month resets. Builder and above are unlimited.
          </P>
          <P>
            Most of your inbox never touches it. Every message is first judged by rules running on this
            machine, and only genuinely suspicious mail costs a check — so 50 buys far more than 50 emails
            of protection.
          </P>
          <Note>
            Guard never deletes, moves or quarantines anything. It tells you and records it; every action
            stays yours.
          </Note>

          <H id="whatsnew">What’s new</H>
          <P>
            The most recent additions, and what each one is actually for. Settings → About always shows
            the notes for the exact version you are running.
          </P>

          <H3>Reading and replying to LinkedIn messages</H3>
          <P>
            Krew can open your LinkedIn inbox and read your conversations properly — the real text, from
            the page. It reads each thread <span className="text-nv-text">in full</span> rather than
            glancing at the newest message, so it can tell a thread that still needs something from you
            apart from one where everything is already settled, and it drafts a reply only where one is
            genuinely needed.
          </P>
          <Example title="Answering a proposed time">
            Say <K>Check my LinkedIn messages — I’m free Wednesday after 1:30 PM IST</K>. If someone
            offered “Mon–Wed, 10am–2pm EST”, the draft answers those real times against yours and shows
            both zones. It will not re-offer a slot you already agreed earlier in the thread.
          </Example>
          <P>
            Each pending reply also becomes a to-do linked to that person’s chat. When a draft looks
            right, say <K>Send the reply to Kevin</K> — Krew types it into the chat box and stops there.
            You read it and press Send. Nothing is ever sent for you.
          </P>

          <H3>Web Autopilot</H3>
          <P>
            Covered in full in its own section above. In short: turn it on and Krew can work through a
            website nobody built a specific integration for — reading the page, filling the form,
            attaching a file from your computer — asking you whenever it does not know something, and
            always stopping for your approval before anything is submitted or sent. What it works out
            is saved as a reusable skill.
          </P>

          <H3>To-dos that know where they point</H3>
          <P>
            Krew now adds to-dos itself when a request leaves something outstanding, and can add several
            at once rather than one vague catch-all. Where a task is about a particular page,{' '}
            <span className="text-nv-text">Continue</span> opens that page. You may also see a{' '}
            <span className="text-nv-text">Next up</span> card offering one sensible follow-on step —
            take it with a click, or ignore it and type what you actually want.
          </P>

          <H3>The browser stays yours while you work</H3>
          <P>
            When you open someone’s chat from the outreach copilot, the browser window is now held open
            until <span className="text-nv-text">you</span> close it — there is a{' '}
            <span className="text-nv-text">Close browser</span> button in the copilot. Previously a
            background task finishing could close the window while you were still part-way through
            pasting a message. Work down the list at your own pace and mark each person Sent as you go;
            that is what stops them being drafted again next time.
          </P>

          <H3>Renaming a note keeps its to-do in step</H3>
          <P>
            Rename a note in the Brain and anything in your To-do list that pointed at it by name is
            renamed with it, so you never end up with a to-do referring to a note that no longer
            exists under that name.
          </P>
          <Note>
            Your reference note is also saved when you close the panel with Escape, the ✕ or by
            clicking away — not only when you click out of the box first. Text typed there is no
            longer lost if you close the panel straight after typing.
          </Note>

          <H3>Repairing a broken table</H3>
          <P>
            If a saved table ever collapses into one long row, <K>/repair-table</K> rebuilds it. Pick the
            note and it puts every row back on its own line, telling you how many it recovered. It only
            rebuilds line breaks — no cell text is changed — and it is safe to run on a note that is
            already fine.
          </P>

          <H id="rules">How things actually work</H>
          <P>
            The details that are easy to guess wrong. If something behaves differently from what you
            expected, the answer is probably here.
          </P>

          <H3>Lists and /scan</H3>
          <QA q="If I attach my connections list and run /scan, does it continue that list?">
            It continues the list, but not because you attached it. <K>/scan</K> always reads the Brain
            note named exactly <span className="text-nv-text">LinkedIn connections</span>, skips everyone
            already in it, and appends the new people to it. Two consequences: attaching a
            <em> different</em> list will not redirect the scan to it, and if you <em>rename</em> that note,
            the scan will not find it and will start a fresh list from zero.
          </QA>
          <QA q="Does /outreach behave the same way?">
            No — and this difference matters. If you attach a connections list to <K>/outreach</K>, that
            file is authoritative and only those people are used. With nothing attached, it falls back to
            your saved connections. So: attach for outreach, don't bother for scanning.
          </QA>
          <QA q="Will /outreach message the same person twice?">
            No, provided you mark people as sent in the copilot. That status is what the next run reads.
            There is one running campaign rather than one per run, so progress accumulates instead of
            resetting. If you skip marking, those people look un-contacted and will be drafted again.
          </QA>
          <QA q="Why do I sometimes get a new note instead of my existing one updated?">
            By default related work updates the note that already exists. You can change that in Settings
            under Lists &amp; notes. Whatever the setting says, telling Krew
            <span className="text-nv-text"> "continue the existing list"</span> in the chat wins for that
            request.
          </QA>

          <H3>Research</H3>
          <QA q="Does research really open competitor websites?">
            It fetches their homepages directly and reads the title, hero line, description and brand
            colours. If the search step returns no usable site links it will say so, and the report is
            written from search results alone — it will not state brand colours it could not read.
            Adding a Brave Search key in Connect Apps produces far better results here.
          </QA>
          <QA q="What do the extra focus areas actually change?">
            Each one you tick aims the searches at that topic <em>and</em> adds a matching section to the
            report — funding, recent news, a pricing teardown, a feature-comparison table, or India
            specifics. Ticking none gives you the standard six-section report.
          </QA>
          <QA q="Which files can I attach?">
            Plain-text formats only: MD, TXT, CSV, TSV, JSON, YAML, HTML. PDFs and Word files are refused
            on purpose — partially decoded text quietly corrupts the analysis, which is worse than
            attaching nothing. Paste the relevant part into the description box instead.
          </QA>

          <H3>Your allowance</H3>
          <QA q="What uses up my monthly tokens?">
            Only the hosted adris.tech AI. Running your own API key or a local model costs you nothing
            from the allowance, and neither is ever blocked when the allowance runs out — so when you see
            "limit reached", switching the connection bar to Own key or Local genuinely keeps you working.
          </QA>
          <QA q="Why does the number differ between screens?">
            It shouldn't any more. Free and Explore allowances are counted for the lifetime of the account;
            paid plans are counted per calendar month. Every screen now uses the rule that matches your
            plan.
          </QA>

          <H3>Windows and panels</H3>
          <QA q="I turned the Quick Bar off and can't get it back.">
            Go to <span className="text-nv-text">Settings › Interface</span> and switch Quick Bar back on —
            it reappears immediately, no restart needed. The bar's own menu turns it off but the switch to
            bring it back lives in Settings.
          </QA>
          <QA q="I closed the outreach copilot — are my drafts gone?">
            No. Drafts and per-person status save continuously. Get it back by typing <K>/continue</K>, or
            from the Continue button on the To-do tab — that card is the one that survives deleting the
            chat and restarting the app.
          </QA>
          <QA q="Does the app keep working after I close the window?">
            Automations can, if you set Run mode to 24/7 background in Settings. The Guard inbox watch does
            not — it runs only while the app is open.
          </QA>

          <H id="privacy">Privacy</H>
          <P>
            Your Brain, files, chats, saved lists and downloaded models all stay on this computer. Local
            models send nothing anywhere. The hosted AI receives only the text of the request you make, and
            your content is never used for training. Connected accounts are used only when an agent needs
            them for something you asked for.
          </P>

          <H id="trouble">When something goes wrong</H>
          <H3>A scan finds nobody</H3>
          <P>
            Usually you are not signed in to LinkedIn in the adris.tech browser window, or the page had not
            finished loading. Open that window, sign in, scroll the list once, then run <K>/scan</K> again.
          </P>
          <H3>The outreach panel disappeared</H3>
          <P>
            Nothing is lost — drafts and progress are saved continuously. Bring it back by typing{' '}
            <K>/continue</K>, or from the Continue button on the To-do tab.
          </P>
          <H3>A download does not start</H3>
          <P>
            Check you are online and try again; a clear message appears if the download server cannot be
            reached. Make sure you have room, too — the larger models are 15&nbsp;GB and more.
          </P>
          <H3>The AI stops mid-task</H3>
          <P>
            If your connection drops, adris.tech reconnects and carries on by itself. If you have run out of
            monthly usage, switch the connection bar to Own key or Local and keep working.
          </P>

          <div className="mt-14 pt-5 border-t border-nv-border">
            <p className="text-[12px] text-nv-faint leading-relaxed">
              Still stuck, or something here does not match what you see? Get in touch through{' '}
              <a href="https://adris.tech/partner" target="_blank" rel="noreferrer" className="text-accent hover:underline">adris.tech/partner</a>
              {' '}— it reaches us directly. This manual is updated with each release.
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}
