import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { extractPdf } from "../unit/helpers";
import { convertAndDownload, fixture, trackNetwork, uploadFile, waitForWorkspace } from "./helpers";

async function pdfPageBox(bytes: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  return { view: page.view, numPages: doc.numPages };
}

test.describe("images through the browser pipeline", () => {
  for (const [file, quality] of [
    ["image.png", "high"],
    ["image.png", "balanced"],
    ["image.png", "small"],
    ["image.webp", "high"],
    ["image.webp", "balanced"],
    ["photo.jpg", "high"],
    ["photo.jpg", "small"],
    ["rotated.jpg", "high"],
    ["rotated.jpg", "small"],
  ] as const) {
    test(`${file} @ ${quality}`, async ({ page }) => {
      await page.goto("/");
      await uploadFile(page, fixture(file));
      await waitForWorkspace(page);
      await page.getByLabel("Quality").selectOption(quality);
      const { bytes } = await convertAndDownload(page);
      const { view, numPages } = await pdfPageBox(bytes);
      expect(numPages).toBe(1);
      const w = view[2]! - view[0]!;
      const h = view[3]! - view[1]!;
      if (file === "rotated.jpg") expect(h).toBeGreaterThan(w);
      if (file === "photo.jpg" || file === "image.png") expect(w).toBeGreaterThan(h);
      await expect(page.getByTestId("quality-checks")).toContainText("Image embedded");
    });
  }

  test("DOCX is not offered for images", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("image.png"));
    await waitForWorkspace(page);
    await expect(page.getByTestId("output-docx")).toBeDisabled();
  });
});

test.describe("long and large inputs", () => {
  test("2 MB TXT converts to PDF in the worker and can be cancelled", async ({ page }) => {
    await page.goto("/");
    const line = "The quick brown fox jumps over the lazy dog 0123456789.\n\n";
    await uploadFile(page, { name: "long.txt", mimeType: "text/plain", buffer: Buffer.from(line.repeat(Math.ceil((2 * 1024 * 1024) / line.length))) });
    await waitForWorkspace(page);
    await page.getByTestId("convert-button").click();
    await expect(page.getByRole("heading", { name: /Converting to PDF/ })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("convert-button")).toBeVisible();
    // UI stays usable after cancel: converting again completes.
    const t0 = Date.now();
    const { bytes } = await convertAndDownload(page);
    console.log(`2MB TXT -> PDF in browser: ${Date.now() - t0} ms, ${bytes.length} bytes`);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("5 MB TXT limit boundary converts to DOCX", async ({ page }) => {
    await page.goto("/");
    const line = "Boundary test line with some text to fill the file.\n\n";
    const buffer = Buffer.from(line.repeat(Math.floor((5 * 1024 * 1024) / line.length)));
    expect(buffer.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    await uploadFile(page, { name: "five.txt", mimeType: "text/plain", buffer });
    await waitForWorkspace(page);
    await page.getByTestId("output-docx").click();
    const t0 = Date.now();
    await page.getByTestId("convert-button").click();
    await expect(page.getByRole("heading", { name: "Conversion Complete!" })).toBeVisible({ timeout: 180000 });
    console.log(`5MB TXT -> DOCX in browser: ${Date.now() - t0} ms`);
  });

  test("CJK text refuses PDF with a helpful message but converts to DOCX", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, { name: "cjk.txt", mimeType: "text/plain", buffer: Buffer.from("这是一个完全由中文组成的文档。".repeat(20)) });
    await waitForWorkspace(page);
    await page.getByTestId("convert-button").click();
    await expect(page.getByTestId("error-message")).toContainText("DOCX");
    await page.getByRole("button", { name: "Change settings" }).click();
    await page.getByTestId("output-docx").click();
    await convertAndDownload(page);
  });
});

test.describe("preferences, themes, motion", () => {
  test("settings persist across reloads and apply to new conversions", async ({ page }) => {
    await page.goto("/settings/");
    await page.getByRole("radio", { name: "Light" }).click();
    await page.getByRole("radio", { name: "Emerald" }).click();
    await page.getByRole("radio", { name: "DOCX" }).click();
    await page.getByLabel("Page size").selectOption("LETTER");
    await page.getByLabel(/Filename suffix/).fill("_done");
    await page.reload();
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(html).toHaveAttribute("data-accent", "emerald");
    await page.goto("/");
    await uploadFile(page, fixture("sample.txt"));
    await waitForWorkspace(page);
    await expect(page.getByTestId("output-docx")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Page Size")).toHaveValue("LETTER");
    const { download } = await convertAndDownload(page);
    expect(download.suggestedFilename()).toBe("sample_done.docx");
    const stored = await page.evaluate(() => localStorage.getItem("fileforge:settings:v1"));
    expect(stored).not.toContain("sample");
    await page.goto("/settings/");
    await page.getByTestId("clear-settings").click();
    expect(await page.evaluate(() => localStorage.getItem("fileforge:settings:v1"))).toBeNull();
    await expect(html).toHaveAttribute("data-theme", /dark|light/);
  });

  test("system theme follows prefers-color-scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("reduced motion setting and OS preference stop animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await uploadFile(page, fixture("sample.txt"));
    await waitForWorkspace(page);
    const dur = await page.getByTestId("convert-button").evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(dur)).toBeLessThan(0.01);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/settings/");
    await page.getByRole("radio", { name: "Reduced" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await page.goto("/");
    const anim = await page.locator("main > div").first().evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(anim)).toBeLessThan(0.01);
  });
});

test.describe("navigation, keyboard, drag and drop", () => {
  test("pages render and nav marks the current page", async ({ page }, info) => {
    await page.goto("/");
    const nav = info.project.name === "mobile" ? page.getByRole("navigation", { name: "Primary mobile" }) : page.getByRole("navigation", { name: "Primary" });
    const mobile = info.project.name === "mobile";
    for (const [name, mobileName, heading] of [["Formats", "Formats", "Supported formats"], ["Settings", "Settings", "Settings"], ["Help", "Help", "Help"], ["Convert", "Home", /Convert your files/]] as const) {
      const link = nav.getByRole("link", { name: mobile ? mobileName : name });
      await link.click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(link).toHaveAttribute("aria-current", "page");
    }
    await page.goto("/privacy/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Privacy");
  });

  test("keyboard: upload zone is reachable and opens the file chooser", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "keyboard path is a desktop concern");
    await page.goto("/");
    await page.keyboard.press("Tab"); // skip link
    await page.keyboard.press("Tab");
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) {
      reached = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "file-input");
      if (!reached) await page.keyboard.press("Tab");
    }
    expect(reached).toBe(true);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press("Enter")]);
    await chooser.setFiles(fixture("sample.txt"));
    await waitForWorkspace(page);
    // workspace controls are reachable by keyboard and radio buttons toggle with Space
    await page.getByTestId("output-docx").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("output-docx")).toHaveAttribute("aria-checked", "true");
  });

  test("drag and drop shows the active state and accepts the file", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "drag and drop is a desktop enhancement");
    await page.goto("/");
    const zone = page.locator(".dropzone");
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(new File(["hello drop"], "dropped.txt", { type: "text/plain" }));
      return d;
    });
    await zone.dispatchEvent("dragenter", { dataTransfer: dt });
    await expect(zone).toHaveAttribute("data-dragging", "true");
    await zone.dispatchEvent("dragleave", { dataTransfer: dt });
    await expect(zone).toHaveAttribute("data-dragging", "false");
    await zone.dispatchEvent("drop", { dataTransfer: dt });
    await waitForWorkspace(page);
    await expect(page.getByTestId("file-name")).toHaveText("dropped.txt");
  });

  test("format list rows open a filtered picker", async ({ page }) => {
    await page.goto("/");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "CSV to PDF / Word" }).click()]);
    await chooser.setFiles(fixture("sample.csv"));
    await waitForWorkspace(page);
    await expect(page.getByTestId("file-name")).toHaveText("sample.csv");
  });

  test("change file and new file flows", async ({ page }) => {
    await page.goto("/");
    await uploadFile(page, fixture("sample.txt"));
    await waitForWorkspace(page);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Change File" }).click()]);
    await chooser.setFiles(fixture("sample.csv"));
    await expect(page.getByTestId("file-name")).toHaveText("sample.csv");
    await page.getByRole("button", { name: "New File" }).click();
    await expect(page.locator(".dropzone")).toBeVisible();
  });

  test("state survives navigating between pages", async ({ page }, info) => {
    const mobile = info.project.name === "mobile";
    await page.goto("/");
    await uploadFile(page, fixture("sample.txt"));
    await waitForWorkspace(page);
    const nav = page.getByRole("navigation", { name: mobile ? "Primary mobile" : "Primary" });
    await nav.getByRole("link", { name: "Help" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    await nav.getByRole("link", { name: mobile ? "Home" : "Convert" }).click();
    await expect(page.getByTestId("file-name")).toHaveText("sample.txt");
  });
});

