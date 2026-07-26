import { useMemo } from 'react';

// ─── The "still working" indicator ───────────────────────────────────────────
//
// A small rotating globe built out of dots: rings of latitude, drawn as points rather than lines,
// each one swelling as it comes round to the front and shrinking as it passes behind. It replaces
// the single pulsing dot on the progress panel, which did its job but looked like a placeholder.
//
// Built with CSS 3D transforms rather than canvas or WebGL:
//   - No animation frame loop and no JS running per frame. The browser composites the rotation and
//     the dot scaling on the GPU, so an indicator that may sit on screen for twenty minutes of a
//     lead run costs effectively nothing and never competes with the work it is reporting on.
//   - Nothing extra to bundle.
//
// THE DEPTH TRICK, which is what makes it read as a sphere instead of a blob of dots:
// CSS cannot vary a dot's opacity by how far away it currently is, and the first version without
// it looked flat — front and back were identical, so the silhouette was round but the inside was
// mush. The fix needs no per-frame code. A dot's distance from the viewer is a pure function of
// its longitude and how far the globe has turned, and both are periodic with the SAME period. So
// the scale/opacity animation is given exactly the rotation's duration, and each dot's
// animation-delay is set so that its peak lands at the moment it faces the viewer. Near dots are
// then genuinely large and bright, far dots small and faint, and the "wave" travelling around the
// sphere is the depth cue rather than a decoration bolted onto it.

type Tone = 'work' | 'halt' | 'wait';

/** Seconds for one full turn. Must match `nv-globe-turn`/`nv-globe-wave` in index.css — the depth
 *  illusion depends on the two running at exactly the same period. */
const SPIN_SECONDS = 7;

/** Latitude rings, with dot counts proportional to cos(latitude) — the way a globe's parallels
 *  actually shorten toward the poles. SEVEN rings, not five: with five, the middle three are all
 *  within a whisker of the same width, so the silhouette came out a rounded SQUARE rather than a
 *  circle. Seven gives the taper enough steps to read as a ball at 22px. */
const RINGS: Array<{ lat: number; count: number }> = [
  { lat: 74, count: 3 },
  { lat: 49, count: 7 },
  { lat: 24, count: 10 },
  { lat: 0, count: 11 },
  { lat: -24, count: 10 },
  { lat: -49, count: 7 },
  { lat: -74, count: 3 },
];

export function StatusGlobe({ size = 22, tone = 'work' }: { size?: number; tone?: Tone }) {
  const r = size / 2 - 1.5;                     // a hair of room so the near side never clips

  // Positions never change, so compute them once rather than re-deriving 40 sines on every repaint
  // of a panel that repaints on every progress message.
  const dots = useMemo(() => {
    const out: Array<{ y: number; lon: number; ring: number; delay: number; pole?: boolean }> = [];
    RINGS.forEach(({ lat, count }, ringIdx) => {
      const rad = (lat * Math.PI) / 180;
      const y = -r * Math.sin(rad);             // screen Y grows downward, so north is negative
      const ringRadius = r * Math.cos(rad);
      for (let i = 0; i < count; i++) {
        // Offset alternate rings so dots sit in a quincunx rather than straight columns — columns
        // read as a grid wrapped round a ball, not as a globe.
        const lon = (360 / count) * i + (ringIdx % 2 ? 180 / count : 0);
        // Peak exactly when this dot faces the viewer. Derivation: the group's rotation at time t
        // is (t / SPIN) * 360, so the dot faces front at t = ((360 - lon) / 360) * SPIN. The wave
        // peaks at 50% of its cycle, i.e. at t = delay + SPIN/2. Solve for delay, then shift by a
        // whole period so it is negative — a negative delay starts the animation part-way through,
        // which is what makes the globe correct on its very first frame instead of settling in.
        const delay = ((360 - lon) / 360) * SPIN_SECONDS - SPIN_SECONDS / 2 - SPIN_SECONDS;
        out.push({ y, lon, ring: ringRadius, delay });
      }
    });
    // The poles sit ON the axis of rotation, so their depth never changes and a wave would be a
    // lie. They stay a constant middle weight, which also visually pins the top and bottom.
    out.push({ y: -r, lon: 0, ring: 0, delay: 0, pole: true });
    out.push({ y: r, lon: 0, ring: 0, delay: 0, pole: true });
    return out;
  }, [r]);

  return (
    <span
      className="nv-globe"
      style={{ width: size, height: size, perspective: size * 8 }}
      aria-hidden="true"
    >
      <span className={`nv-globe-spin${tone === 'halt' ? ' nv-globe-still' : ''}`}>
        {dots.map((d, i) => (
          <span
            key={i}
            className="nv-globe-pos"
            style={{ transform: `translate(-50%, -50%) translateY(${d.y}px) rotateY(${d.lon}deg) translateZ(${d.ring}px)` }}
          >
            {/* The scale animation lives on an inner element: the outer one already owns a
                transform for positioning, and a second transform would replace it, not combine. */}
            <span
              className={d.pole ? 'nv-globe-dot nv-globe-pole' : 'nv-globe-dot'}
              style={d.pole ? undefined : { animationDelay: `${d.delay}s` }}
            />
          </span>
        ))}
      </span>
    </span>
  );
}
