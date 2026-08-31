// ─── The DeckSpec, as a real PowerPoint file ─────────────────────────────────
//
// This used to live in deck.ts next to the HTML renderer, and the two had drifted badly apart.
// The spec defines seventeen layouts. The HTML deck rendered all seventeen. The .pptx writer had a
// case for eight, and the other nine fell through to the bullets branch — which reads `title`,
// `body` and `bullets` and nothing else. So a chart slide arrived carrying its title and none of
// its numbers, a pricing slide none of its plans, a timeline none of its milestones.
//
// Measured on a deck using every layout: 19 of 54 pieces of content, 35%, never reached the file.
// The slide COUNT was right, which is why nobody caught it — the slides were there, and empty.
//
// That, plus text set at constant sizes that overflowed its box, is the whole of what the user
// reported: "the size of the words and everything were changed... and content was missing".
//
// It is a separate module now because it is a renderer in its own right, and because deck.ts had
// grown past the point where the HTML and the PowerPoint could be read side by side.

import type { DeckSpec, DeckSlide } from './deck';
import { slideText as T, fitSize, docProps, sectionKicker, centredRow, centredStack } from './pptxPolish';

/** Colours must reach pptxgenjs as 6-digit hex WITHOUT the '#'. */
const hx = (c: string) => (c || '#000000').replace('#', '').slice(0, 6).padStart(6, '0');

/** Who the finished file should say made it. Empty is fine and normal; a generator's name is not. */
export interface PptxAuthor { name?: string; company?: string }

