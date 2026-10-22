"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ACCEPT_ATTR, SOURCE_FORMATS, type SourceFormat } from "@/engine/registry";
import { UploadIcon } from "./icons";

export function useFilePicker(onFiles: (files: File[]) => void, opts: { accept?: string } = {}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = (format?: SourceFormat) => {
    const el = inputRef.current;
    if (!el) return;
    el.accept = format ? format.extensions.map((e) => `.${e}`).join(",") : (opts.accept ?? ACCEPT_ATTR);
    el.click();
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    e.target.accept = opts.accept ?? ACCEPT_ATTR;
    if (files.length) onFiles(files);
  };
  return { inputRef, pick, onChange };
}

export function UploadZone({ onFiles, inputId, accept, mode = "convert" }: { onFiles: (files: File[]) => void; inputId?: string; accept?: string; mode?: "convert" | "merge" | "pdf" }) {
  const autoId = useId();
  const id = inputId ?? `file-${autoId}`;
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const { inputRef, onChange } = useFilePicker(onFiles, { accept });

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
        if (files.length) onFiles(files);
      }}
    >
      <input ref={inputRef} id={id} type="file" multiple accept={accept ?? ACCEPT_ATTR} onChange={onChange} className="peer sr-only" data-testid="file-input" />
      <label htmlFor={id} className="flex cursor-pointer flex-col items-center gap-2 text-center rounded-xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent-text">
        <span className="dz-icon grid size-14 place-items-center rounded-2xl bg-accent/15 text-accent-text">
          <UploadIcon size={30} />
        </span>
        <span className="mt-1 text-base font-semibold sm:text-lg">
          <span className="hidden sm:inline">{dragging ? (mode === "merge" ? "Drop to add images" : mode === "pdf" ? "Drop to add PDFs" : "Drop to convert") : mode === "merge" ? "Drag & drop your images here" : mode === "pdf" ? "Drag & drop your PDFs here" : "Drag & drop your files here"}</span>
          <span className="sm:hidden">{mode === "merge" ? "Tap to select images" : mode === "pdf" ? "Tap to select PDFs" : "Tap to select files"}</span>
        </span>
        <span className="text-sm text-muted">
          <span className="hidden sm:inline">or </span>
          <span className="font-semibold text-accent-text underline underline-offset-4">
            <span className="hidden sm:inline">click to browse</span>
            <span className="sm:hidden">or drag and drop</span>
          </span>
        </span>
        <span className="mt-2 max-w-xs text-xs leading-relaxed text-muted">
          {mode === "merge" ? "JPG, PNG and WebP images. Up to 15 MB each." : mode === "pdf" ? "PDF files, up to 100 MB each. Password-protected PDFs are not supported." : "Supports TXT, Markdown, HTML, CSV, JPG, PNG, WebP, and experimental Word, Excel, PDF and EPUB. Files up to 100 MB. Select several files to convert them as a batch. Select several files to convert them as a batch."}
        </span>
      </label>
    </div>
  );
}

export { SOURCE_FORMATS };
