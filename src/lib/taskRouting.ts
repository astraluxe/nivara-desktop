// ─── Who should do this, and what will they use ──────────────────────────────
//
// An office is not a list of forty-three job titles. It is knowing that the pitch deck goes to the
// deck maker, that they will use the document generator rather than describing slides at you, and
// that the spreadsheet filtering in front of it is a different person's job entirely.
//
// This answers that for one task, deterministically. No model call: the user is looking at a task
// panel, not asking a question, and spending a request to be told "Slade makes decks" would be
// slower AND less reliable than a table. It is also honest about not knowing — a task that matches
// nothing returns nothing rather than a confident wrong name.
//
// The tool names are REAL tool names from krewTools. If a capability is named here it exists; if it
// is not here, the agents cannot do it and the panel must not imply otherwise.

export interface TaskRoute {
  /** Agent keys, best first. */
  agents: string[];
  /** What they will actually use — human-readable, drawn from real capabilities. */
  tools: { name: string; what: string }[];
  /** Why this task landed here, in one clause. */
  why: string;
}

interface Rule {
  re: RegExp;
  agents: string[];
  tools: [string, string][];
  why: string;
}

/**
 * Ordered most-specific first: "record a demo video" is a video task, not a generic content one,
 * and the first rule that matches sets the headline answer.
 */
const RULES: Rule[] = [
  {
    re: /\b(deck|slide|slides|presentation|ppt|powerpoint|pitch ?deck|keynote)\b/i,
    agents: ['deck_maker', 'visual_creator'],
    tools: [
      ['generate_document', 'builds the real .pptx / .pdf file, not a description of one'],
      ['recall_from_brain', 'pulls your existing positioning and numbers so the deck says what you actually say'],
    ],
    why: 'produces slides',
  },
  {
    re: /\b(spreadsheet|xlsx|excel|csv|filter (the )?(list|sheet|rows)|rows with|dedup|clean (the )?(list|data)|segment)\b/i,
    agents: ['data_analyst', 'ops_agent'],
    tools: [
      ['query_table', 'filters a big saved sheet by column without reading all of it'],
      ['extract_contacts', 'pulls names, emails and links out of any shape of list'],
      ['generate_document', 'writes the result back out as a real .xlsx'],
    ],
    why: 'is spreadsheet work',
  },
  {
    re: /\b(outreach|cold (email|dm|message)|reach out|send (the )?(batch|messages|dms)|prospect(ing)?|follow[- ]?up (non-?repliers|the list))\b/i,
    agents: ['cold_outreach', 'email_marketer', 'social_manager'],
    tools: [
      ['linkedin_outreach', 'drafts per person and opens the copilot that tracks who replied'],
      ['gmail_send_bulk', 'one separate personalised email each, never a visible group send'],
      ['query_table', 'narrows your list to the rows worth contacting first'],
    ],
    why: 'contacts people on a list',
  },
  {
    re: /\b(lead list|find (leads|prospects|companies)|build (a )?list|target list|icp|verify (the )?(leads?|list)|enrich)\b/i,
    agents: ['research_agent', 'researcher'],
    tools: [
      ['research_companies', 'finds real named companies and people, not plausible ones'],
      ['verify_lead_list', 'opens each profile and drops the rows that do not check out'],
      ['enrich_lead_list', 'fills the missing LinkedIn, phone and email in one pass'],
    ],
    why: 'builds or checks a list of real people',
  },
  {
    re: /\b(video|loom|screen[- ]?(share|capture|record)|demo (recording|video)|podcast|audio overview|explainer)\b/i,
    agents: ['video_script_writer', 'script_writer'],
    tools: [
      ['open_content_studio', 'drives NotebookLM, which turns your own documents into audio and video overviews free'],
      ['generate_document', 'writes the script or shot list you record from'],
    ],
    why: 'produces something recorded',
  },
  {
    re: /\b(image|logo|graphic|illustration|thumbnail|banner|gif|visual asset|creative)\b/i,
    agents: ['image_maker', 'visual_creator', 'thumbnail_maker'],
    tools: [
      ['open_content_studio', 'drives ImageFX and Pomelli — free image and campaign generation on the open web'],
    ],
    why: 'produces a picture',
  },
  {
    re: /\b(comparison page|landing page|website copy|notion page|publish (a|the) page|one-?pager|blog|article|seo)\b/i,
    agents: ['seo_agent', 'caption_writer', 'product_describer'],
    tools: [
      ['notion_create_page', 'publishes it as a real page on a link you can send'],
      ['recall_from_brain', 'uses your saved positioning so the page and your outreach say the same thing'],
      ['web_search', 'checks what the alternatives actually claim before you compare against them'],
    ],
    why: 'publishes something people will read',
  },
  {
    re: /\b(market research|competitor|trends?|demand|what are people searching|pricing research|landscape)\b/i,
    agents: ['research_agent', 'competitor_watcher'],
    tools: [
      ['web_search', 'reads real sources rather than recalling them'],
      ['open_content_studio', 'opens Google Trends — free, no account, real demand data by city'],
      ['fetch_open_data', 'official statistics where they exist'],
    ],
    why: 'is research into a market',
  },
  {
    re: /\b(call|meeting|discovery|demo call|schedule|book (a|the)|calendar|onboard(ing)?)\b/i,
    agents: ['ops_agent', 'boss'],
    tools: [
      ['get_availability', 'checks your real working hours before offering a time'],
      ['create_calendar_event', 'puts it in your actual calendar with the link'],
      ['gmail_send_email', 'sends the confirmation'],
    ],
    why: 'involves other people\'s time',
  },
  {
    re: /\b(inbox|reply|replied|respond to|answer (the )?(email|message|dm))\b/i,
    agents: ['email_writer', 'dm_responder'],
    tools: [
      ['gmail_search', 'finds the thread and reads what was actually said'],
      ['draft_linkedin_reply', 'drafts the reply — it never sends without you'],
    ],
    why: 'answers someone',
  },
  {
    re: /\b(agreement|contract|mou|terms|nda|legal|compliance|invoice|pricing|₹|\$\d)/i,
    agents: ['legal_checker', 'contract_checker', 'cfo'],
    tools: [
      ['generate_document', 'produces the real document file'],
      ['read_file', 'reads the existing agreement locally — nothing is uploaded'],
    ],
    why: 'commits you to something',
  },
  {
    re: /\b(dashboard|tracker|kpi|metrics|weekly report|results|conversion|analytics)\b/i,
    agents: ['report_builder', 'data_analyst'],
    tools: [
      ['notion_create_page', 'builds the tracker as a real table you can filter'],
      ['open_content_studio', 'opens Looker Studio for a live dashboard on a link'],
      ['query_table', 'reads the numbers out of your saved sheets'],
    ],
    why: 'turns work into numbers you can see',
  },
  {
    re: /\b(code|build (the )?(app|feature)|bug|refactor|deploy|api|script\b)/i,
    agents: ['coder', 'bug_hunter'],
    tools: [
      ['read_file', 'reads the real project on your disk'],
      ['execute_terminal', 'runs the build and the tests rather than guessing they pass'],
    ],
    why: 'changes software',
  },
  {
    re: /\b(automat(e|ion)|every (monday|week|day)|recurring|on a schedule)\b/i,
    agents: ['automation_strategist', 'ops_agent'],
    tools: [
      ['create_automation', 'sets it running on a schedule without you'],
      ['list_automations', 'checks what is already running so nothing doubles up'],
    ],
    why: 'should run without you',
  },
  {
    re: /\b(post|linkedin post|tweet|thread|caption|social)\b/i,
    agents: ['social_manager', 'caption_writer'],
    tools: [
      ['linkedin_create_post', 'posts it, or leaves it as a draft for you to approve'],
      ['recall_from_brain', 'keeps it in the voice you have already established'],
    ],
    why: 'is published to an audience',
  },
  {
    re: /\b(write|draft|note|one[- ]?liner|positioning|messaging|define|decide|spec)\b/i,
    agents: ['content_planner', 'ad_copywriter'],
    tools: [
      ['save_to_brain', 'saves it where every other agent will find and reuse it'],
      ['recall_from_brain', 'starts from what you have already decided rather than a blank page'],
    ],
    why: 'writes something down',
  },
];

