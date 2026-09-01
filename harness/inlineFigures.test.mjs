// ─── Showing the picture, not just describing it ─────────────────────────────
//
// A student attached four lecture decks with thirty-two figures and asked for exam notes. The notes
// said "Sketch the 4-layer architecture diagram to ensure you can label all components" — about a
// diagram that was in the attached file and was never shown. They had to reopen the .pptx to see
// the thing the notes told them to learn.
//
// The danger in fixing it runs one way: showing the WRONG figure. The reader has no reason to doubt
// a picture the app placed under a sentence, so a confident wrong match is worse than no picture at
// all. With four decks attached there are four "figure 3"s, and most of what follows is about
// refusing to guess between them.

import { figureRefs, isFigureLine, matchPicture, figureDirective, splitFigureBlocks } from './inlineFigures.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

const pic = (id, title) => ({ id, title, filePath: `C:/pics/${id}.png` });

console.log('\n=== finding the marker ===');
{
  const refs = figureRefs('Here is the model:\n\n![The four layers](figure:figure 3)\n\nAs you can see…');
  ok('one figure is found', refs.length === 1);
  ok('the caption is kept', refs[0].caption === 'The four layers', refs[0].caption);
  ok('the reference is kept', refs[0].ref === 'figure 3', refs[0].ref);

  ok('several are found in order',
    figureRefs('![a](figure:1)\ntext\n![b](figure:2)').map((r) => r.ref).join(',') === '1,2');
  ok('an ordinary image is not a figure', figureRefs('![logo](https://x.com/a.png)').length === 0);
  ok('a link is not a figure', figureRefs('[see this](figure:3)').length === 0);
  ok('an empty reference is ignored', figureRefs('![x](figure: )').length === 0);
  ok('prose with no marker finds none', figureRefs('Sketch the four-layer diagram.').length === 0);
}

console.log('\n=== a figure gets its own block ===');
{
  ok('a line that is only a marker', isFigureLine('![The four layers](figure:figure 3)'));
  ok('...with surrounding space', isFigureLine('   ![x](figure:3)   '));
  ok('a marker with words around it is not a block', !isFigureLine('See ![x](figure:3) above'));
  ok('ordinary prose is not', !isFigureLine('The four-layer model has a perception layer.'));
  ok('an empty line is not', !isFigureLine(''));
}

console.log('\n=== matching the reference to a stored picture ===');
{
  const pics = [
    pic('a', '1 - Introduction.pptx — figure 1'),
    pic('b', '1 - Introduction.pptx — figure 2'),
    pic('c', '3 - Networking Architecture.pptx — figure 7'),
  ];
  ok('the whole title matches', matchPicture('1 - Introduction.pptx — figure 2', pics)?.id === 'b');
  ok('...whatever the dash', matchPicture('1 - Introduction.pptx - figure 2', pics)?.id === 'b');
  ok('...and whatever the case', matchPicture('1 - INTRODUCTION.PPTX — FIGURE 2', pics)?.id === 'b');
  ok('an id matches', matchPicture('c', pics)?.id === 'c');
  ok('a unique figure number matches', matchPicture('figure 7', pics)?.id === 'c');
  ok('...written as Fig 7', matchPicture('Fig 7', pics)?.id === 'c');
  ok('...or just the number pattern', matchPicture('figure7', pics)?.id === 'c');
  ok('an unknown reference matches nothing', matchPicture('figure 99', pics) === null);
  ok('an empty reference matches nothing', matchPicture('', pics) === null);
  ok('no pictures at all matches nothing', matchPicture('figure 1', []) === null);
}

console.log('\n=== four decks, four "figure 3"s: refuse to guess ===');
{
  // This is the user's actual attachment set, and the case that would show the wrong diagram.
  const many = [
    pic('i3', '1 - Introduction.pptx — figure 3'),
    pic('e3', '2 - Edge Computing Essentials.pptx — figure 3'),
    pic('n3', '3 - Networking Architecture.pptx — figure 3'),
    pic('r3', '4 - Resource Management.pptx — figure 3'),
  ];
  ok('a bare "figure 3" is ambiguous and matches nothing', matchPicture('figure 3', many) === null);
  ok('naming the deck resolves it', matchPicture('Networking Architecture figure 3', many)?.id === 'n3');
  ok('...however it is written', matchPicture('networking architecture — figure 3', many)?.id === 'n3');
  ok('the full title always works', matchPicture('4 - Resource Management.pptx — figure 3', many)?.id === 'r3');
  ok('a deck that is not there matches nothing', matchPicture('Security figure 3', many) === null);
}

console.log('\n=== the instruction ===');
{
  const d = figureDirective(['1 - Introduction.pptx — figure 1', '1 - Introduction.pptx — figure 2']);
  ok('the figures are listed', d.includes('1 - Introduction.pptx — figure 1'));
  ok('the syntax is shown', d.includes('figure:'));
  ok('it says a figure goes on its own line', /own line/i.test(d));
  ok('it warns against decoration', /decoration|buries/i.test(d));
  ok('nothing is added when nothing was attached', figureDirective([]) === '');
  ok('...nor for a list of empties', figureDirective(['', null, undefined]) === '');

  // A lecture course can attach a hundred figures; the prompt must not become the deck.
  const many = figureDirective(Array.from({ length: 100 }, (_, i) => `deck.pptx — figure ${i + 1}`));
  ok('a huge attachment set is capped', (many.match(/deck\.pptx/g) || []).length <= 40);
  ok('...and says how many were left out', /and 60 more/.test(many));
}


console.log('\n=== splitting prose from plates ===');
{
  const b = splitFigureBlocks('The model has four layers.\n\n![The four layers](figure:figure 3)\n\nEach one does a job.');
  ok('three blocks', b.length === 3, JSON.stringify(b.map((x) => x.kind)));
  ok('prose, figure, prose', b[0].kind === 'text' && b[1].kind === 'figure' && b[2].kind === 'text');
  ok('the caption survives', b[1].caption === 'The four layers');
  ok('the reference survives', b[1].ref === 'figure 3');
  ok('the prose is not mangled', b[0].text.includes('four layers') && b[2].text.includes('Each one'));

  // A marker mid-sentence is a mention, not a plate — pulling it out would break the sentence.
  const inline = splitFigureBlocks('As ![this](figure:3) shows, the layers stack.');
  ok('an inline marker stays in the text', inline.length === 1 && inline[0].kind === 'text');

  ok('prose with no figures is one block',
    splitFigureBlocks('Just an answer.').length === 1);
  ok('an empty answer produces nothing', splitFigureBlocks('').length === 0);
  ok('blank lines between two figures are not a paragraph',
    splitFigureBlocks('![a](figure:1)\n\n![b](figure:2)').every((x) => x.kind === 'figure'));
  ok('a figure at the very start works',
    splitFigureBlocks('![a](figure:1)\nThen words.')[0].kind === 'figure');
  ok('a figure at the very end works', (() => {
    const s = splitFigureBlocks('Words.\n![a](figure:1)');
    return s[s.length - 1].kind === 'figure';
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
