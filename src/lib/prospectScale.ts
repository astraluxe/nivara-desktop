// ─── Who this user can actually sell to ──────────────────────────────────────
//
// A lead run for non-tech SMB founders came back with Zoho, Acko, Zerodha and Byju's. The user's
// answer was the whole problem in one line: "yes true they are in bangalore but i cant deal with
// them na".
//
// Two separate causes, and the sector filter only fixed one of them.
//
// 1. NOTHING KEYED THE PROSPECT SIZE TO THE USER'S OWN SIZE. The app records `business_scale` in
//    the shared profile — the agents are instructed to save it — and the lead run never read it.
//    A solo founder and a fifty-person company got an identical brief, so both got the companies a
//    model knows best, which are the famous ones. A one-person business emailing Zoho's founder is
//    not a lead; it is a wasted row and a wasted hour.
//
// 2. THE SOURCE WAS WRONG. Grounding came from a Google web search, and Google's answer to "small
//    companies in Bangalore founder" is an article listing Bangalore's biggest startups. Articles
//    are written about the companies you cannot sell to. The businesses the user CAN sell to — the
//    fabricator, the diagnostics chain, the freight yard — are on Maps and in the directories and
//    registers they list themselves in, and nowhere else.
//
// Both are fixed by reading the profile: it decides how big a prospect may be, and where to look.
// Deterministic and synchronous; nothing here calls a model.

export type Scale = 'solo' | 'small-team' | 'startup' | 'smb' | 'mid-market' | 'enterprise';

/** Read a scale out of whatever the profile actually holds. */
export function parseScale(value: string): Scale | null {
  const v = String(value || '').toLowerCase();
  if (!v.trim()) return null;
  if (/\b(solo|freelance|freelancer|one[- ]person|just me|myself|single founder)\b/.test(v)) return 'solo';
  if (/\b(small[- ]team|tiny team|2-10|few people)\b/.test(v)) return 'small-team';
  if (/\b(startup|early[- ]stage|seed)\b/.test(v)) return 'startup';
  if (/\b(smb|small business|small and medium)\b/.test(v)) return 'smb';
  if (/\b(mid[- ]market|mid[- ]size|midsize)\b/.test(v)) return 'mid-market';
  if (/\b(enterprise|large company|corporate)\b/.test(v)) return 'enterprise';
  return null;
}

/** Pull business_scale out of the shared profile rows, whatever key it was saved under. */
export function scaleFromProfile(rows: Array<{ key: string; value: string }>): Scale | null {
  for (const r of rows) {
    if (/business_?scale|company_?size|team_?size|^scale$/i.test(r.key)) {
      const s = parseScale(r.value);
      if (s) return s;
    }
  }
  // Sometimes it is recorded as prose under another key ("about_business": "solo consultant").
  for (const r of rows) {
    if (!/about|business|company|work|role/i.test(r.key)) continue;
    const s = parseScale(r.value);
    if (s) return s;
  }
  return null;
}

/**
 * How big a prospect this user can realistically win, given their own size.
 *
 * The rule every founder learns eventually: sell sideways or slightly up, never to a company an
 * order of magnitude bigger than you. A solo consultant gets a reply from a 20-person firm and
 * silence from a 2000-person one, because the second has a procurement process they will never
 * clear.
 */
export function targetSizesFor(scale: Scale | null): { sizes: string[]; reach: 'local' | 'growing' | 'known'; note: string } {
  switch (scale) {
    case 'solo':
      return { sizes: ['1-10', '11-50'], reach: 'local',
        note: 'The user runs this alone. Their realistic customers are owner-run businesses where one person decides and can say yes in a single conversation — usually under 50 people, usually local. A company with a procurement process is not a prospect for them.' };
    case 'small-team':
      return { sizes: ['11-50', '51-200'], reach: 'local',
        note: 'A small team. They can serve businesses up to a couple of hundred people, but the buyer still has to be an owner or a department head who can decide without a committee.' };
    case 'startup':
      return { sizes: ['11-50', '51-200'], reach: 'growing',
        note: 'An early-stage company. Aim at businesses of a similar size or a little larger — peers who move quickly, not household names with vendor-approval processes.' };
    case 'smb':
      return { sizes: ['51-200', '201-1000'], reach: 'growing',
        note: 'An established small business. Mid-sized companies are winnable; the very largest are not worth the cycle time.' };
    case 'mid-market':
      return { sizes: ['201-1000', '1000+'], reach: 'known',
        note: 'A mid-market company. Larger organisations are a realistic target.' };
    case 'enterprise':
      return { sizes: ['1000+'], reach: 'known',
        note: 'An enterprise. Large organisations are the right target.' };
    default:
      // UNKNOWN MEANS SMALL. Most users of this app are one or two people, and the two mistakes do
      // not cost the same: aiming too small gives a list that is merely less ambitious, aiming too
      // big gives a list of companies that will never reply. When in doubt, aim low.
      return { sizes: ['1-10', '11-50', '51-200'], reach: 'growing',
        note: 'The user’s own size is not recorded, so assume small — most are. Aim at owner-run and small companies where one person can decide. Do NOT return household names or funded startups everyone has heard of.' };
  }
}

/**
 * Where to look for businesses a small seller can actually reach.
 *
 * Deliberately NOT news and NOT "top N" listicles — those exist to write about big companies. These
 * are the places ordinary businesses list THEMSELVES, which is exactly why they contain the ones
 * nobody writes articles about.
 *
 * India-first, because that is where this user sells, with neutral fallbacks so the same code works
 * anywhere. Every one is a public directory openable in a browser: no account, no paid API.
 */
export function registrySources(city: string, what: string, country = 'India'): string[] {
  const where = city ? ` ${city}` : '';
  const kind = String(what || 'companies').split(/\s+/).slice(0, 4).join(' ');
  if (/india/i.test(country)) {
    return [
      // Businesses list themselves here to be FOUND by buyers — the opposite of a news article.
      `site:indiamart.com ${kind}${where}`,
      `site:justdial.com ${kind}${where}`,
      // The public registers: real, small, and never in a listicle.
      `${kind}${where} udyam MSME registered`,
      `site:startupindia.gov.in ${kind}${where}`,
    ];
  }
  return [
    `${kind}${where} business directory contact`,
    `${kind}${where} chamber of commerce members`,
  ];
}

/** The paragraph that goes into the lead search, so the size filter is real rather than implied. */
export function scaleDirective(scale: Scale | null, city: string): string {
  const t = targetSizesFor(scale);
  return [
    '',
    'WHO THIS USER CAN ACTUALLY SELL TO — a filter, not a preference:',
    `- ${t.note}`,
    `- Target company size: ${t.sizes.join(' or ')} employees.`,
    `- A company that is a household name, has raised venture funding, or appears in "top startups" lists${city ? ` for ${city}` : ''} is the WRONG answer here, however well it matches the sector. Those companies do not reply to small vendors, and every one of them is a row the user cannot use.`,
    '- If you find yourself naming a company you have heard of, that is the signal that you are drawing from memory rather than from the search results. Go back to the results and take the ones you had never heard of — those are the real ones.',
  ].join('\n');
}
