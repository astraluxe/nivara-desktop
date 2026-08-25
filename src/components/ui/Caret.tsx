/**
 * The disclosure caret.
 *
 * This replaces the literal `▲`/`▼` characters that were scattered through the app. They were the
 * single loudest dated signal in the interface, for three reasons worth writing down so they do not
 * come back:
 *
 *  - they render in whatever glyph the font happens to carry, so their weight and size never
 *    matched the text beside them;
 *  - swapping one character for another is a jump cut, where every other state change in the app
 *    is a transition;
 *  - they sit on the text baseline, which is why they always looked a pixel or two off.
 *
 * One triangle that rotates is the same information, costs nothing, and reads as a control.
 */
export default function Caret({ open, className = '' }: { open: boolean; className?: string }) {
  return (
    <svg
      width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true"
      className={`inline-block shrink-0 transition-transform duration-med ease-nv ${className}`}
      style={{ transform: open ? 'rotate(90deg)' : 'none', verticalAlign: 'middle' }}
    >
      <path d="M3.5 1.5 L7.5 5 L3.5 8.5" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
