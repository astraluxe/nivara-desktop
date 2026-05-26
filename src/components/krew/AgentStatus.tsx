interface Props {
  step: string | null;
  tool: string | null;
}

export default function AgentStatus({ step, tool }: Props) {
  if (!step) return null;

  const isToolCall = !!tool;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-nv-surface border-b border-nv-border shrink-0">
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-accent"
            style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </span>
      {isToolCall ? (
        <span className="text-[11px] text-nv-muted font-mono">
          <span className="text-accent">{tool}</span>
          <span className="text-nv-faint"> · {step}</span>
        </span>
      ) : (
        <span className="text-[11px] text-nv-muted font-mono">{step}</span>
      )}
    </div>
  );
}
