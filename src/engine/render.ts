import { prepareForPdf, MAX_UNSUPPORTED_RATIO } from "./coverage";
import { renderDocx } from "./render-docx";
import { renderImagePdf, renderTextPdf } from "./render-pdf";
import { verifyDocx, verifyPdf } from "./verify";
import { FileForgeError, type RenderJob, type RenderResult, type Stage } from "./types";

/**
 * Pure rendering pipeline. Runs inside a Web Worker in the browser (so it can be cancelled by
 * terminating the worker) and directly on the main thread as a fallback and in tests.
 */
export async function runRender(job: RenderJob, onStage: (s: Stage) => void = () => {}): Promise<RenderResult> {
  if (job.kind === "image") {
    onStage("rendering");
    const pdf = await renderImagePdf(job.image, job.settings, job.title);
    onStage("verifying");
    return { bytes: pdf.bytes, mime: "application/pdf", extension: "pdf", pageCount: pdf.pageCount, checks: verifyPdf(pdf.bytes, { pageCount: pdf.pageCount, kind: "image" }) };
  }

  if (job.output === "pdf") {
    const { doc, report, warning } = prepareForPdf(job.doc);
    if (report.total > 0 && report.unsupported / report.total > MAX_UNSUPPORTED_RATIO) {
      throw new FileForgeError(
        "pdf-unsupported-script",
        "Most of this text uses a script the PDF font can't draw (for example CJK, Arabic or Hebrew). A PDF would be unreadable. Convert to DOCX instead, which keeps every character.",
      );
    }
    onStage("rendering");
    const pdf = await renderTextPdf(doc, job.settings, job.title);
    onStage("verifying");
    const checks = verifyPdf(pdf.bytes, { pageCount: pdf.pageCount, kind: "text" });
    if (warning) checks.push({ id: "glyphs", label: warning.message, passed: false });
    return { bytes: pdf.bytes, mime: "application/pdf", extension: "pdf", pageCount: pdf.pageCount, checks };
  }

  onStage("rendering");
  const bytes = await renderDocx(job.doc, job.settings, job.title);
  onStage("verifying");
  const checks = await verifyDocx(bytes, job.doc);
  return { bytes, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx", checks };
}
