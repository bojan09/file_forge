import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { docxXml, extractPdf } from "../unit/helpers";
import { convertAndDownload, trackNetwork, uploadFile, waitForWorkspace } from "./helpers";

const corpus = (name: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../corpus", name);
const file = (name: string) => ({ name, mimeType: "application/octet-stream", buffer: readFileSync(corpus(name)) });
const notices = (page: Page) => page.locator('[data-testid="notices"]:visible');

test.describe("capability matrix and honesty", () => {
  test("Formats page labels Word, Excel and PDF as Experimental and explains what is unavailable", async ({ page }) => {
    await page.goto("/formats/");
    const matrix = page.getByTestId("format-matrix");
    for (const [label, outputs] of [
      ["Word", ["Experimental", "Unavailable"]],
      ["Excel", ["Experimental", "Unavailable"]],
      ["PDF (with text)", ["Unavailable", "Experimental"]],
      ["Plain text", ["Supported", "Supported"]],
      ["HTML", ["Approximate", "Approximate"]],
    ] as const) {
      const row = matrix.locator("tr", { has: page.getByRole("rowheader", { name: label }) });
      const cells = await row.locator("td").allInnerTexts();
      expect([cells[1], cells[2]], label).toEqual(outputs);
    }
    await expect(page.getByText("What the labels mean")).toBeVisible();
    const rows = page.getByTestId("unavailable-row");
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toContainText("Scanned PDF to Word");
    await expect(rows.nth(0)).toContainText("OCR");
    await expect(page.locator("body")).toContainText("PowerPoint to PDF");
    // No clickable control offers an unavailable conversion.
    await expect(page.getByRole("button", { name: /PowerPoint|EPUB/i })).toHaveCount(0);
  });

  test("home screen lists the new conversions as experimental", async ({ page }) => {
    await page.goto("/");
    for (const t of ["Word to PDF (experimental)", "Excel to PDF (experimental)", "PDF to Word (experimental)"]) await expect(page.getByRole("button", { name: t })).toBeVisible();
  });

  test("unsupported Office formats are refused with a reason", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, { name: "deck.pptx", mimeType: "application/octet-stream", buffer: Buffer.from("PK\x03\x04") });
    await expect(page.getByTestId("inspect-error")).toContainText(/\.pptx files are not supported/);
    await uploadFile(page, { name: "old.doc", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
    await expect(page.getByTestId("inspect-error")).toContainText(/\.doc files are not supported/);
  });
});

test.describe("Word to PDF", () => {
  test("simple document: extracted preview, only PDF offered, experimental notices, searchable PDF with preview", async ({ page }) => {
    const net = trackNetwork(page);
    await page.goto("/");
    await uploadFile(page, file("docx-simple.docx"));
    await waitForWorkspace(page);
    await expect(page.getByTestId("file-meta")).toContainText("Word");
    await expect(page.getByTestId("doc-preview")).toContainText("Simple Report");
    await expect(page.getByTestId("preview-note")).toContainText("Extracted content");
    await expect(page.getByRole("tab", { name: "Raw Content" })).toHaveCount(0);
    await expect(page.getByTestId("output-docx")).toBeDisabled();
    await expect(page.getByTestId("output-pdf")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("only-output-note")).toContainText("Word files convert to PDF only");
    await expect(page.getByTestId("experimental-note")).toBeVisible();
    await expect(notices(page)).toContainText("Word to PDF is experimental");
    const { download, bytes } = await convertAndDownload(page);
    expect(download.suggestedFilename()).toBe("docx-simple.pdf");
    const text = (await extractPdf(new Uint8Array(bytes))).pages.join(" ");
    for (const w of ["Simple Report", "bold", "Third bullet", "Gizmo", "199.99"]) expect(text).toContain(w);
    await expect(page.getByTestId("experimental-result-note")).toBeVisible();
    await expect(page.getByTestId("pdf-viewer").locator("canvas").first()).toBeVisible({ timeout: 20000 });
    expect(net.external).toEqual([]);
    expect(net.writes).toEqual([]);
  });

  test("page setup, font, header and footer are read from the document and stay editable", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, file("docx-complex.docx"));
    await waitForWorkspace(page);
    await expect(page.getByLabel("Page Size")).toHaveValue("LETTER");
    await expect(page.getByRole("radio", { name: "Landscape" })).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("advanced-options").locator("summary").click();
    await expect(page.getByLabel("Header text")).toHaveValue("Complex Document Header");
    await expect(page.getByRole("radio", { name: "Serif" })).toHaveAttribute("aria-checked", "true");
    await page.getByLabel("Header text").fill("Edited header");
    for (const t of [/tracked changes/i, /text box/, /merged cells/, /Header, footer/]) await expect(notices(page)).toContainText(t);
    const { bytes } = await convertAndDownload(page);
    const pages = (await extractPdf(new Uint8Array(bytes))).pages.join(" ");
    expect(pages).toContain("Edited header");
    expect(pages).toContain("inserted text");
    expect(pages).not.toContain("deleted text");
  });

  test("damaged and fake documents are refused with specific messages", async ({ page }) => {
    await page.goto("/");
    for (const [name, re] of [
      ["docx-truncated.docx", /damaged or truncated/],
      ["docx-notzip.docx", /valid \.docx/],
      ["docx-bomb.docx", /too large to process safely/],
    ] as const) {
      await uploadFile(page, file(name));
      await expect(page.getByTestId("inspect-error")).toContainText(re);
    }
  });
});

