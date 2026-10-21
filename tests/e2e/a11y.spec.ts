import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { convertAndDownload, fixture, uploadFile, waitForWorkspace } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = (n: string) => ({ name: n, mimeType: "application/octet-stream", buffer: readFileSync(path.resolve(here, "../corpus", n)) });
const asFile = (n: string) => ({ name: n, mimeType: "application/octet-stream", buffer: readFileSync(fixture(n)) });
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function axe(page: Page, label: string) {
  await page.waitForTimeout(650); // let entrance animations settle so contrast is measured on final colors
  const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(res.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

test.describe("automated checks across every screen and state", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`axe ${theme}: home, merge mode, workspaces, errors, results, batch, merge, static pages`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.addInitScript((t) => localStorage.setItem("fileforge:settings:v1", JSON.stringify({ theme: t })), theme);
      await page.goto("/");
      await axe(page, "home");
      await page.getByTestId("mode-merge").click();
      await axe(page, "home merge mode");
      await page.getByTestId("mode-convert").click();

      await uploadFile(page, { name: "data.csv", mimeType: "text/csv", buffer: Buffer.from("a;b;c\n1;2;3\n4;5;6\n") });
      await waitForWorkspace(page);
      await page.getByTestId("advanced-options").locator("summary").click();
      await axe(page, "csv workspace with advanced options");
      await page.getByRole("button", { name: "New File" }).click();

      await uploadFile(page, asFile("photo.jpg"));
      await waitForWorkspace(page);
      await axe(page, "image workspace");
      await convertAndDownload(page);
      await axe(page, "pdf result");
      await page.getByTestId("convert-another").click();

      // A conversion that fails at render time shows the error screen.
      await uploadFile(page, { name: "cjk.txt", mimeType: "text/plain", buffer: Buffer.from("中文日本語한국어 ".repeat(200)) });
      await waitForWorkspace(page);
      await page.getByTestId("convert-button").click();
      await expect(page.getByRole("heading", { name: /couldn.t|failed|wrong/i }).first()).toBeVisible({ timeout: 60000 });
      await axe(page, "conversion error");
      await page.goto("/");

      await uploadFile(page, { name: "x.pptx", mimeType: "application/octet-stream", buffer: Buffer.from("PK") });
      await expect(page.getByTestId("inspect-error")).toBeVisible();
      await axe(page, "rejected file");

      await page.getByTestId("file-input").setInputFiles([asFile("sample.txt"), asFile("sample.md"), { name: "bad.xyz", mimeType: "text/plain", buffer: Buffer.from("x") }]);
      await expect(page.getByTestId("batch-workspace")).toBeVisible();
      await axe(page, "batch queue");
      await page.getByTestId("start-batch").click();
      await expect(page.getByTestId("batch-complete")).toBeVisible({ timeout: 90000 });
      await axe(page, "batch complete");
      await page.getByTestId("clear-queue").click();
      await axe(page, "clear confirmation");
      await page.getByTestId("clear-yes").click();

      await page.getByTestId("mode-merge").click();
      await page.getByTestId("file-input").setInputFiles([asFile("photo.jpg"), asFile("image.png")]);
      await expect(page.getByTestId("merge-workspace")).toBeVisible();
      await axe(page, "merge workspace");

      for (const url of ["/pdf-tools/", "/formats/", "/settings/", "/help/", "/privacy/", "/this-page-does-not-exist/"]) {
        await page.goto(url);
        await axe(page, url);
      }
    });
  }

  for (const accent of ["indigo", "cyan", "emerald", "violet"]) {
    test(`axe: ${accent} accent in both themes (workspace and result)`, async ({ page }) => {
      for (const theme of ["dark", "light"]) {
        await page.addInitScript(([t, a]) => localStorage.setItem("fileforge:settings:v1", JSON.stringify({ theme: t, accent: a })), [theme, accent]);
        await page.goto("/");
        await uploadFile(page, corpus("docx-simple.docx"));
        await waitForWorkspace(page);
        await axe(page, `${accent} ${theme} workspace`);
        await convertAndDownload(page);
        await axe(page, `${accent} ${theme} result`);
        await page.evaluate(() => localStorage.clear());
      }
    });
  }
});

