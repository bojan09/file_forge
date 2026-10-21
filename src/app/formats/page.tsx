import type { Metadata } from "next";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { PageShell, Section } from "@/components/PageShell";
import { PROCESSING_LIMITS, SOURCE_FORMATS, formatBytes } from "@/engine/registry";

export const metadata: Metadata = { title: "Formats" };

const FID = { high: "High fidelity", approximate: "Approximate" } as const;

export default function FormatsPage() {
  return (
    <PageShell title="Supported formats" intro="FileForge converts one file at a time, in your browser. Only the conversions below are supported; anything else is rejected rather than faked.">
      <section aria-label="Compatibility matrix" className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm" data-testid="format-matrix">
            <caption className="sr-only">Which input formats convert to which outputs</caption>
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Input</th>
                <th scope="col" className="px-4 py-3 font-semibold">Extensions</th>
                <th scope="col" className="px-4 py-3 font-semibold">PDF</th>
                <th scope="col" className="px-4 py-3 font-semibold">DOCX</th>
                <th scope="col" className="px-4 py-3 font-semibold">Max size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {SOURCE_FORMATS.map((f) => (
                <tr key={f.id}>
                  <th scope="row" className="px-4 py-3 font-semibold">
                    <span className="flex items-center gap-2.5">
                      <FileTypeIcon ext={f.extensions[0]!} size={22} />
                      {f.label}
                    </span>
                  </th>
                  <td className="px-4 py-3 text-muted">{f.extensions.map((e) => `.${e}`).join(" ")}</td>
                  {(["pdf", "docx"] as const).map((o) => (
                    <td key={o} className="px-4 py-3">
                      {f.outputs.includes(o) ? (
                        <span className={`badge ${f.fidelity[o] === "high" ? "badge-success" : "badge-warn"}`}>{FID[f.fidelity[o]!]}</span>
                      ) : (
                        <span className="text-muted">Not supported</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-muted">{formatBytes(f.maxBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {SOURCE_FORMATS.map((f) => (
        <Section key={f.id} title={f.label} id={f.id}>
          <p>{f.summary}</p>
          <ul>
            {f.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Section>
      ))}

      <Section title="Searchable PDF vs picture PDF">
        <p>
          <strong>Text, Markdown, HTML and CSV</strong> become PDFs with real text. You can select, copy and search it.
        </p>
        <p>
          <strong>Images</strong> become PDFs that contain a picture of the image. FileForge does not do OCR, so text inside a photo or scan can&apos;t be selected or searched.
        </p>
      </Section>

      <Section title="Editable DOCX">
        <p>
          DOCX output uses real Word paragraphs, headings, lists and tables, so you can edit it in Word, LibreOffice or Google Docs. It is never a screenshot of the page. Appearance can differ slightly between word processors.
        </p>
      </Section>

      <Section title="Limitations">
        <ul>
          <li>PDF text uses the Roboto font, which covers Latin, Cyrillic and Greek. Other scripts (for example Chinese, Japanese, Korean, Arabic, Hebrew, emoji) can&apos;t be drawn in PDF and are replaced by &quot;?&quot;. If most of a file uses such scripts, PDF is refused. DOCX keeps every character.</li>
          <li>HTML and CSV are <strong>approximate</strong>. CSS, scripts, forms, media and remote resources in HTML are ignored.</li>
          <li>
            Limits: up to {PROCESSING_LIMITS.balanced.imageMaxMegapixels} megapixels per image, {PROCESSING_LIMITS.balanced.csvMaxRows.toLocaleString()} CSV rows and {PROCESSING_LIMITS.balanced.csvMaxCols} columns (conservative processing mode: {PROCESSING_LIMITS.conservative.imageMaxMegapixels} MP, {PROCESSING_LIMITS.conservative.csvMaxRows.toLocaleString()} rows, {PROCESSING_LIMITS.conservative.csvMaxCols} columns). Very large files may be slow or run out of memory on phones.
          </li>
          <li>Not supported: password-protected files, PDF or DOCX as input, batch conversion, OCR.</li>
        </ul>
      </Section>
    </PageShell>
  );
}
