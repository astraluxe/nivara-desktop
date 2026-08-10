// ─── What "non-tech" actually means ──────────────────────────────────────────
//
// Asked for non-tech SMB founders in Bangalore, the run came back with Zerodha, Byju's, Razorpay,
// PhonePe, CRED, Meesho, Unacademy, InMobi, Swiggy, Ola, Dunzo, Groww, Slice, Jupiter, Fi Money,
// Vedantu, Quikr, BigBasket and Udaan. Every one of them is a technology company, and several are
// among the best-known technology companies in India.
//
// The reason is embarrassing and simple: nothing in this app had ever said what non-tech means.
// "non tech companies" was passed to the model as free text in the `what` field and left to its
// own interpretation — and a model asked for companies in Bangalore reaches for the Bangalore
// companies it knows best, which are precisely the startups. The filter the user thought they had
// set did not exist.
//
// What they meant, in their words: "companies which are pure non tech like construction companies
// or hospitals or such companies who don't know much about AI or technology as it's not part of
// their system or office." That is not a vague preference — it is the entire premise of selling to
// them, and it is checkable.
//
// So it is written down here, once, and used twice:
//   1. In the SEARCH, so it looks for the right thing — with named examples of both sides.
//   2. On the RESULTS, so anything tech-shaped is dropped even when the search ignores the brief.
//
// Deterministic and synchronous. The classifier reads the sector and the company descriptor, never
// a hardcoded list of company names — a list of Indian startups would be useless the moment
// somebody searches in Manila or Lagos, and this has to work anywhere.

export type TechStance = 'tech' | 'nontech' | 'unclear';

/**
 * Signals that a business IS a technology company.
 *
 * The test is what the company SELLS, not whether it uses computers. Every business uses
 * computers; a technology company's product is software, a platform, or an online service.
 */
const TECH_SIGNALS: RegExp[] = [
  /\b(saas|software|app|apps|platform|marketplace|aggregator)\b/i,
  /\b\w*tech\b/i,                       // fintech, edtech, adtech, healthtech, proptech, insurtech
  /\b(fin|ed|ad|health|prop|insur|hr|legal|agri|reg|mar)[- ]?tech\b/i,
  /\b(e[- ]?commerce|ecommerce|online|digital|internet|web3|crypto|blockchain|nft)\b/i,
  /\b(ai|artificial intelligence|machine learning|ml|data science|analytics|big data)\b/i,
  /\b(cloud|devops|cyber ?security|infosec|api|developer|dev ?tools?)\b/i,
  /\b(it services|information technology|system integrator|bpo|kpo)\b/i,
  /\b(neobank|payments?|wallet|lending platform|wealth ?tech|trading platform|brokerage app)\b/i,
  /\b(d2c|direct[- ]to[- ]consumer|social commerce|q[- ]?commerce|quick commerce|hyperlocal)\b/i,
  /\b(delivery app|ride[- ]hailing|food delivery|on[- ]demand|subscription box)\b/i,
  /\b(gaming|game studio|esports|streaming|adtech|martech)\b/i,
  /\b(startup|saas b2b|product company|tech company)\b/i,
  // Categories that only exist as app-shaped businesses. "Mobility" is never a truck fleet's word
  // for itself — a fleet says logistics or transport; mobility is what a ride-hailing app says.
  /\b(mobility|classifieds|social commerce|consumer internet|consumer brand roll[- ]?up)\b/i,
  /\b(commerce|delivery platform|wellness platform|content platform|digital media)\b/i,
];

/**
 * Signals that a business is NOT a technology company.
 *
 * Physical operations: things made, built, treated, taught, moved, served or repaired. These are
 * the businesses the user is actually trying to reach — the ones for whom software is something
 * they buy, not something they sell.
 */
