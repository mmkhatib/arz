// Inline cedar tree brand mark. Used in NavBar brand + headers.
// Stylised conifer with two tiers; uses currentColor + cedar variables
// so it reflects the active theme automatically.

interface Props {
  size?: number;
  className?: string;
}

export default function CedarMark({ size = 22, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cedar-mark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cedar-glow)" />
          <stop offset="100%" stopColor="var(--cedar-deep)" />
        </linearGradient>
      </defs>
      {/* trunk */}
      <rect x="14.6" y="22" width="2.8" height="7" fill="var(--text3)" rx="1" opacity="0.7" />
      {/* tiers */}
      <path
        d="M16 3 L23 12 L19 12 L26 21 L6 21 L13 12 L9 12 Z"
        fill="url(#cedar-mark-grad)"
      />
      <path
        d="M16 7 L21 13 L17 13 L23 19 L9 19 L15 13 L11 13 Z"
        fill="var(--cedar-2)"
        opacity="0.7"
      />
    </svg>
  );
}
