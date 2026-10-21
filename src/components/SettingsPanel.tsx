"use client";

import { getFormat } from "@/engine/registry";
import type { Inspection } from "@/engine/convert";
import type { OutputFormat, PageSettings } from "@/engine/types";
import { useConverter } from "@/lib/converter";
import { BoltIcon, LockIcon } from "./icons";
import { FileTypeIcon } from "./FileTypeIcon";

const OUTPUT_META: Record<OutputFormat, { label: string; blurb: string; imageBlurb?: string }> = {
  pdf: { label: "PDF", blurb: "Best for sharing", imageBlurb: "Picture pages" },
  docx: { label: "DOCX", blurb: "Editable Word file" },
};

function Segment<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled} className="choice !min-h-11 justify-center !px-2 text-sm font-medium" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

export function SettingsPanel({ insp, output, page }: { insp: Inspection; output: OutputFormat; page: PageSettings }) {
  const { setOutput, setPage, convert } = useConverter();
  const format = getFormat(insp.kind);
  const isImage = insp.kind === "image";
  const matchSize = isImage && page.imageFit === "match";
  const pickable: OutputFormat[] = ["pdf", "docx"];

  return (
    <section className="card space-y-5 p-4 sm:p-5" aria-label="Conversion settings">
      <h2 className="text-base font-bold">Conversion Settings</h2>

      <div className="space-y-2">
        <p id="out-label" className="text-xs font-semibold text-muted">
          Output Format
        </p>
        <div role="radiogroup" aria-labelledby="out-label" className="grid grid-cols-2 gap-2.5">
          {pickable.map((o) => {
            const allowed = format.outputs.includes(o);
            const meta = OUTPUT_META[o];
            return (
              <button key={o} type="button" role="radio" aria-checked={output === o} disabled={!allowed} className="choice" onClick={() => setOutput(o)} data-testid={`output-${o}`}>
                <FileTypeIcon ext={o} size={24} />
                <span>
                  <span className="block text-sm font-bold">{meta.label}</span>
                  <span className="block text-[0.7rem] leading-tight text-muted">{!allowed ? "Not available" : isImage && meta.imageBlurb ? meta.imageBlurb : meta.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        {isImage && <p className="text-xs text-muted">Images convert to PDF only. The PDF holds a picture, so text in it can&apos;t be selected.</p>}
      </div>

      <div className="space-y-3.5 border-t border-line pt-4">
        <h3 className="text-sm font-bold">{isImage ? "Image & Page Settings" : "Page Settings"}</h3>

        {isImage && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quality" htmlFor="ws-quality">
              <select id="ws-quality" className="field" value={page.imageQuality} onChange={(e) => setPage({ imageQuality: e.target.value as PageSettings["imageQuality"] })}>
                <option value="high">High (original)</option>
                <option value="balanced">Balanced</option>
                <option value="small">Small file</option>
              </select>
            </Field>
            <Field label="Fit" htmlFor="ws-fit">
              <select id="ws-fit" className="field" value={page.imageFit} onChange={(e) => setPage({ imageFit: e.target.value as PageSettings["imageFit"] })}>
                <option value="fit">Fit to page</option>
                <option value="match">Match image size</option>
              </select>
            </Field>
          </div>
        )}

        <Field label="Page Size" htmlFor="ws-size">
          <select id="ws-size" className="field" value={page.pageSize} disabled={matchSize} onChange={(e) => setPage({ pageSize: e.target.value as PageSettings["pageSize"] })}>
            <option value="A4">A4 (210 × 297 mm)</option>
            <option value="LETTER">Letter (8.5 × 11 in)</option>
            <option value="LEGAL">Legal (8.5 × 14 in)</option>
          </select>
        </Field>

        <Field label="Orientation">
          <Segment
            label="Orientation"
            value={page.orientation}
            disabled={matchSize}
            onChange={(v) => setPage({ orientation: v })}
            options={[...(isImage ? [{ value: "auto" as const, label: "Auto" }] : []), { value: "portrait" as const, label: "Portrait" }, { value: "landscape" as const, label: "Landscape" }]}
          />
        </Field>

        <Field label="Margins" htmlFor="ws-margins">
          <select id="ws-margins" className="field" value={page.margins} disabled={matchSize} onChange={(e) => setPage({ margins: e.target.value as PageSettings["margins"] })}>
            <option value="narrow">Narrow (0.5 in)</option>
            <option value="normal">Normal (1 in, default)</option>
            <option value="wide">Wide (1.5 in)</option>
          </select>
        </Field>
        {matchSize && <p className="text-xs text-muted">The page takes the image&apos;s size, with no margins.</p>}
      </div>

      <div className="space-y-3">
        <button type="button" className="btn btn-primary w-full" onClick={convert} data-testid="convert-button">
          <BoltIcon size={18} /> Convert to {OUTPUT_META[output].label}
        </button>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <LockIcon size={14} className="mt-0.5 shrink-0" />
          Conversion runs locally in your browser. Your file never leaves your device.
        </p>
      </div>
    </section>
  );
}