test.describe("responsive layout and accessibility", () => {
  test("no horizontal overflow on any screen", async ({ page }) => {
    for (const url of ["/", "/formats/", "/settings/", "/help/", "/privacy/"]) {
      await page.goto(url);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, url).toBeLessThanOrEqual(0);
    }
    await page.goto("/");
    await uploadFile(page, fixture("wide.csv"));
    await waitForWorkspace(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`axe: home, workspace, result, settings (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("fileforge:settings:v1", JSON.stringify({ theme: t })), theme);
      const check = async (label: string) => {
        await page.waitForTimeout(600); // let entrance animations finish so contrast is measured on settled colors
        const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(res.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
      };
      await page.goto("/");
      await check("home");
      await uploadFile(page, fixture("sample.md"));
      await waitForWorkspace(page);
      await check("workspace");
      await page.getByRole("tab", { name: "Raw Content" }).click();
      await check("raw");
      await convertAndDownload(page);
      await check("result");
      for (const url of ["/settings/", "/formats/", "/help/", "/privacy/"]) {
        await page.goto(url);
        await check(url);
      }
    });
  }

  test("no network traffic carries file content across a full flow (HTML + image)", async ({ page }) => {
    const net = trackNetwork(page);
    const bodies: string[] = [];
    page.on("request", (r) => r.postData() && bodies.push(r.postData()!));
    await page.goto("/");
    await uploadFile(page, fixture("unsafe.html"));
    await waitForWorkspace(page);
    await convertAndDownload(page);
    await page.getByTestId("convert-another").click();
    await uploadFile(page, fixture("photo.jpg"));
    await waitForWorkspace(page);
    await convertAndDownload(page);
    expect(net.external).toEqual([]);
    expect(net.writes).toEqual([]);
    expect(bodies).toEqual([]);
    expect(net.all.some((u) => /evil\.example/.test(u))).toBe(false);
  });
});

test("text output is searchable after settings round trip (sanity on extractPdf helper)", async ({ page }) => {
  await page.goto("/");
  await uploadFile(page, fixture("sample.html"));
  await waitForWorkspace(page);
  const { bytes } = await convertAndDownload(page);
  const t = (await extractPdf(new Uint8Array(bytes))).pages.join(" ");
  expect(t).toContain("HTML Heading");
  expect(t).toContain("Designer");
  expect(t).not.toContain("pwned");
});
