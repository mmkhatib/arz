interface Props {
  pct: number; // 0–100
  /** Marks the value as a client-side estimate (no provider data). */
  estimated?: boolean;
}

export default function ContextRing({ pct, estimated = false }: Props) {
  const safe = Math.max(0, Math.min(100, pct || 0));
  const radius = 10;
  const circ = 2 * Math.PI * radius;
  const filled = circ * (safe / 100);
  const color =
    safe >= 90 ? "#f87171" : safe >= 75 ? "#fbbf24" : safe > 0 ? "#4ade80" : "var(--muted)";
  const title = estimated
    ? `Context: ~${Math.round(safe)}% (client estimate)`
    : `Context: ${Math.round(safe)}%`;

  return (
    <div title={title} className="shrink-0 w-7 h-7 flex items-center justify-center">
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle
          cx="14" cy="14" r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth="2.5"
        />
        {safe > 0 && (
          <circle
            cx="14" cy="14" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeDasharray={`${filled} ${circ - filled}`}
            strokeLinecap="round"
            strokeDashoffset={0}
            transform="rotate(-90 14 14)"
            opacity={estimated ? 0.6 : 1}
          />
        )}
        <text
          x="14" y="14"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="5.5"
          fill="var(--muted)"
          fontFamily="system-ui, sans-serif"
        >
          {Math.round(safe)}%
        </text>
      </svg>
    </div>
  );
}
