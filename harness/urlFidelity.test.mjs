// ─── Answer about the link they gave you ─────────────────────────────────────
//
// A user asked for research on https://iangroup.vc/portfolio/ and got back:
//
//   "I couldn't access the full portfolio page at `ian-fund.com/portfolio/` — it blocked the
//    browser and didn't load."
//
// ian-fund.com is a DIFFERENT SITE — a link in the navigation of the page they gave. And their page
// was never blocked: it returns 200 and our own browser navigates it fine. The reader sees their
// link, sees a failure under it, and concludes their link is broken.
//
// The risk in fixing this runs the other way too: following links is normal and often necessary, and
// a check that fires whenever an answer mentions another domain would be worse than useless. So most
// of what follows is cases that must NOT fire.

import { hostsIn, linksIn, claimsPageFailure, checkUrlFidelity, urlDirective, fidelityNote } from './urlFidelity.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== reading hosts out of what people write ===');
{
  ok('a full url', hostsIn('look at https://iangroup.vc/portfolio/ please').includes('iangroup.vc'));
  ok('a bare domain', hostsIn('check iangroup.vc for me').includes('iangroup.vc'));
  ok('www is not a different site', hostsIn('https://www.ian-fund.com/').includes('ian-fund.com'));
  ok('several at once', hostsIn('compare a.com and https://b.co.uk/x').length === 2);
  ok('trailing punctuation is not part of the host',
    hostsIn('see iangroup.vc, then stop').includes('iangroup.vc'));
  // Things that look like hosts and are not.
  ok('a file name is not a host', hostsIn('open report.pdf and notes.md').length === 0, JSON.stringify(hostsIn('open report.pdf and notes.md')));
  ok('a source file is not a host', hostsIn('edit src/lib/entitlement.ts').length === 0);
  ok('plain prose has none', hostsIn('find out how much they invested').length === 0);
}

console.log('\n=== spotting a claim that a page failed ===');
{
  ok('"could not access"', claimsPageFailure("I couldn't access the full portfolio page"));
  ok('"blocked the browser"', claimsPageFailure('it blocked the browser and did not load'));
  ok('"unable to open"', claimsPageFailure('I was unable to open that page'));
  ok('"timed out"', claimsPageFailure('the request timed out'));
  // A successful read is not a failure, however it is phrased.
  ok('a page that loaded is not a failure', !claimsPageFailure('The page loaded and lists 260+ startups.'));
  ok('an honest absence is not a failure',
    !claimsPageFailure('The page loaded but does not publish per-company amounts.'), 'this is the RIGHT answer');
}

console.log('\n=== the reported case ===');
{
  const r = checkUrlFidelity({
    request: 'https://iangroup.vc/portfolio/ (check with this link do a bit of research and find out how much they have invested in each)',
    answer: "I couldn't access the full portfolio page at `ian-fund.com/portfolio/` — it blocked the browser and didn't load. The IAN Group site itself only states they've invested in 260+ startups.",
  });
  ok('their host is recognised', r.asked.includes('iangroup.vc'), JSON.stringify(r.asked));
  ok('the blamed host is the other one', r.blamed.includes('ian-fund.com'), JSON.stringify(r.blamed));
  ok('and it is caught', r.wrongTarget);
}

console.log('\n=== what must NOT be caught ===');
{
  const req = 'look at https://iangroup.vc/portfolio/ and tell me what you find';

  // The right answer to that request. It names their page and reports honestly.
  ok('an honest report on their own page',
    !checkUrlFidelity({ req, request: req,
      answer: 'iangroup.vc/portfolio loaded fine. It lists 260+ companies and publishes no investment amounts.' }).wrongTarget);

  // Following a link and saying so is correct behaviour, not a fault.
  ok('following a link and being clear about it',
    !checkUrlFidelity({ request: req,
      answer: 'iangroup.vc/portfolio opened. From there I followed their Fund I link to ian-fund.com, which would not load.' }).wrongTarget);

  // A failure on THEIR page, honestly reported, is exactly what we want to allow.
  ok('an honest failure on their own page',
    !checkUrlFidelity({ request: req, answer: 'I could not open iangroup.vc/portfolio — it timed out twice.' }).wrongTarget);

  // No link in the request: nothing to be unfaithful to.
  ok('no link was given',
    !checkUrlFidelity({ request: 'find me some investors', answer: 'I could not open crunchbase.com.' }).wrongTarget);

  // Mentioning other sites while succeeding is not a failure claim at all.
  ok('other sites mentioned in a successful answer',
    !checkUrlFidelity({ request: req,
      answer: 'From iangroup.vc I also checked tracxn.com and crunchbase.com for figures.' }).wrongTarget);

  // A sub-domain is the same site.
  ok('a subdomain is not a different site',
    !checkUrlFidelity({ request: 'check example.com', answer: 'I could not load docs.example.com.' }).wrongTarget);
}

console.log('\n=== the instruction it adds ===');
{
  const d = urlDirective(['https://iangroup.vc/portfolio/']);
  ok('it repeats the link', d.includes('https://iangroup.vc/portfolio/'));
  ok('it demands the source of each finding', /which page each finding came from/i.test(d));
  ok('it forbids blaming the wrong site', /never report a failure on a different site/i.test(d));
  ok('it asks for what WAS there', /does not publish that figure/i.test(d));
  ok('nothing is added when there is no link', urlDirective([]) === '');
}


console.log('\n=== quoting their link back as they wrote it ===');
{
  // A path is part of the request. Quoting back the bare domain loses what they asked for.
  ok('the path is kept',
    linksIn('research https://iangroup.vc/portfolio/ for me').includes('https://iangroup.vc/portfolio/'));
  ok('a bare domain with a path counts',
    linksIn('check iangroup.vc/portfolio for me').includes('iangroup.vc/portfolio'));
  ok('a trailing full stop is not part of the link',
    linksIn('see https://example.com/x. thanks').includes('https://example.com/x'));
  ok('prose has no links', linksIn('find me some investors').length === 0);
  ok('the same link twice is one link', linksIn('https://a.com/x and https://a.com/x').length === 1);
}

console.log('\n=== the note added under a wrong-target answer ===');
{
  const n = fidelityNote(
    'https://iangroup.vc/portfolio/ find out how much they invested',
    "I couldn't access the full portfolio page at `ian-fund.com/portfolio/` — it blocked the browser and didn't load.");
  ok('it names the site actually blamed', n.includes('ian-fund.com'));
  ok('it names the site they asked about', n.includes('iangroup.vc'));
  // We never checked their page from inside the app, so the note may not say it works.
  ok('it does not claim their page works', !/works|loads fine|is fine/i.test(n));
  ok('nothing is added when the answer was honest',
    fidelityNote('look at https://iangroup.vc/portfolio/',
      'iangroup.vc/portfolio lists 260+ companies and publishes no amounts.') === '');
  ok('nothing is added to an ordinary answer', fidelityNote('write me a poem', 'Here is a poem.') === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
