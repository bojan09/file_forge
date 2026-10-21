"use client";

import { summarize } from "@/engine/batch/queue";
import type { BatchSnapshot } from "@/engine/batch/types";
import type { PageSettings } from "@/engine/types";
import { useBatchContext } from "@/lib/batch";
import { FileTypeIcon } from "../FileTypeIcon";

export function BatchSettingsPanel({ snap }: { snap: BatchSnapshot }) {
  const { queue } = useBatchContext();
  const { shared } = snap;
  const hasImages = snap.items.some((i) => i.kind === "image" && i.status !== "rejected");
  const imageCount = snap.items.filter((i) => i.kind === "image" && i.status !== "rejected").length;
  const blocked = summarize(snap).blocked;
  const setPage = (patch: Partial<PageSettings>) => queue.setShared({ page: patch });
  return (
    <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="bs-title" data-testid="batch-settings">
      <h2 id="bs-title" className="text-base font-bold">
        Batch settings
      </h2>

      <div className="space-y-2">
        <p id="bs-out" className="text-xs font-semibold text-muted">
          Convert all eligible files to
        </p>
        <div role="radiogroup" aria-labelledby="bs-out" className="grid grid-cols-2 gap-2.5">
          {(["pdf", "docx"] as const).map((o) => (
            <button key={o} type="button" role="radio" aria-checked={shared.output === o} className="choice" onClick={() => queue.setShared({ output: o })} data-testid={`batch-output-${o}`}>
              <FileTypeIcon ext={o} size={22} />
              <span className="text-sm font-bold">{o.toUpperCase()}</span>
            </button>
          ))}
        </div>
        {shared.output === "docx" && hasImages && (
          <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs leading-snug" data-testid="docx-image-note">
            {imageCount} image{imageCount > 1 ? "s" : ""} can&apos;t become DOCX and will be skipped{blocked ? ` (${blocked} waiting)` : ""}. Set an image to PDF in its own settings, or choose PDF for the batch.
          </p>
        )}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <h3 className="text-sm font-bold">Page settings</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="bs-size" className="block text-xs font-semibold text-muted">Paper size</label>
            <select id="bs-size" className="field" value={shared.page.pageSize} onChange={(e) => setPage({ pageSize: e.target.value as PageSettings["pageSize"] })}>
              <option value="A4">A4</option>
              <option value="LETTER">Letter</option>
              <option value="LEGAL">Legal</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="bs-margins" className="block text-xs font-semibold text-muted">Margins</label>
            <select id="bs-margins" className="field" value={shared.page.margins} onChange={(e) => setPage({ margins: e.target.value as PageSettings["margins"] })}>
              <option value="narrow">Narrow</option>
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="bs-orient" className="block text-xs font-semibold text-muted">Orientation</label>
          <select id="bs-orient" className="field" value={shared.page.orientation} onChange={(e) => setPage({ orientation: e.target.value as PageSettings["orientation"] })}>
            <option value="auto">Auto (documents portrait, images match)</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </div>
      </div>

      {hasImages && (
        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-sm font-bold">Images</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="bs-quality" className="block text-xs font-semibold text-muted">Quality</label>
              <select id="bs-quality" className="field" value={shared.page.imageQuality} onChange={(e) => setPage({ imageQuality: e.target.value as PageSettings["imageQuality"] })}>
                <option value="high">High (original)</option>
                <option value="balanced">Balanced</option>
                <option value="small">Small file</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="bs-fit" className="block text-xs font-semibold text-muted">Placement</label>
              <select id="bs-fit" className="field" value={shared.page.imageFit} onChange={(e) => setPage({ imageFit: e.target.value as PageSettings["imageFit"] })}>
                <option value="fit">Fit to page</option>
                <option value="match">Match image size</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1 border-t border-line pt-4">
        <label htmlFor="bs-suffix" className="block text-xs font-semibold text-muted">Filename suffix (before the extension)</label>
        <input id="bs-suffix" className="field" value={shared.suffix} maxLength={30} placeholder="e.g. _converted" onChange={(e) => queue.setShared({ suffix: e.target.value.replace(/[\\/:*?"<>|]/g, "") })} />
        <p className="pt-1 text-xs leading-snug text-muted">Changes apply to files that haven&apos;t started converting. Each file can override these in its own settings.</p>
      </div>
    </section>
  );
}
