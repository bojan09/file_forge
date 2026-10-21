"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ACCEPT_ATTR, SOURCE_FORMATS, type SourceFormat } from "@/engine/registry";
import { UploadIcon } from "./icons";

export function useFilePicker(onFile: (file: File, extra: number) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = (format?: SourceFormat) => {
    const el = inputRef.current;
    if (!el) return;
    el.accept = format ? format.extensions.map((e) => `.${e}`).join(",") : ACCEPT_ATTR;
    el.click();
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    e.target.accept = ACCEPT_ATTR;
    if (files[0]) onFile(files[0], files.length - 1);
  };
  return { inputRef, pick, onChange };
}

export function UploadZone({ onFile, inputId }: { onFile: (file: File, extra: number) => void; inputId?: string }) {
  const autoId = useId();
  const id = inputId ?? `file-${autoId}`;
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const { inputRef, onChange } = useFilePicker(onFile);

  // Dropping a file outside the zone must not navigate the tab to the file.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  return (
    <div
      className="dropzone p-6 sm:p-8"
      data-dragging={dragging}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files[0]) onFile(files[0], files.length - 1);
      }}
    >
      <input ref={inputRef} id={id} type="file" accept={ACCEPT_ATTR} onChange={onChange} className="peer sr-only" data-testid="file-input" />
      <label htmlFor={id} className="flex cursor-pointer flex-col items-center gap-2 text-center rounded-xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent-text">
        <span className="dz-icon grid size-14 place-items-center rounded-2xl bg-accent/15 text-accent-text">
          <UploadIcon size={30} />
        </span>
        <span className="mt-1 text-base font-semibold sm:text-lg">
          <span className="hidden sm:inline">{dragging ? "Drop to convert" : "Drag & drop your file here"}</span>
          <span className="sm:hidden">Tap to select a file</span>
        </span>
        <span className="text-sm text-muted">
          <span className="hidden sm:inline">or </span>
          <span className="font-semibold text-accent-text underline underline-offset-4">
            <span className="hidden sm:inline">click to browse</span>
            <span className="sm:hidden">or drag and drop</span>
          </span>
        </span>
        <span className="mt-2 max-w-xs text-xs leading-relaxed text-muted">
          Supports TXT, Markdown, HTML, CSV, JPG, PNG, WebP. Max size: 15 MB (varies by file type).
        </span>
      </label>
    </div>
  );
}

export { SOURCE_FORMATS };
