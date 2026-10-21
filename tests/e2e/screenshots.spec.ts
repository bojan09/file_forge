import { test } from "@playwright/test";
import { convertAndDownload, fixture, uploadFile, waitForWorkspace } from "./helpers";

// Produces the screenshots referenced in docs/DESIGN_REFERENCE.md. Run with: SCREENSHOTS=1 npx playwright test screenshots
test.skip(!process.env.SCREENSHOTS, "screenshots are generated on demand");

for (const theme of ["dark", "light"] as const) {
  test(`screens ${theme}`, async ({ page }, info) => {
    const tag = `${info.project.name}-${theme}`;
    await page.addInitScript((t) => localStorage.setItem("fileforge:settings:v1", JSON.stringify({ theme: t })), theme);
    await page.goto("/");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `docs/screenshots/${tag}-1-home.png`, fullPage: true });
    await uploadFile(page, fixture("sample.md"));
    await waitForWorkspace(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `docs/screenshots/${tag}-2-workspace.png`, fullPage: true });
    await convertAndDownload(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `docs/screenshots/${tag}-3-result.png`, fullPage: true });
  });
}

import { readFileSync } from "node:fs";

const asFile = (name: string) => ({ name, mimeType: "application/octet-stream", buffer: readFileSync(fixture(name)) });

for (const theme of ["dark", "light"] as const) {
  test(`phase 2 screens ${theme}`, async ({ page }, info) => {
    const tag = `${info.project.name}-${theme}`;
    await page.addInitScript((t) => localStorage.setItem("fileforge:settings:v1", JSON.stringify({ theme: t })), theme);
    await page.goto("/");
    await page.getByTestId("mode-merge").click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `docs/screenshots/${tag}-4-home-merge-mode.png`, fullPage: true });
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles([asFile("sample.txt"), asFile("sample.md"), asFile("sample.csv"), asFile("photo.jpg"), { name: "archive.zip", mimeType: "application/zip", buffer: Buffer.from("PK") }]);
    await page.getByTestId("batch-workspace").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `docs/screenshots/${tag}-5-batch-queue.png`, fullPage: true });
    await page.getByTestId("start-batch").click();
    await page.getByTestId("batch-complete").waitFor({ timeout: 90000 });
    await page.locator("[data-testid=queue-row]").first().getByTestId("row-expand").click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `docs/screenshots/${tag}-6-batch-complete.png`, fullPage: true });
    await page.getByTestId("clear-queue").click();
    await page.getByTestId("clear-yes").click();
    await page.getByTestId("mode-merge").click();
    await page.getByTestId("file-input").setInputFiles([asFile("photo.jpg"), asFile("rotated.jpg"), asFile("image.png"), asFile("image.webp")]);
    await page.getByTestId("merge-workspace").waitFor();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `docs/screenshots/${tag}-7-merge.png`, fullPage: true });
    await page.getByTestId("merge-create").click();
    await page.getByTestId("merge-result").waitFor({ timeout: 60000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `docs/screenshots/${tag}-8-merge-result.png`, fullPage: true });
  });
}

const richHtml = (png: string) => `<html><head><title>Styled report</title></head><body>
<h1 style="text-align:center;color:#1e3a8a">Quarterly Report</h1>
<p>Revenue grew <u>12%</u>, with <span style="color:#c00000"><b>two regions</b></span> below plan. See <a href="https://example.com">the dashboard</a>.</p>
<img alt="Chart" src="data:image/png;base64,${png}">
<table><tr><th>Region</th><th align="right">Revenue</th></tr><tr><td>North</td><td>1,204</td></tr><tr><td>South</td><td>987</td></tr></table>
<div style="page-break-before:always"></div><h2>Appendix</h2><p style="text-align:right">Prepared locally in the browser.</p></body></html>`;

for (const theme of ["dark", "light"] as const) {
  test(`phase 3 screens ${theme}`, async ({ page }, info) => {
    const tag = `${info.project.name}-${theme}`;
    await page.addInitScript((t) => localStorage.setItem("fileforge:settings:v1", JSON.stringify({ theme: t })), theme);
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles({ name: "report.html", mimeType: "text/html", buffer: Buffer.from(richHtml(readFileSync(fixture("opaque.png")).toString("base64"))) });
    await waitForWorkspace(page);
    await page.getByTestId("advanced-options").locator("summary").click();
    await page.getByRole("radio", { name: "Serif" }).click();
    await page.getByLabel("Header text").fill("Quarterly Report");
    await page.getByLabel("Page numbers").selectOption("page-n-of-N");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `docs/screenshots/${tag}-9-advanced-options.png`, fullPage: true });
    await convertAndDownload(page);
    await page.getByTestId("pdf-viewer").locator("canvas").first().waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `docs/screenshots/${tag}-10-pdf-viewer.png`, fullPage: true });
    await page.getByRole("button", { name: "Change settings and convert again" }).click();
    await page.getByTestId("output-docx").click();
    await convertAndDownload(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(900);
    await page.screenshot({ path: `docs/screenshots/${tag}-11-docx-preview.png`, fullPage: true });
    await page.getByTestId("convert-another").click();
    await page.getByTestId("file-input").setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from("Region;Q1;Q2;Q3\nNorth;1204;1310;1422\nSouth;987;1012;1100\nEast;1530;1498;1604\n") });
    await waitForWorkspace(page);
    await page.getByTestId("advanced-options").locator("summary").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `docs/screenshots/${tag}-12-csv-options.png`, fullPage: true });
  });
}
