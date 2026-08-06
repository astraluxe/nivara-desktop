// ─── Free content studios on the open web ─────────────────────────────────────
//
// Building an image generator, a video renderer and a podcast engine is months of work, and the
// result would be worse than tools that already exist and are currently free. The user does not
// care which machine made the asset; they care that the work is done. So the marketing agents get
// taught to DRIVE those tools in the app's own browser — the same real Chrome window they already
// use for LinkedIn and Gmail, signed in as the user, with the user watching.
//
// This file is only the map: which tool does what, where it lives, what it costs, who can use it,
// and what it hands back. Working the interface itself is left to the ordinary browser tools plus
// the learned-skill recipe the first successful run writes down — because a step-by-step recipe
// written here, for a beta product whose UI changes weekly, would be a confident set of
// instructions for buttons that may no longer exist. Better to say what the tool is FOR and let
// the agent look.
//
// EVERY FIELD BELOW IS CHECKED, NOT ASSUMED. Availability especially: Pomelli is not available in
// India, which is this app's largest market, and an agent that cheerfully opens it for a Bengaluru
// user and reports back "generating your campaign" would be lying about something it cannot do.

export interface ContentStudio {
  id: string;
  name: string;
  url: string;
  /** One line: what it is for. */
  makes: string;
  /** What you can actually take away at the end. */
  outputs: string;
  /** ISO-3166 alpha-2 codes, or 'all' when there is no geographic restriction. */
  countries: string[] | 'all';
  /** What the user must have before it will work at all. */
  needs: string;
  /** The free tier as it stands — stated so nothing promises more than the tool gives. */
  limits: string;
  /** When to reach for this one rather than another. */
  useWhen: RegExp;
  /** Anything that would otherwise be discovered the hard way. */
  notes: string;
}

export const CONTENT_STUDIOS: ContentStudio[] = [
  {
    id: 'pomelli',
    name: 'Pomelli (Google Labs)',
    url: 'https://labs.google.com/pomelli/about',
    makes: 'On-brand marketing campaigns built from the user\'s own website — social posts, ads and website assets that match their existing colours, fonts and tone.',
    outputs: 'Editable text and images/videos you download and post anywhere (Instagram, LinkedIn, Facebook, TikTok, YouTube).',
    // Confirmed at launch: US, Canada, Australia, New Zealand only. NOT India.
    countries: ['US', 'CA', 'AU', 'NZ'],
    needs: 'A Google account, signed in, and a real website URL for the business.',
    limits: 'Free during the public beta, with several hundred image and video generations.',
    useWhen: /\b(campaign|ad creative|social (post|asset)s?|brand (kit|book|assets)|marketing (asset|creative|material)s?|photoshoot|banner|creative)\b/i,
    notes: 'It reads the business website to build a "Business DNA" (colours, fonts, tone), so a real site is what makes the output on-brand. English only.',
  },
  {
    id: 'notebooklm',
    name: 'NotebookLM (Gemini Notebook)',
    url: 'https://notebooklm.google.com',
    makes: 'Turning documents the user already has into briefing docs, study guides, FAQs, mind maps and podcast-style audio overviews.',
    outputs: 'Text reports you can copy out, and an audio overview you can download as a file.',
    countries: 'all',
    needs: 'A Google account, and at least one source uploaded (a PDF, a doc, a link or pasted text).',
    limits: 'Free tier: around 50 chats a day and about 3 audio overviews a day — so treat an audio overview as something to spend deliberately, not to retry casually.',
    useWhen: /\b(podcast|audio (overview|summary)|briefing (doc|note)|study guide|mind map|faq|summar(y|ise|ize) (this|these|the) (doc|report|pdf|file)|explainer)\b/i,
    notes: 'It only works from SOURCES. Upload or paste the material first — asking it about something it has not been given produces nothing useful.',
  },
];

/** Two-letter country code from a free-text location ("Bengaluru, India" → IN). */
export function countryCodeOf(location: string): string {
  const s = String(location || '').toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/\bindia\b|bengaluru|bangalore|mumbai|delhi|chennai|hyderabad|pune|kolkata/, 'IN'],
    [/\bunited states\b|\busa\b|\bu\.s\.|new york|san francisco|california|texas/, 'US'],
    [/\bcanada\b|toronto|vancouver|montreal/, 'CA'],
    [/\baustralia\b|sydney|melbourne|brisbane/, 'AU'],
    [/\bnew zealand\b|auckland|wellington/, 'NZ'],
    [/\bunited kingdom\b|\buk\b|london|manchester/, 'GB'],
    [/\bsingapore\b/, 'SG'],
    [/\buae\b|dubai|abu dhabi/, 'AE'],
  ];
  for (const [re, code] of map) if (re.test(s)) return code;
  return '';
}

export function studioById(id: string): ContentStudio | undefined {
  return CONTENT_STUDIOS.find((s) => s.id === id.trim().toLowerCase());
}

export interface StudioPick {
  studio: ContentStudio;
  /** False when the user's country is outside the tool's supported list. */
  availableHere: boolean;
  why: string;
}

/**
 * Which studio suits this brief, and can this user actually use it?
 *
 * Returns every match rather than one, so the caller can offer the usable one and still say what
 * else exists. Availability is reported, never used to hide a tool silently — "it is not available
 * in your country" is information the user needs; a tool quietly missing from a list is not.
 */
export function pickStudios(brief: string, location = ''): StudioPick[] {
  const code = countryCodeOf(location);
  const matched = CONTENT_STUDIOS.filter((s) => s.useWhen.test(brief));
  const list = matched.length ? matched : CONTENT_STUDIOS;
  return list.map((studio) => {
    const availableHere = studio.countries === 'all' || !code || studio.countries.includes(code);
    return {
      studio,
      availableHere,
      why: studio.countries === 'all'
        ? 'Available everywhere.'
        : availableHere
          ? `Available in ${code || 'your region'}.`
          : `NOT available in ${code} — it only works in ${(studio.countries as string[]).join(', ')}.`,
    };
  });
}

/** The block an agent is given when it is about to use one of these. */
export function studioBriefing(pick: StudioPick): string {
  const s = pick.studio;
  return [
    `**${s.name}** — ${s.url}`,
    `Makes: ${s.makes}`,
    `You get back: ${s.outputs}`,
    `Needs: ${s.needs}`,
    `Free tier: ${s.limits}`,
    `Availability: ${pick.why}`,
    `Worth knowing: ${s.notes}`,
  ].join('\n');
}
