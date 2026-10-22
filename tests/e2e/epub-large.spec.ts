import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { docxXml, extractPdf } from "../unit/helpers";
import { uploadFile, waitForWorkspace } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = (n: string) => ({ name: n, mimeType: "application/octet-stream", buffer: readFileSync(path.resolve(here, "../corpus", n)) });

test.describe("EPUB in the browser", () => {
  test("converts to PDF with the book's text and embedded pictures, and offers DOCX too", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, corpus("epub-simple.epub"));
    await waitForWorkspace(page);
    await expect(page.getByTestId("file-name")).toContainText("epub-simple.epub");
    await expect(page.getByTestId("output-docx")).toBeEnabled();
    await page.getByTestId("convert-button").click();
    await expect(page.getByRole("heading", { name: "Conversion Complete!" })).toBeVisible({ timeout: 60000 });
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-link").click()]);
    const pdf = readFileSync(await d.path());
    const text = (await extractPdf(new Uint8Array(pdf))).pages.join(" ");
    expect(text).toContain("bright cold day in April");
    expect(text).toContain("Македонски");
    expect(pdf.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
  });

  test("converts to DOCX", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, corpus("epub-simple.epub"));
    await waitForWorkspace(page);
    await page.getByTestId("output-docx").click();
    await page.getByTestId("convert-button").click();
    await expect(page.getByRole("heading", { name: "Conversion Complete!" })).toBeVisible({ timeout: 60000 });
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-link").click()]);
    const { xml } = await docxXml(new Uint8Array(readFileSync(await d.path())));
    expect(xml).toContain("Chapter Three");
  });

  test("a protected EPUB is refused with an explanation", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, corpus("epub-drm.epub"));
    await expect(page.getByTestId("inspect-error")).toContainText("protected");
  });
});

test.describe("home navigation", () => {
  test("clicking the logo from a result or a queue returns to the upload screen", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await waitForWorkspace(page);
    await page.locator('header a[aria-label="FileForge home"]').click();
    await expect(page.getByTestId("file-input")).toBeAttached();
    await expect(page.getByTestId("convert-button")).toHaveCount(0);

    await page.getByTestId("file-input").setInputFiles([
      { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("1") },
      { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("2") },
    ]);
    await expect(page.getByTestId("batch-workspace")).toBeVisible();
    await page.locator('header a[aria-label="FileForge home"]').click();
    await expect(page.getByTestId("batch-workspace")).toHaveCount(0);
    await expect(page.getByTestId("file-input")).toBeAttached();
  });

  test("the logo also works from another page", async ({ page }) => {
    await page.goto("/formats/");
    await page.locator('header a[aria-label="FileForge home"]').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("file-input")).toBeAttached();
  });
});

test.describe("larger files", () => {
  test("a ~90 MB PDF is accepted by size (and then judged on its content), a 101 MB one is refused up front", async ({ page }) => {
    await page.goto("/");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "big-"));
    const ok = path.join(dir, "ok.pdf");
    fs.writeFileSync(ok, "%PDF-1.4\n");
    fs.truncateSync(ok, 90 * 1024 * 1024);
    await page.getByTestId("file-input").setInputFiles(ok);
    // Past the size check it fails on content (not a real PDF), which proves the size was accepted.
    await expect(page.getByTestId("inspect-error")).not.toContainText("limited to", { timeout: 60000 });
    const big = path.join(dir, "big.pdf");
    fs.writeFileSync(big, "%PDF-1.4\n");
    fs.truncateSync(big, 101 * 1024 * 1024);
    await page.getByTestId("file-input").setInputFiles(big);
    await expect(page.getByTestId("inspect-error")).toContainText("limited to 100 MB");
  });
});
