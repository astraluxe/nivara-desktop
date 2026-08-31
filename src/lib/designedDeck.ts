// ─── An agent's presentation, designed rather than typed ─────────────────────
//
// When an agent made a PowerPoint it drove Office through COM and added every slide with the same
// layout — a title box and a bullet box, repeated. A deck of twelve identical bullet slides is an
// outline someone still has to design.
//
// Meanwhile the in-chat deck builder had been producing real design the whole time: a palette,
// varied layouts, full-bleed figures, stat and quote slides, the user's own logo on every slide.
// Agents could not reach any of it.
//
// This is the bridge. An agent hands over what it always handed over — titles and bullets — and
// gets back a designed .pptx, opened in the user's own PowerPoint.

import { deckToPptxBlob, type DeckSpec, type DeckSlide } from './deck';

export interface AgentSlide {
  title?: string;
  bullets?: string[];
  body?: string;
}

/**
 * Choose a layout for each slide from what it actually contains.
 *
 * A deck where every slide is the same shape reads as a form someone filled in. Real decks breathe:
 * they open, they break into sections, they land a number on its own, they close. None of that needs
 * the agent to know our layout names — it can be read off the content it already produced.
 */
export function planLayouts(slides: AgentSlide[]): DeckSlide[] {
  const out: DeckSlide[] = [];
  const n = slides.length;

  slides.forEach((s, i) => {
    const title = (s.title || '').trim();
    const bullets = (s.bullets || []).map((b) => String(b).trim()).filter(Boolean);
    const body = (s.body || '').trim();

    // The opener and the closer are fixed points — every deck has them, and a deck that starts on a
    // bullet slide always looks like it started halfway through.
    if (i === 0) { out.push({ layout: 'title', title, subtitle: body || undefined }); return; }
    if (i === n - 1 && n > 2) { out.push({ layout: 'closing', title: title || 'Thank you', body: body || undefined }); return; }

    // A slide whose whole point is one figure should BE that figure. "Revenue grew 42%" buried in a
    // bullet list is a fact; on its own it is a point.
    const soleNumber = bullets.length === 1 && /^[^a-zA-Z]*\d[\d.,%×x]*\s*\w{0,12}$/.test(bullets[0]);
    if (soleNumber) { out.push({ layout: 'stat', stat: bullets[0], statLabel: title }); return; }

    // A quotation, likewise.
    const quoted = bullets.length === 1 && /^["“].+["”]$/.test(bullets[0]);
    if (quoted) { out.push({ layout: 'quote', quote: bullets[0].replace(/^["“]|["”]$/g, ''), attribution: title || undefined }); return; }

    // A section marker: a heading with nothing under it.
    if (!bullets.length && !body && title) { out.push({ layout: 'section', title }); return; }

    // Two balanced halves become two columns; anything else is a bullet slide, which is still the
    // right answer most of the time.
    if (bullets.length >= 4 && bullets.length % 2 === 0 && bullets.length <= 8) {
      const half = bullets.length / 2;
      out.push({
        layout: 'two-column',
        title,
        columns: [
          { heading: title || 'Points', bullets: bullets.slice(0, half) },
          { heading: '', bullets: bullets.slice(half) },
        ],
      });
      return;
    }

    out.push({ layout: 'bullets', title, body: body || undefined, bullets });
  });

  return out;
}

/** The house palette. One deck should not look like a different product from the last one. */
export function housePalette() {
  return { bg: '#FFFFFF', surface: '#F4F3F7', text: '#14141A', muted: '#6B6B76', accent: '#7C5CFF' };
}

export function buildSpec(title: string, slides: AgentSlide[]): DeckSpec {
  return {
    title,
    font: { heading: 'Georgia', body: 'Segoe UI' },
    palette: housePalette(),
    slides: planLayouts(slides),
  } as DeckSpec;
}

/**
 * Build the file and open it in the user's PowerPoint.
 *
 * Returns the sentence the agent reports back. It says which program the file was opened in and
 * where it went, because "I made your deck" with no path is something the user cannot act on.
 */
export async function designPresentation(o: {
  title: string;
  slides: AgentSlide[];
  savePath?: string;
}): Promise<string> {
  const spec = buildSpec(o.title, o.slides);
  const blob = await deckToPptxBlob(spec);

  const b64 = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(new Error('could not read the generated deck'));
    r.readAsDataURL(blob);
  });

  const { invoke } = await import('@tauri-apps/api/core');
  const name = (o.savePath?.split(/[\\/]/).pop() || `${o.title || 'presentation'}.pptx`)
    .replace(/\.pptx?$/i, '') + '.pptx';
  const file = await invoke<string>('save_to_downloads', { filename: name, dataBase64: b64 });

  // Open it where the user can see it. A file written to disk that nobody opens is indistinguishable
  // from no file at all.
  let opened = false, why = '';
  try {
    const apps = await import('./installedApps');
    const ppt = apps.officeApp(await apps.getInstalledApps(), 'powerpoint');
    if (ppt) {
      await invoke('launch_application', { exe: ppt.path, file });
      opened = true;
    } else {
      why = 'PowerPoint is not installed on this computer';
    }
  } catch (e) {
    why = String(e).replace(/^Error:\s*/, '');
  }

  const n = spec.slides.length;
  return opened
    ? `[Designed a ${n}-slide presentation and opened it in Microsoft PowerPoint. Saved at ${file}. `
      + `The slides use real layouts — a title, sections, a full slide for any single figure, and a close — `
      + `not the same bullet layout repeated. Tell the user it is open on their screen.]`
    : `[Designed a ${n}-slide presentation and saved it at ${file}, but could not open PowerPoint`
      + `${why ? ` (${why})` : ''}. Tell the user the file is ready and where it is — do not imply it is open.]`;
}
