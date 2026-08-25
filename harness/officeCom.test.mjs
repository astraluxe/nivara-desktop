import {
  chooseEngine, engineNote, checkSpec, buildPayload, buildScript,
  assertSafePayload, EXPECTED_EXT,
} from './officeCom.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got : ${JSON.stringify(g)}\n        want: ${JSON.stringify(w)}`);

const OFFICE_YES = { word: true, excel: true, powerpoint: true, outlook: false, libreoffice: false };
const OFFICE_NO  = { word: false, excel: false, powerpoint: false, outlook: false, libreoffice: false };
const WORD_SPEC = {
  kind: 'word', savePath: 'C:\\Users\\a\\Documents\\p.docx',
  blocks: [{ style: 'title', text: 'Hello' }],
};

console.log('\n=== which engine, and never a "probably" ===');
eq('real Office when its COM server is registered', chooseEngine(OFFICE_YES, 'word'), 'office');
eq('the built-in generator when it is not',         chooseEngine(OFFICE_NO, 'word'), 'builtin');
eq('a missing scan is not treated as yes',          chooseEngine(null, 'word'), 'builtin');
eq('each kind is asked about separately',
   chooseEngine({ ...OFFICE_NO, excel: true }, 'excel'), 'office');
eq('...and one being present does not vouch for another',
   chooseEngine({ ...OFFICE_NO, excel: true }, 'word'), 'builtin');

console.log('\n=== the sentence the user is owed ===');
{
  const withT = engineNote('office', 'word', true);
  ok('a template is named as intact', /your own template/i.test(withT), withT);
  const noT = engineNote('office', 'word', false);
  ok('no template says default blank', /default blank/i.test(noT), noT);
  ok('...and does not claim a template', !/your own template/i.test(noT), noT);

  const gen = engineNote('builtin', 'word', false);
  ok('the fallback says Office was NOT used', /not available for automation/i.test(gen), gen);
  ok('...and warns the branding is missing', /does NOT carry your template/i.test(gen), gen);
  ok('...and never claims it was made in Word',
     !/^Made in/i.test(gen) && !/Made in Microsoft Word on this computer/i.test(gen), gen);
}

console.log('\n=== the spec has to be right before Office is ever started ===');
eq('a good spec passes', checkSpec(WORD_SPEC), null);
ok('a relative path is refused', /absolute Windows path/i.test(checkSpec({ ...WORD_SPEC, savePath: 'p.docx' }) ?? ''));
ok('a path with no drive is refused', /absolute Windows path/i.test(checkSpec({ ...WORD_SPEC, savePath: 'C:Users\\p.docx' }) ?? ''));
ok('the wrong extension is refused', /must be saved as \.docx/i.test(checkSpec({ ...WORD_SPEC, savePath: 'C:\\a\\p.pdf' }) ?? ''));
ok('Word with no content is refused', /No content/i.test(checkSpec({ ...WORD_SPEC, blocks: [] }) ?? ''));
ok('Excel with no rows is refused',
   /No rows/i.test(checkSpec({ kind: 'excel', savePath: 'C:\\a\\b.xlsx' }) ?? ''));
ok('PowerPoint with no slides is refused',
   /No slides/i.test(checkSpec({ kind: 'powerpoint', savePath: 'C:\\a\\b.pptx' }) ?? ''));
eq('each kind knows its extension', EXPECTED_EXT, { word: '.docx', excel: '.xlsx', powerpoint: '.pptx' });

// ── The one that matters most ────────────────────────────────────────────────
// Content is written by a language model and ends up inside a PowerShell script. It travels as JSON
// data inside a single-quoted here-string, which interpolates nothing — so none of the below can
// become code. These assert the property holds rather than trusting that it does.
console.log('\n=== model-written text cannot become a command ===');
{
  const nasty = [
    "it's an apostrophe",
    '$env:USERPROFILE',
    '$(Remove-Item C:\\ -Recurse)',
    '"; Stop-Process -Name WINWORD; "',
    'a `backtick` and a $var',
    "'@\nStop-Process -Name WINWORD\n@'",
  ];
  for (const text of nasty) {
    const script = buildScript({ ...WORD_SPEC, blocks: [{ style: 'body', text }] });
    const payloadLine = script.split('\n')[1];
    ok(`inert: ${JSON.stringify(text).slice(0, 34)}…`,
       // The payload is exactly one line, and the here-string is still closed by a lone '@.
       !/[\r\n]/.test(payloadLine) && script.includes("\n'@\n"),
       payloadLine);
  }
  ok('a newline in the payload is rejected outright', (() => {
    try { assertSafePayload('{"a":"b"}\n{"c":"d"}'); return false; } catch { return true; }
  })());
  // Deliberately ALLOWED. "'@" cannot close a here-string unless it starts a line, and the payload
  // is always one line — so refusing it would only mean refusing to write an ordinary document that
  // happened to contain those two characters. An earlier version did refuse, and was wrong.
  ok("a lone '@ inside the text is written, not refused", (() => {
    const s = buildScript({ ...WORD_SPEC, blocks: [{ style: 'body', text: "email me at bob'@example.com" }] });
    return s.includes("bob'@example.com") && s.includes("\n'@\n");
  })());
  ok('a payload that BEGINS with a terminator is still rejected', (() => {
    try { assertSafePayload("'@ everything after this"); return false; } catch { return true; }
  })());
  ok('a newline in the TEXT survives as JSON, without breaking the payload', (() => {
    const s = buildScript({ ...WORD_SPEC, blocks: [{ style: 'body', text: 'line one\nline two' }] });
    return s.split('\n')[1].includes('line one\\nline two');
  })());
}

console.log('\n=== the script is fixed; only the data changes ===');
{
  const a = buildScript(WORD_SPEC);
  const b = buildScript({ ...WORD_SPEC, blocks: [{ style: 'body', text: 'totally different' }] });
  const bodyOf = (s) => s.split("\n'@\n")[1];
  eq('two different documents produce byte-identical code', bodyOf(a), bodyOf(b));
  ok('the payload carries the content, not the code', buildPayload(WORD_SPEC).includes('Hello'));
}

console.log('\n=== styles are numbers, because names are translated ===');
{
  const s = buildScript(WORD_SPEC);
  ok('built-in style IDs are used', /title = -63; heading = -2/.test(s), s.slice(0, 200));
  ok('no English style name is looked up', !/Styles\.Item\("Heading 1"\)/.test(s));
}

console.log('\n=== only our own Office processes are ever stopped ===');
{
  const s = buildScript(WORD_SPEC);
  ok('processes present beforehand are recorded', /\$theirs = @\(Get-Process/.test(s));
  ok('only ids not seen before are stopped', /if \(\$theirs -notcontains \$p\.Id\)/.test(s));
  ok('nothing is ever killed by name alone', !/Stop-Process -Name/.test(s));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
