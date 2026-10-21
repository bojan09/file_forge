import type { ConversionWarning } from "@/engine/types";
import { AlertIcon, InfoIcon } from "./icons";

export function Notices({ warnings, title = "Before you convert" }: { warnings: ConversionWarning[]; title?: string }) {
  if (!warnings.length) return null;
  return (
    <section aria-label={title} className="card-flat space-y-2.5 p-3.5" data-testid="notices">
      <h3 className="text-sm font-bold">{title}</h3>
      <ul className="space-y-2">
        {warnings.map((w) => (
          <li key={w.code + w.message} className="flex gap-2.5 text-[0.82rem] leading-snug" data-level={w.level}>
            {w.level === "warn" ? <AlertIcon size={17} className="mt-px shrink-0 text-warning" /> : <InfoIcon size={17} className="mt-px shrink-0 text-info" />}
            <span>
              <span className="sr-only">{w.level === "warn" ? "Warning: " : "Note: "}</span>
              {w.message}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
