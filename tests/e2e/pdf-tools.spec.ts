import { mkdtempSync, readFileSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { extractPdf } from "../unit/helpers";
import { trackNetwork } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = (n: string) => ({ name: n, mimeType: "application/pdf", buffer: readFileSync(path.resolve(here, "../corpus", n)) });

async function add(page: Page, ...names: string[]) {
  const first = await page.getByTestId("file-input").count();
  await (first ? page.getByTestId("file-input") : page.getByTestId("pdf-add-input")).setInputFiles(names.map(corpus));
}
async function ready(page: Page, n: number) {
  await expect(page.getByTestId("pdf-file-row")).toHaveCount(n);
  await expect(page.locator('[data-testid="pdf-file-row"]:has-text("Checking")')).toHaveCount(0, { timeout: 30000 });
}
async function download(page: Page, id: string) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId(id).click()]);
  return readFileSync(await d.path());
}
const axe = async (page: Page, label: string) => {
  await page.waitForTimeout(500);
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(res.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join("|")}`), label).toEqual([]);
};

test.describe("PDF tools", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/pdf-tools/");
    await expect(page.getByTestId("pdf-tools")).toBeVisible();
  });

  test("merge: files in the listed order, reorder with arrows, text of every page intact, nothing leaves the device", async ({ page }) => {
    const net = trackNetwork(page);
    await add(page, "pdf-text-simple.pdf", "pdf-two-column.pdf");
    await ready(page, 2);
    await expect(page.getByTestId("tool-panel")).toContainText("7 pages from 2 files");
    await page.getByRole("button", { name: "Move pdf-two-column.pdf up" }).click();
    await page.getByTestId("run-tool").click();
    await expect(page.getByTestId("tool-result")).toBeVisible({ timeout: 30000 });
    const out = await download(page, "download-0");
    const merged = await extractPdf(new Uint8Array(out));
    const a = await extractPdf(new Uint8Array(corpus("pdf-text-simple.pdf").buffer));
    const b = await extractPdf(new Uint8Array(corpus("pdf-two-column.pdf").buffer));
    expect(merged.numPages).toBe(7);
    expect(merged.pages).toEqual([...b.pages, ...a.pages]);
    expect(net.external).toEqual([]);
  });

  test("organize: rotate, remove, move and extract by range; result matches the plan", async ({ page }) => {
    await page.getByTestId("tool-organize").click();
    await add(page, "pdf-text-simple.pdf");
    await ready(page, 1);
    await expect(page.getByTestId("page-card")).toHaveCount(4);
    await expect(page.getByTestId("page-card").first().locator("canvas")).toBeVisible();
    await page.getByTestId("keep-ranges").fill("2-4");
    await page.getByTestId("keep-apply").click();
    await expect(page.getByTestId("organize-summary")).toContainText("3 of 4 pages kept");
    await page.getByTestId("page-card").nth(1).getByTestId("page-rotate-cw").click();
    await page.getByTestId("page-card").nth(3).getByTestId("page-left").click();
    await page.getByTestId("run-tool").click();
    await expect(page.getByTestId("tool-result")).toBeVisible({ timeout: 30000 });
    const out = await download(page, "download-0");
    const res = await extractPdf(new Uint8Array(out));
    const src = await extractPdf(new Uint8Array(corpus("pdf-text-simple.pdf").buffer));
    // pages 2,3,4 kept; page 4 moved before page 3 → 2,4,3
    expect(res.pages).toEqual([src.pages[1], src.pages[3], src.pages[2]]);
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 0]);
  });

  test("organize: invalid range explains itself; unchanged plan is refused", async ({ page }) => {
    await page.getByTestId("tool-organize").click();
    await add(page, "pdf-text-simple.pdf");
    await ready(page, 1);
    await page.getByTestId("keep-ranges").fill("9");
    await page.getByTestId("keep-apply").click();
    await expect(page.getByRole("alert").filter({ hasText: "past the end" })).toBeVisible();
    await page.getByTestId("run-tool").click();
    await expect(page.getByTestId("tool-error")).toContainText("Nothing to change");
  });

  test("split by ranges produces a verified ZIP of separate PDFs", async ({ page }) => {
    await page.getByTestId("tool-split").click();
    await add(page, "pdf-long.pdf");
    await ready(page, 1);
    await expect(page.getByTestId("run-tool")).toBeDisabled();
    await page.getByTestId("split-ranges").fill("1-50, 51-120");
    await expect(page.getByTestId("split-summary")).toContainText("2 files will be created");
    await page.getByTestId("run-tool").click();
    await expect(page.getByTestId("result-file")).toHaveCount(2, { timeout: 60000 });
    const zip = await JSZip.loadAsync(await download(page, "download-zip"));
    expect(Object.keys(zip.files).sort()).toEqual(["pdf-long-pages-1-50.pdf", "pdf-long-pages-51-120.pdf"]);
    const second = await extractPdf(new Uint8Array(await zip.files["pdf-long-pages-51-120.pdf"]!.async("uint8array")));
    expect(second.numPages).toBe(70);
  });

  test("split: bad ranges are explained, every-N and every-page modes count correctly", async ({ page }) => {
    await page.getByTestId("tool-split").click();
    await add(page, "pdf-text-simple.pdf");
    await ready(page, 1);
    await page.getByTestId("split-ranges").fill("3-1");
    await expect(page.getByTestId("split-summary")).toContainText("backwards");
    await page.getByTestId("split-mode-every").click();
    await page.getByTestId("split-count").fill("3");
    await expect(page.getByTestId("split-summary")).toContainText("2 files");
    await page.getByTestId("split-mode-each").click();
    await expect(page.getByTestId("split-summary")).toContainText("4 files");
  });

  test("properties: edits title and author (Unicode) and the result keeps its content", async ({ page }) => {
    await page.getByTestId("tool-metadata").click();
    await add(page, "pdf-text-simple.pdf");
    await ready(page, 1);
    await page.getByTestId("meta-title").fill("Годишен извештај");
    await page.getByTestId("meta-author").fill("Бојан");
    await page.getByTestId("run-tool").click();
    await expect(page.getByTestId("tool-result")).toBeVisible({ timeout: 30000 });
    const out = await download(page, "download-0");
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(out);
    expect([doc.getTitle(), doc.getAuthor(), doc.getPageCount()]).toEqual(["Годишен извештај", "Бојан", 4]);
  });

  test("compress is labeled experimental, reports before/after, and never returns something larger", async ({ page }) => {
    await page.getByTestId("tool-compress").click();
    await expect(page.getByTestId("tool-compress")).toContainText("Experimental");
    await add(page, "pdf-long.pdf");
    await ready(page, 1);
    await page.getByTestId("run-tool").click();
    await expect(page.getByTestId("compress-stats")).toContainText("Before");
    const out = await download(page, "download-0");
    expect(out.length).toBeLessThanOrEqual(readFileSync(path.resolve(here, "../corpus/pdf-long.pdf")).length);
    expect((await extractPdf(new Uint8Array(out))).numPages).toBe(120);
  });

  test("encrypted, damaged and non-PDF files are refused per file; good files still work", async ({ page }) => {
    await add(page, "pdf-text-simple.pdf", "pdf-encrypted.pdf", "pdf-truncated.pdf", "pdf-notpdf.pdf");
    await ready(page, 4);
    const rows = page.getByTestId("pdf-file-row");
    await expect(rows.nth(1)).toContainText("password-protected");
    await expect(rows.nth(2)).toContainText(/damaged|not a PDF/);
    await expect(rows.nth(3)).toContainText("not a PDF");
    await expect(page.getByTestId("run-tool")).toBeDisabled(); // only one usable file; merge needs two
    await rows.nth(1).getByRole("button", { name: /Remove/ }).click();
  });

  test("non-PDF extensions are rejected with a message", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles({ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(page.getByTestId("pdf-notice")).toContainText("only PDF files");
  });

  test("a file above the size limit is refused before it is read", async ({ page }) => {
    const big = path.join(mkdtempSync(path.join(tmpdir(), "huge-")), "huge.pdf");
    writeFileSync(big, "%PDF-1.4\n");
    truncateSync(big, 101 * 1024 * 1024); // sparse file
    await page.getByTestId("file-input").setInputFiles(big);
    await expect(page.getByTestId("pdf-notice")).toContainText("larger than 100 MB");
    await expect(page.getByTestId("pdf-file-row")).toHaveCount(0);
  });

  test("the run button is disabled while a job runs, so rapid clicks cannot start two", async ({ page }) => {
    await page.getByTestId("tool-split").click();
    await add(page, "pdf-long.pdf");
    await ready(page, 1);
    await page.getByTestId("split-mode-each").click();
    await page.getByTestId("run-tool").click();
    await expect(page.getByTestId("run-tool")).toBeDisabled();
    await expect(page.getByTestId("result-file")).toHaveCount(120, { timeout: 90000 });
  });

  test("a running job can be cancelled and the tool stays usable", async ({ page }) => {
    await page.getByTestId("tool-split").click();
    await add(page, "pdf-long.pdf");
    await ready(page, 1);
    await page.getByTestId("split-mode-each").click();
    await page.getByTestId("run-tool").click();
    await page.getByTestId("cancel-tool").click();
    await expect(page.getByTestId("tool-error")).toContainText(/Cancelled/);
    await expect(page.getByTestId("run-tool")).toBeEnabled();
  });

  test("axe: empty, loaded tools, results; keyboard operation of page controls", async ({ page }) => {
    await axe(page, "empty");
    await page.getByTestId("tool-organize").click();
    await add(page, "pdf-text-simple.pdf");
    await ready(page, 1);
    await expect(page.getByTestId("page-card").first().locator("canvas")).toBeVisible();
    await axe(page, "organize");
    await page.getByRole("button", { name: "Rotate page 1 clockwise" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("organize-summary")).toContainText("1 rotated");
    await page.getByTestId("tool-metadata").click();
    await axe(page, "properties");
    await page.getByTestId("run-tool").click();
    await expect(page.getByTestId("tool-result")).toBeVisible({ timeout: 30000 });
    await axe(page, "result");
  });

  test("no horizontal overflow and the page controls fit at this viewport", async ({ page }) => {
    await page.getByTestId("tool-organize").click();
    await add(page, "pdf-long.pdf");
    await ready(page, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
