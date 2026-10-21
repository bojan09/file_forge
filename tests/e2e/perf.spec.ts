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
