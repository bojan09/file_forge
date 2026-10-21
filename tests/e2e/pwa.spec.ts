import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { extractPdf } from "../unit/helpers";
import { convertAndDownload, trackNetwork, uploadFile, waitForWorkspace } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = (n: string) => ({ name: n, mimeType: "application/octet-stream", buffer: readFileSync(path.resolve(here, "../corpus", n)) });
const MARKER = "SECRET-MARKER-9f3a7c";

/** Opens Settings and waits until the offline copy is complete. */
async function waitOfflineReady(page: Page) {
  await page.goto("/settings/");
  await expect(page.getByTestId("offline-status")).toHaveAttribute("data-state", "ready", { timeout: 90000 });
}

const swVersion = (page: Page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg?.active) return null;
    return new Promise<string>((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => resolve(e.data.version);
      reg.active!.postMessage({ type: "STATUS" }, [ch.port2]);
    });
  });

test.describe("manifest and install metadata", () => {
  test("manifest is valid, its icons exist, and the page links to it", async ({ page, request }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBe("/manifest.webmanifest");
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m).toMatchObject({ name: "FileForge", short_name: "FileForge", display: "standalone", scope: "/", id: "/" });
    expect(m.start_url.startsWith("/")).toBe(true);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    const purposes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
    expect(purposes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
      const r = await request.get(icon.src);
      expect(r.ok(), icon.src).toBe(true);
      expect(r.headers()["content-type"]).toContain(icon.type === "image/svg+xml" ? "svg" : "png");
      if (icon.type === "image/png") {
        const b = await r.body();
        const w = b.readUInt32BE(16);
        const h = b.readUInt32BE(20);
        expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
      }
    }
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
    expect(await page.locator('meta[name="theme-color"]').count()).toBeGreaterThanOrEqual(1);
    for (const s of m.shortcuts as { url: string }[]) expect((await request.get(s.url)).ok()).toBe(true);
  });

  test("an install prompt, when the browser offers one, is shown as a button in Settings and calls prompt()", async ({ page }) => {
    await page.goto("/settings/");
    await expect(page.getByTestId("offline-status")).toBeVisible();
    // The browser fires this once, when it decides the app is installable; retry until the page has hydrated and is listening.
    await expect
      .poll(async () => {
        await page.evaluate(() => {
          const e = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
          (window as unknown as { __prompted: number }).__prompted = 0;
          e.prompt = async () => void ((window as unknown as { __prompted: number }).__prompted += 1);
          e.userChoice = Promise.resolve({ outcome: "accepted" });
          window.dispatchEvent(e);
        });
        return page.getByTestId("install-app").count();
      })
      .toBe(1);
    await page.getByTestId("install-app").click();
    expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
    await expect(page.getByTestId("install-app")).toHaveCount(0);
  });

  test("Settings explains offline use accurately and passes axe", async ({ page }) => {
    await waitOfflineReady(page);
    await expect(page.getByTestId("offline-status")).toContainText("works without a connection");
    await expect(page.locator("main")).toContainText("Your files, results and previews are never cached");
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(res.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });
});