/**
 * Who should take this task, and what they will use.
 *
 * Returns empty when nothing matches — the panel then says nothing about agents, which is the
 * correct behaviour. A confident wrong name ("give this to Slade") on a task Slade cannot do is
 * worse than no suggestion at all, because the user will act on it.
 */
export function routeTask(text: string): TaskRoute | null {
  const t = (text || '').trim();
  if (t.length < 4) return null;
  // SCORED, NOT FIRST-MATCH.
  //
  // "Fix the bug in the outreach parser and deploy" is a coding task that happens to contain the
  // word outreach, and taking the first rule that matched handed it to the cold-outreach agent.
  // Counting how many of a rule's signals actually fired settles it — two ("bug", "deploy") beats
  // one — and rule order only breaks ties, which is what it was always meant to do.
  const scored = RULES
    .map((r, i) => ({ r, i, n: (t.match(new RegExp(r.re.source, 'gi')) || []).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i);
  if (!scored.length) return null;
  const hit = scored[0].r;
  // A second rule contributes its agents too. Real tasks are usually two jobs — "filter the list
  // to rows with an email, then send the batch" is a spreadsheet job followed by an outreach one —
  // and naming both teams is more useful than picking a winner. What made this read badly before
  // was the phrasing, not the pairing: two clauses that each began "it is…" glued together with a
  // comma. The clauses are now written to join.
  const also = scored[1]?.r;
  const agents = [...hit.agents, ...(also?.agents ?? [])].filter((a, i, arr) => arr.indexOf(a) === i).slice(0, 4);
  const seen = new Set<string>();
  const tools = [...hit.tools, ...(also?.tools ?? [])]
    .filter(([n]) => (seen.has(n) ? false : (seen.add(n), true)))
    .slice(0, 5)
    .map(([name, what]) => ({ name, what }));
  return {
    agents,
    tools,
    why: also && also.why !== hit.why ? `${hit.why}, and ${also.why}` : hit.why,
  };
}