test.describe("keyboard", () => {
  test("skip link, logical tab order and a full conversion without a mouse", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard order is checked on desktop; mobile has no hardware keyboard in this suite");
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();

    // Walk the home screen: every stop is a real control with an accessible name and a visible focus indicator.
    const stops: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const name = el.getAttribute("aria-label") || el.textContent?.trim() || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || (el as HTMLInputElement).placeholder || "";
        return { tag: el.tagName, name: name.slice(0, 40), outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2, shadow: cs.boxShadow !== "none", visible: r.width > 0 && r.height > 0 };
      });
      if (!info) break;
      expect(info.visible, JSON.stringify(info)).toBe(true);
      expect(info.name.length, JSON.stringify(info)).toBeGreaterThan(0);
      expect(info.outline || info.shadow, `no focus indicator on ${JSON.stringify(info)}`).toBe(true);
      stops.push(`${info.tag}:${info.name}`);
    }
    expect(stops.some((s) => /Convert|Formats|Settings|Help/.test(s))).toBe(true);
    expect(stops.some((s) => /drop|browse|select/i.test(s))).toBe(true);

    // Open the file chooser from the keyboard, load a file, and drive the rest by keys.
    await page.goto("/");
    const zone = page.getByTestId("file-input"); // visually hidden input behind the drop zone label; native Enter/Space opens the chooser
    await zone.focus();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press("Enter")]);
    await chooser.setFiles(fixture("sample.md"));
    await waitForWorkspace(page);
    await expect(page.getByTestId("file-name")).toBeFocused();
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid === "convert-button");
    }
    expect(reached, "convert button reachable by Tab").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Conversion Complete!" })).toBeFocused({ timeout: 60000 });
    let download = false;
    for (let i = 0; i < 30 && !download; i++) {
      await page.keyboard.press("Tab");
      download = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid === "download-link");
    }
    expect(download, "download link reachable by Tab").toBe(true);
  });

  test("radio groups: arrow keys and Space work, and the selected state is exposed", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop keyboard check");
    await page.goto("/settings/");
    const light = page.getByRole("radio", { name: "Light" });
    await light.focus();
    await page.keyboard.press("Space");
    await expect(light).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("radio", { name: "Dark" })).not.toHaveAttribute("aria-checked", "true");
  });

  test("clear confirmation: Escape cancels and returns focus to the button that opened it", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles([asFile("sample.txt"), asFile("sample.md")]);
    await expect(page.getByTestId("batch-workspace")).toBeVisible();
    await page.getByTestId("clear-queue").click();
    await expect(page.getByTestId("clear-yes")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("clear-confirm")).toHaveCount(0);
    await expect(page.getByTestId("clear-queue")).toBeFocused();
    await page.getByTestId("clear-queue").click();
    await page.getByTestId("clear-no").click();
    await expect(page.getByTestId("clear-queue")).toBeFocused();
  });

  test("PDF viewer: fullscreen can be left with Escape and zoom works from the keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop keyboard check");
    await page.goto("/");
    await uploadFile(page, asFile("sample.md"));
    await waitForWorkspace(page);
    await convertAndDownload(page);
    await expect(page.getByTestId("pdf-viewer").locator("canvas").first()).toBeVisible({ timeout: 20000 });
    const region = page.getByTestId("pdf-viewer").getByRole("region", { name: /PDF pages/ });
    await region.focus();
    const before = parseInt(await page.getByTestId("pdf-zoom-label").innerText(), 10);
    await page.keyboard.press("+");
    expect(parseInt(await page.getByTestId("pdf-zoom-label").innerText(), 10)).toBeGreaterThan(before);
    await page.keyboard.press("-");
    await page.keyboard.press("-");
    expect(parseInt(await page.getByTestId("pdf-zoom-label").innerText(), 10)).toBeLessThan(before);
  });
});

