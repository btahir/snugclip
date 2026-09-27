// Large illustrative glass for landing heroes: filled just under the destination's line.
export function HeroGlass({ label }: { label: string }) {
  return (
    <svg className="hero-glass-svg" width="220" height="300" viewBox="0 0 220 300" role="img" aria-label={`A glass filled just under the ${label} line`}>
      <defs>
        <clipPath id="hg-in">
          <path d="M40 40h120l-10 208a26 26 0 0 1-26 24H76a26 26 0 0 1-26-24Z" />
        </clipPath>
        <linearGradient id="hg-liq" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sn-liquid-top)" />
          <stop offset=".3" stopColor="var(--sn-liquid)" />
          <stop offset="1" stopColor="var(--sn-liquid-deep)" />
        </linearGradient>
      </defs>
      <path d="M40 40h120l-10 208a26 26 0 0 1-26 24H76a26 26 0 0 1-26-24Z" fill="color-mix(in oklab, var(--sn-surface) 70%, transparent)" />
      <g clipPath="url(#hg-in)">
        <g className="hg-pour">
          <path d="M20 104c20-8 40-8 60 0s40 8 60 0 40-8 60 0v200H20Z" fill="url(#hg-liq)" />
          <path d="M20 104c20-8 40-8 60 0s40 8 60 0 40-8 60 0" fill="none" stroke="white" strokeOpacity=".45" strokeWidth="4" />
          <rect x="62" y="116" width="7" height="130" rx="3.5" fill="white" opacity=".3" />
        </g>
      </g>
      <path d="M40 40l10 208a26 26 0 0 0 26 24h48a26 26 0 0 0 26-24l10-208" fill="none" stroke="var(--sn-ink)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      {[0.25, 0.5, 0.75].map((f) => (
        <path key={f} d={`M${46 + f * 2} ${272 - f * 176}h14`} stroke="var(--sn-glass)" strokeWidth="3" strokeLinecap="round" />
      ))}
      <path d="M22 88h156" stroke="var(--sn-limit)" strokeWidth="6" strokeLinecap="round" />
      <path d="M186 88l-10-7v14z" fill="var(--sn-limit)" />
      <text x="192" y="72" textAnchor="end" fontFamily="var(--sn-font-mono)" fontWeight="600" fontSize="16" fill="var(--sn-limit-text)">
        {label}
      </text>
    </svg>
  );
}
