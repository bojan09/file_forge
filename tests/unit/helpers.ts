import JSZip from "jszip";

/** Extracts text per page from a PDF using pdf.js, independent of our own verification code. */
export async function extractPdf(bytes: Uint8Array): Promise<{ pages: string[]; numPages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  const numPages = doc.numPages;
  await task.destroy();
  return { pages, numPages };
}

export async function docxXml(bytes: Uint8Array): Promise<{ xml: string; zip: JSZip }> {
  const zip = await JSZip.loadAsync(bytes);
  return { xml: await zip.file("word/document.xml")!.async("string"), zip };
}

export const defaultSettings = {
  pageSize: "A4" as const,
  orientation: "portrait" as const,
  margins: "normal" as const,
  imageQuality: "balanced" as const,
  imageFit: "fit" as const,
};
