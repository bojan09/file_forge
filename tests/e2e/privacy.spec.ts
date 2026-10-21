import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { convertAndDownload, fixture, trackNetwork, uploadFile, waitForWorkspace } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = (n: string) => ({ name: n, mimeType: "application/octet-stream", buffer: readFileSync(path.resolve(here, "../corpus", n)) });
const asFile = (n: string) => ({ name: n, mimeType: "application/octet-stream", buffer: readFileSync(fixture(n)) });

/** Wraps URL.createObjectURL / revokeObjectURL so a test can see which blob URLs are still alive. */
async function trackObjectUrls(page: Page) {
  await page.addInitScript(() => {
    const live = new Set<string>();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource) => {
      const u = create(o);
      live.add(u);
      return u;
    };
    URL.revokeObjectURL = (u: string) => {
      live.delete(u);
      revoke(u);
    };
    (window as unknown as { __live: Set<string> }).__live = live;
  });
}
const liveUrls = (page: Page) => page.evaluate(() => (window as unknown as { __live: Set<string> }).__live.size);

test.describe("object URL lifecycle", () => {
  test("at most the current result's URL stays alive; resetting releases everything", async ({ page }) => {
    await trackObjectUrls(page);
    await page.goto("/");
    for (const f of [asFile("sample.md"), asFile("photo.jpg"), corpus("docx-simple.docx"), corpus("pdf-text-simple.pdf")]) {
      await uploadFile(page, f);
      await waitForWorkspace(page);
      if (f.name.endsWith(".pdf")) await page.getByTestId("output-docx").click();
      await convertAndDownload(page);
      // The result screen holds the download URL (and the image preview holds none once it has unmounted).
      expect(await liveUrls(page)).toBeLessThanOrEqual(2);
      await page.getByTestId("convert-another").click();
      await expect.poll(() => liveUrls(page)).toBe(0);
    }
  });

  test("preview images release their URL when the preview goes away", async ({ page }) => {
    await trackObjectUrls(page);
    await page.goto("/");
    await uploadFile(page, asFile("photo.jpg"));
    await waitForWorkspace(page);
    expect(await liveUrls(page)).toBeGreaterThanOrEqual(1);
    await page.getByRole("button", { name: "New File" }).click();
    await expect.poll(() => liveUrls(page)).toBe(0);
  });

  test("batch results and the ZIP are released when the queue is cleared", async ({ page }) => {
    await trackObjectUrls(page);
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles([asFile("sample.txt"), asFile("sample.md"), asFile("sample.csv")]);
    await expect(page.getByTestId("batch-workspace")).toBeVisible();
    await page.getByTestId("start-batch").click();
    await expect(page.getByTestId("batch-complete")).toBeVisible({ timeout: 90000 });
    await page.getByTestId("download-zip").click();
    await expect(page.getByTestId("zip-status")).toContainText(/ready|saved|download/i, { timeout: 30000 }).catch(() => {});
    await page.getByTestId("clear-queue").click();
    await page.getByTestId("clear-yes").click();
    await expect.poll(() => liveUrls(page), { timeout: 45000 }).toBe(0); // the ZIP link is revoked 30 s after the download starts
  });

  test("merge preview thumbnails and the merged PDF are released on clear", async ({ page }) => {
    await trackObjectUrls(page);
    await page.goto("/");
    await page.getByTestId("mode-merge").click();
    await page.getByTestId("file-input").setInputFiles([asFile("photo.jpg"), asFile("image.png")]);
    await expect(page.getByTestId("merge-workspace")).toBeVisible();
    await page.getByTestId("merge-create").click();
    await expect(page.getByTestId("merge-result")).toBeVisible({ timeout: 60000 });
    await page.getByTestId("merge-clear").click();
    await page.getByTestId("merge-clear-yes").click();
    await expect.poll(() => liveUrls(page), { timeout: 15000 }).toBe(0);
  });
});