test.describe("Excel to PDF", () => {
  test("sheet picker, all sheets, print area and header options re-parse instantly and change the output", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, file("xlsx-multi.xlsx"));
    await waitForWorkspace(page);
    await expect(notices(page)).toContainText('only "Overview" is converted');
    await page.getByTestId("advanced-options").locator("summary").click();
    const sheet = page.getByTestId("xlsx-sheet");
    await expect(sheet.locator("option")).toHaveText(["Overview", "Detail", "All sheets"]);
    await sheet.selectOption("1");
    await expect(page.getByTestId("doc-preview").locator("th")).toHaveCount(3); // print area A1:C10
    await expect(notices(page)).toContainText("print area was used");
    await page.getByLabel("Use the sheet's print area").uncheck();
    await expect(page.getByTestId("doc-preview").locator("th")).toHaveCount(4);
    await sheet.selectOption("all");
    await expect(page.getByTestId("doc-preview").locator("table")).toHaveCount(2);
    await expect(page.getByTestId("doc-preview").getByRole("separator", { name: "Page break" })).toBeVisible();
    await page.getByRole("radio", { name: "Is data" }).click();
    await expect(page.getByTestId("doc-preview").locator("th")).toHaveCount(0);
    const { bytes } = await convertAndDownload(page);
    const text = (await extractPdf(new Uint8Array(bytes))).pages.join(" ");
    for (const v of ["Overview", "Detail", "Item 30", "Quarter"]) expect(text).toContain(v);
    expect(text).not.toContain("secret");
  });

  test("values keep their Excel formatting; formulas show saved results", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, file("xlsx-simple.xlsx"));
    await waitForWorkspace(page);
    const { bytes } = await convertAndDownload(page);
    const text = (await extractPdf(new Uint8Array(bytes))).pages.join(" ");
    for (const v of ["2024-01-15", "1,234.50", "1.0%", "$96,291.00"]) expect(text).toContain(v);
  });

  test("a sheet above the column limit is refused with the limit stated; nothing is truncated", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, file("xlsx-too-wide.xlsx"));
    await expect(page.getByTestId("inspect-error")).toContainText("60 columns, above the 40-column limit");
  });
});