test.describe("offline", () => {
  test("after the first visit every conversion works with the network off, including preview, serif fonts and every page", async ({ page, context }) => {
    await waitOfflineReady(page);
    await context.setOffline(true);
    for (const url of ["/", "/pdf-tools/", "/formats/", "/help/", "/privacy/", "/settings/"]) {
      await page.goto(url);
      await expect(page.locator("h1").first()).toBeVisible();
    }
    // Client-side navigation also works offline.
    await page.goto("/");
    // A real click on the router link (the footer, header and bottom bar all carry one; which is visible depends on the viewport).
    await page.evaluate(() => (document.querySelector('a[href="/formats/"]') as HTMLAnchorElement).click());
    await expect(page.getByRole("heading", { name: "Supported formats" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByTestId("offline-pill")).toBeVisible();

    await uploadFile(page, { name: "offline.md", mimeType: "text/markdown", buffer: Buffer.from(`# Offline test\n\nSerif body text with a code sample \`x = 1\`. ${MARKER}`) });
    await waitForWorkspace(page);
    await page.getByTestId("advanced-options").locator("summary").click();
    await page.getByRole("radio", { name: "Serif" }).click();
    const { bytes } = await convertAndDownload(page);
    expect(bytes.toString("latin1")).toMatch(/LiberationSerif/);
    expect((await extractPdf(new Uint8Array(bytes))).pages.join(" ")).toContain("Offline test");
    const viewer = page.getByTestId("pdf-viewer");
    await expect(viewer.locator("canvas").first()).toBeVisible({ timeout: 20000 });
    await expect.poll(() => viewer.locator('[data-page="1"] canvas').evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15000 }).toBeGreaterThan(100);
    await expect(viewer).not.toContainText("couldn't be drawn");

    for (const [name, out] of [["docx-simple.docx", "pdf"], ["xlsx-simple.xlsx", "pdf"], ["pdf-text-simple.pdf", "docx"]] as const) {
      await page.getByTestId("convert-another").click();
      await uploadFile(page, corpus(name));
      await waitForWorkspace(page);
      await page.getByTestId(`output-${out}`).click();
      const r = await convertAndDownload(page);
      expect(r.bytes.length).toBeGreaterThan(1000);
    }
    // PDF tools use their own worker bundle; it must be in the offline copy too.
    await page.goto("/pdf-tools/");
    await page.getByTestId("file-input").setInputFiles([corpus("pdf-text-simple.pdf"), corpus("pdf-two-column.pdf")]);
    await expect(page.locator('[data-testid="pdf-file-row"]:has-text("pages")')).toHaveCount(2, { timeout: 30000 });
    await page.getByTestId("run-tool").click();
    await expect(page.getByTestId("tool-result")).toContainText("Your PDF is ready", { timeout: 30000 });
    await context.setOffline(false);
  });

  test("the offline copy contains only the app: no user content, no blob or data URLs, no unlisted URLs", async ({ page }) => {
    await waitOfflineReady(page);
    await page.goto("/");
    await uploadFile(page, { name: `${MARKER}.txt`, mimeType: "text/plain", buffer: Buffer.from(`body ${MARKER}`) });
    await waitForWorkspace(page);
    await convertAndDownload(page);
    await page.evaluate(() => fetch("/definitely-not-precached.json").catch(() => null));
    const report = await page.evaluate(async (marker) => {
      const keys = await caches.keys();
      const urls: string[] = [];
      let leaked = 0;
      for (const k of keys) {
        const c = await caches.open(k);
        for (const req of await c.keys()) {
          urls.push(new URL(req.url).pathname + new URL(req.url).search);
          const res = await c.match(req);
          const type = res?.headers.get("content-type") ?? "";
          if (res && /text|json|javascript|html|xml/.test(type)) if ((await res.text()).includes(marker)) leaked++;
        }
      }
      const swText = await (await fetch("/sw.js")).text();
      const precache = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);\nconst PRECACHE_SET/.exec(swText)![1]!) as string[];
      return { keys, urls, leaked, precache };
    }, MARKER);
    expect(report.keys).toHaveLength(1);
    expect(report.keys[0]).toMatch(/^fileforge-app-[0-9a-f]{12}$/);
    expect(report.leaked).toBe(0);
    expect(report.urls.some((u) => /blob:|data:|definitely-not-precached|SECRET/.test(u))).toBe(false);
    expect([...report.urls].sort()).toEqual([...report.precache].sort());
    expect(report.urls.length).toBeGreaterThan(60);
  });

  test("a request outside the precache list goes to the network and is never stored", async ({ page }) => {
    await waitOfflineReady(page);
    const status = await page.evaluate(async () => (await fetch("/not-in-the-list.txt")).status);
    expect(status).toBe(404);
    expect(await page.evaluate(async () => (await caches.match("/not-in-the-list.txt")) === undefined)).toBe(true);
  });

  test("service worker traffic stays on our origin and sends nothing", async ({ page }) => {
    const net = trackNetwork(page);
    await waitOfflineReady(page);
    expect(net.external).toEqual([]);
    expect(net.writes).toEqual([]);
  });

  test("Data Saver skips the offline copy entirely and says why", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true, effectiveType: "4g" } }));
    const page = await context.newPage();
    await page.goto("/settings/");
    await expect(page.getByTestId("offline-status")).toHaveAttribute("data-state", "data-saver");
    await expect(page.getByTestId("offline-status")).toContainText("Data Saver");
    await page.waitForTimeout(2500);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    await context.close();
  });

  test("Remove offline copy unregisters the worker and deletes the cache", async ({ page }) => {
    await waitOfflineReady(page);
    await page.getByTestId("clear-offline").click();
    await expect(page.getByText("Offline copy removed")).toBeVisible();
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(0);
  });
});