test.describe("remote resources and logging", () => {
  const hostile = `<html><head><title>t</title>
    <link rel="stylesheet" href="https://evil.example/a.css"><style>@import url("https://evil.example/b.css"); body{background:url(https://evil.example/bg.png)}</style>
    <meta http-equiv="refresh" content="0;url=https://evil.example/redirect"><script src="https://evil.example/s.js"></script></head>
    <body onload="fetch('https://evil.example/onload')"><h1>Visible text</h1>
    <img src="https://evil.example/pixel.png" srcset="https://evil.example/2x.png 2x"><picture><source srcset="https://evil.example/p.webp"><img src="https://evil.example/q.png"></picture>
    <video poster="https://evil.example/poster.png" src="https://evil.example/v.mp4"></video><audio src="https://evil.example/a.mp3"></audio>
    <iframe src="https://evil.example/frame"></iframe><object data="https://evil.example/o.swf"></object><embed src="https://evil.example/e.swf">
    <svg><image href="https://evil.example/svg.png"/><use href="https://evil.example/sprite.svg#a"/></svg>
    <a href="javascript:fetch('https://evil.example/click')">click</a><form action="https://evil.example/post"><input name="x"><button>go</button></form>
    <p style="background-image:url(https://evil.example/inline.png);color:red">styled text</p>
    </body></html>`;

  test("a hostile HTML file triggers no request to any other origin, and nothing is executed", async ({ page }) => {
    const net = trackNetwork(page);
    const consoleErrors: string[] = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("dialog", (d) => void d.dismiss());
    await page.goto("/");
    await uploadFile(page, { name: "hostile.html", mimeType: "text/html", buffer: Buffer.from(hostile) });
    await waitForWorkspace(page);
    await expect(page.getByTestId("doc-preview")).toContainText("Visible text");
    const { bytes } = await convertAndDownload(page);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await page.waitForTimeout(500);
    expect(net.all.filter((u) => /evil\.example/.test(u))).toEqual([]);
    expect(net.external).toEqual([]);
    expect(net.writes).toEqual([]);
    expect(consoleErrors.filter((e) => /evil\.example|Refused to/.test(e))).toEqual([]);
  });

  test("Markdown and CSV with remote references are equally inert", async ({ page }) => {
    const net = trackNetwork(page);
    await page.goto("/");
    await uploadFile(page, { name: "r.md", mimeType: "text/markdown", buffer: Buffer.from("# T\n\n![x](https://evil.example/md.png)\n\n[link](https://evil.example/l)\n\n<img src=\"https://evil.example/raw.png\">\n") });
    await waitForWorkspace(page);
    await convertAndDownload(page);
    await page.getByTestId("convert-another").click();
    await uploadFile(page, { name: "r.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n=HYPERLINK(\"https://evil.example/f\"),https://evil.example/c\n") });
    await waitForWorkspace(page);
    await convertAndDownload(page);
    expect(net.all.filter((u) => /evil\.example/.test(u))).toEqual([]);
    expect(net.external).toEqual([]);
  });

  test("the app never writes file names or contents to the console or storage", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (m) => logs.push(m.text()));
    page.on("pageerror", (e) => logs.push(String(e)));
    await page.goto("/");
    await uploadFile(page, { name: "confidential-merger-plan.txt", mimeType: "text/plain", buffer: Buffer.from("TOPSECRET-BODY-TEXT paragraph") });
    await waitForWorkspace(page);
    await convertAndDownload(page);
    const storage = await page.evaluate(async () => {
      const out: string[] = [];
      for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) out.push(s.key(i)! + "=" + s.getItem(s.key(i)!));
      const dbs = (await (indexedDB as unknown as { databases?: () => Promise<{ name?: string }[]> }).databases?.()) ?? [];
      return { out, dbs: dbs.map((d) => d.name) };
    });
    expect(logs.join("\n")).not.toMatch(/TOPSECRET|confidential-merger/);
    expect(storage.out.join("\n")).not.toMatch(/TOPSECRET|confidential-merger/);
    expect(storage.dbs).toEqual([]);
    const cookies = await page.context().cookies();
    expect(cookies).toEqual([]);
  });

  test("security headers and CSP are present in the served policy (meta fallback) and forbid remote connections", async ({ page }) => {
    await page.goto("/");
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:\/\//);
    // The page cannot open a connection to another origin even if a script tried.
    const blocked = await page.evaluate(() => fetch("https://example.org/", { mode: "no-cors" }).then(() => "allowed", () => "blocked"));
    expect(blocked).toBe("blocked");
  });
});
