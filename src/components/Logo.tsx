import { useId } from "react";

/** Original layered-document + transform mark. Colors follow the active accent. */
export function LogoMark({ size = 40 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}a`} x1="6" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--btn-from)" }} />
          <stop offset="1" style={{ stopColor: "var(--accent-2)" }} />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="10" y1="8" x2="34" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--accent-text)" }} />
          <stop offset="1" style={{ stopColor: "var(--btn-from)" }} />
        </linearGradient>
      </defs>
      {/* back layer */}
      <rect x="13" y="4" width="26" height="34" rx="6" transform="rotate(8 26 21)" fill={`url(#${id}a)`} opacity="0.55" />
      {/* front document with folded corner */}
      <path d="M9 10a6 6 0 0 1 6-6h13l9 9v21a6 6 0 0 1-6 6H15a6 6 0 0 1-6-6V10Z" fill={`url(#${id}b)`} />
      <path d="M28 4v7a2 2 0 0 0 2 2h7" fill="rgba(255,255,255,0.35)" />
      {/* transform arrow */}
      <path d="M16 31h14m0 0-4.5-4.5M30 31l-4.5 4.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="35" cy="37" r="7" fill="var(--surface)" stroke={`url(#${id}a)`} strokeWidth="2" />
      <path d="m32 37 2.2 2.2L38.2 35" stroke="var(--success)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      File<span className="text-gradient">Forge</span>
    </span>
  );
}
