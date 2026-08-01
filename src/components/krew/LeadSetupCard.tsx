import { useState } from 'react';

// ─── Lead-list setup ─────────────────────────────────────────────────────────
// Finding leads used to mean writing one sentence and hoping the model inferred the right size,
// city and seniority from it. It usually didn't: asking for "SaaS founders in Bangalore" returned
// a mix of 5,000-person enterprises and one-person consultancies, and there was no way to say
// which you meant short of arguing with it in prose.
//
// These are HARD constraints, applied as filters on the result rather than hints in a prompt.
// Same shape as the deck setup card, so the app has one way of asking "what exactly do you want?"

/**
 * WHO YOU CAN REALISTICALLY REACH.
 *
 * Asking a model for "fintech founders in Bengaluru" gets you Kunal Shah at CRED and the founders
 * of Zolve and Juspay — real people, correctly matching the brief, and useless to someone just
 * starting out, because those are the names every model knows and every stranger emails. There is
 * also only a handful of them, which is why such a search runs dry at seven rows however many were
 * asked for: the well-known set is small.
 *
 * The fix is to say which end of the market is meant, and then look somewhere that HAS that end.
 * Household names live in the model's memory; small local businesses do not — they live on Google
 * Maps, listed with a real address and usually a phone number.
 */
export type Reach = 'local' | 'growing' | 'known';

export const REACH_OPTIONS: Array<{ key: Reach; label: string; hint: string }> = [
  { key: 'local',   label: 'Local businesses', hint: 'Found on Google Maps around your city — small, real, and far more likely to reply. Best when you are starting out.' },
  { key: 'growing', label: 'Startups & SMEs',  hint: 'Growing companies, past the local-shop stage but not household names.' },
  { key: 'known',   label: 'Well-known',       hint: 'Big, established names. Easiest to find, hardest to get a reply from.' },
];

/**
 * WHAT KIND OF THING YOU ARE LOOKING FOR.
 *
 * Everything here was built to find COMPANIES and then a decision-maker inside one. That is the
 * wrong shape for recruiting affiliates, creators or partners, where the person IS the target and
 * the company is incidental — an Instagram reviewer has no employee count, and a channel manager
 * matters because of who follows him, not how big his employer is.
 *
 * It matters that this runs through /leads rather than a research prompt: this path searches
 * first, then lays out what the search returned, then opens and verifies each profile. A research
 * answer lets the model write the names itself, which is how a co-founder who does not exist ends
 * up in a table with a confident LinkedIn URL. Same reason, different target.
 */
export type FindKind = 'companies' | 'people';

/** Where to look. Each maps to a real capability the app already has. */
export type FindSource = 'linkedin' | 'x' | 'instagram' | 'web';

export const SOURCE_OPTIONS: Array<{ key: FindSource; label: string; hint: string }> = [
  { key: 'linkedin',  label: 'LinkedIn',  hint: 'Profiles are opened and checked before they are saved — the most reliable source.' },
  { key: 'x',         label: 'X',         hint: 'Public profiles and bios. Handles are saved so the copilot can DM them.' },
  { key: 'instagram', label: 'Instagram', hint: 'Public profiles. Follower counts are only recorded when actually visible — never estimated.' },
  { key: 'web',       label: 'The web',   hint: 'Directories, podcast guest lists, conference speakers, "best of" round-ups.' },
];

/** Common people-hunts, so the usual ones are one click rather than a paragraph. */
export const PEOPLE_PRESETS: Array<{ key: string; label: string; what: string; sources: FindSource[] }> = [
  { key: 'affiliate_b2b', label: 'Affiliate partners (B2B)', sources: ['linkedin', 'web'],
    what: 'people who would promote a product to a business audience — account executives, channel and partnership managers, business-development leads at companies selling adjacent software, plus consultants and agency owners who already recommend tools to their clients' },
  { key: 'creators', label: 'Creators & reviewers', sources: ['instagram', 'x', 'web'],
    what: 'creators who review software and productivity tools for a general audience — tech reviewers, coding and AI channels, SaaS comparison accounts' },
  { key: 'resellers', label: 'Consultants & resellers', sources: ['linkedin', 'web'],
    what: 'independent consultants, IT service providers and agencies who advise businesses on software and could resell or refer a product' },
  { key: 'community', label: 'Community leaders', sources: ['x', 'linkedin', 'web'],
    what: 'people who run communities, newsletters, meetups or podcasts for founders, developers or operators' },
];

