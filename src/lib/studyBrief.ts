// ─── When someone is going to be examined on it ──────────────────────────────
//
// A student attached four lecture decks and asked: "explain everything from this ppt i have an exam
// coming up for 50 marks... first do a sort of quick recap for me covering all the ppts and then
// question bank". The question bank came back excellent. The recap came back as a bullet skeleton —
// headings and phrases, no explanations — and their verdict was "if recap could have been expanded
// then it would have been more useful".
//
// Both halves of that request were in the same sentence and they pull opposite ways: "explain
// everything" and "a sort of quick recap". A model reading "quick" writes a contents page. But the
// point of revision notes is that you can revise FROM them — if the reader has to open the original
// deck to understand a line, the notes have not saved them anything, which is the whole reason they
// asked.
//
// So the resolution is stated rather than left to the model: quick means *tight*, not *thin*.

/** Words that mean "I am going to be tested on this material". */
const EXAM = /\b(exam|test|quiz|viva|midterm|semester|assessment|revision|revise|syllabus|question bank|past paper)\b/i;
/** Words that mean "teach me this", as opposed to "find me something". */
const LEARN = /\b(explain|summar\w+|recap|notes?|study|learn|understand|walk me through|go through|teach)\b/i;

export interface StudyAsk {
  /** They are revising for something. */
  exam: boolean;
  /** They want the material explained, not searched. */
  learning: boolean;
  /** The mark total, when they said one — it decides how much is worth writing. */
  marks: number | null;
}

/**
 * What kind of ask this is, from the user's own words.
 *
 * Only ever consulted when source material is actually attached. Without a document there is
 * nothing to be thorough ABOUT, and the directive would just make ordinary answers longer.
 */
export function readStudyAsk(text: string): StudyAsk {
  const t = String(text || '');
  const m = t.match(/\b(\d{1,3})\s*marks?\b/i);
  const marks = m ? parseInt(m[1], 10) : null;
  return {
    exam: EXAM.test(t) || marks != null,
    learning: LEARN.test(t),
    marks: marks != null && marks > 0 && marks <= 500 ? marks : null,
  };
}

/**
 * The instruction that makes a recap something you can actually revise from.
 *
 * Empty unless the user attached material AND is clearly studying it — an ordinary question about
 * an attached spreadsheet must not get a lecture.
 */
export function studyDirective(text: string, hasSource: boolean): string {
  if (!hasSource) return '';
  const ask = readStudyAsk(text);
  if (!ask.exam && !ask.learning) return '';

  const lines = [
    '',
    '## THEY ARE GOING TO BE TESTED ON THIS — THE NOTES HAVE TO STAND ALONE',
    '',
    'The material they attached is the syllabus. Cover **all of it**, in the order it comes in.',
    '',
    '- **"Quick" means TIGHT, NOT THIN.** Headings with half-sentences under them are a contents page,',
    '  not a recap. If the reader has to open the original file to understand one of your lines, the',
    '  notes have saved them nothing, which is the entire reason they asked.',
    '- **Every concept gets its explanation, not just its name.** Not "Flynn\'s Taxonomy: SISD, SIMD,',
    '  MISD, MIMD" but what each one actually is, how it differs from the one beside it, and where it',
    '  is used. A term with no explanation beside it is a term they cannot answer a question on.',
    '- **Keep every number, name, definition and example from the source.** Those are what gets',
    '  asked. Do not summarise a worked example away.',
    '- **Say where each part came from** (which file or module), so they can go and check.',
    '- **Never write "refer to the slides" or "see the diagram".** They came here so they would not',
    '  have to. If a diagram matters, describe what it shows — and place it if you can.',
  ];

  if (ask.marks) {
    lines.push(
      `- **The paper is worth ${ask.marks} marks.** Weight your depth accordingly: this is not a`,
      '  page of bullets, it is everything they need in front of them the night before.',
    );
  }

  return lines.join('\n');
}
