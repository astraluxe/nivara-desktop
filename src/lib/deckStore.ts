// ─── Last-deck bridge ────────────────────────────────────────────────────────
// The Krew chat holds the deck the user just made in React state, but the agent TOOLS
// (krewTools.executeTool) run outside that component. This tiny module-level store lets the
// chat publish the most recent DeckSpec so a tool (e.g. gmail_send_bulk with attach_deck) can
// grab it, render a PDF via deckToPdfBlob, and attach it to an email.
import type { DeckSpec } from './deck';

let lastDeck: DeckSpec | null = null;

export function setLastDeck(spec: DeckSpec | null) { lastDeck = spec; }
export function getLastDeck(): DeckSpec | null { return lastDeck; }

// Render the last deck to a base64 PDF (no data: prefix) for use as an email attachment.
// Returns null if there's no deck yet or rendering fails.
export async function lastDeckPdfBase64(): Promise<{ base64: string; filename: string } | null> {
  if (!lastDeck) return null;
  try {
    const { deckToPdfBlob } = await import('./deck');
    const blob = await deckToPdfBlob(lastDeck);
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const slug = (lastDeck.title || 'presentation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'presentation';
    return { base64, filename: `${slug}.pdf` };
  } catch { return null; }
}
