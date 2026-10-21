import { useId } from "react";

export function HeroIllustration() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 360 230" className="h-auto w-full" role="img" aria-label="A document transforming into PDF and Word files">
      <defs>
        <linearGradient id={`${id}d`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--accent-text)" }} />
          <stop offset="1" style={{ stopColor: "var(--btn-from)" }} />
        </linearGradient>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--btn-from)" }} />
          <stop offset="1" style={{ stopColor: "var(--accent-2)" }} />
        </linearGradient>
        <filter id={`${id}s`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#000" floodOpacity="0.28" />
        </filter>
      </defs>
      <g filter={`url(#${id}s)`}>
        <path d="M44 38a16 16 0 0 1 16-16h66l44 44v108a16 16 0 0 1-16 16H60a16 16 0 0 1-16-16V38Z" fill={`url(#${id}d)`} />
        <path d="M126 22v34a10 10 0 0 0 10 10h34" fill="rgba(255,255,255,0.35)" />
        <rect x="62" y="96" width="82" height="7" rx="3.5" fill="rgba(255,255,255,0.55)" />
        <rect x="62" y="114" width="64" height="7" rx="3.5" fill="rgba(255,255,255,0.4)" />
        <rect x="62" y="132" width="76" height="7" rx="3.5" fill="rgba(255,255,255,0.4)" />
      </g>
      <path d="M150 128h70m0 0-16-16m16 16-16 16" stroke={`url(#${id}t)`} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      <g filter={`url(#${id}s)`}>
        <path d="M232 44a10 10 0 0 1 10-10h42l26 26v62a10 10 0 0 1-10 10h-58a10 10 0 0 1-10-10V44Z" fill="#ef4444" />
        <path d="M284 34v18a8 8 0 0 0 8 8h18" fill="rgba(255,255,255,0.35)" />
        <text x="260" y="104" textAnchor="middle" fontSize="19" fontWeight="800" fill="#fff" fontFamily="ui-sans-serif, system-ui, sans-serif">
          PDF
        </text>
        <g transform="translate(250 120)">
          <path d="M0 10A10 10 0 0 1 10 0h42l26 26v62a10 10 0 0 1-10 10H10A10 10 0 0 1 0 88V10Z" fill="#2563eb" />
          <path d="M52 0v18a8 8 0 0 0 8 8h18" fill="rgba(255,255,255,0.35)" />
          <text x="39" y="70" textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff" fontFamily="ui-sans-serif, system-ui, sans-serif">
            DOCX
          </text>
        </g>
      </g>
    </svg>
  );
}
