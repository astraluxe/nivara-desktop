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
    makes: 'Turning documents the user already has into briefing docs, study guides, FAQs, mind maps, and podcast-style AUDIO or VIDEO overviews.',
    outputs: 'Text reports you can copy out, plus audio and video overviews you can download as files.',
    countries: 'all',
    needs: 'A Google account, and at least one source uploaded (a PDF, a doc, a link or pasted text).',
    limits: 'Free tier: around 50 chats a day, and a small daily allowance of audio/video overviews (roughly three) — so generate one deliberately rather than retrying casually.',
    useWhen: /\b(podcast|audio (overview|summary)|video (overview|summary|explainer)?|briefing (doc|note)|study guide|mind map|faq|summar(y|ise|ize) (this|these|the) (doc|report|pdf|file)|explainer|walkthrough)\b/i,
    notes: 'It only works from SOURCES. Upload or paste the material first — asking it about something it has not been given produces nothing useful. A VIDEO overview is the same idea as the audio one with visuals, and is the closest thing to a generated explainer video available free.',
  },
  {
    id: 'trends',
    name: 'Google Trends',
    url: 'https://trends.google.com/trends/explore',
    makes: 'Evidence about what people actually search for — relative interest over time, by region and city, plus the queries rising fastest around a topic.',
    outputs: 'Charts and tables you can read straight off the page or export as CSV.',
    countries: 'all',
    needs: 'Nothing. No account, no sign-in.',
    limits: 'Genuinely free with no quota. Figures are RELATIVE interest (0–100), never absolute search volumes — anyone reporting "12,000 searches" from Trends has made that number up.',
    useWhen: /\b(trend|demand|search volume|what are people (search|look)ing|seasonal|interest over time|keyword|market (research|demand|timing)|is there demand|rising quer)/i,
    notes: 'The single most useful free input to positioning: compare your category against its alternatives, and filter to your own city or state. "Related queries → Rising" is where the language your buyers actually use shows up.',
  },
  {
    id: 'imagefx',
    name: 'ImageFX (Google Labs)',
    url: 'https://labs.google/fx/tools/image-fx',
    makes: 'Images from a written prompt — illustrations, backgrounds, concept art, social graphics.',
    outputs: 'Downloadable image files, watermarked with SynthID.',
    countries: 'all',
    needs: 'A Google account, signed in.',
    limits: 'Free with a daily generation allowance that Google changes without notice.',
    useWhen: /\b(image|illustration|graphic|artwork|picture|visual|thumbnail|hero (image|shot)|background|icon set)\b/i,
    notes: 'A Google Labs product, and Labs rolls out country by country — if the page will not open, that is why rather than anything the user has done wrong. Say so plainly instead of retrying. Not a design tool: it makes pictures, not laid-out posts with text on them.',
  },
  {
    id: 'lookerstudio',
    name: 'Looker Studio',
    url: 'https://lookerstudio.google.com',
    makes: 'Shareable dashboards and reports built on a spreadsheet, a Google Sheet, or a connected data source.',
    outputs: 'A live dashboard on a link, and PDF exports.',
    countries: 'all',
    needs: 'A Google account, and the data in a Sheet or a supported source.',
    limits: 'Free for personal use with no report limit.',
    useWhen: /\b(dashboard|report(ing)?|chart|visuali[sz]e|kpi|metrics|track (results|numbers|performance)|analytics)\b/i,
    notes: 'The honest way to show a client or an investor real numbers without building anything. Put the data in a Sheet first — that is the step people skip, and nothing works until it is done.',
  },
  {
    id: 'gbp',
    name: 'Google Business Profile',
    url: 'https://business.google.com',
    makes: 'The free listing that decides whether a local business appears in Maps and in "near me" searches at all.',
    outputs: 'A public profile, posts, photos, and a review flow — plus the search terms people used to find it.',
    countries: 'all',
    needs: 'A Google account and a real business with a verifiable address or service area.',
    limits: 'Free. Verification can take days and sometimes needs a postcard or a video call.',
    useWhen: /\b(local (seo|search|business|customers)|google maps|near me|foot ?fall|walk-?ins|listing|reviews?)\b/i,
    notes: 'For any business with local customers this outranks almost anything else free, and most have either never claimed it or left it half-filled. The Insights tab shows the exact words people searched before they called — better positioning research than most paid tools.',
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
      // Worded as what the PUBLISHER says, not as a verdict on what the user can do. This app
      // ships a DNS switch (Vault) and people reach these tools through it every day — a flat
      // "not available to you" would be the app contradicting something already working on the
      // user's screen.
      why: studio.countries === 'all'
        ? 'Available everywhere.'
        : availableHere
          ? `Listed as available in ${code || 'your region'}.`
          : `Officially listed for ${(studio.countries as string[]).join(', ')} only — not ${code}. It may still open with Vault (the app's DNS switch) on; check the page rather than assuming either way.`,
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
