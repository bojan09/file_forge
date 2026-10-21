"use client";

import { useEffect, useRef } from "react";
import { formatBytes } from "@/engine/registry";
import { useConverter } from "@/lib/converter";
import { ArrowLeftIcon } from "./icons";
import { FileTypeIcon } from "./FileTypeIcon";
import { Notices } from "./Notices";
import { PreviewPanel } from "./PreviewPanel";
import { SettingsPanel } from "./SettingsPanel";
import { useFilePicker } from "./UploadZone";

export function Workspace() {
  const { state, reset, selectFile } = useConverter();
  const { inputRef, pick, onChange } = useFilePicker(selectFile);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  if (state.phase !== "ready") return null;
  const { inspection: insp, output, page } = state;
  const ext = insp.extension;

  return (
    <div className="enter space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
          <ArrowLeftIcon size={16} /> New File
        </button>
      </div>
      <div className="card flex items-center gap-3 p-3 sm:p-4">
        <FileTypeIcon ext={ext} size={34} />
        <div className="min-w-0 flex-1">
          <h1 ref={title} tabIndex={-1} className="truncate text-sm font-bold outline-none sm:text-base" title={insp.name} data-testid="file-name">
            {insp.name}
          </h1>
          <p className="text-xs text-muted" data-testid="file-meta">
            {formatBytes(insp.sizeBytes)} • {insp.format.label}
            {insp.image ? ` • ${insp.image.width}×${insp.image.height}` : ""}
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => pick()}>
          Change File
        </button>
        <input ref={inputRef} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onChange} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23.5rem]">
        <div className="min-w-0 space-y-4">
          <PreviewPanel insp={insp} />
          <div className="lg:hidden">
            <Notices warnings={insp.warnings} />
          </div>
        </div>
        <div className="space-y-4">
          <SettingsPanel insp={insp} output={output} page={page} />
          <div className="hidden lg:block">
            <Notices warnings={insp.warnings} />
          </div>
        </div>
      </div>
    </div>
  );
}
