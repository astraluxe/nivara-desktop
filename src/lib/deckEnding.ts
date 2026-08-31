// ─── A deck that actually ends ───────────────────────────────────────────────
//
// The user, twice: "it never gives the ppt a proper ending the content is fydn but the ending part
// must be made proper... and i still feel the ppt wasnt completed".
//
// Both halves of that are the same thing. The deck prompt asks for a closing slide, and on a long
// deck the model is still writing content slides when it runs out of output budget — so the last
// thing it emits is whatever slide it happened to be on, and the deck stops rather than ends. A
// prompt cannot fix that, because the failure IS the prompt not being reached.
//
// So the ending is guaranteed in code, after generation and after the review pass, from the deck's
// own content. Nothing here invents a fact: the summary is built from the headings the deck already
// has, which is what a person would put on that slide anyway.

import type { DeckSpec, DeckSlide } from './deck';

/** Layouts that carry a heading worth recapping. A divider or a cover is not a point being made. */
const CONTENT_LAYOUTS = new Set([
  'bullets', 'two-column', 'comparison', 'cards', 'process', 'timeline',
  'chart', 'stat', 'pricing', 'team', 'image-full',
]);

const SUMMARY_TITLE = /\b(summary|key ?(points|takeaways?|findings)|takeaways?|conclusion|recap|in ?summary|wrap ?up)\b/i;

/** Does this deck already say goodbye properly? */
export function hasClosing(spec: DeckSpec): boolean {
  const slides = spec.slides ?? [];
  if (!slides.length) return false;
  // Only the LAST slide counts. A closing in the middle is a mislabelled content slide, and a deck
  // that ends three slides after its "Thank you" still ends abruptly.
  return slides[slides.length - 1]?.layout === 'closing';
}

/** Does it already recap itself? */
export function hasSummary(spec: DeckSpec): boolean {
  return (spec.slides ?? []).some((s) => SUMMARY_TITLE.test(String(s.title ?? '')));
}

/**
 * The points a recap should make, taken from the deck's own headings.
 *
 * Deliberately the headings and not a re-reading of the bullets: a heading is already the one-line
 * version of its slide, which is exactly what belongs on a summary. Deduplicated, because a deck
 * that repeated a heading should not repeat it again here.
 */
export function keyPoints(spec: DeckSpec, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of spec.slides ?? []) {
    if (!CONTENT_LAYOUTS.has(s.layout)) continue;
    const t = String(s.title ?? '').trim();
    if (!t || SUMMARY_TITLE.test(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  // A recap of twenty headings is not a recap. Spread the choice across the deck rather than taking
  // the first six, so the ending reflects the whole talk instead of its opening.
  if (out.length <= max) return out;
  const step = out.length / max;
  return Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]);
}

export interface EndingResult {
  spec: DeckSpec;
  /** What was added, for telling the user honestly rather than silently growing their deck. */
  added: ('summary' | 'closing')[];
}

/**
 * Give the deck a real ending, if it does not have one.
 *
 * Runs LAST — after generation, after continuation, after the review pass — because every one of
 * those can leave the deck stopping mid-thought, and because a closing added before the reviewer
 * runs is a closing the reviewer may quietly drop.
 *
 * Adds at most two slides, and only the ones that are missing. A deck that already ends well is
 * returned untouched, with nothing claimed.
 */
export function ensureProperEnding(spec: DeckSpec): EndingResult {
  const slides = [...(spec.slides ?? [])];
  const added: ('summary' | 'closing')[] = [];
  if (!slides.length) return { spec, added };

  // A stray "closing" in the middle is a content slide the model mislabelled. Demote it, or the
  // deck reads as though it ended and then carried on.
  for (let i = 0; i < slides.length - 1; i++) {
    if (slides[i].layout === 'closing') {
      slides[i] = { ...slides[i], layout: 'bullets',
        bullets: slides[i].bullets?.length ? slides[i].bullets : [slides[i].body || slides[i].subtitle || ''].filter(Boolean) };
    }
  }

  // A recap, but only when there is enough deck to be worth recapping.
  const points = keyPoints({ ...spec, slides } as DeckSpec);
  if (slides.length >= 8 && !hasSummary({ ...spec, slides } as DeckSpec) && points.length >= 3) {
    slides.push({ layout: 'bullets', title: 'Key points', bullets: points,
      notes: 'Recap the main points before closing.' } as DeckSlide);
    added.push('summary');
  }

  // And an actual ending.
  if (slides[slides.length - 1]?.layout !== 'closing') {
    slides.push({
      layout: 'closing',
      title: 'Thank you',
      body: String(spec.title ?? '').trim() || undefined,
      subtitle: 'Questions & discussion',
      notes: 'Invite questions.',
    } as DeckSlide);
    added.push('closing');
  }

  return { spec: { ...spec, slides }, added };
}
