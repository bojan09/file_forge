const COLORS: Record<string, string> = {
  txt: "#64748b",
  md: "#a855f7",
  markdown: "#a855f7",
  html: "#ef4444",
  htm: "#ef4444",
  csv: "#16a34a",
  jpg: "#3b82f6",
  jpeg: "#3b82f6",
  png: "#f59e0b",
  webp: "#64748b",
  pdf: "#ef4444",
  docx: "#2563eb",
  xlsx: "#16a34a",
  pptx: "#ea580c",
  epub: "#0d9488",
};

export function FileTypeIcon({ ext, size = 40 }: { ext: string; size?: number }) {
  const key = ext.toLowerCase().replace(".", "");
  const color = COLORS[key] ?? "#64748b";
  const label = (key === "markdown" ? "md" : key === "jpeg" ? "jpg" : key === "htm" ? "html" : key).toUpperCase();
  const fs = label.length > 3 ? 8 : 9.5;
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 40 48" fill="none" aria-hidden="true" focusable="false" className="shrink-0">
      <path d="M6 6a4 4 0 0 1 4-4h14l10 10v30a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V6Z" style={{ fill: "var(--surface-2)" }} stroke={color} strokeWidth="1.8" />
      <path d="M24 2v7a3 3 0 0 0 3 3h7" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <rect x="6" y="26" width="28" height="14" rx="2.5" fill={color} />
      <text x="20" y="36.4" textAnchor="middle" fontSize={fs} fontWeight="700" fill="#fff" fontFamily="ui-sans-serif, system-ui, sans-serif">
        {label}
      </text>
    </svg>
  );
}
