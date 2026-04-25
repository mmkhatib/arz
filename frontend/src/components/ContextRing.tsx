interface Props {
  pct: number; // 0–100
}

export default function ContextRing({ pct }: Props) {
  if (pct <= 0) return null;

  const radius = 10;
  const circ = 2 * Math.PI * radius;
  const filled = circ * (pct / 100);
  const color =
    pct >= 90 ? "#f87171" : pct >= 75 ? "#fbbf24" : "#4ade80";

  return (
    <div title={`Context: ${pct}%`} className="shrink-0 w-7 h-7 flex items-center justify-center">
      <svg width="28" height="28" viewBox="0 0 28 28">
        {/* Track */}
        <circle
          cx="14" cy="14" r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth="2.5"
        />
        {/* Fill */}
        <circle
          cx="14" cy="14" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
          transform="rotate(-90 14 14)"
        />
        {/* Label */}
        <text
          x="14" y="14"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="5.5"
          fill="var(--muted)"
          fontFamily="system-ui, sans-serif"
        >
          {Math.round(pct)}%
        </text>
      </svg>
    </div>
  );
}
