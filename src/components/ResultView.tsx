"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { formatBytes } from "@/engine/registry";
import { useConverter } from "@/lib/converter";
import { AlertIcon, CheckIcon, DownloadIcon, RefreshIcon } from "./icons";
import { DocPreview } from "./DocPreview";
import { FileTypeIcon } from "./FileTypeIcon";
import { Notices } from "./Notices";

// pdf.js is loaded only when a PDF result is shown.
const PdfViewer = dynamic(() => import("./PdfViewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => (
    <div className="card grid h-64 place-items-center text-sm text-muted" role="status">
      Loading preview…
    </div>
  ),
});

const SPARKS = [
  { x: 14, y: 30, c: "var(--accent-2)" },
  { x: 40, y: 8, c: "var(--success)" },
  { x: 118, y: 12, c: "var(--warning)" },
  { x: 142, y: 40, c: "var(--accent-text)" },
  { x: 6, y: 78, c: "var(--success)" },
  { x: 150, y: 86, c: "var(--accent-2)" },
];

export function ResultView() {
  const { state, reset, backToSettings } = useConverter();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  if (state.phase !== "done") return null;
  const { result, url, inspection } = state;
  const allPassed = result.checks.every((c) => c.passed);
  const notes = result.warnings.filter((w) => w.code !== "approximate");
  return (
    <div className="enter mx-auto max-w-6xl">
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-5 lg:col-start-2 lg:row-start-1">
          <section className="space-y-2 text-center" aria-labelledby="done-title">
            <svg viewBox="0 0 160 110" className="mx-auto h-28 w-40" aria-hidden="true">
              {SPARKS.map((s, i) => (
                <circle key={i} className="spark" cx={s.x} cy={s.y} r="2.6" fill={s.c} style={{ animationDelay: `${0.5 + i * 0.1}s` }} />
              ))}
              <circle className="check-circle" cx="80" cy="56" r="30" fill="color-mix(in srgb, var(--success) 12%, transparent)" stroke="var(--success)" strokeWidth="4" strokeLinecap="round" />
              <path className="check-mark" d="m66 57 10 10 19-21" fill="none" stroke="var(--success)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h1 id="done-title" ref={ref} tabIndex={-1} className="text-2xl font-extrabold outline-none sm:text-3xl">
              Conversion Complete!
            </h1>
            <p className="text-sm text-muted" role="status">
              Your file has been converted
              {allPassed ? " and passed the automatic checks below" : ". Review the notes below"}.
            </p>
          </section>

          <div className="card flex items-center gap-3 p-3.5 sm:p-4">
            <FileTypeIcon ext={result.extension} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold sm:text-base" title={result.filename} data-testid="out-name">
                {result.filename}
              </p>
              <p className="text-xs text-muted" data-testid="out-meta">
                {formatBytes(result.sizeBytes)} • {result.extension.toUpperCase()}
                {result.pageCount ? ` • ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}` : ""}
              </p>
            </div>
            {allPassed ? (
              <span className="badge badge-success">
                <CheckIcon size={12} /> Checks passed
              </span>
            ) : (
              <span className="badge badge-warn">
                <AlertIcon size={12} /> Review notes
              </span>
            )}
          </div>

          {result.fidelity === "experimental" && (
        <p className="badge badge-warn !rounded-lg !px-3 !py-2 !text-xs" data-testid="experimental-result-note">
          Experimental conversion: compare this result with the original and check the notes below.
        </p>
      )}
      {result.fidelity === "approximate" && (
            <p className="badge badge-warn !rounded-lg !px-3 !py-2 !text-xs">Approximate fidelity: layout may differ from the original. Please review the output.</p>
          )}

          <div className="space-y-2.5">
            <a href={url} download={result.filename} className="btn btn-primary w-full" data-testid="download-link">
              <DownloadIcon size={18} /> Download File
            </a>
            <button type="button" className="btn btn-secondary w-full" onClick={reset} data-testid="convert-another">
              <RefreshIcon size={17} /> Convert Another File
            </button>
            <button type="button" className="btn btn-ghost btn-sm w-full" onClick={backToSettings}>
              Change settings and convert again
            </button>
          </div>
        </div>
        <div className="min-w-0 space-y-3 lg:col-start-1 lg:row-start-1 lg:row-span-2" data-testid="result-preview">
          {result.extension === "pdf" ? (
            <PdfViewer key={url} blob={result.blob} label={`Preview of ${result.filename}`} />
          ) : (
            inspection.doc && (
              <section className="card p-3 sm:p-4" aria-label="Approximate preview of the Word document">
                <p className="badge badge-warn mb-3 !rounded-lg !px-3 !py-2 !text-xs" data-testid="docx-preview-note">
                  Approximate preview of the content. Word&apos;s own layout, fonts and page breaks will differ; open the file to check it.
                </p>
                <div className="max-h-[40rem] overflow-auto rounded-lg" tabIndex={0} role="region" aria-label="Document content preview">
                  <DocPreview blocks={inspection.doc.blocks} />
                </div>
              </section>
            )
          )}
        </div>
        <div className="min-w-0 space-y-5 lg:col-start-2 lg:row-start-2">
          <section className="card-flat space-y-2.5 p-4" aria-labelledby="qc-title" data-testid="quality-checks">
            <h2 id="qc-title" className="text-sm font-bold">
              Quality Check
            </h2>
            <ul className="space-y-2">
              {result.checks.map((c) => (
                <li key={c.id} className="flex gap-2.5 text-[0.85rem] leading-snug" data-passed={c.passed}>
                  {c.passed ? <CheckIcon size={17} className="mt-px shrink-0 text-success" /> : <AlertIcon size={17} className="mt-px shrink-0 text-warning" />}
                  <span>
                    <span className="sr-only">{c.passed ? "Passed: " : "Needs attention: "}</span>
                    {c.label}
                    {c.detail ? <span className="text-muted"> ({c.detail})</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">These checks inspect the file structure. They can&apos;t judge how the document looks, so open it to confirm.</p>
          </section>
          <Notices warnings={notes} title="Notes about this conversion" />
        </div>
      </div>
    </div>
  );
}
