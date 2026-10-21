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
