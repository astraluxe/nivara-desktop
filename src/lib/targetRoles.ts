// ─── Who do you actually ask for? ─────────────────────────────────────────────
//
// The copilot's "find someone there to talk to" searched LinkedIn for
// "founder OR director OR owner <company>" every single time. On a two-person trading firm that is
// exactly right. On BHARAT PETROLEUM CORPORATION LTD — a state oil company with tens of thousands
// of staff — it is nonsense: there is no founder to find, "director" means a board member who will
// never see a cold message, and the search returns whoever happens to rank.
//
// The person worth reaching depends on two things the app already knows: how big the organisation
// probably is, and what the outreach is FOR. A supplier-side pitch goes to procurement; a software
// pitch goes to whoever owns that function; at a five-person firm all of it goes to the owner.
//
// Everything here is pure and deterministic — no model call — so it behaves the same on every
// plan, and it can be tested. It is a STARTING GUESS the user can edit, never a silent decision:
// the panel shows the roles before it searches.

export type OrgScale = 'micro' | 'small' | 'large';

/** Words that only appear in the name of a genuinely large organisation. */
const LARGE_NAME = /\b(limited|ltd|corporation|corp|plc|public limited|nigam|bhavan|industries limited|international|holdings|group|enterprises limited|pvt\.? ltd\.? \(india\)|india limited|systems limited|technologies limited|motors limited|bank|insurance|assurance|airlines|railways|petroleum|refiner|steel authority|power grid|telecom|university|institute|hospital|federation|council|authority|ministry|government|govt)\b/i;

/** Public-sector and household-name markers — these are always big, whatever the suffix says. */
const PSU_OR_MAJOR = /\b(bharat|hindustan|indian oil|iocl|bpcl|hpcl|ongc|gail|ntpc|sail|bhel|drdo|isro|hal\b|bel\b|midhani|coal india|lic\b|sbi\b|tata|reliance|adani|mahindra|godrej|siemens|abb\b|bosch|honeywell|emerson|schneider|wipro|infosys|tcs\b|hcl\b|l&t|larsen|thermo fisher|perkin ?elmer|xerox|polycab|havells|bata|nilkamal|vip industries|force motors|tvs\b|volvo|bharat forge|apollo|amphenol|carborundum|praxair|linde|dana\b|flowserve|rittal|schunk|liebherr|klingelnberg|oxford instruments|olympus|godrej ?& ?boyce)\b/i;

/** Words that mean a small, owner-run business. */
const SMALL_NAME = /\b(enterprises|traders|trading|agencies|agency|associates|works|stores|store|mart|services|solutions|consultancy|contractor|suppliers?|distributors?|udyog|impex|company|& co|and co|and sons|bros|brothers)\b/i;

/**
 * How big is this organisation, judged from its name alone?
 *
 * Deliberately conservative in one direction: guessing LARGE when it is small only means the
 * search asks for a "head of purchase" at a firm where the owner does that job — the owner still
 * comes up. Guessing SMALL when it is large sends you hunting for a founder who does not exist,
 * which is the failure we are fixing. So the large signals win ties.
 */
export function orgScale(name: string, headcountHint = 0): OrgScale {
  if (headcountHint >= 500) return 'large';
  if (headcountHint > 0 && headcountHint < 25) return 'micro';
  const s = String(name || '').trim();
  if (!s) return 'small';
  if (PSU_OR_MAJOR.test(s)) return 'large';
  if (LARGE_NAME.test(s)) return 'large';
  if (SMALL_NAME.test(s)) return 'small';
  // A bare two-or-three-word name with no legal form is usually a small local business.
  return s.split(/\s+/).length <= 3 ? 'micro' : 'small';
}

/** What the outreach is for, as far as the roles are concerned. */
export type OutreachIntent = 'sell_to_them' | 'supply_them' | 'partner' | 'hire' | 'general';

export function intentOf(purpose: string): OutreachIntent {
  const p = String(purpose || '').toLowerCase();
  if (/\b(supply|supplier|vendor|quote|quotation|rfq|tender|procure|purchase order|we manufacture|we make|we provide)\b/.test(p)) return 'supply_them';
  if (/\b(partner|reseller|distributor|channel|collaborat|alliance)\b/.test(p)) return 'partner';
  if (/\b(hire|hiring|recruit|candidate|job|intern)\b/.test(p)) return 'hire';
  if (/\b(sell|demo|pitch|our product|our software|our tool|buy|subscription|trial|customer)\b/.test(p)) return 'sell_to_them';
  return 'general';
}

/**
 * The job titles worth searching for, best first.
 *
 * At a LARGE organisation nobody senior enough to be called a director reads a cold message, and
 * there is no founder — so the target is the person who owns the function the outreach concerns,
 * one or two levels down. At a MICRO business the owner does every job and is the only sensible
 * target. `small` sits between: a named decision-maker exists and is reachable.
 */
export function targetRoles(company: string, purpose = '', headcountHint = 0): { scale: OrgScale; intent: OutreachIntent; roles: string[]; why: string } {
  const scale = orgScale(company, headcountHint);
  const intent = intentOf(purpose);

  const byIntentLarge: Record<OutreachIntent, string[]> = {
    // Selling INTO a big company: the function head who owns the budget, not the board.
    sell_to_them: ['head of procurement', 'purchase manager', 'category manager', 'general manager'],
    // Wanting to BE their supplier: procurement and vendor development, every time.
    supply_them:  ['procurement manager', 'purchase head', 'vendor development', 'sourcing manager'],
    partner:      ['business development manager', 'alliance manager', 'partnerships'],
    hire:         ['talent acquisition', 'hr manager', 'recruitment lead'],
    general:      ['manager', 'head of operations', 'business development'],
  };
  const byIntentSmall: Record<OutreachIntent, string[]> = {
    sell_to_them: ['founder', 'owner', 'director', 'proprietor'],
    supply_them:  ['owner', 'purchase', 'proprietor', 'partner'],
    partner:      ['founder', 'director', 'partner'],
    hire:         ['founder', 'hr', 'owner'],
    general:      ['founder', 'owner', 'director', 'proprietor'],
  };

  const roles = scale === 'large' ? byIntentLarge[intent]
    : scale === 'micro' ? ['owner', 'proprietor', 'founder', 'partner']
      : byIntentSmall[intent];

  const why = scale === 'large'
    ? `${company} looks like a large organisation, so there is no founder to reach and a board director will not read a cold message — these are the people who own the decision.`
    : scale === 'micro'
      ? `${company} looks like a small owner-run business, so the owner decides everything.`
      : `${company} looks like a small-to-mid company where a named decision-maker is reachable.`;

  return { scale, intent, roles, why };
}

/**
 * A LinkedIn people-search URL for these roles at this company.
 *
 * Quoting matters and was wrong before: the old query was assembled as
 * `founder OR director OR owner <COMPANY>" <COMPANY>` — a stray quote from a filter string, the
 * company repeated, and no grouping at all. LinkedIn treats that as loose keywords and returns
 * whoever ranks. Parentheses group the roles, quotes bind the company name into one phrase, and
 * the company appears exactly once.
 */
export function peopleSearchUrl(company: string, roles: string[]): string {
  const co = String(company || '').replace(/["\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  const rolePart = roles.length ? `(${roles.map((r) => `"${r}"`).join(' OR ')})` : '';
  const q = [rolePart, co ? `"${co}"` : ''].filter(Boolean).join(' ');
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}
