// ─── Deciding whether a paste is Markdown ────────────────────────────────────
//
// The risk here is entirely one-sided. Failing to render Markdown is a small annoyance the user can
// fix in a second. Rendering something that was NOT Markdown silently rewrites what they wrote —
// their hyphens become bullets, their asterisks disappear. So every "no" case below matters more
// than every "yes" case, and the rule is deliberately hard to pass.

import { looksLikeMarkdown, markdownSignals, pasteMode } from './markdownPaste.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const yes = (label, t) => ok(`renders: ${label}`, looksLikeMarkdown(t) === true);
const no  = (label, t) => ok(`leaves alone: ${label}`, looksLikeMarkdown(t) === false);

console.log('\n=== structure nobody types by accident ===');
{
  yes('a table', '| Name | Role |\n| --- | --- |\n| Priya | Founder |');
  yes('a heading', '## Blood supply\n\nThe gingiva receives its supply from three sources.');
  yes('a deeper heading', '#### Notes\n\nSomething worth keeping in the Brain.');
  yes('a fenced code block', 'Try this:\n```\nnpm run build\n```\nand see.');
  yes('a full document', '# Title\n\nSome intro.\n\n- one\n- two\n\n**bold** and [a link](https://x.com)');

  // One pipe line is a sentence with a pipe in it, not a table.
  no('a single line with pipes', 'The command is: cat file | grep thing | wc -l');
  // One backtick fence with no closing one is not a code block.
  no('a lone stray backtick line', 'He said ```that``` and left the room without saying anything else');
}

console.log('\n=== ordinary prose is never touched ===');
{
  // These are the cases that matter. Rewriting any of them would be worse than the bug.
  no('a plain paragraph', 'Had a chance to see Adris in action today. What impressed me most was how naturally it fits together.');
  no('a hyphenated sentence', 'The local-first workflow is well thought out - it just works.');
  no('a dash used as a bullet, once', '- call the supplier tomorrow');
  no('an email signature', 'Thanks,\nAmogh\nadris.tech\nBengaluru, India');
  no('a maths-ish line', 'Revenue = 3 * 1499 and costs = 2 * 200 across the quarter');
  no('an address', '12/3, MG Road\nBengaluru 560001\nKarnataka');
  no('something short', '# hi');
  no('nothing at all', '');
  no('whitespace', '   \n  \n ');
}

console.log('\n=== weak signals need company ===');
{
  // Bullets alone could be someone's dashed list — leave it as typed.
  no('bullets alone', '- milk\n- eggs\n- bread');
  no('numbers alone', '1. wake up\n2. drink coffee');
  // Bullets AND bold, or bullets AND links, is a document.
  yes('bullets and bold', '- **Cost**: nothing\n- **Time**: minutes\n- **Risk**: low here');
  yes('numbers and links', '1. Read [the docs](https://x.com)\n2. Then [the guide](https://y.com)');
}

console.log('\n=== HTML is never re-parsed as Markdown ===');
{
  // A note run through the Markdown renderer once had its own tags escaped into visible text. That
  // exact bug has bitten this codebase before; this is the guard against repeating it here.
  no('a table in HTML', '<table><tr><td>Priya</td><td>Founder</td></tr></table>');
  no('paragraphs in HTML', '<p>First thought.</p><p>Second thought.</p>');
  no('HTML with markdown-ish text inside', '<div>## not a heading, just text</div><p>more</p>');
}

console.log('\n=== which branch a real paste takes ===');
{
  // Copying from a web page gives real HTML — let the editor take it, unchanged.
  ok('rich HTML wins', pasteMode('<p>Hello <strong>there</strong></p>', 'Hello there') === 'html');
  // Browsers wrap even plain text in a bare fragment; that is not rich content.
  ok('a bare wrapper is not rich',
    pasteMode('<meta charset="utf-8">## Heading\n\ntext here', '## Heading\n\ntext here') === 'markdown');
  ok('markdown with no html at all', pasteMode('', '## Heading\n\nbody text here') === 'markdown');
  ok('plain prose stays plain', pasteMode('', 'just a sentence I typed out') === 'plain');
  ok('nothing is plain', pasteMode('', '') === 'plain');
}

console.log('\n=== the counts behind the decision ===');
{
  const s = markdownSignals('# T\n\n| a | b |\n| - | - |\n\n- x\n- y\n\n**bold** [l](u)\n\n---');
  ok('headings counted', s.headings === 1, String(s.headings));
  ok('table rows counted', s.tables >= 2, String(s.tables));
  ok('bullets counted', s.bullets === 2, String(s.bullets));
  ok('bold counted', s.bold === 1, String(s.bold));
  ok('links counted', s.links === 1, String(s.links));
  ok('a rule counted', s.rules === 1, String(s.rules));
  ok('a single asterisk is not bold', markdownSignals('5 * 3 = 15').bold === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