export async function renderPptx(spec: DeckSpec, who: PptxAuthor = {}): Promise<Blob> {
  const mod: any = await import('pptxgenjs');
  const PptxGenJS = mod.default || mod;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'W', width: 13.333, height: 7.5 });
  pptx.layout = 'W';

  // WHAT THE FILE SAYS ABOUT ITSELF.
  //
  // Every deck shipped with `PptxGenJS Presentation` as its subject and `adris.tech` as its author.
  // Both are visible in File → Info → Properties, two clicks from a slide the user is about to
  // present as their own work — and "it looks very clearly like it's made using AI" starts there,
  // before anyone reads a word on the slides.
  const props = docProps(spec.title, who.name, who.company);
  pptx.title   = props.title;
  pptx.subject = props.subject;
  pptx.author  = props.author;
  pptx.company = props.company;

  const p = spec.palette;
  const headFont = spec.font.heading;
  const bodyFont = spec.font.body;
  const W = 13.333, H = 7.5;

  // Section dividers are numbered "01 / 04" the way a designer numbers them, which means knowing
  // how many there are before the loop starts.
  const sectionTotal = spec.slides.filter((s) => s.layout === 'section').length;
  let sectionSeen = 0;

  for (const s of spec.slides as DeckSlide[]) {
    const slide = pptx.addSlide();
    const isSurface = s.layout === 'section' || s.layout === 'closing';
    slide.background = { color: hx(isSurface ? p.surface : p.bg) };

    // A full-bleed picture on the sparse layouts, the way the chat deck does it. Drawn FIRST so the
    // brand bar, the logo and the text sit on top. pptx has no gradient fill through this API, so
    // the readability scrim the HTML gets from a gradient is two overlapping rectangles: solid
    // where the words are, fading out across the middle.
    if (s.imageData && (s.layout === 'title' || s.layout === 'section' || s.layout === 'closing')) {
      const base = hx(isSurface ? p.surface : p.bg);
      try {
        slide.addImage({ data: s.imageData, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
        slide.addShape('rect', { x: 0, y: 0, w: W * 0.52, h: H, fill: { color: base, transparency: 8 }, line: { type: 'none' } });
        slide.addShape('rect', { x: W * 0.52, y: 0, w: W * 0.22, h: H, fill: { color: base, transparency: 55 }, line: { type: 'none' } });
      } catch { /* a picture that will not encode must not cost the user the slide */ }
    }

    slide.addShape('rect', { x: 0, y: 0, w: 0.14, h: H, fill: { color: hx(p.accent) } });
    if (spec.logo) {
      try { slide.addImage({ data: spec.logo, x: W - 1.9, y: 0.3, w: 1.5, h: 0.62, sizing: { type: 'contain', w: 1.5, h: 0.62 } }); } catch { /* skip a bad logo */ }
    }
    if (s.notes) slide.addNotes(T(s.notes));

    const titleOpt = { fontFace: headFont, color: hx(p.text), bold: true } as any;
    const bodyOpt  = { fontFace: bodyFont, color: hx(p.text) } as any;
    const muteOpt  = { fontFace: bodyFont, color: hx(p.muted) } as any;

    // A HEADING THAT FITS THE SLIDE IT IS ON.
    //
    // Every size here used to be a constant, so a title the length of a sentence was set at 48pt in
    // a two-inch box and ran off the slide — the same deck that fitted perfectly in chat, where the
    // HTML measures and shrinks. `fit: 'shrink'` alone does not save it: PowerPoint recomputes that
    // factor only when someone edits the shape, so a file that is opened and presented never
    // shrinks at all. The size has to be right in the file. It is set here and `fit` is kept as
    // well, for whoever does edit it later.
    const heading = (text: string, o: { x: number; y: number; w: number; h: number; base: number; opt?: any; min?: number }) =>
      slide.addText(T(text), {
        ...(o.opt ?? titleOpt), x: o.x, y: o.y, w: o.w, h: o.h,
        fontSize: fitSize([T(text)], { w: o.w, h: o.h, base: o.base, min: o.min, lineSpacing: 1.15 }),
        valign: 'top', wrap: true, fit: 'shrink',
      });

    /** The rounded surface card the HTML deck uses for columns, cards, plans and people. */
    const panel = (x: number, y: number, w: number, h: number, accent = false) =>
      slide.addShape('roundRect', {
        x, y, w, h, rectRadius: 0.12,
        fill: { color: hx(accent ? p.accent : p.surface), transparency: accent ? 88 : 0 },
        line: accent ? { color: hx(p.accent), width: 1.25 } : { type: 'none' },
      });

    /** The thin accent rule under a heading, on every content layout in the HTML deck. */
    const rule = (y: number) =>
      slide.addShape('rect', { x: 0.9, y, w: 1.1, h: 0.045, fill: { color: hx(p.accent) }, line: { type: 'none' } });

    const kicker = (text: string, y: number) =>
      slide.addText(T(text).toUpperCase(), { x: 0.9, y, w: 11, h: 0.4, fontSize: 13, charSpacing: 3, color: hx(p.accent), fontFace: bodyFont, bold: true });

    const bulletBlock = (items: string[], o: { x: number; y: number; w: number; h: number; base: number; opt?: any }) => {
      const list = items.map((b) => T(b)).filter(Boolean);
      if (!list.length) return;
      slide.addText(list.map((b) => ({ text: b, options: { bullet: { characterCode: '2022' } } })),
        { ...(o.opt ?? bodyOpt), x: o.x, y: o.y, w: o.w, h: o.h,
          fontSize: fitSize(list, { w: o.w, h: o.h, base: o.base, lineSpacing: 1.35 }),
          lineSpacingMultiple: 1.35, valign: 'top', wrap: true, fit: 'shrink' });
    };

    // Each new layout degrades to whatever the HTML renderer degrades to when its data is missing —
    // a chart with no numbers, a comparison with one column, a card grid with no cards — so the two
    // renderers never disagree about what a given slide is.
    const asBullets = () => {
      if (s.title) heading(s.title, { x: 0.9, y: 0.8, w: 11.5, h: 1.1, base: 32 });
      rule(2.0);
      if (s.body) slide.addText(T(s.body), { ...muteOpt, x: 0.9, y: 2.15, w: 11.5, h: 0.9, fontSize: 18, valign: 'top', wrap: true });
      bulletBlock(s.bullets || [], { x: 0.9, y: s.body ? 3.1 : 2.3, w: 11.5, h: s.body ? 3.7 : 4.5, base: 20 });
    };

    switch (s.layout) {
      case 'title':
        if (s.subtitle) slide.addText(T(s.subtitle).toUpperCase(), { x: 0.9, y: 2.2, w: 11, h: 0.5, fontSize: 14, charSpacing: 3, color: hx(p.accent), fontFace: bodyFont, bold: true });
        heading(s.title || spec.title, { x: 0.9, y: 2.7, w: 11.5, h: 2, base: 48 });
        if (s.body) slide.addText(T(s.body), { ...muteOpt, x: 0.9, y: 4.8, w: 10.5, h: 1.4, fontSize: 20, valign: 'top', wrap: true });
        break;

      case 'section': {
        // WAS THE LITERAL WORD "SECTION", stamped above every chapter title. Nobody types that on a
        // divider; a designer puts the chapter number there. See pptxPolish.sectionKicker.
        sectionSeen++;
        const k = sectionKicker(sectionSeen, sectionTotal);
        if (k) slide.addText(k, { x: 0.9, y: 2.6, w: 8, h: 0.5, fontSize: 14, charSpacing: 3, color: hx(p.accent), fontFace: bodyFont, bold: true });
        heading(s.title || '', { x: 0.9, y: 3.1, w: 11, h: 1.6, base: 40 });
        if (s.subtitle) slide.addText(T(s.subtitle), { ...muteOpt, x: 0.9, y: 4.8, w: 10, h: 1, fontSize: 20, valign: 'top', wrap: true });
        break;
      }

      case 'quote':
        slide.addText('“', { x: 0.7, y: 1.0, w: 3, h: 2, fontSize: 130, color: hx(p.accent), fontFace: headFont, bold: true });
        heading(s.quote || s.title || '', { x: 1.2, y: 2.7, w: 11, h: 2.5, base: 30, opt: { ...titleOpt, bold: false, italic: true } });
        // The attribution was prefixed with a hard-coded em dash: the exact character the user asked
        // us to stop using, written by us rather than by any model.
        if (s.attribution) slide.addText(T(s.attribution), { x: 1.2, y: 5.4, w: 10, h: 0.6, fontSize: 18, color: hx(p.accent), fontFace: bodyFont, bold: true });
        break;

      case 'stat':
        if (s.title) kicker(s.title, 2.0);
        slide.addText(T(s.stat || ''), { ...titleOpt, x: 0.9, y: 2.4, w: 11.5, h: 2.4,
          fontSize: fitSize([T(s.stat || '')], { w: 11.5, h: 2.4, base: 130, min: 44 }), color: hx(p.accent), valign: 'top' });
        if (s.statLabel) slide.addText(T(s.statLabel), { ...muteOpt, x: 0.9, y: 5.0, w: 10.5, h: 1.2, fontSize: 22, valign: 'top', wrap: true });
        break;

      case 'agenda': {
        const items = (s.bullets || []).map((b) => T(b)).filter(Boolean);
        if (!items.length) { asBullets(); break; }
        kicker(s.subtitle || 'Agenda', 0.85);
        heading(s.title || 'Agenda', { x: 0.9, y: 1.3, w: 11.5, h: 1.0, base: 40 });
        rule(2.45);
        // Two columns once the list is long enough that one column would run off the slide.
        const split = items.length > 6;
        const perCol = split ? Math.ceil(items.length / 2) : items.length;
        const { w: rowH, x: agY0 } = centredStack(perCol, 4.1, 0.75, 2.7);
        const size = Math.max(12, Math.min(19, Math.round(rowH * 30)));
        items.forEach((b, bi) => {
          const col = split && bi >= perCol ? 1 : 0;
          const row = split ? bi % perCol : bi;
          const x = 0.9 + col * 5.9;
          const y = agY0 + row * rowH;
          slide.addText(String(bi + 1).padStart(2, '0'), { x, y, w: 0.7, h: rowH, fontSize: size, bold: true, color: hx(p.accent), fontFace: headFont, valign: 'middle' });
          slide.addText(b, { ...bodyOpt, x: x + 0.75, y, w: split ? 5.0 : 11.0, h: rowH, fontSize: size, valign: 'middle', wrap: true, fit: 'shrink' });
        });
        break;
      }

      case 'chart': {
        // A REAL POWERPOINT CHART, not a picture of one.
        //
        // This layout had no case at all, so a slide whose entire point was its numbers arrived
        // carrying only its title. A native chart is also editable and re-themable in PowerPoint,
        // which a rendered image never is.
        const data = (s.chartData || []).filter((d) => d && typeof d.value === 'number' && isFinite(d.value));
        if (!data.length) { asBullets(); break; }
        if (s.title) heading(s.title, { x: 0.9, y: 0.8, w: 11.5, h: 1.0, base: 34 });
        rule(1.95);
        const unit = T(s.chartUnit || '');
        try {
          slide.addChart(pptx.ChartType.bar, [{
            name: unit || 'Value',
            labels: data.map((d) => T(d.label)),
            values: data.map((d) => d.value),
          }], {
            x: 0.9, y: 2.2, w: 11.5, h: s.body ? 3.6 : 4.5,
            barDir: 'col', chartColors: [hx(p.accent)],
            showValue: true, dataLabelColor: hx(p.text), dataLabelFontFace: bodyFont, dataLabelFontSize: 12,
            catAxisLabelColor: hx(p.muted), catAxisLabelFontFace: bodyFont, catAxisLabelFontSize: 12,
            valAxisLabelColor: hx(p.muted), valAxisLabelFontFace: bodyFont, valAxisLabelFontSize: 11,
            showLegend: false, showTitle: false,
            valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
          });
        } catch {
          // A chart the library refuses to build must not cost the slide its numbers.
          bulletBlock(data.map((d) => `${T(d.label)}: ${unit}${d.value.toLocaleString()}`), { x: 0.9, y: 2.2, w: 11.5, h: 4.2, base: 20 });
        }
        if (s.body) slide.addText(T(s.body), { ...muteOpt, x: 0.9, y: 6.0, w: 11.5, h: 0.9, fontSize: 16, valign: 'top', wrap: true });
        break;
      }

      case 'comparison': {
        const cc = (s.columns || []).filter((c) => c && (c.heading || (c.bullets && c.bullets.length))).slice(0, 2);
        if (cc.length < 2) { asBullets(); break; }
        if (s.title) heading(s.title, { x: 0.9, y: 0.8, w: 11.5, h: 1.0, base: 34 });
        rule(1.95);
        const cw = 5.35;
        cc.forEach((c, ci) => {
          const cx = 0.9 + ci * (cw + 0.75);
          panel(cx, 2.25, cw, 4.4, ci === 1);
          slide.addText(T(c.heading), { x: cx + 0.35, y: 2.5, w: cw - 0.7, h: 0.6, fontSize: 20, bold: true, color: hx(p.accent), fontFace: headFont, valign: 'middle', wrap: true, fit: 'shrink' });
          bulletBlock(c.bullets || [], { x: cx + 0.35, y: 3.2, w: cw - 0.7, h: 3.2, base: 16 });
        });
        // The VS badge the HTML deck puts between the two columns.
        slide.addShape('ellipse', { x: 6.32, y: 4.13, w: 0.72, h: 0.72, fill: { color: hx(p.accent) }, line: { type: 'none' } });
        slide.addText('VS', { x: 6.32, y: 4.13, w: 0.72, h: 0.72, fontSize: 13, bold: true, color: hx(p.bg), fontFace: bodyFont, align: 'center', valign: 'middle' });
        break;
      }

      case 'cards':
      case 'process': {
        const cards = (s.cards || []).filter((c) => c && (c.heading || c.body)).slice(0, 6);
        if (!cards.length) { asBullets(); break; }
        const isProc = s.layout === 'process';
        if (s.title) heading(s.title, { x: 0.9, y: 0.8, w: 11.5, h: 1.0, base: 34 });
        rule(1.95);
        const cols = cards.length <= 2 ? 2 : 3;
        const rows = Math.ceil(cards.length / cols);
        const gap = 0.4;
        const { w: cw, x: cx0 } = centredRow(cols, 11.5, gap, 4.2, 0.9);
        const ch = Math.min(2.1, (4.45 - gap * (rows - 1)) / rows);
        cards.forEach((c, ci) => {
          const cx = cx0 + (ci % cols) * (cw + gap);
          const cy = 2.25 + Math.floor(ci / cols) * (ch + gap);
          panel(cx, cy, cw, ch);
          let ty = cy + 0.24;
          if (isProc) {
            slide.addText(String(ci + 1).padStart(2, '0'), { x: cx + 0.3, y: ty, w: 1, h: 0.35, fontSize: 14, bold: true, color: hx(p.accent), fontFace: headFont });
            ty += 0.4;
          }
          if (c.heading) slide.addText(T(c.heading), { x: cx + 0.3, y: ty, w: cw - 0.6, h: 0.5, fontSize: 16, bold: true, color: hx(p.text), fontFace: headFont, valign: 'top', wrap: true, fit: 'shrink' });
          if (c.body) {
            const bh = ch - (ty - cy) - 0.7;
            slide.addText(T(c.body), { ...muteOpt, x: cx + 0.3, y: ty + 0.52, w: cw - 0.6, h: bh,
              fontSize: fitSize([T(c.body)], { w: cw - 0.6, h: bh, base: 13, min: 9 }), valign: 'top', wrap: true, fit: 'shrink' });
          }
        });
        break;
      }

      case 'timeline': {
        const rowsT = (s.timeline || []).filter((t) => t && (t.label || t.text)).slice(0, 7);
        if (!rowsT.length) { asBullets(); break; }
        if (s.title) heading(s.title, { x: 0.9, y: 0.8, w: 11.5, h: 1.0, base: 34 });
        rule(1.95);
        // Two or three milestones used to crowd into the top of the band and leave the bottom half
        // of the slide empty. The rows fill the space they are given, up to a sensible row height.
        const { w: rh, x: ty0 } = centredStack(rowsT.length, 4.4, 1.0, 2.3);
        // The spine the milestone markers sit on.
        slide.addShape('rect', { x: 2.42, y: ty0 + 0.05, w: 0.03, h: Math.max(0.2, rowsT.length * rh - 0.2), fill: { color: hx(p.accent), transparency: 55 }, line: { type: 'none' } });
        rowsT.forEach((t, ti) => {
          const y = ty0 + ti * rh;
          slide.addText(T(t.label || ''), { x: 0.9, y, w: 1.35, h: rh, fontSize: Math.max(11, Math.min(15, Math.round(rh * 20))), bold: true, color: hx(p.accent), fontFace: headFont, align: 'right', valign: 'middle', wrap: true, fit: 'shrink' });
          slide.addShape('ellipse', { x: 2.31, y: y + rh / 2 - 0.13, w: 0.26, h: 0.26, fill: { color: hx(p.accent) }, line: { type: 'none' } });
          slide.addText(T(t.text || ''), { ...bodyOpt, x: 2.85, y, w: 9.5, h: rh, fontSize: Math.max(11, Math.min(16, Math.round(rh * 21))), valign: 'middle', wrap: true, fit: 'shrink' });
        });
        break;
      }

      case 'pricing': {
        const plans = (s.plans || []).filter((pl) => pl && pl.name).slice(0, 4);
        if (!plans.length) { asBullets(); break; }
        if (s.title) heading(s.title, { x: 0.9, y: 0.8, w: 11.5, h: 1.0, base: 34 });
        rule(1.95);
        // ONE plan used to become a full-width box with a line of text adrift inside it. Panels are
        // capped and the leftover width is split either side. See centredRow.
        const gap = 0.35;
        const { w: pw, x: px0 } = centredRow(plans.length, 11.5, gap, 3.6, 0.9);
        plans.forEach((pl, pi) => {
          const px = px0 + pi * (pw + gap);
          panel(px, 2.25, pw, 4.4, !!pl.highlight);
          slide.addText(T(pl.name), { x: px + 0.25, y: 2.5, w: pw - 0.5, h: 0.45, fontSize: 15, bold: true, color: hx(p.muted), fontFace: bodyFont, align: 'center', valign: 'middle', wrap: true, fit: 'shrink' });
          if (pl.price) slide.addText(T(pl.price), { x: px + 0.25, y: 3.0, w: pw - 0.5, h: 0.8,
            fontSize: fitSize([T(pl.price)], { w: pw - 0.5, h: 0.8, base: 30, min: 14 }), bold: true, color: hx(p.accent), fontFace: headFont, align: 'center', valign: 'middle' });
          bulletBlock(pl.bullets || [], { x: px + 0.25, y: 3.95, w: pw - 0.5, h: 2.5, base: 13 });
        });
        break;
      }

      case 'team': {
        const ppl = (s.people || []).filter((m) => m && m.name).slice(0, 8);
        if (!ppl.length) { asBullets(); break; }
        if (s.title) heading(s.title, { x: 0.9, y: 0.8, w: 11.5, h: 1.0, base: 34 });
        rule(1.95);
        const cols = Math.min(4, Math.max(1, ppl.length));
        const rows = Math.ceil(ppl.length / cols);
        const gap = 0.4;
        const { w: cw, x: cx0 } = centredRow(cols, 11.5, gap, 3.0, 0.9);
        const ch = Math.min(2.15, (4.45 - gap * (rows - 1)) / rows);
        ppl.forEach((m, mi) => {
          const cx = cx0 + (mi % cols) * (cw + gap);
          const cy = 2.25 + Math.floor(mi / cols) * (ch + gap);
          const av = Math.min(0.86, ch * 0.42);
          slide.addShape('ellipse', { x: cx + cw / 2 - av / 2, y: cy + 0.18, w: av, h: av, fill: { color: hx(p.accent), transparency: 82 }, line: { color: hx(p.accent), width: 1 } });
          slide.addText(T(m.name).trim().charAt(0).toUpperCase(), { x: cx + cw / 2 - av / 2, y: cy + 0.18, w: av, h: av, fontSize: 19, bold: true, color: hx(p.accent), fontFace: headFont, align: 'center', valign: 'middle' });
          slide.addText(T(m.name), { x: cx + 0.1, y: cy + 0.24 + av, w: cw - 0.2, h: 0.42, fontSize: 14, bold: true, color: hx(p.text), fontFace: headFont, align: 'center', valign: 'middle', wrap: true, fit: 'shrink' });
          if (m.role) slide.addText(T(m.role), { ...muteOpt, x: cx + 0.1, y: cy + 0.66 + av, w: cw - 0.2, h: 0.42, fontSize: 11, align: 'center', valign: 'top', wrap: true, fit: 'shrink' });
        });
        break;
      }

      case 'logos': {
        const names = (s.logos || []).map((l) => T(l)).filter(Boolean).slice(0, 12);
        if (!names.length) { asBullets(); break; }
        kicker(s.subtitle || 'Trusted by', 0.85);
        heading(s.title || '', { x: 0.9, y: 1.3, w: 11.5, h: 1.0, base: 34 });
        rule(2.45);
        const cols = Math.min(4, Math.max(1, names.length));
        const rows = Math.ceil(names.length / cols);
        const gap = 0.3;
        const { w: cw, x: cx0 } = centredRow(cols, 11.5, gap, 3.0, 0.9);
        const ch = Math.min(1.2, (4.0 - gap * (rows - 1)) / rows);
        names.forEach((l, li) => {
          const cx = cx0 + (li % cols) * (cw + gap);
          const cy = 2.8 + Math.floor(li / cols) * (ch + gap);
          panel(cx, cy, cw, ch);
          slide.addText(l, { x: cx + 0.12, y: cy, w: cw - 0.24, h: ch,
            fontSize: fitSize([l], { w: cw - 0.24, h: ch, base: 16, min: 9 }), bold: true, color: hx(p.text), fontFace: headFont, align: 'center', valign: 'middle', wrap: true, fit: 'shrink' });
        });
        break;
      }

      case 'two-column': {
        const cols = (s.columns || []).filter((c) => c && (c.heading || (c.bullets && c.bullets.length)));
        if (!cols.length) { asBullets(); break; }
        if (s.title) heading(s.title, { x: 0.9, y: 0.8, w: 11.5, h: 1.0, base: 30 });
        rule(1.95);
        const cw = 5.6;
        cols.slice(0, 2).forEach((c, ci) => {
          const cx = 0.9 + ci * (cw + 0.5);
          panel(cx, 2.25, cw, 4.4);
          slide.addText(T(c.heading), { x: cx + 0.4, y: 2.5, w: cw - 0.8, h: 0.6, fontSize: 20, bold: true, color: hx(p.accent), fontFace: headFont, valign: 'middle', wrap: true, fit: 'shrink' });
          bulletBlock(c.bullets || [], { x: cx + 0.4, y: 3.2, w: cw - 0.8, h: 3.2, base: 16 });
        });
        break;
      }

      case 'image-full':
        if (s.imageData) slide.addImage({ data: s.imageData, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
        if (s.title) {
          // A caption over a photograph needs its own ground, or it is unreadable on a light image.
          slide.addShape('rect', { x: 0, y: 5.9, w: W, h: 1.6, fill: { color: '000000', transparency: 45 }, line: { type: 'none' } });
          slide.addText(T(s.title), { x: 0.9, y: 6.2, w: 11, h: 1,
            fontSize: fitSize([T(s.title)], { w: 11, h: 1, base: 30, min: 16 }), bold: true, color: 'FFFFFF', fontFace: headFont, valign: 'top', wrap: true });
        }
        break;

      case 'closing':
        heading(s.title || 'Thank you', { x: 0.9, y: 2.6, w: 11.5, h: 1.6, base: 44 });
        if (s.body) slide.addText(T(s.body), { ...muteOpt, x: 0.9, y: 4.4, w: 10.5, h: 1.2, fontSize: 22, valign: 'top', wrap: true });
        if (s.subtitle) slide.addText(T(s.subtitle), { x: 0.9, y: 5.7, w: 10, h: 0.8, fontSize: 20, bold: true, color: hx(p.accent), fontFace: bodyFont, valign: 'top', wrap: true });
        break;

      case 'bullets':
      default: {
        const hasImg = !!s.imageData;
        const txtW = hasImg ? 6.8 : 11.5;
        if (s.title) heading(s.title, { x: 0.9, y: 0.8, w: txtW, h: 1.1, base: 32 });
        rule(2.0);
        if (s.body) slide.addText(T(s.body), { ...muteOpt, x: 0.9, y: 2.15, w: txtW, h: 0.9, fontSize: 18, valign: 'top', wrap: true });
        bulletBlock(s.bullets || [], { x: 0.9, y: s.body ? 3.1 : 2.3, w: txtW, h: s.body ? 3.6 : 4.4, base: 20 });
        if (hasImg) slide.addImage({ data: s.imageData!, x: 8.1, y: 1.6, w: 4.4, h: 4.4, rounding: true, sizing: { type: 'cover', w: 4.4, h: 4.4 } });
        break;
      }
    }
  }

  return (await pptx.write({ outputType: 'blob' })) as Blob;
}
