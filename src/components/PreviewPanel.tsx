"use client";

import { useEffect, useRef, useState } from "react";
import type { Inspection } from "@/engine/convert";
import { DocPreview } from "./DocPreview";

function ImagePreview({ insp }: { insp: Inspection }) {
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = imgRef.current;
    if (!insp.image || !el) return;
    const u = URL.createObjectURL(new Blob([insp.image.bytes as BlobPart], { type: `image/${insp.image.type}` }));
    el.src = u;
    return () => {
      el.removeAttribute("src");
      URL.revokeObjectURL(u);
    };
  }, [insp.image]);
  if (!insp.image) return null;
  return (
    <div className="grid place-items-center rounded-lg bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,var(--surface)_0%_50%)] [background-size:20px_20px] p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} alt={`Preview of ${insp.name}`} className="max-h-[26rem] w-auto max-w-full rounded object-contain" />
      <p className="mt-2 text-xs text-muted">
        {insp.image.width}×{insp.image.height} px
      </p>
    </div>
  );
}

export function PreviewPanel({ insp }: { insp: Inspection }) {
  const [tab, setTab] = useState<"preview" | "raw">("preview");
  const isImage = insp.kind === "image";
  return (
    <section className="card p-3 sm:p-4" aria-label="File preview">
      <div role="tablist" aria-label="Preview mode" className="mb-3 flex items-center gap-1">
        <button role="tab" id="tab-preview" aria-selected={tab === "preview"} aria-controls="panel-preview" className="tab" onClick={() => setTab("preview")}>
          Preview
        </button>
        {!isImage && (
          <button role="tab" id="tab-raw" aria-selected={tab === "raw"} aria-controls="panel-raw" className="tab" onClick={() => setTab("raw")}>
            Raw Content
          </button>
        )}
        <span className="ml-auto text-xs text-muted" data-testid="preview-note">Approximate preview: final layout may differ</span>
      </div>
      <div className="max-h-[32rem] overflow-auto rounded-lg" role="tabpanel" id={tab === "preview" ? "panel-preview" : "panel-raw"} aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {tab === "preview" ? (
          isImage ? (
            <ImagePreview insp={insp} />
          ) : (
            insp.doc && <DocPreview blocks={insp.doc.blocks} />
          )
        ) : (
          <>
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-4 font-mono text-xs leading-relaxed" data-testid="raw-content">
              {insp.rawText}
            </pre>
            {insp.rawTruncated && <p className="mt-2 text-xs text-muted">Showing the first 20,000 characters.</p>}
          </>
        )}
      </div>
    </section>
  );
}