const NONTECH_SIGNALS: RegExp[] = [
  /\b(construction|builders?|contractors?|civil|infrastructure|real estate developer|architect)\b/i,
  /\b(hospitals?|clinics?|nursing homes?|diagnostics?|pathology|dental|medical centre|medical center|healthcare provider)\b/i,
  /\b(manufactur|factory|plant|foundry|fabrication|machining|tooling|engineering works|industrial)\b/i,
  /\b(textiles?|garments?|apparel manufactur|spinning|weaving|dyeing|leather|footwear manufactur)\b/i,
  /\b(logistics|freight|transport(ers?)?|trucking|fleets?|warehous|couriers?|shipping|customs|packers)\b/i,
  /\b(hotels?|resorts?|hospitality|catering|banquets?|restaurant chain|cloud kitchen operator|canteen)\b/i,
  /\b(schools?|colleges?|university|universities|institutes?|coaching centre|coaching center|training centre)\b/i,
  /\b(law firm|legal services|chartered accountant|accounting firm|audit firm|tax consultan)\b/i,
  /\b(printing|packaging|papers?|plastics|rubber|chemicals?|cement|steel|aluminium|aluminum|metals?)\b/i,
  /\b(agri|farm|dairy|poultry|food processing|mill|cold storage|horticultur)\b/i,
  /\b(automotive|auto parts|dealership|showroom|service centre|service center|garage|workshop)\b/i,
  /\b(facility management|housekeeping|security services|manpower|staffing agency|cleaning)\b/i,
  /\b(retail (store|chain|outlet)|supermarket|wholesale|distributor|trader|trading company)\b/i,
  /\b(pharmaceutical manufactur|pharma manufactur|api manufactur|formulation)\b/i,
  /\b(event management|wedding|interior contractor|furniture manufactur|carpentry)\b/i,
  /\b(mining|quarry|quarries|oil|gas|energy (utility|distribution)|solar epc|electrical contractor)\b/i,
  /\b(travel agency|tour operator|transport operator|bus operator|taxi operator)\b/i,
];

/**
 * Is this lead a technology company?
 *
 * Reads the sector and the company/role descriptor together, because either alone lies: a sector
 * cell saying "Healthcare" covers both a hospital (non-tech) and a health-app startup (tech), and
 * the company descriptor is what separates them.
 *
 * TECH WINS TIES. "Fintech / Wealth Management" and "E-commerce (Grocery)" both carry a non-tech
 * word next to a tech one, and both are technology companies. When a business has to describe
 * itself with a tech word at all, that is what it is — so a tech signal anywhere beats a non-tech
 * signal, and the ambiguous cases fall out of a non-tech list rather than into it.
 */
export function classifyLead(fields: { sector?: string; company?: string; website?: string }): TechStance {
  const hay = [fields.sector ?? '', fields.company ?? ''].join(' ').trim();
  if (!hay) return 'unclear';
  if (TECH_SIGNALS.some((re) => re.test(hay))) return 'tech';
  if (NONTECH_SIGNALS.some((re) => re.test(hay))) return 'nontech';
  return 'unclear';
}

/** Does the user's brief ask for non-tech businesses specifically? */
export function wantsNonTech(brief: string): boolean {
  return /\bnon[\s-]?tech(nical|nology)?\b/i.test(String(brief || ''))
    || /\btraditional (business|compan|industr|sector)/i.test(String(brief || ''))
    || /\b(brick[- ]and[- ]mortar|offline business|legacy industr)\b/i.test(String(brief || ''));
}

/** Does it ask for technology companies specifically? */
export function wantsTech(brief: string): boolean {
  const b = String(brief || '');
  if (wantsNonTech(b)) return false;
  return /\b(tech|saas|software|startup|fintech|edtech|it companies|product companies)\b/i.test(b);
}

/**
 * The definition that goes INTO the search, so it looks for the right thing in the first place.
 *
 * Filtering afterwards cannot invent leads that were never searched for — if the search returns
 * twenty famous startups, dropping them leaves nothing. The definition has to reach the query.
 */
