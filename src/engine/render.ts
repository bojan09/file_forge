import { prepareForPdf, MAX_UNSUPPORTED_RATIO } from "./coverage";
import { normalizeDocImages } from "./doc-images";
import { resolveStyle } from "./style";
import { renderDocx } from "./render-docx";
import { renderImagePdf, renderImagesPdf, renderTextPdf } from "./render-pdf";
import { verifyDocx, verifyPdf } from "./verify";
import { FileForgeError, type RenderJob, type RenderResult, type Stage } from "./types";

/**
 * Pure rendering pipeline. Runs inside a Web Worker in the browser (so it can be cancelled by
 * terminating the worker) and directly on the main thread as a fallback and in tests.
 */
function Buffer_latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}

export async function runRender(job: RenderJob, onStage: (s: Stage) => void = () => {}): Promise<RenderResult> {
  if (job.kind === "image") {
    onStage("rendering");
    const pdf = await renderImagePdf(job.image, job.settings, job.title);
    onStage("verifying");
    return { bytes: pdf.bytes, mime: "application/pdf", extension: "pdf", pageCount: pdf.pageCount, checks: verifyPdf(pdf.bytes, { pageCount: pdf.pageCount, kind: "image" }) };
  }

  if (job.kind === "images") {
    onStage("rendering");
    const pdf = await renderImagesPdf(job.images, job.settings, job.title);
    onStage("verifying");
    const checks = verifyPdf(pdf.bytes, { pageCount: pdf.pageCount, kind: "image" });
    const embedded = (Buffer_latin1(pdf.bytes).match(/\/Subtype\s*\/Image\b/g) ?? []).length;
    checks.push({ id: "image-count", label: `All ${job.images.length} images are embedded, one per page`, passed: embedded >= job.images.length && pdf.pageCount === job.images.length });
    return { bytes: pdf.bytes, mime: "application/pdf", extension: "pdf", pageCount: pdf.pageCount, checks };
  }

  if (job.output === "pdf") {
    const style = resolveStyle(job.settings.style);
    const { doc, report, warning } = prepareForPdf(job.doc, style.fontFamily);
    if (report.total > 0 && report.unsupported / report.total > MAX_UNSUPPORTED_RATIO) {
      throw new FileForgeError(
        "pdf-unsupported-script",
        "Most of this text uses a script the PDF font can't draw (for example CJK, Arabic or Hebrew). A PDF would be unreadable. Convert to DOCX instead, which keeps every character.",
      );
    }
    onStage("rendering");
    const prepared = await normalizeDocImages(doc);
    const pdf = await renderTextPdf(prepared.doc, job.settings, job.title);
    onStage("verifying");
    const checks = verifyPdf(pdf.bytes, { pageCount: pdf.pageCount, kind: "text", embeddedImages: doc.imageCount ?? 0 });
    if (warning) checks.push({ id: "glyphs", label: warning.message, passed: false });
    if (prepared.dropped) checks.push({ id: "images-dropped", label: `${prepared.dropped} image${prepared.dropped > 1 ? "s" : ""} with transparency could not be prepared here and ${prepared.dropped > 1 ? "were" : "was"} replaced by alt text.`, passed: false });
    if (pdf.fontFallback) checks.push({ id: "font-fallback", label: `The ${pdf.fontFallback} font could not be loaded, so the default sans font was used.`, passed: false });
    return { bytes: pdf.bytes, mime: "application/pdf", extension: "pdf", pageCount: pdf.pageCount, checks };
  }

  onStage("rendering");
  const bytes = await renderDocx(job.doc, job.settings, job.title);
  onStage("verifying");
  const checks = await verifyDocx(bytes, job.doc, job.settings);
  return { bytes, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx", checks };
}
