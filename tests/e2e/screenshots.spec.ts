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
