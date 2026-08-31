// ─── The arithmetic behind an invoice ────────────────────────────────────────
//
// This is the only file in the app whose output is money someone is asked to pay. Every assertion
// here is a way of being wrong that would show up on a customer's card.
//
// The failures it guards are not hypothetical — they are the state the table was actually in when
// pay-per-use was proposed: no input/output split, a hardcoded model on every row, no record of
// whose key paid, and RLS that let the customer edit their own usage.

import {
  billingSource, isBillable, priceRow, summarise, pricingReady, rupees, formatTokens,
} from './usageMeter.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

// A card only for the tests. The shipped one is deliberately empty until the owner sets prices.
const CARD = { 'gemini-3-flash-preview': { inputPaisePerMTok: 1000, outputPaisePerMTok: 4000 } };

console.log('\n=== only what we actually paid for is billable ===');
{
  ok('the managed key is billable', billingSource('nivara') === 'adris' && isBillable('adris'));
  // Each of these is the user's own capacity. Charging per token for them would be charging for
  // something adris never bought — and the bridge is SOLD on that promise.
  ok('their own API key is not', !isBillable(billingSource('own_key')));
  ok('a local model is not', !isBillable(billingSource('local')));
  ok('their Claude/Codex subscription is not', !isBillable(billingSource('agent_cli')));
  ok('the bridge maps to bridge', billingSource('agent_cli') === 'bridge');

  // Every row written before the column existed. There is no way to tell now which ran on our key.
  ok('an unrecorded source is NOT billed', !isBillable(billingSource(undefined)));
  ok('rubbish is NOT billed', !isBillable(billingSource('something-else')));
  ok('null is NOT billed', !isBillable(billingSource(null)));

  // ── THE ROUND TRIP, WHICH IS WHERE THE REVENUE WENT ───────────────────────
  //
  // The source is mapped when the row is WRITTEN and mapped again when it is READ back. A mapper
  // that does not accept its own output turns every billable row into 'unknown' on the way back,
  // and unknown is deliberately not billable — so the meter reads zero for everyone, silently, in
  // the safe direction. It was caught by looking at the usage screen, not by any type.
  for (const mode of ['nivara', 'own_key', 'local', 'agent_cli']) {
    const once = billingSource(mode);
    ok(`${mode} survives the write/read round trip`, billingSource(once) === once,
      `${mode} -> ${once} -> ${billingSource(once)}`);
  }
  ok('a stored adris row is still billable on the way back',
    isBillable(billingSource(billingSource('nivara'))));
}

console.log('\n=== a price is never invented ===');
{
  // The shipped rate card is empty on purpose: a guessed number would flow into a real invoice and
  // look authoritative.
  ok('shipped pricing is not set', !pricingReady());
  ok('...and a test card is', pricingReady(CARD));

  const row = { created_at: '2026-08-01', task_type: 'krew', tokens_consumed: 1000, source: 'nivara' };
  // null, NOT zero. A caller cannot quietly fold an unpriceable row into a total as "free".
  ok('an unpriceable row returns null, not 0', priceRow(row, {}) === null);
  ok('a non-billable row is genuinely zero',
    priceRow({ ...row, source: 'local' }, {}) === 0);
}

console.log('\n=== input and output are not the same price ===');
{
  const base = { created_at: '2026-08-01', task_type: 'krew', source: 'nivara', model_used: 'gemini-3-flash-preview' };
  const read  = { ...base, tokens_consumed: 1_000_000, input_tokens: 1_000_000, output_tokens: 0 };
  const write = { ...base, tokens_consumed: 1_000_000, input_tokens: 0, output_tokens: 1_000_000 };

  ok('a million input tokens costs the input rate', priceRow(read, CARD) === 1000);
  ok('a million output tokens costs the output rate', priceRow(write, CARD) === 4000);
  // THE WHOLE POINT. One blended number charges these two identically, which is generous to heavy
  // writers and punitive to heavy readers — and both of them are wrong.
  ok('the same token count can cost four times as much',
    priceRow(write, CARD) === priceRow(read, CARD) * 4);

  const split = { ...base, tokens_consumed: 1_000_000, input_tokens: 750_000, output_tokens: 250_000 };
  ok('a mixed row prices both halves', priceRow(split, CARD) === 750 + 1000);
}

