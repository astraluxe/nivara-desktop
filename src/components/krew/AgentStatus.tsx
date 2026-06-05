import { useState, useEffect } from 'react';

interface Props {
  step: string | null;
  tool: string | null;
}

export default function AgentStatus({ step, tool }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!step) { setElapsed(0); return; }
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

  if (!step) return null;

  const slow = elapsed >= 30;
  const verySlow = elapsed >= 60;

  return (
    <div className={`flex items-center gap-2 px-3 py-2 border-b border-nv-border shrink-0 transition-colors ${verySlow ? 'bg-nv-yellow/8' : slow ? 'bg-nv-surface2' : 'bg-nv-surface'}`}>
      {/* Animated dots */}
      <span className="flex gap-0.5 shrink-0">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${verySlow ? 'bg-nv-yellow' : 'bg-accent'}`}
            style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </span>

      {/* Label */}
      <span className="flex-1 text-[11px] font-mono truncate">
        {tool ? (
          <>
            <span className="text-accent">{tool}</span>
            <span className="text-nv-faint"> · {step}</span>
          </>
        ) : (
          <span className={verySlow ? 'text-nv-yellow' : 'text-nv-muted'}>{step}</span>
        )}
        {verySlow && <span className="text-nv-yellow ml-1">— taking longer than usual</span>}
      </span>

      {/* Elapsed timer */}
      <span className={`text-[10px] font-mono tabular-nums shrink-0 ${verySlow ? 'text-nv-yellow' : 'text-nv-faint'}`}>
        {elapsed}s
      </span>
    </div>
  );
}
