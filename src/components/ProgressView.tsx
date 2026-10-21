"use client";

import { useEffect, useRef } from "react";
import type { Stage } from "@/engine/types";
import { useConverter } from "@/lib/converter";
import { CheckIcon } from "./icons";
import { FileTypeIcon } from "./FileTypeIcon";

const STEPS: { id: Stage; label: string }[] = [
  { id: "reading", label: "Reading file" },
  { id: "rendering", label: "Building document" },
  { id: "verifying", label: "Verifying output" },
];

export function ProgressView() {
  const { state, cancel } = useConverter();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  if (state.phase !== "converting") return null;
  const current = STEPS.findIndex((s) => s.id === state.stage);
  const target = state.output.toUpperCase();
  return (
    <div className="enter mx-auto max-w-lg">
      <section className="card space-y-6 p-6 sm:p-8" aria-labelledby="progress-title">
        <div className="flex items-center gap-3">
          <FileTypeIcon ext={state.inspection.extension} size={32} />
          <div className="min-w-0">
            <h1 id="progress-title" ref={ref} tabIndex={-1} className="text-lg font-bold outline-none">
              Converting to {target}…
            </h1>
            <p className="truncate text-xs text-muted">{state.inspection.name}</p>
          </div>
        </div>
        <div className="indeterminate" role="progressbar" aria-label="Conversion in progress" />
        <ol className="space-y-3" data-testid="stages">
          {STEPS.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s.id} className="flex items-center gap-3 text-sm" aria-current={active ? "step" : undefined} data-state={done ? "done" : active ? "active" : "pending"}>
                <span className={`grid size-6 place-items-center rounded-full border text-xs ${done ? "border-success bg-success/15 text-success" : active ? "border-accent bg-accent/15 text-accent-text" : "border-line text-muted"}`}>
                  {done ? <CheckIcon size={14} /> : i + 1}
                </span>
                <span className={active ? "font-semibold" : done ? "" : "text-muted"}>{s.label}</span>
              </li>
            );
          })}
        </ol>
        <p className="sr-only" role="status" aria-live="polite">
          {STEPS[current]?.label}
        </p>
        <p className="text-xs leading-relaxed text-muted">Everything happens on your device. Large files can take a while; you can cancel at any time.</p>
        <button type="button" className="btn btn-secondary w-full" onClick={cancel}>
          Cancel
        </button>
      </section>
    </div>
  );
}