console.log('\n=== a row with no split is approximated, and says so ===');
{
  const noSplit = {
    created_at: '2026-08-01', task_type: 'krew', source: 'nivara',
    model_used: 'gemini-3-flash-preview', tokens_consumed: 1_000_000,
  };
  const p = priceRow(noSplit, CARD);
  ok('it can still be priced', typeof p === 'number' && p > 0);
  ok('...between the two extremes', p > 1000 && p < 4000, String(p));

  const s = summarise([noSplit], CARD);
  // The number is an estimate and the screen has to be able to say so.
  ok('the summary counts it as estimated', s.estimatedRows === 1);
  ok('a row WITH a split is not counted as estimated',
    summarise([{ ...noSplit, input_tokens: 1, output_tokens: 1 }], CARD).estimatedRows === 0);
}

console.log('\n=== the summary a screen shows ===');
{
  const rows = [
    { created_at: '2026-08-01T10:00:00Z', task_type: 'krew',   tokens_consumed: 1000, source: 'nivara',
      model_used: 'gemini-3-flash-preview' },
    { created_at: '2026-08-01T12:00:00Z', task_type: 'krew',   tokens_consumed: 500,  source: 'own_key' },
    { created_at: '2026-08-02T09:00:00Z', task_type: 'coder',  tokens_consumed: 2000, source: 'agent_cli' },
    { created_at: '2026-08-02T11:00:00Z', task_type: 'krew',   tokens_consumed: 300 },   // legacy, no source
  ];
  const s = summarise(rows, CARD);

  ok('every token is counted', s.totalTokens === 3800);
  // The three numbers a user actually wants: what they owe, what their own key covered, and what
  // we cannot account for.
  ok('only the managed key is billable', s.billableTokens === 1000);
  ok('their own capacity is reported separately', s.ownTokens === 2500);
  ok('legacy rows are flagged, not hidden', s.unknownRows === 1);

  ok('days are grouped and ordered', s.byDay.length === 2 && s.byDay[0].day === '2026-08-01');
  ok('...with the right totals', s.byDay[0].tokens === 1500 && s.byDay[1].tokens === 2300);
  ok('modules are ranked by spend, not by row count',
    s.byModule[0].module === 'coder' && s.byModule[0].tokens === 2000);
  ok('...and every module keeps its row count',
    s.byModule.find((m) => m.module === 'krew').rows === 3);
  ok('sources are broken out', s.bySource.length === 4);

  // Only the one billable row has a price; the rest are genuinely zero, not unpriced.
  ok('the cost covers only billable rows', s.costPaise === priceRow(rows[0], CARD));
  ok('nothing was left unpriced', s.unpricedRows === 0);
}

console.log('\n=== an empty or unpriceable period says so rather than "₹0.00" ===');
{
  // "₹0.00" when the rate card is empty is a lie, and the most expensive kind: the user believes it.
  const s = summarise([{ created_at: '2026-08-01', task_type: 'krew', tokens_consumed: 100, source: 'nivara' }], {});
  ok('an unpriceable period reports null, not zero', s.costPaise === null);
  ok('...and says how many rows it could not price', s.unpricedRows === 1);

  // Zero is a real answer when nothing was billable, and worth stating plainly — it is the whole
  // promise of the bridge. It is only a lie when something could NOT be priced.
  const empty = summarise([], CARD);
  ok('no usage at all is an honest zero', empty.costPaise === 0);
  ok('an empty period does not crash', empty.totalTokens === 0 && empty.byDay.length === 0);
  const ownOnly = summarise([{ created_at: '2026-08-01', task_type: 'krew', tokens_consumed: 900, source: 'local' }], CARD);
  ok('a month entirely on their own key owes exactly nothing', ownOnly.costPaise === 0);
}

console.log('\n=== money and tokens, displayed ===');
{
  ok('paise become rupees', rupees(12345).startsWith('₹123.45'));
  ok('zero is shown properly', rupees(0) === '₹0.00');
  // Indian digit grouping, because the customers are in India.
  ok('lakhs group the Indian way', rupees(10000000).includes('1,00,000'), rupees(10000000));

  ok('millions are readable', formatTokens(11_082_094) === '11M');
  ok('thousands are readable', formatTokens(13_770) === '14k');
  ok('small numbers are exact', formatTokens(637) === '637');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