test.describe("PDF to Word", () => {
  test("text PDF becomes an editable DOCX with headings, a list and a table", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, file("pdf-text-simple.pdf"));
    await waitForWorkspace(page);
    await expect(page.getByTestId("output-pdf")).toBeDisabled();
    await expect(page.getByTestId("output-docx")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("only-output-note")).toContainText("convert to DOCX only");
    await expect(page.getByTestId("doc-preview")).toContainText("Quarterly Overview");
    await expect(page.getByTestId("doc-preview").locator("table")).toHaveCount(1);
    await expect(notices(page)).toContainText("PDF to Word is experimental and approximate");
    await expect(notices(page)).toContainText("Repeated headers, footers and page numbers");
    const { download, bytes } = await convertAndDownload(page);
    expect(download.suggestedFilename()).toBe("pdf-text-simple.docx");
    const { xml } = await docxXml(new Uint8Array(bytes));
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain("Quarterly Overview");
    await expect(page.getByTestId("docx-preview-note")).toBeVisible();
  });

  test("scanned, protected and damaged PDFs are refused with the real reason", async ({ page }) => {
    await page.goto("/");
    for (const [name, re] of [
      ["pdf-scanned.pdf", /scanned pages.*OCR/s],
      ["pdf-encrypted.pdf", /password protected/],
      ["pdf-truncated.pdf", /isn't a valid PDF, or it is damaged/],
      ["pdf-notpdf.pdf", /PDF header/],
    ] as const) {
      await uploadFile(page, file(name));
      await expect(page.getByTestId("inspect-error")).toContainText(re);
    }
  });

  test("a PDF parse can be cancelled", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, file("pdf-long.pdf"));
    // Whether the parse is still running or already finished, the app must end in a usable state after Cancel / New File.
    const cancel = page.getByRole("button", { name: "Cancel" });
    if (await cancel.isVisible().catch(() => false)) await cancel.click();
    else {
      await waitForWorkspace(page);
      await page.getByRole("button", { name: "New File" }).click();
    }
    await expect(page.getByTestId("file-input")).toBeAttached();
    await uploadFile(page, file("docx-simple.docx"));
    await waitForWorkspace(page);
  });
});

test.describe("batch", () => {
  test("Word, Excel and PDF files in one batch: eligible ones convert, ineligible ones are skipped with a reason, ZIP works", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles([file("docx-simple.docx"), file("xlsx-simple.xlsx"), file("pdf-text-simple.pdf"), file("pdf-scanned.pdf")]);
    await expect(page.getByTestId("batch-workspace")).toBeVisible();
    await page.getByTestId("start-batch").click();
    await expect(page.getByTestId("batch-complete")).toBeVisible({ timeout: 120000 });
    const rows = page.locator("[data-testid=queue-row]");
    await expect(rows.nth(0)).toHaveAttribute("data-status", "done");
    await expect(rows.nth(1)).toHaveAttribute("data-status", "done");
    await expect(rows.nth(2)).toHaveAttribute("data-status", "queued");
    await expect(rows.nth(2).getByTestId("row-reason")).toContainText("PDF (with text) files convert to DOCX only");
    await expect(rows.nth(3)).toHaveAttribute("data-status", "queued"); // scanned PDF: also not a PDF output
    await expect(page.getByTestId("download-zip")).toBeVisible();
  });
});

test.describe("accessibility and privacy", () => {
  for (const f of ["docx-complex.docx", "xlsx-multi.xlsx", "pdf-text-simple.pdf"]) {
    test(`axe: workspace and result for ${f}`, async ({ page }) => {
      await page.goto("/");
      await uploadFile(page, file(f));
      await waitForWorkspace(page);
      await page.getByTestId("advanced-options").locator("summary").click();
      await page.waitForTimeout(600);
      const check = async (label: string) => {
        const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(res.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
      };
      await check("workspace");
      await convertAndDownload(page);
      await page.waitForTimeout(800);
      await check("result");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }

  test("no file content leaves the browser for Office and PDF conversions", async ({ page }) => {
    const net = trackNetwork(page);
    const bodies: string[] = [];
    page.on("request", (r) => r.postData() && bodies.push(r.postData()!));
    await page.goto("/");
    for (const [name, out] of [["docx-simple.docx", "pdf"], ["xlsx-simple.xlsx", "pdf"], ["pdf-text-simple.pdf", "docx"]] as const) {
      await uploadFile(page, file(name));
      await waitForWorkspace(page);
      await page.getByTestId(`output-${out}`).click();
      await convertAndDownload(page);
      await page.getByTestId("convert-another").click();
    }
    expect(net.external).toEqual([]);
    expect(net.writes).toEqual([]);
    expect(bodies).toEqual([]);
  });
});