export function sectorDirective(brief: string): string {
  if (wantsNonTech(brief)) {
    return [
      '',
      'NON-TECH MEANS NON-TECHNOLOGY. This is the most important filter on this search, and the',
      'easiest one to get wrong, so it is spelled out:',
      '',
      'INCLUDE — businesses whose product is physical or a hands-on service, for whom software is',
      'something they BUY rather than something they sell:',
      '  construction and civil contractors, architects, interior contractors',
      '  hospitals, clinics, diagnostic labs, nursing homes, dental chains',
      '  manufacturing of any kind — engineering works, foundries, fabrication, machining, plastics,',
      '    packaging, textiles and garments, furniture, auto components, chemicals, cement, steel',
      '  logistics, transport fleets, warehousing, courier, freight forwarding, customs clearing',
      '  hotels, resorts, restaurant chains, catering, banquet and event businesses',
      '  schools, colleges, coaching institutes, training centres',
      '  law firms, chartered accountants, audit and tax practices',
      '  distributors, wholesalers, trading companies, retail chains with physical stores',
      '  facility management, housekeeping, security services, staffing agencies',
      '  agriculture, food processing, dairy, cold storage, mills',
      '  automotive dealerships, service centres, workshops',
      '',
      'EXCLUDE — technology companies, without exception, however non-technical the industry they',
      'serve sounds. If it sells software, an app, a platform, an online marketplace or a digital',
      'service, it does NOT belong on this list:',
      '  anything ending in -tech (fintech, edtech, adtech, healthtech, proptech, insurtech)',
      '  SaaS and software product companies, IT services, BPO/KPO, system integrators',
      '  e-commerce, D2C brands, online marketplaces, quick-commerce, social commerce',
      '  payments, neobanks, lending and trading platforms, crypto',
      '  food-delivery, ride-hailing, hyperlocal and on-demand apps',
      '  AI, analytics, data, cloud, cybersecurity, developer tools, gaming and streaming',
      '',
      'The test is what the company SELLS, not whether it uses computers — every business uses',
      'computers. A hospital that runs software is non-tech. A company that sells software to',
      'hospitals is tech.',
      '',
      'A VENTURE-BACKED CONSUMER STARTUP IS NOT A NON-TECH BUSINESS. If it is a well-known name,',
      'raised funding, or is described anywhere as a startup or a platform, leave it out. The point',
      'of this list is owner-run businesses that do not have technology people in the building.',
    ].join('\n');
  }
  if (wantsTech(brief)) {
    return [
      '',
      'TECH MEANS the company\'s product is software, a platform or an online service — SaaS, apps,',
      'marketplaces, IT services, AI/data, fintech and the rest. A traditional business that merely',
      'uses software (a hospital, a factory, a logistics firm) does NOT belong on this list.',
    ].join('\n');
  }
  return '';
}

export interface SectorFilterResult {
  kept: string[];
  /** Rows dropped, with the reason, so the user is told rather than left to notice. */
  dropped: { row: string; label: string; why: string }[];
}

/** Pull a labelled cell out of a markdown row, given the header's column order. */
function cells(row: string): string[] {
  return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

/**
 * Drop rows that contradict the brief.
 *
 * Only ever removes rows the classifier is CONFIDENT about — 'unclear' is kept, because a thin row
 * is a row to be filled in, not a wrong one, and deleting the user's results on a guess is a worse
 * failure than the one being fixed.
 */
export function filterBySector(markdown: string, brief: string): SectorFilterResult {
  const nonTech = wantsNonTech(brief);
  const tech = wantsTech(brief);
  const lines = String(markdown || '').split('\n');
  if (!nonTech && !tech) return { kept: lines, dropped: [] };

  // Find the header so the sector / company columns can be read by name rather than by position.
  const headerIdx = lines.findIndex((l) => /\|/.test(l) && /\b(name|company)\b/i.test(l));
  if (headerIdx < 0) return { kept: lines, dropped: [] };
  const heads = cells(lines[headerIdx]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => heads.findIndex((h) => names.some((n) => h.includes(n)));
  const iSector = col('sector', 'industry');
  const iCompany = col('company', 'role', 'organisation', 'organization');
  const iName = col('name');
  if (iSector < 0 && iCompany < 0) return { kept: lines, dropped: [] };

  const kept: string[] = [];
  const dropped: SectorFilterResult['dropped'] = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    const isData = i > headerIdx && t.startsWith('|') && !/^\|?[\s:|-]+\|?$/.test(t);
    if (!isData) { kept.push(line); return; }
    const c = cells(line);
    const stance = classifyLead({ sector: iSector >= 0 ? c[iSector] : '', company: iCompany >= 0 ? c[iCompany] : '' });
    const label = (iName >= 0 ? c[iName] : '') || (iCompany >= 0 ? c[iCompany] : '') || 'row';
    if (nonTech && stance === 'tech') {
      dropped.push({ row: line, label, why: `${(iCompany >= 0 ? c[iCompany] : '') || (iSector >= 0 ? c[iSector] : '')} is a technology company` });
      return;
    }
    if (tech && stance === 'nontech') {
      dropped.push({ row: line, label, why: 'not a technology company' });
      return;
    }
    kept.push(line);
  });
  return { kept, dropped };
}
