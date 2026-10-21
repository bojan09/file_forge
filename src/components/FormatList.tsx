"use client";

import type { SourceFormat } from "@/engine/registry";
import { SOURCE_FORMATS } from "@/engine/registry";
import { ChevronRightIcon } from "./icons";
import { FileTypeIcon } from "./FileTypeIcon";

const ROWS: { id: SourceFormat["id"]; label: string; icon: string }[] = [
  { id: "txt", label: "Text to PDF / Word", icon: "txt" },
  { id: "md", label: "Markdown to PDF / Word", icon: "md" },
  { id: "html", label: "HTML to PDF / Word", icon: "html" },
  { id: "image", label: "Images to PDF", icon: "jpg" },
  { id: "csv", label: "CSV to PDF / Word", icon: "csv" },
  { id: "docx", label: "Word to PDF (experimental)", icon: "docx" },
  { id: "xlsx", label: "Excel to PDF (experimental)", icon: "xlsx" },
  { id: "pdf", label: "PDF to Word (experimental)", icon: "pdf" },
];

export function FormatList({ onPick }: { onPick: (f: SourceFormat) => void }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-2/60">
      {ROWS.map((row) => {
        const format = SOURCE_FORMATS.find((f) => f.id === row.id)!;
        return (
          <li key={row.id}>
            <button type="button" onClick={() => onPick(format)} className="flex w-full min-h-12 items-center gap-3 px-3.5 py-2 text-left text-sm font-medium transition-colors hover:bg-accent/10">
              <span className="grid w-7 place-items-center">
                <FileTypeIcon ext={row.icon} size={22} />
              </span>
              <span className="flex-1">{row.label}</span>
              <ChevronRightIcon size={16} className="text-muted" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
