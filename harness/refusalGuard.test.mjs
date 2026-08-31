// ─── The refusal that must never be the answer ───────────────────────────────
//
// Every "yes" case below is drawn from the reply a user actually got after attaching a document and
// five figures and asking for a PowerPoint. Every "no" case is an honest answer that must survive:
// throwing away a real reply is a worse bug than the one this fixes, so the no-cases carry more
// weight than the yes-cases.

import {
  looksLikeCapabilityRefusal, claimsNoFilesReceived, asksUserToPasteContent,
  shouldOverrideRefusal, wantsAnArtifact, recoveryNote,
} from './refusalGuard.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

// The real reply, near enough verbatim.
const REAL = `I **cannot create or send a \`.pptx\` file directly** — I am a text-based AI and do not have the ability to generate binary files, access your local filesystem, or "read attached files" from your message (no files were received in this chat).

### What I can do right now:
Give you a complete, meeting-ready slide structure that you can copy-paste into PowerPoint in 5-10 minutes.

### To give you the best structure, please paste or tell me:
1. The full text / key points from your document
2. What each attached image shows
3. Audience & goal

### Your move:
Paste the document text (or detailed outline) + describe the images.`;

console.log('\n=== the reply that was actually sent ===');
{
  ok('it is caught as a capability refusal', looksLikeCapabilityRefusal(REAL));
  ok('it is caught claiming no files arrived', claimsNoFilesReceived(REAL));
  ok('it is caught handing the work back', asksUserToPasteContent(REAL));
  ok('and it is overridden',
    shouldOverrideRefusal({ reply: REAL, hadFiles: true, wantedArtifact: true }));
  // Even if we somehow did not know a file was attached, the identity disclaimer alone is enough.
  ok('...on the capability claim alone',
    shouldOverrideRefusal({ reply: REAL, hadFiles: false, wantedArtifact: true }));
}

console.log('\n=== the other ways a model says the same thing ===');
{
  const variants = [
    'As an AI language model, I cannot generate a .pptx file for you.',
    "I'm not able to create PowerPoint files. However, here is an outline you can use.",
    "I do not have the ability to attach documents to this conversation.",
    "I can't access your local filesystem, so I cannot save the presentation for you.",
    "I am a text-based AI assistant and cannot produce a binary document.",
  ];
  for (const v of variants) {
    ok(`caught: ${v.slice(0, 44)}…`,
      shouldOverrideRefusal({ reply: v, hadFiles: true, wantedArtifact: true }), v);
  }
  ok('and "no files were received" on its own, when files were sent',
    shouldOverrideRefusal({ reply: 'There were no files attached to your message, so I could not read anything.', hadFiles: true, wantedArtifact: false }));
}

console.log('\n=== honest answers that MUST survive ===');
{
  // These are the ones that matter. Suppressing any of them replaces a true statement with a
  // pointless retry.
  const keep = [
    ['a real limit, honestly stated', "I couldn't reach LinkedIn just now — the page wouldn't load, so I have no rows for you."],
    ['declining for a good reason', "I won't send that email until you've checked the address — the last one bounced."],
    ['a plain answer with the word cannot', 'The council cannot meet before Thursday because two members are away.'],
    ['a deck actually delivered', 'Your deck is ready — 14 slides, every figure from your document is on its slide.'],
    ['asking a genuine question', 'Which sector should I focus the deck on — logistics or fintech?'],
    ['ordinary prose', 'The gingiva receives its blood supply from three sources, which the deck covers on slide 4.'],
    ['a short reply', 'Done.'],
    ['empty', ''],
  ];
  for (const [name, txt] of keep) {
    ok(`kept: ${name}`, !shouldOverrideRefusal({ reply: txt, hadFiles: true, wantedArtifact: true }), txt.slice(0, 70));
  }
  // "I did not receive any file" is TRUE when nothing was attached — it must only be overridden
  // when a file really was there.
  ok('"no files" is left alone when there really were none',
    !shouldOverrideRefusal({ reply: 'I did not receive any file with that message.', hadFiles: false, wantedArtifact: true }));
}

console.log('\n=== the gate: was a file even asked for ===');
{
  ok('a ppt request wants an artifact', wantsAnArtifact('make me a ppt from the attached doc'));
  ok('a word document too', wantsAnArtifact('write up a word document about this'));
  ok('a spreadsheet too', wantsAnArtifact('build a spreadsheet of these numbers'));
  ok('a question about a deck does not', !wantsAnArtifact('what should I say when I present the deck?'));
  ok('plain chat does not', !wantsAnArtifact('what do you think about marketing on X?'));
  // Without the artifact gate, an honest "I am not able to browse" would be thrown away.
  ok('a capability refusal to a NON-artifact request is left alone',
    !shouldOverrideRefusal({ reply: 'I am not able to create a live connection to your bank.', hadFiles: false, wantedArtifact: false }));
}

console.log('\n=== what the user is told instead ===');
{
  const n = recoveryNote('deck');
  ok('it names the thing being built', /presentation/i.test(n));
  ok('it does not repeat the refusal', !looksLikeCapabilityRefusal(n));
  ok('it does not apologise at length', n.length < 200, String(n.length));
  ok('a document variant exists', /document/i.test(recoveryNote('document')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