export interface LeadConfig {
  /** Companies (the original behaviour) or people in their own right (affiliates, creators). */
  find: FindKind;
  /** Which sources to search. Only meaningful when find === 'people'. */
  sources: FindSource[];
  /** Empty = start a new list. Otherwise the Brain lead list to READ, exclude, and append to —
   *  this is what /expand and /findleads used to do, folded in so there is one way to find leads. */
  addToList: string;
  what: string;              // what they do / who to look for, in the user's words
  sizes: string[];           // company-size bands
  seniority: string[];       // decision-maker levels
  city: string;
  sector: string;
  count: number;
  mustHaveLinkedIn: boolean;
  mustHaveContact: boolean;  // phone or email
  useMaps: boolean;          // local businesses → Google Maps
  /** How big a company to aim at. This is the difference between a list you can actually sell
   *  to and a list of household names who will never reply — see the Reach notes below. */
  reach: Reach;
  verify: boolean;           // open + confirm every profile before saving
}

const SIZES = [
  { key: '1-10',    label: '1–10',    hint: 'solo & tiny teams' },
  { key: '11-50',   label: '11–50',   hint: 'early startups' },
  { key: '51-200',  label: '51–200',  hint: 'scale-ups' },
  { key: '201-1000',label: '201–1k',  hint: 'mid-market' },
  { key: '1000+',   label: '1000+',   hint: 'enterprise' },
];
const SENIORITY = [
  { key: 'founder', label: 'Founder / C-level' },
  { key: 'vp',      label: 'VP / Head' },
  { key: 'manager', label: 'Manager / Lead' },
  { key: 'any',     label: 'Anyone' },
];

