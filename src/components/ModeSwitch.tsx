"use client";

import type { HomeMode } from "@/lib/batch";
import { FileIcon, ImagesIcon } from "./icons";

const OPTIONS: { id: HomeMode; label: string; icon: typeof FileIcon }[] = [
  { id: "convert", label: "Convert files", icon: FileIcon },
  { id: "merge", label: "Merge images into one PDF", icon: ImagesIcon },
];

export function ModeSwitch({ mode, onChange }: { mode: HomeMode; onChange: (m: HomeMode) => void }) {
  return (
    <div role="radiogroup" aria-label="What would you like to do?" className="grid grid-cols-2 gap-2" data-testid="mode-switch">
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={mode === id} className="choice !min-h-12 justify-center gap-2 text-center text-[0.82rem] font-semibold leading-tight sm:text-sm" onClick={() => onChange(id)} data-testid={`mode-${id}`}>
          <Icon size={18} className="shrink-0" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
