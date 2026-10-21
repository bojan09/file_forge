import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Measurement harness behind docs/PHASE_2_REPORT.md. Run: PERF=1 npx playwright test perf --project=desktop
test.skip(!process.env.PERF, "performance measurements run on demand");

const rssMb = () => {
  try {
    const out = execSync("ps -eo rss,args | grep -E 'chrome-linux/chrome|headless_shell' | grep -v grep | awk '{s+=$1} END {print s/1024}'", { encoding: "utf8" });
    return Math.round(Number(out.trim()) || 0);
  } catch {
    return 0;
  }
};

function makeFiles(kind: "txt-max" | "mixed" | "csv-max") {
  const dir = mkdtempSync(path.join(tmpdir(), "ff-perf-"));
  const files: string[] = [];
  const mk = (name: string, bytes: number, gen: (i: number) => string) => {
    let s = "";
    let i = 0;
    const parts: string[] = [];
    let n = 0;
    while (n < bytes) {
      const l = gen(i++);
      parts.push(l);
      n += l.length;
    }
    s = parts.join("");
    const f = path.join(dir, name);
    writeFileSync(f, s);
    files.push(f);
  };
  if (kind === "txt-max") for (let k = 0; k < 9; k++) mk(`doc${k}.txt`, 5 * 1024 * 1024 - 1000, (i) => `Document ${k} paragraph ${i}: the quick brown fox jumps over the lazy dog.\n\n`);
  if (kind === "mixed") {
    for (let k = 0; k < 4; k++) mk(`note${k}.txt`, 4 * 1024 * 1024, (i) => `Note ${k} line ${i} lorem ipsum dolor sit amet\n`);
    // ~150 bytes per row keeps each 3 MB file near 20,000 rows (the balanced row limit).
    for (let k = 0; k < 3; k++) mk(`data${k}.csv`, 2.5 * 1024 * 1024, (i) => `${i},${k},name ${i},value ${i * 3},${"x".repeat(110)}\n`);
    for (let k = 0; k < 3; k++) mk(`readme${k}.md`, 2 * 1024 * 1024, (i) => (i % 40 === 0 ? `\n## Section ${k}-${i}\n\n` : `- bullet ${i} with **bold** and a [link](https://example.com/${i})\n`));
  }
  if (kind === "csv-max") for (let k = 0; k < 10; k++) mk(`big${k}.csv`, 3 * 1024 * 1024, (i) => `${i},${k},name ${i},value ${i * 3},${"y".repeat(110)}\n`);
  return files;
}

for (const kind of (process.env.PERF_KIND ? [process.env.PERF_KIND] : ["txt-max", "mixed"]) as ("txt-max" | "mixed" | "csv-max")[]) {
  test(`batch near the limits: ${kind}`, async ({ page }) => {
    test.setTimeout(1_200_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(Math.round(e.duration)))).observe({ entryTypes: ["longtask"] });
    });
    await page.goto("/");
    const files = makeFiles(kind);
    const t0 = Date.now();
    await page.getByTestId("file-input").setInputFiles(files);
    await expect(page.getByTestId("batch-workspace")).toBeVisible();
    const accepted = await page.locator("[data-testid=queue-row][data-status=queued]").count();
    const intakeMs = Date.now() - t0;
    const baseline = rssMb();
    let peak = baseline;
    const timer = setInterval(() => (peak = Math.max(peak, rssMb())), 1000);
    const t1 = Date.now();
    await page.getByTestId("start-batch").click();
    await expect(page.getByTestId("batch-complete")).toBeVisible({ timeout: 1_100_000 });
    clearInterval(timer);
    const total = Date.now() - t1;
    const done = await page.locator("[data-testid=queue-row][data-status=done]").count();
    const failed = await page.locator("[data-testid=queue-row][data-status=failed]").count();
    const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
    const outBytes = await page.getByTestId("sum-limits").textContent();
    console.log(`PERF ${kind}: accepted=${accepted} intake=${intakeMs}ms convert=${Math.round(total / 1000)}s done=${done} failed=${failed} rssBaseline=${baseline}MB rssPeak=${peak}MB longtasks=${long.length} maxLongTask=${Math.max(0, ...long)}ms (${outBytes})`);
    for (const e of await page.getByTestId("row-error").allTextContents()) console.log(`PERF failure reason: ${e}`);
    expect(failed).toBe(0);
  });
}