test.describe("updates", () => {
  // Simulates a new deploy by rewriting the served sw.js with a different version, and restores it afterwards.
  const swPath = path.resolve(here, "../../out/sw.js");
  const original = readFileSync(swPath, "utf8");
  test.afterEach(() => writeFileSync(swPath, original));
  const deployNewVersion = (version: string) => writeFileSync(swPath, original.replace(/const VERSION = "[0-9a-f]+";/, `const VERSION = "${version}";`));

  test("a new version waits for the user; it is never applied during a conversion; old caches are removed", async ({ page }) => {
    await waitOfflineReady(page);
    const before = await swVersion(page);
    expect(before).toMatch(/^[0-9a-f]{12}$/);
    deployNewVersion("aaaaaaaaaaaa");
    await page.goto("/");
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/"))!.update());
    await expect(page.getByTestId("update-banner")).toBeVisible({ timeout: 60000 });
    // The old version keeps controlling the page until the user accepts.
    expect(await swVersion(page)).toBe(before);
    expect(await page.evaluate(async () => (await caches.keys()).sort())).toHaveLength(2);

    // While a conversion runs the update button is disabled.
    const big = Buffer.from("A fairly long line of text that repeats to make conversion take a moment.\n\n".repeat(30000));
    await uploadFile(page, { name: "big.txt", mimeType: "text/plain", buffer: big });
    await waitForWorkspace(page);
    await page.getByTestId("convert-button").click();
    await expect(page.getByTestId("update-now")).toBeDisabled();
    await expect(page.getByTestId("update-now")).toContainText("after conversion");
    await expect(page.getByRole("heading", { name: "Conversion Complete!" })).toBeVisible({ timeout: 90000 });

    // Idle again: the user can update; the page reloads onto the new version and the old cache is deleted.
    await expect(page.getByTestId("update-now")).toBeEnabled();
    await Promise.all([page.waitForEvent("load"), page.getByTestId("update-now").click()]);
    await expect.poll(() => swVersion(page), { timeout: 30000 }).toBe("aaaaaaaaaaaa");
    await expect.poll(async () => page.evaluate(async () => (await caches.keys()).sort()), { timeout: 30000 }).toEqual(["fileforge-app-aaaaaaaaaaaa"]);
    await expect(page.getByTestId("update-banner")).toHaveCount(0);
  });
});

test("the first visit never reloads the page under the user when the worker takes control", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __navs: number }).__navs = 0;
    window.addEventListener("beforeunload", () => sessionStorage.setItem("reloaded", String(Number(sessionStorage.getItem("reloaded") ?? 0) + 1)));
  });
  await page.goto("/");
  await uploadFile(page, { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await waitForWorkspace(page);
  const marker = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="file-name"]') as HTMLElement;
    el.dataset.keep = "yes";
    return !!el;
  });
  expect(marker).toBe(true);
  // Wait until the offline copy is complete (the worker has been installed, activated and has claimed this page).
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return !!reg?.active && !!navigator.serviceWorker.controller;
  }, undefined, { timeout: 90000 });
  await page.waitForTimeout(1500);
  expect(await page.locator('[data-keep="yes"]').count(), "the workspace must still be the same one (no reload)").toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem("reloaded"))).toBeNull();
});