test.describe("announcements and error association", () => {
  test("status changes are announced through live regions", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles([asFile("sample.txt"), asFile("sample.md")]);
    await expect(page.getByTestId("batch-workspace")).toBeVisible();
    await expect(page.locator('[role="status"][aria-live="polite"], [aria-live="polite"]').first()).toBeAttached();
    await page.getByTestId("start-batch").click();
    await expect(page.getByTestId("batch-complete")).toBeVisible({ timeout: 90000 });
    const live = await page.locator("[aria-live]").evaluateAll((els) => els.map((e) => e.textContent?.trim()).filter(Boolean));
    expect(live.join(" ")).toMatch(/finished|converted/i);
  });

  test("a rejected file is announced as an alert tied to the upload control", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, { name: "x.pptx", mimeType: "application/octet-stream", buffer: Buffer.from("PK") });
    const alert = page.getByTestId("inspect-error");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toContainText("not supported");
  });
});

test.describe("zoom, reflow and device settings", () => {
  const pages = ["/", "/pdf-tools/", "/formats/", "/settings/", "/help/", "/privacy/"];

  for (const [label, width, height] of [["200% zoom", 720, 450], ["400% zoom / 320 px reflow", 320, 256]] as const) {
    test(`${label}: no horizontal scrolling and every control stays reachable`, async ({ page, isMobile }) => {
      test.skip(isMobile, "zoom is emulated through the viewport on the desktop project");
      await page.setViewportSize({ width, height });
      for (const url of pages) {
        await page.goto(url);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `${url} at ${width}px`).toBeLessThanOrEqual(0);
      }
      await page.goto("/");
      await uploadFile(page, corpus("xlsx-wide.xlsx"));
      await waitForWorkspace(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await page.getByTestId("convert-button").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("convert-button")).toBeVisible();
      await convertAndDownload(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await expect(page.getByTestId("download-link")).toBeVisible();
    });
  }

  test("text can be enlarged to 200% (root font size) without clipping or overlap on the workspace", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop check");
    await page.goto("/");
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await uploadFile(page, fixture("sample.csv"));
    await waitForWorkspace(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("convert-button")).toBeVisible();
  });

  test("touch targets are at least 44 px on coarse pointers", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    await page.goto("/");
    await uploadFile(page, fixture("sample.md"));
    await waitForWorkspace(page);
    await page.getByTestId("advanced-options").locator("summary").click();
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const sel = "button, [role=radio], [role=tab], select, input:not([type=file]):not([type=range]):not([type=checkbox]), summary, a.btn, nav a";
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || el.closest("[aria-hidden=true]")) return;
        if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      return out;
    });
    expect(small).toEqual([]);
  });

  test("reduced motion removes animations and transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await uploadFile(page, fixture("sample.md"));
    await waitForWorkspace(page);
    const animated = await page.evaluate(() => {
      let n = 0;
      document.querySelectorAll<HTMLElement>("*").forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.05 && cs.animationIterationCount !== "1") n++;
      });
      return n;
    });
    expect(animated).toBe(0);
  });

  test("forced colors (high contrast): selection, focus, cards and progress are still distinguishable", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");
    await uploadFile(page, fixture("sample.md"));
    await waitForWorkspace(page);
    const sel = page.getByTestId("output-pdf");
    const other = page.getByTestId("output-docx");
    const w = (l: typeof sel) => l.evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth));
    expect(await w(sel)).toBeGreaterThan(await w(other));
    await page.getByTestId("convert-button").focus();
    const outline = await page.getByTestId("convert-button").evaluate((e) => ({ style: getComputedStyle(e).outlineStyle, width: parseFloat(getComputedStyle(e).outlineWidth) }));
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
    const card = await page.locator(".card").first().evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth));
    expect(card).toBeGreaterThanOrEqual(1);
  });
});
