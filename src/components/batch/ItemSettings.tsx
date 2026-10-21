"use client";

import { getFormat } from "@/engine/registry";
import { effectiveOutput, effectiveSettings } from "@/engine/batch/queue";
import type { ItemOverrides, QueueItem, SharedSettings } from "@/engine/batch/types";
import { useBatchContext } from "@/lib/batch";

function Sel({ id, label, value, onChange, children, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold text-muted">
        {label}
      </label>
      <select id={id} className="field" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}

/** Per-file overrides. Only settings that apply to this file's conversion are shown. */
export function ItemSettings({ item, shared }: { item: QueueItem; shared: SharedSettings }) {
  const { queue } = useBatchContext();
  if (!item.kind) return null;
  const fmt = getFormat(item.kind);
  const isImage = item.kind === "image";
  const out = effectiveOutput(item, shared);
  const eff = effectiveSettings(item, shared);
  const set = (patch: ItemOverrides) => queue.setOverride(item.id, patch);
  const hasOverrides = Object.keys(item.overrides).length > 0;
  const batchOut = shared.output.toUpperCase();
  const id = (k: string) => `${item.id}-${k}`;

  return (
    <div className="space-y-3" data-testid="item-settings">
      <div className="grid gap-3 sm:grid-cols-2">
        <Sel id={id("out")} label="Output format" value={item.overrides.output ?? ""} onChange={(v) => set({ output: (v || undefined) as ItemOverrides["output"] })}>
          <option value="">Use batch setting ({batchOut})</option>
          <option value="pdf">PDF</option>
          <option value="docx" disabled={!fmt.outputs.includes("docx")}>
            DOCX{fmt.outputs.includes("docx") ? "" : " (not available for images)"}
          </option>
        </Sel>
        {/* Page size, orientation and margins apply to PDF and DOCX alike. */}
        <Sel id={id("size")} label="Paper size" value={eff.pageSize} onChange={(v) => set({ pageSize: v as ItemOverrides["pageSize"] })}>
          <option value="A4">A4</option>
          <option value="LETTER">Letter</option>
          <option value="LEGAL">Legal</option>
        </Sel>
        <Sel id={id("orient")} label="Orientation" value={eff.orientation} onChange={(v) => set({ orientation: v as ItemOverrides["orientation"] })} disabled={isImage && eff.imageFit === "match"}>
          <option value="auto">{isImage ? "Auto (match image)" : "Auto (portrait)"}</option>
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </Sel>
        <Sel id={id("margins")} label="Margins" value={eff.margins} onChange={(v) => set({ margins: v as ItemOverrides["margins"] })} disabled={isImage && eff.imageFit === "match"}>
          <option value="narrow">Narrow</option>
          <option value="normal">Normal</option>
          <option value="wide">Wide</option>
        </Sel>
        {isImage && (
          <>
            <Sel id={id("fit")} label="Image placement" value={eff.imageFit} onChange={(v) => set({ imageFit: v as ItemOverrides["imageFit"] })}>
              <option value="fit">Fit to page (keeps proportions)</option>
              <option value="match">Page matches image size</option>
            </Sel>
            <Sel id={id("quality")} label="Image quality" value={eff.imageQuality} onChange={(v) => set({ imageQuality: v as ItemOverrides["imageQuality"] })}>
              <option value="high">High (original)</option>
              <option value="balanced">Balanced</option>
              <option value="small">Small file</option>
            </Sel>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted">
          This file converts to <strong className="text-fg">{out.toUpperCase()}</strong>
          {hasOverrides ? " with its own settings." : " using the batch settings."}
        </p>
        {hasOverrides && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => queue.setOverride(item.id, null)}>
            Reset to batch settings
          </button>
        )}
      </div>
    </div>
  );
}
