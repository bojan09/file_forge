import { expect, test } from "@playwright/test";
import { docxXml, extractPdf } from "../unit/helpers";
import { convertAndDownload, fixture, trackNetwork, uploadFile, waitForWorkspace } from "./helpers";

test.describe("upload → settings → convert → download", () => {
  test("Markdown → searchable PDF, with no external requests and no uploads", async ({ page }) => {
    const net = trackNetwork(page);
    await page.goto("/");
    await uploadFile(page, fixture("sample.md"));
    await waitForWorkspace(page);
    await expect(page.getByTestId("file-name")).toHaveText("sample.md");
    await expect(page.getByTestId("doc-preview")).toContainText("Project Plan");
    await page.getByLabel("Page Size").selectOption("LETTER");
    await page.getByRole("radio", { name: "Landscape" }).click();
    const { download, bytes } = await convertAndDownload(page);
    expect(download.suggestedFilename()).toBe("sample.pdf");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const { pages, numPages } = await extractPdf(new Uint8Array(bytes));
    expect(numPages).toBeGreaterThan(0);
    const text = pages.join(" ");
    expect(text).toContain("Project Plan");
    expect(text).toContain("Build a fast and intuitive product");
    expect(text).toContain("In Progress");
    await expect(page.getByTestId("quality-checks")).toContainText("selectable and searchable");
    expect(net.external, "no requests leave localhost").toEqual([]);
    expect(net.writes, "no POST/PUT requests").toEqual([]);
  });

  test("Markdown → editable DOCX with headings, lists, tables", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("sample.md"));
    await waitForWorkspace(page);
    await page.getByTestId("output-docx").click();
    const { download, bytes } = await convertAndDownload(page);
    expect(download.suggestedFilename()).toBe("sample.docx");
    const { xml, zip } = await docxXml(new Uint8Array(bytes));
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain("Project Plan");
    expect(Object.keys(zip.files).some((n) => n.startsWith("word/media/"))).toBe(false);
  });

  test("TXT with Unicode keeps Cyrillic text in PDF", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("sample.txt"));
    await waitForWorkspace(page);
    const { bytes } = await convertAndDownload(page);
    const { pages } = await extractPdf(new Uint8Array(bytes));
    expect(pages.join(" ")).toContain("Здраво свету");
  });

  test("image → PDF keeps aspect ratio; rotated EXIF image becomes portrait", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("rotated.jpg"));
    await waitForWorkspace(page);
    await page.getByLabel("Quality").selectOption("balanced");
    const { bytes } = await convertAndDownload(page);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await (pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise);
    const view = (await doc.getPage(1)).view;
    const w = view[2]! - view[0]!;
    const h = view[3]! - view[1]!;
    expect(h).toBeGreaterThan(w); // auto orientation: portrait because the image displays as 240x400
    expect(doc.numPages).toBe(1);
    await expect(page.getByTestId("quality-checks")).toContainText("not searchable");
  });

  test("HTML: unsafe content is neutralised and reported", async ({ page }) => {
    const net = trackNetwork(page);
    await page.goto("/");
    await uploadFile(page, fixture("unsafe.html"));
    await waitForWorkspace(page);
    const notices = page.getByTestId("notices").first();
    await expect(notices).toContainText("remote resource");
    await expect(notices).toContainText("approximate");
    const pwned = await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned);
    expect(pwned).toBeUndefined();
    const { bytes } = await convertAndDownload(page);
    const { pages } = await extractPdf(new Uint8Array(bytes));
    const text = pages.join(" ");
    expect(text).toContain("Unsafe & messy");
    expect(text).toContain("Visible text survives");
    expect(text).not.toContain("pwned");
    expect(text).not.toContain("alert");
    expect(net.external).toEqual([]);
  });

  test("CSV → PDF table and DOCX table", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("sample.csv"));
    await waitForWorkspace(page);
    const pdf = await convertAndDownload(page);
    const { pages } = await extractPdf(new Uint8Array(pdf.bytes));
    expect(pages.join(" ")).toContain('Likes "quotes", commas');
    await page.getByTestId("convert-another").click();
    await uploadFile(page, fixture("sample.csv"));
    await waitForWorkspace(page);
    await page.getByTestId("output-docx").click();
    const docx = await convertAndDownload(page);
    const { xml } = await docxXml(new Uint8Array(docx.bytes));
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("Ünïcode ok");
  });

  test("wide CSV warns and still converts", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("wide.csv"));
    await waitForWorkspace(page);
    await expect(page.getByTestId("notices").first()).toContainText("24 columns");
    await page.getByRole("radio", { name: "Landscape" }).click();
    await page.getByLabel("Margins").selectOption("narrow");
    const { bytes } = await convertAndDownload(page);
    const { pages } = await extractPdf(new Uint8Array(bytes));
    const text = pages.join(" ");
    expect(text).toContain("Column 24");
    expect(text.replace(/\s+/g, "")).toContain("r29c23-value");
  });
});

test.describe("rejections", () => {
  test("unsupported file type is rejected politely", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, { name: "archive.zip", mimeType: "application/zip", buffer: Buffer.from("PK\x03\x04") });
    await expect(page.getByTestId("inspect-error")).toContainText(".zip files are not supported");
    await expect(page.getByTestId("file-input")).toBeAttached();
  });

  test("oversized text file is rejected with the limit", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, { name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(5 * 1024 * 1024 + 10, "a") });
    await expect(page.getByTestId("inspect-error")).toContainText("limited to 5.0 MB");
  });

  test("empty file and fake image are rejected", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) });
    await expect(page.getByTestId("inspect-error")).toContainText("empty");
    await uploadFile(page, { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not really a png at all") });
    await expect(page.getByTestId("inspect-error")).toContainText("isn't a valid");
  });

  test("image above megapixel limit is rejected from its header", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("huge-dimensions.png"));
    await expect(page.getByTestId("inspect-error")).toContainText("megapixels");
  });
});