export default function LeadSetupCard({ defaultCity, existingLists = [], onGenerate, onCancel, disabled }: {
  defaultCity?: string;
  existingLists?: string[];
  onGenerate: (cfg: LeadConfig) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [done, setDone] = useState(false);
  const [addToList, setAddToList] = useState('');
  const [what, setWhat] = useState('');
  const [sizes, setSizes] = useState<string[]>(['11-50', '51-200']);
  const [seniority, setSeniority] = useState<string[]>(['founder']);
  const [city, setCity] = useState(defaultCity || '');
  const [sector, setSector] = useState('');
  const [count, setCount] = useState(25);
  const [mustHaveLinkedIn, setMustLI] = useState(true);
  const [mustHaveContact, setMustContact] = useState(false);
  const [useMaps, setUseMaps] = useState(false);
  const [reach, setReach] = useState<Reach>('growing');
  // Off by default. Filling in contacts ALREADY opens and confirms each profile, so ticking this
  // as well put every person through a second full browser pass — the single biggest reason a
  // 25-lead run took 25+ minutes. It only does anything when no contact-filling is requested.
  const [verify, setVerify] = useState(false);
  // Companies stays the default: it is what most runs are, and changing the default would change
  // behaviour for everyone who never opens this control.
  const [find, setFind] = useState<FindKind>('companies');
  const [sources, setSources] = useState<FindSource[]>(['linkedin', 'web']);
  const [preset, setPreset] = useState('');

  const toggle = (arr: string[], set: (v: string[]) => void, k: string) =>
    set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);

  const chip = (active: boolean) =>
    `text-[11px] px-2.5 py-1 rounded-lg border transition-fast ${active
      ? 'border-accent bg-accent text-white'
      : 'border-nv-border text-nv-faint hover:bg-nv-surface2'}`;

  if (done) {
    return (
      <div className="mx-1 my-1 px-3 py-2 rounded-xl border border-nv-border bg-nv-surface text-[11px] text-nv-faint">
        Finding leads — {count} {seniority.includes('any') ? 'people' : 'decision-makers'}
        {city ? ` in ${city}` : ''}…
      </div>
    );
  }

  return (
    <div className="mx-1 my-1 rounded-xl border border-nv-border bg-nv-surface overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-nv-border">
        <div className="text-[12.5px] font-semibold text-nv-text">Find leads</div>
        <div className="text-[10.5px] text-nv-faint mt-0.5">
          Set what you actually want — these are applied as filters, not hints, so the list comes back matching.
        </div>
      </div>

      <div className="p-3.5 space-y-3">
        {/* WHAT ARE YOU LOOKING FOR — first, because it changes what the rest of the card means.
            Company size is a sensible question about a business and a meaningless one about an
            Instagram reviewer. */}
        <div>
          <label className="text-[10px] text-nv-faint uppercase tracking-wide">What are you looking for?</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setFind('companies')} className={chip(find === 'companies')}
              title="Businesses, and the decision-maker inside each one">Companies</button>
            <button type="button" onClick={() => setFind('people')} className={chip(find === 'people')}
              title="People in their own right — affiliates, creators, consultants, community leaders">People</button>
          </div>
          {find === 'people' && (
            <p className="text-[9.5px] text-nv-faint mt-1 leading-relaxed">
              Every profile is opened and checked before it is saved, so the list is people who actually exist —
              then it goes straight to the outreach copilot.
            </p>
          )}
        </div>

        {find === 'people' && (
          <>
            <div>
              <label className="text-[10px] text-nv-faint uppercase tracking-wide">Who, roughly?</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {PEOPLE_PRESETS.map((p) => (
                  <button key={p.key} type="button" title={p.what}
                    onClick={() => { setPreset(p.key); setWhat(p.what); setSources(p.sources); }}
                    className={chip(preset === p.key)}>{p.label}</button>
                ))}
              </div>
              <p className="text-[9.5px] text-nv-faint mt-1">Pick one to fill the description below, then edit it freely.</p>
            </div>
            <div>
              <label className="text-[10px] text-nv-faint uppercase tracking-wide">Where to look</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SOURCE_OPTIONS.map((s) => (
                  <button key={s.key} type="button" title={s.hint}
                    onClick={() => toggle(sources, (v) => setSources(v as FindSource[]), s.key)}
                    className={chip(sources.includes(s.key))}>{s.label}</button>
                ))}
              </div>
              {(sources.includes('instagram') || sources.includes('x')) && (
                <p className="text-[9.5px] text-nv-faint mt-1 leading-relaxed">
                  Handles are saved so the copilot can message them there. Follower counts are recorded only when
                  they are actually visible on the profile — never estimated, so a blank means unknown, not zero.
                </p>
              )}
              {!sources.length && <p className="text-[9.5px] text-amber-600 mt-1">Pick at least one place to look.</p>}
            </div>
          </>
        )}

        {/* Topping up an existing list is the same job with one extra rule — never return anyone
            already on it. Keeping it here means one command instead of /leads + /findleads +
            /expand, and the de-duplication is guaranteed rather than asked for politely. */}
        {existingLists.length > 0 && (
          <div>
            <label className="text-[10px] text-nv-faint uppercase tracking-wide">Where do these go?</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setAddToList('')} className={chip(!addToList)}>Start a new list</button>
              {existingLists.slice(0, 6).map((t) => (
                <button key={t} type="button" onClick={() => setAddToList(t)} className={chip(addToList === t)} title={`Add to "${t}" and skip anyone already on it`}>
                  Add to: {t.length > 22 ? t.slice(0, 21) + '…' : t}
                </button>
              ))}
            </div>
            {addToList && (
              <p className="text-[9.5px] text-nv-faint mt-1 leading-relaxed">
                Reads “{addToList}” first and skips everyone already on it, so you only get new people.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="text-[10px] text-nv-faint uppercase tracking-wide">Who are you looking for?</label>
          <input
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder="e.g. B2B SaaS founders who'd use an AI agent for ops"
            className="mt-1 w-full text-xs bg-nv-bg border border-nv-border rounded-lg px-2.5 py-2 focus:outline-none focus:border-accent/40"
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="text-[10px] text-nv-faint uppercase tracking-wide">City / area</label>
            <input
              value={city} onChange={(e) => setCity(e.target.value)}
              placeholder="Bangalore (HSR)"
              className="mt-1 w-full text-xs bg-nv-bg border border-nv-border rounded-lg px-2.5 py-2 focus:outline-none focus:border-accent/40"
            />
          </div>
          <div>
            <label className="text-[10px] text-nv-faint uppercase tracking-wide">Sector</label>
            <input
              value={sector} onChange={(e) => setSector(e.target.value)}
              placeholder="FinTech, legal, D2C…"
              className="mt-1 w-full text-xs bg-nv-bg border border-nv-border rounded-lg px-2.5 py-2 focus:outline-none focus:border-accent/40"
            />
          </div>
        </div>

        {/* Company-shaped questions. A creator has no employee count and no "market position",
            so asking is noise at best and a filter that silently drops good people at worst. */}
        {find === 'companies' && <div>
          <label className="text-[10px] text-nv-faint uppercase tracking-wide">Who to aim at</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {REACH_OPTIONS.map((o) => (
              <button key={o.key} type="button" title={o.hint}
                onClick={() => setReach(o.key)}
                className={chip(reach === o.key)}>{o.label}</button>
            ))}
          </div>
          <p className="text-[9.5px] text-nv-faint mt-1 leading-relaxed">
            {REACH_OPTIONS.find((o) => o.key === reach)?.hint}
          </p>
        </div>}

        {find === 'companies' && <div>
          <label className="text-[10px] text-nv-faint uppercase tracking-wide">Company size</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {SIZES.map((s) => (
              <button key={s.key} type="button" title={s.hint}
                onClick={() => toggle(sizes, setSizes, s.key)}
                className={chip(sizes.includes(s.key))}>{s.label}</button>
            ))}
          </div>
          {/* Said plainly rather than discovered later: headcount is not published anywhere free
              and reliably, so this is read off the company's LinkedIn page one at a time. */}
          <p className="text-[9.5px] text-nv-faint mt-1 leading-relaxed">
            Size is read from each company's LinkedIn page, so a size filter makes the search slower.
            Leave all of them on to skip that check.
          </p>
        </div>}

        <div>
          <label className="text-[10px] text-nv-faint uppercase tracking-wide">Seniority</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {SENIORITY.map((s) => (
              <button key={s.key} type="button"
                onClick={() => toggle(seniority, setSeniority, s.key)}
                className={chip(seniority.includes(s.key))}>{s.label}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] text-nv-faint uppercase tracking-wide">How many</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[10, 25, 50].map((n) => (
              <button key={n} type="button" onClick={() => setCount(n)} className={chip(count === n)}>{n}</button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 pt-1 border-t border-nv-border">
          <label className="text-[10px] text-nv-faint uppercase tracking-wide block pt-2">Only keep leads that have</label>
          {[
            { on: mustHaveLinkedIn, set: setMustLI, label: 'A real LinkedIn profile', hint: 'needed to connect or message them' },
            { on: mustHaveContact, set: setMustContact, label: 'A phone or email', hint: 'checked on Google Maps + their website' },
          ].map((o) => (
            <button key={o.label} type="button" onClick={() => o.set(!o.on)}
              className="w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-nv-surface2 transition-fast">
              <span className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${o.on ? 'bg-accent border-accent' : 'border-nv-border'}`}>
                {o.on && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </span>
              <span className="min-w-0">
                <span className="text-[11.5px] text-nv-text block">{o.label}</span>
                <span className="text-[9.5px] text-nv-faint">{o.hint}</span>
              </span>
            </button>
          ))}
          {[
            { on: useMaps, set: setUseMaps, label: 'Look on Google Maps too', hint: 'best for local businesses — shops, firms, clinics' },
            { on: verify, set: setVerify, label: 'Verify profiles separately', hint: 'only needed if you are not filling in contacts above — that already confirms each one' },
          ].map((o) => (
            <button key={o.label} type="button" onClick={() => o.set(!o.on)}
              className="w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-nv-surface2 transition-fast">
              <span className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${o.on ? 'bg-accent border-accent' : 'border-nv-border'}`}>
                {o.on && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </span>
              <span className="min-w-0">
                <span className="text-[11.5px] text-nv-text block">{o.label}</span>
                <span className="text-[9.5px] text-nv-faint">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-3.5 py-2.5 border-t border-nv-border flex items-center gap-2">
        <button onClick={onCancel} disabled={disabled}
          className="text-[11px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast">
          Cancel
        </button>
        <button
          disabled={disabled || !what.trim()}
          onClick={() => {
            setDone(true);
            onGenerate({
              addToList, what: what.trim(), sizes, seniority, city: city.trim(), sector: sector.trim(),
              count, mustHaveLinkedIn, mustHaveContact, useMaps, verify, reach,
              find, sources: find === 'people' ? sources : [],
            });
          }}
          className="flex-1 text-[11.5px] font-semibold px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast disabled:opacity-50"
        >
          {what.trim() ? `Find ${count} leads` : 'Say who you\'re looking for'}
        </button>
      </div>
    </div>
  );
}