// ---- Phase 4: Office and PDF conversions on a desktop and on a throttled (4x slower CPU) device ----
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const corpusPath = (n: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../corpus", n);
const CASES: [string, "pdf" | "docx"][] = [
  ["docx-simple.docx", "pdf"],
  ["docx-long.docx", "pdf"],
  ["xlsx-wide.xlsx", "pdf"],
  ["xlsx-long.xlsx", "pdf"],
  ["pdf-text-simple.pdf", "docx"],
  ["pdf-long.pdf", "docx"],
];

for (const throttle of [1, 4]) {
  test(`phase 4 pathways, CPU x${throttle}`, async ({ page }) => {
    test.setTimeout(900_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await page.goto("/");
    for (const [name, out] of CASES) {
      const t0 = Date.now();
      await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: readFileSync(corpusPath(name)) });
      await expect(page.getByTestId("convert-button")).toBeVisible({ timeout: 300_000 });
      const parseMs = Date.now() - t0;
      await page.getByTestId(`output-${out}`).click();
      const t1 = Date.now();
      await page.getByTestId("convert-button").click();
      await expect(page.getByRole("heading", { name: "Conversion Complete!" })).toBeVisible({ timeout: 600_000 });
      const convertMs = Date.now() - t1;
      const heap = await page.evaluate(() => Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576));
      const meta = await page.getByTestId("out-meta").innerText();
      console.log(`P4PERF cpu=x${throttle} ${name}->${out}: open+parse ${parseMs} ms, convert ${convertMs} ms, js heap ${heap} MB, browser rss ${rssMb()} MB, ${meta}`);
      await page.getByTestId("convert-another").click();
    }
  });
}

// ---- Phase 5: first load and main-thread responsiveness ----
for (const throttle of [1, 4]) {
  test(`phase 5 first load, CPU x${throttle}`, async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await page.addInitScript(() => {
      const w = window as unknown as { __m: { lcp: number; fcp: number; long: number[] } };
      w.__m = { lcp: 0, fcp: 0, long: [] };
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.__m.lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => e.name === "first-contentful-paint" && (w.__m.fcp = e.startTime))).observe({ type: "paint", buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__m.long.push(e.duration))).observe({ type: "longtask", buffered: true });
    });
    const js: { url: string; encoded: number }[] = [];
    page.on("requestfinished", async (req) => {
      if (req.resourceType() === "script" || req.url().endsWith(".css") || req.resourceType() === "stylesheet") js.push({ url: req.url(), encoded: (await req.sizes()).responseBodySize });
    });
    const t0 = Date.now();
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByTestId("file-input").waitFor({ state: "attached" });
    const interactive = Date.now() - t0;
    const m = await page.evaluate(() => (window as unknown as { __m: { lcp: number; fcp: number; long: number[] } }).__m);
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) };
    });
    const tbt = m.long.reduce((a, d) => a + Math.max(0, d - 50), 0);
    const bytes = js.reduce((a, r) => a + r.encoded, 0);
    console.log(`P5LOAD cpu=x${throttle}: ${js.length} script/style files, ${(bytes / 1024).toFixed(0)} KB over the wire, FCP ${Math.round(m.fcp)} ms, LCP ${Math.round(m.lcp)} ms, DCL ${nav.dcl} ms, load ${nav.load} ms, long tasks ${m.long.length} (total blocking ${Math.round(tbt)} ms, longest ${Math.round(Math.max(0, ...m.long))} ms), upload zone ready ${interactive} ms`);
  });
}

const RESPONSIVE: [string, "pdf" | "docx"][] = [
  ["docx-long.docx", "pdf"],
  ["xlsx-long.xlsx", "pdf"],
  ["pdf-long.pdf", "docx"],
  ["pdf-text-simple.pdf", "docx"],
];
for (const throttle of [1, 4]) {
  test(`phase 5 main-thread blocking during conversion, CPU x${throttle}`, async ({ page }) => {
    test.setTimeout(900_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await page.addInitScript(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: "longtask" });
    });
    await page.goto("/");
    const big = Buffer.from("A fairly long line of text that repeats to make a big plain text file.\n\n".repeat(60000));
    const cases: [string, Buffer, "pdf" | "docx"][] = [["5mb.txt", big, "pdf"], ...RESPONSIVE.map(([n, o]) => [n, readFileSync(corpusPath(n)), o] as [string, Buffer, "pdf" | "docx"])];
    for (const [name, buffer, out] of cases) {
      await page.evaluate(() => ((window as unknown as { __long: number[] }).__long.length = 0));
      await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
      await expect(page.getByTestId("convert-button")).toBeVisible({ timeout: 300_000 });
      await page.getByTestId(`output-${out}`).click();
      await page.getByTestId("convert-button").click();
      await expect(page.getByRole("heading", { name: "Conversion Complete!" })).toBeVisible({ timeout: 600_000 });
      const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
      console.log(`P5BLOCK cpu=x${throttle} ${name}->${out}: ${long.length} long tasks, longest ${Math.round(Math.max(0, ...long))} ms, total blocking ${Math.round(long.reduce((a, d) => a + Math.max(0, d - 50), 0))} ms`);
      await page.getByTestId("convert-another").click();
    }
  });
}
