import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { docxXml, extractPdf } from "../unit/helpers";
import { fixture, trackNetwork } from "./helpers";

type F = { name: string; mimeType: string; buffer: Buffer };
const txt = (name: string, body: string): F => ({ name, mimeType: "text/plain", buffer: Buffer.from(body) });
const bigTxt = (name: string, mb: number): F => {
  const line = `${name} line with some filler text to make the file long enough to take a moment.\n\n`;
  return txt(name, line.repeat(Math.ceil((mb * 1024 * 1024) / line.length)));
};
const fromFixture = (name: string, as = name): F => ({ name: as, mimeType: "application/octet-stream", buffer: readFileSync(fixture(name)) });
const row = (page: Page, name: string) => page.locator(`[data-testid=queue-row][data-name="${name}"]`);
const rowsOf = (page: Page) => page.locator("[data-testid=queue-row]");

async function addBatch(page: Page, files: F[]) {
  await page.getByTestId("file-input").setInputFiles(files);
  await expect(page.getByTestId("batch-workspace")).toBeVisible();
}

async function waitDone(page: Page, timeout = 120000) {
  await expect(page.getByTestId("batch-complete")).toBeVisible({ timeout });
}

/** Records which rows are converting at each status change, to prove strictly sequential execution. */
async function recordConversions(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __log: { conv: string[] }[] };
    w.__log = [];
    const list = document.querySelector("[data-testid=queue-list]")!;
    const rec = () => w.__log.push({ conv: [...list.querySelectorAll("[data-testid=queue-row]")].filter((r) => r.getAttribute("data-status") === "converting").map((r) => r.getAttribute("data-name")!) });
    new MutationObserver(rec).observe(list, { subtree: true, attributes: true, attributeFilter: ["data-status"], childList: true });
  });
}
async function conversionLog(page: Page) {
  return page.evaluate(() => (window as unknown as { __log: { conv: string[] }[] }).__log);
}

test.beforeEach(async ({ page }) => {
  // Track object URLs so tests can prove they are released.
  await page.addInitScript(() => {
    const w = window as unknown as { __urls: Set<string> };
    w.__urls = new Set();
    const c = URL.createObjectURL.bind(URL);
    const r = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource) => {
      const u = c(o);
      w.__urls.add(u);
      return u;
    };
    URL.revokeObjectURL = (u: string) => {
      w.__urls.delete(u);
      r(u);
    };
  });
  await page.goto("/");
});

test.describe("multi-file intake", () => {
  test("several files, unsupported and duplicate handling, per-file info", async ({ page }) => {
    await addBatch(page, [
      txt("a.txt", "alpha"),
      txt("b.txt", "bravo"),
      txt("copy-of-a.txt", "alpha"), // exact duplicate of a.txt
      { name: "archive.zip", mimeType: "application/zip", buffer: Buffer.from("PK\x03\x04") },
      fromFixture("sample.csv"),
      fromFixture("photo.jpg"),
    ]);
    await expect(rowsOf(page)).toHaveCount(5);
    await expect(row(page, "a.txt")).toContainText("Plain text");
    await expect(row(page, "sample.csv")).toContainText("CSV");
    await expect(row(page, "photo.jpg")).toContainText("Images");
    await expect(row(page, "archive.zip")).toHaveAttribute("data-status", "rejected");
    await expect(row(page, "archive.zip").getByTestId("row-reason")).toContainText(".zip files are not supported");
    await expect(page.getByTestId("batch-notices")).toContainText("copy-of-a.txt (same as a.txt)");
    await expect(page.getByTestId("sum-limits")).toContainText("4/10 files");
    // valid files are not blocked by the invalid one
    await expect(page.getByTestId("start-batch")).toBeEnabled();
    await expect(page.getByTestId("announcer")).toContainText(/files? added/);
  });

  test("adding more files later keeps the queue", async ({ page }) => {
    await addBatch(page, [txt("one.txt", "1"), txt("two.txt", "2")]);
    await page.getByTestId("batch-input").setInputFiles([txt("three.txt", "3")]);
    await expect(rowsOf(page)).toHaveCount(3);
    await expect(rowsOf(page).nth(2)).toHaveAttribute("data-name", "three.txt");
  });

  test("single workspace → Add more files moves into the batch", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles(fromFixture("sample.txt"));
    await expect(page.getByTestId("convert-button")).toBeVisible();
    await page.getByTestId("add-more-input").setInputFiles([fromFixture("sample.csv")]);
    await expect(page.getByTestId("batch-workspace")).toBeVisible();
    await expect(rowsOf(page)).toHaveCount(2);
    await expect(rowsOf(page).first()).toHaveAttribute("data-name", "sample.txt");
  });

  test("a single dropped file still uses the single-file flow", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles(txt("solo.txt", "only"));
    await expect(page.getByTestId("convert-button")).toBeVisible();
    await expect(page.getByTestId("batch-workspace")).toHaveCount(0);
  });

  test("count and combined-size limits reject extra files without blocking the rest", async ({ page }) => {
    await addBatch(page, Array.from({ length: 12 }, (_, i) => txt(`f${i}.txt`, `file number ${i}`)));
    await expect(page.locator("[data-testid=queue-row][data-status=queued]")).toHaveCount(10);
    await expect(page.locator("[data-testid=queue-row][data-status=rejected]")).toHaveCount(2);
    await expect(page.locator("[data-testid=queue-row][data-status=rejected]").first().getByTestId("row-reason")).toContainText("at most 10 files");
    await page.getByTestId("clear-queue").click();
    await page.getByTestId("clear-yes").click();
    // 14 MB header-valid PNGs: the fourth would exceed 50 MB combined
    const dir = mkdtempSync(path.join(tmpdir(), "ff-big-"));
    const png = (n: number) => {
      const file = path.join(dir, `big${n}.png`);
      writeFileSync(file, Buffer.concat([readFileSync(fixture("image.png")), Buffer.alloc(14 * 1024 * 1024 - 100, n)]));
      return file;
    };
    await page.getByTestId("file-input").setInputFiles([png(1), png(2), png(3), png(4)]); // paths: Playwright caps in-memory buffers at 50 MB
    await expect(page.locator("[data-testid=queue-row][data-status=queued]")).toHaveCount(3);
    await expect(page.locator("[data-testid=queue-row][data-status=rejected] [data-testid=row-reason]")).toContainText("combined size limit");
  });
});

test.describe("queue editing", () => {
  test("reorder with move buttons (keyboard) and announce", async ({ page }) => {
    await addBatch(page, [txt("a.txt", "1"), txt("b.txt", "22"), txt("c.txt", "333")]);
    await row(page, "c.txt").getByTestId("row-up").focus();
    await page.keyboard.press("Enter");
    await expect(rowsOf(page).nth(1)).toHaveAttribute("data-name", "c.txt");
    await expect(page.getByTestId("announcer")).toContainText("c.txt moved to position 2 of 3");
    await row(page, "a.txt").getByTestId("row-down").click();
    await expect(rowsOf(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-name")))).resolves.toEqual(["c.txt", "a.txt", "b.txt"]);
    await expect(row(page, "c.txt").getByTestId("row-up")).toBeDisabled();
  });

  test("reorder by drag and drop", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "HTML5 drag and drop is a desktop pointer feature; mobile uses the move buttons");
    await addBatch(page, [txt("a.txt", "1"), txt("b.txt", "22"), txt("c.txt", "333")]);
    await row(page, "c.txt").dragTo(row(page, "a.txt"));
    await expect(rowsOf(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-name")))).resolves.toEqual(["c.txt", "a.txt", "b.txt"]);
  });

  test("remove one file; clear needs confirmation", async ({ page }) => {
    await addBatch(page, [txt("a.txt", "1"), txt("b.txt", "22")]);
    await row(page, "a.txt").getByTestId("row-remove").click();
    await expect(rowsOf(page)).toHaveCount(1);
    await page.getByTestId("clear-queue").click();
    await expect(page.getByTestId("clear-confirm")).toBeVisible();
    await page.getByTestId("clear-no").click();
    await expect(rowsOf(page)).toHaveCount(1);
    await page.getByTestId("clear-queue").click();
    await page.getByTestId("clear-yes").click();
    await expect(page.locator(".dropzone")).toBeVisible();
  });
});

test.describe("batch conversion", () => {
  test("converts sequentially in list order, outputs verified, ZIP is valid", async ({ page }) => {
    const net = trackNetwork(page);
    await addBatch(page, [fromFixture("sample.txt"), fromFixture("sample.md"), fromFixture("sample.csv"), fromFixture("sample.html")]);
    await recordConversions(page);
    await row(page, "sample.md").getByTestId("row-expand").click();
    await row(page, "sample.md").locator("select").first().selectOption("docx");
    await page.getByTestId("start-batch").click();
    await waitDone(page);
    const log = await conversionLog(page);
    expect(Math.max(...log.map((l) => l.conv.length))).toBeLessThanOrEqual(1);
    const seen: string[] = [];
    for (const l of log) for (const n of l.conv) if (!seen.includes(n)) seen.push(n);
    expect(seen).toEqual(["sample.txt", "sample.md", "sample.csv", "sample.html"]);
    await expect(page.getByTestId("count-done")).toHaveText("4");
    await expect(page.locator("[data-testid=queue-row][data-status=done]")).toHaveCount(4);
    await expect(row(page, "sample.md").getByTestId("row-output")).toHaveText("sample.docx");
    await expect(row(page, "sample.txt").getByTestId("row-output")).toHaveText("sample.pdf");

    // individual download, verified by independent readers
    const [dl] = await Promise.all([page.waitForEvent("download"), row(page, "sample.txt").getByTestId("row-download").click()]);
    const pdf = readFileSync(await dl.path());
    expect((await extractPdf(new Uint8Array(pdf))).pages.join(" ")).toContain("Здраво свету");
    const [dl2] = await Promise.all([page.waitForEvent("download"), row(page, "sample.md").getByTestId("row-download").click()]);
    expect((await docxXml(new Uint8Array(readFileSync(await dl2.path())))).xml).toContain("<w:tbl>");

    // ZIP with custom name and originals
    await page.getByTestId("zip-name").fill("my batch");
    await page.getByTestId("zip-originals").check();
    const [zdl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-zip").click()]);
    expect(zdl.suggestedFilename()).toBe("my batch.zip");
    const zipPath = await zdl.path();
    const z = await JSZip.loadAsync(readFileSync(zipPath));
    const names = Object.keys(z.files).filter((n) => !n.endsWith("/")).sort();
    expect(names).toEqual(["originals/sample.csv", "originals/sample.html", "originals/sample.md", "originals/sample.txt", "sample (2).pdf", "sample (3).pdf", "sample.docx", "sample.pdf"]);
    expect(names.every((n) => !n.includes("..") && !n.startsWith("/"))).toBe(true);
    expect((await docxXml(new Uint8Array(await z.file("sample.docx")!.async("uint8array")))).xml).toContain("<w:tbl>");
    expect(Buffer.from(await z.file("originals/sample.csv")!.async("uint8array")).equals(readFileSync(fixture("sample.csv")))).toBe(true);
    try {
      const out = execFileSync("unzip", ["-t", zipPath], { encoding: "utf8" });
      expect(out).toMatch(/No errors detected/);
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") throw e;
    }
    expect(net.external).toEqual([]);
    expect(net.writes).toEqual([]);
  });

  test("output name collisions get (2), (3)", async ({ page }) => {
    await addBatch(page, [txt("report.txt", "one"), { name: "report.md", mimeType: "text/markdown", buffer: Buffer.from("# two") }, { name: "Report.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n") }]);
    await page.getByTestId("start-batch").click();
    await waitDone(page);
    const outs = await page.getByTestId("row-output").allTextContents();
    expect(outs).toEqual(["report.pdf", "report (2).pdf", "Report (3).pdf"]);
    await page.getByTestId("download-zip").click();
    await expect(page.getByTestId("zip-status")).toContainText("Downloaded fileforge-converted.zip");
  });

  test("shared DOCX: images are skipped with an explanation, per-file override fixes it", async ({ page }) => {
    await addBatch(page, [txt("doc.txt", "text"), fromFixture("photo.jpg")]);
    await page.getByTestId("batch-output-docx").click();
    await expect(page.getByTestId("docx-image-note")).toContainText("1 image can't become DOCX");
    await expect(row(page, "photo.jpg").getByTestId("row-reason")).toContainText("only be converted to PDF");
    await page.getByTestId("start-batch").click();
    await waitDone(page);
    await expect(row(page, "doc.txt")).toHaveAttribute("data-status", "done");
    await expect(row(page, "photo.jpg")).toHaveAttribute("data-status", "queued");
    await expect(page.getByTestId("count-skipped")).toHaveText("1");
    await row(page, "photo.jpg").getByTestId("row-expand").click();
    await row(page, "photo.jpg").locator("select").first().selectOption("pdf");
    await page.getByTestId("start-batch").click();
    await expect(row(page, "photo.jpg")).toHaveAttribute("data-status", "done", { timeout: 60000 });
  });

  test("shared page settings and suffix reach the output; per-file override wins", async ({ page }) => {
    await addBatch(page, [txt("a.txt", "alpha text"), txt("b.txt", "bravo text")]);
    await page.getByLabel("Paper size", { exact: true }).first().selectOption("LETTER");
    await page.locator("#bs-orient").selectOption("landscape");
    await page.locator("#bs-suffix").fill("_x");
    await row(page, "b.txt").getByTestId("row-expand").click();
    await row(page, "b.txt").getByLabel("Orientation").selectOption("portrait");
    await page.getByTestId("start-batch").click();
    await waitDone(page);
    const dims = async (name: string) => {
      const [dl] = await Promise.all([page.waitForEvent("download"), row(page, name).getByTestId("row-download").click()]);
      expect(dl.suggestedFilename()).toBe(`${name[0]}_x.pdf`);
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(await dl.path())), verbosity: 0 }).promise;
      const v = (await doc.getPage(1)).view;
      return [Math.round(v[2]! - v[0]!), Math.round(v[3]! - v[1]!)];
    };
    expect(await dims("a.txt")).toEqual([792, 612]); // Letter landscape (shared)
    expect(await dims("b.txt")).toEqual([612, 792]); // Letter portrait (override)
  });

  test("image-only options appear only for images", async ({ page }) => {
    await addBatch(page, [txt("a.txt", "x"), txt("b.txt", "y")]);
    await expect(page.locator("#bs-quality")).toHaveCount(0);
    await row(page, "a.txt").getByTestId("row-expand").click();
    await expect(row(page, "a.txt").getByLabel("Image quality")).toHaveCount(0);
    await page.getByTestId("batch-input").setInputFiles([fromFixture("image.png")]);
    await expect(page.locator("#bs-quality")).toBeVisible();
    await row(page, "image.png").getByTestId("row-expand").click();
    await expect(row(page, "image.png").getByLabel("Image quality")).toBeVisible();
    await expect(row(page, "image.png").getByLabel("Image placement")).toBeVisible();
  });

  test("one failure doesn't stop the rest; retry works", async ({ page }) => {
    const wide = Array.from({ length: 60 }, (_, i) => i).join(",");
    await addBatch(page, [txt("first.txt", "first"), txt("wide.csv", `${wide}\n${wide}\n`), txt("third.txt", "third")]);
    await page.getByTestId("start-batch").click();
    await waitDone(page);
    await expect(row(page, "first.txt")).toHaveAttribute("data-status", "done");
    await expect(row(page, "wide.csv")).toHaveAttribute("data-status", "failed");
    await expect(row(page, "third.txt")).toHaveAttribute("data-status", "done");
    await expect(row(page, "wide.csv").getByTestId("row-error")).toContainText("columns");
    await expect(page.getByTestId("batch-complete")).toContainText("1 failed");
    await expect(page.getByTestId("announcer")).toContainText(/Batch finished: 2 converted, 1 failed/);
    await row(page, "wide.csv").getByTestId("row-retry").click();
    await expect(row(page, "wide.csv")).toHaveAttribute("data-status", "failed", { timeout: 30000 });
    // ZIP contains only the successes
    await page.getByTestId("download-zip").click();
    await expect(page.getByTestId("zip-status")).toContainText("Downloaded");
  });

  test("pause between files, resume, cancel the active file, cancel remaining", async ({ page }) => {
    await addBatch(page, [bigTxt("s1.txt", 1.5), bigTxt("s2.txt", 1.5), bigTxt("s3.txt", 1.5), bigTxt("s4.txt", 1.5)]);
    await page.getByTestId("start-batch").click();
    await expect(row(page, "s1.txt")).toHaveAttribute("data-status", "converting");
    await expect(row(page, "s1.txt").getByTestId("row-progress")).toBeVisible();
    await page.getByTestId("pause-batch").click();
    await expect(page.getByTestId("resume-batch")).toContainText("Pausing");
    // current file finishes, then the queue holds
    await expect(row(page, "s1.txt")).toHaveAttribute("data-status", "done", { timeout: 60000 });
    await expect(page.getByTestId("resume-batch")).toHaveText(/Resume/);
    await expect(row(page, "s2.txt")).toHaveAttribute("data-status", "queued");
    await expect(page.getByTestId("announcer")).toContainText("Paused");
    await page.getByTestId("resume-batch").click();
    await expect(row(page, "s2.txt")).toHaveAttribute("data-status", "converting");
    // cancel the active file only: queue moves on
    await row(page, "s2.txt").getByTestId("row-cancel").click();
    await expect(row(page, "s2.txt")).toHaveAttribute("data-status", "cancelled");
    await expect(row(page, "s3.txt")).toHaveAttribute("data-status", "converting");
    // cancel everything that remains
    await page.getByTestId("cancel-batch").click();
    await expect(row(page, "s3.txt")).toHaveAttribute("data-status", "cancelled");
    await expect(row(page, "s4.txt")).toHaveAttribute("data-status", "cancelled");
    await expect(row(page, "s1.txt")).toHaveAttribute("data-status", "done"); // finished output is kept
    // cancelled files can be re-queued and finish
    await row(page, "s4.txt").getByTestId("row-retry").click();
    await expect(row(page, "s4.txt")).toHaveAttribute("data-status", "done", { timeout: 60000 });
  });

  test("object URLs and memory are released on remove, clear and after downloads", async ({ page }) => {
    await addBatch(page, [txt("a.txt", "alpha"), txt("b.txt", "bravo")]);
    await page.getByTestId("start-batch").click();
    await waitDone(page);
    const [dl] = await Promise.all([page.waitForEvent("download"), row(page, "a.txt").getByTestId("row-download").click()]);
    await dl.path();
    // download URLs are revoked after a delay; before then, the only live URLs belong to downloads
    const live = await page.evaluate(() => [...(window as unknown as { __urls: Set<string> }).__urls].length);
    expect(live).toBeLessThanOrEqual(1);
    await row(page, "a.txt").getByTestId("row-remove").click();
    await page.getByTestId("clear-queue").click();
    await page.getByTestId("clear-yes").click();
    await expect(page.locator(".dropzone")).toBeVisible();
    await expect(page.getByTestId("batch-workspace")).toHaveCount(0);
  });

  test("ZIP failure keeps individual downloads available", async ({ page }) => {
    await page.addInitScript(() => {
      // Make fflate's worker-based zip and the blocking fallback both fail by breaking Blob.arrayBuffer for blobs of type application/zip? Simpler: break Uint8Array-based read.
      const orig = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function (this: Blob) {
        if ((window as unknown as { __breakZip?: boolean }).__breakZip) return Promise.reject(new Error("simulated read failure"));
        return orig.call(this);
      };
    });
    await page.goto("/");
    await addBatch(page, [txt("a.txt", "alpha"), txt("b.txt", "bravo")]);
    await page.getByTestId("start-batch").click();
    await waitDone(page);
    await page.evaluate(() => ((window as unknown as { __breakZip: boolean }).__breakZip = true));
    await page.getByTestId("download-zip").click();
    await expect(page.getByTestId("zip-error")).toContainText("simulated read failure");
    await expect(page.getByTestId("zip-error")).toContainText("still available");
    await page.evaluate(() => ((window as unknown as { __breakZip: boolean }).__breakZip = false));
    const [dl] = await Promise.all([page.waitForEvent("download"), row(page, "a.txt").getByTestId("row-download").click()]);
    expect(dl.suggestedFilename()).toBe("a.pdf");
  });
});

test.describe("merge images into one PDF", () => {
  const images = () => [fromFixture("photo.jpg"), fromFixture("rotated.jpg"), fromFixture("image.png"), fromFixture("image.webp")];
  async function openMerge(page: Page, files: F[] = images(), expected = files.length) {
    await page.getByTestId("mode-merge").click();
    await page.getByTestId("file-input").setInputFiles(files);
    await expect(page.getByTestId("merge-workspace")).toBeVisible();
    await expect(page.getByTestId("page-card")).toHaveCount(expected);
  }
  const orientations = (page: Page) => page.getByTestId("page-frame").evaluateAll((els) => els.map((e) => e.getAttribute("data-orientation")));
  const names = (page: Page) => page.getByTestId("page-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-name")));
  const pdfInfo = async (file: string) => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
    const out: { w: number; h: number }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const v = (await doc.getPage(i)).view;
      out.push({ w: Math.round(v[2]! - v[0]!), h: Math.round(v[3]! - v[1]!) });
    }
    return out;
  };
  const create = async (page: Page) => {
    await page.getByTestId("merge-create").click();
    await expect(page.getByTestId("merge-result")).toBeVisible({ timeout: 60000 });
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("merge-download").click()]);
    return { dl, file: await dl.path() };
  };

  test("merges images in order into one PDF with per-page orientation", async ({ page }) => {
    const net = trackNetwork(page);
    await openMerge(page);
    expect(await orientations(page)).toEqual(["landscape", "portrait", "landscape", "portrait"]);
    const { dl, file } = await create(page);
    expect(dl.suggestedFilename()).toBe("merged-images.pdf");
    const pages = await pdfInfo(file);
    expect(pages).toEqual([{ w: 842, h: 595 }, { w: 595, h: 842 }, { w: 842, h: 595 }, { w: 595, h: 842 }]);
    const { pages: text } = await extractPdf(new Uint8Array(readFileSync(file)));
    expect(text.join("").trim()).toBe(""); // pictures only: nothing selectable, nothing claimed
    await expect(page.getByTestId("merge-checks")).toContainText("All 4 images are embedded");
    await expect(page.getByTestId("merge-checks")).toContainText("not searchable");
    await expect(page.getByTestId("announcer")).toContainText("Merged PDF ready: 4 pages");
    expect(net.external).toEqual([]);
    expect(net.writes).toEqual([]);
  });

  test("reordering changes page order; changing settings invalidates the old result", async ({ page }) => {
    await openMerge(page);
    await page.getByTestId("page-card").nth(1).getByTestId("page-up").click();
    expect(await names(page)).toEqual(["rotated.jpg", "photo.jpg", "image.png", "image.webp"]);
    expect(await orientations(page)).toEqual(["portrait", "landscape", "landscape", "portrait"]);
    const { file } = await create(page);
    expect((await pdfInfo(file)).map((p) => (p.w > p.h ? "L" : "P"))).toEqual(["P", "L", "L", "P"]);
    await page.locator("#mg-size").selectOption("LETTER");
    await expect(page.getByTestId("merge-result")).toHaveCount(0);
    await page.getByTestId("page-card").first().getByTestId("page-remove").click();
    await expect(page.getByTestId("page-card")).toHaveCount(3);
  });

  test("page size, forced orientation, margins and file name apply", async ({ page }) => {
    await openMerge(page);
    await page.locator("#mg-size").selectOption("LETTER");
    await page.locator("#mg-orient").selectOption("portrait");
    await page.locator("#mg-margins").selectOption("narrow");
    await page.getByTestId("merge-name").fill("trip photos");
    expect(await orientations(page)).toEqual(["portrait", "portrait", "portrait", "portrait"]);
    const { dl, file } = await create(page);
    expect(dl.suggestedFilename()).toBe("trip photos.pdf");
    expect(await pdfInfo(file)).toEqual(Array(4).fill({ w: 612, h: 792 }));
  });

  test("fill is explicit cropping; fit never crops", async ({ page }) => {
    await openMerge(page, [fromFixture("photo.jpg")]);
    await expect(page.getByTestId("page-frame")).toHaveAttribute("data-cropped", "false");
    await page.getByTestId("fit-fill").click();
    await expect(page.getByTestId("page-frame")).toHaveAttribute("data-cropped", "true");
    await page.locator("#mg-orient").selectOption("portrait");
    const { file } = await create(page);
    expect(await pdfInfo(file)).toEqual([{ w: 595, h: 842 }]);
    // the 400x240 photo was cropped to the portrait content area, so its embedded image is portrait-shaped
    const raw = readFileSync(file).toString("latin1");
    const m = /\/Width (\d+)[\s\S]{0,200}?\/Height (\d+)|\/Height (\d+)[\s\S]{0,200}?\/Width (\d+)/.exec(raw);
    expect(m).not.toBeNull();
    const w = Number(m![1] ?? m![4]);
    const h = Number(m![2] ?? m![3]);
    expect(h).toBeGreaterThan(w);
  });

  test("transparent PNG is flattened on white, not black", async ({ page }) => {
    for (const quality of ["high", "balanced", "small"]) {
      await page.goto("/");
      await openMerge(page, [fromFixture("alpha.png")]);
      await page.locator("#mg-quality").selectOption(quality);
      await page.getByTestId("fit-fit").click();
      await page.locator("#mg-margins").selectOption("narrow");
      const { file } = await create(page);
      const dir = mkdtempSync(path.join(tmpdir(), "ff-alpha-"));
      try {
        execFileSync("pdftoppm", ["-r", "40", "-png", "-singlefile", file, path.join(dir, "p")]);
      } catch (e) {
        if ((e as { code?: string }).code === "ENOENT") return;
        throw e;
      }
      const png = readFileSync(path.join(dir, "p.png"));
      // Decode with the browser: sample the image near the top-left of the picture area (a transparent corner of the source).
      const px = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const x = Math.round(img.width * 0.13);
        const y = Math.round(img.height * 0.1);
        return Array.from(g.getImageData(x, y, 1, 1).data);
      }, png.toString("base64"));
      expect(px[0], `${quality}: corner red`).toBeGreaterThan(240);
      expect(px[1], `${quality}: corner green`).toBeGreaterThan(240);
      expect(px[2], `${quality}: corner blue`).toBeGreaterThan(240);
    }
  });

  test("non-images, duplicates and limits are reported without blocking valid images", async ({ page }) => {
    await openMerge(page, [fromFixture("photo.jpg"), fromFixture("photo.jpg", "photo-copy.jpg"), txt("notes.txt", "hello"), fromFixture("image.png")], 2);
    // photo-copy.jpg is the same bytes (duplicate), notes.txt is not an image
    await expect(page.getByTestId("merge-notices")).toContainText("notes.txt: only JPG, PNG and WebP");
    await expect(page.getByTestId("merge-notices")).toContainText("photo-copy.jpg (same as photo.jpg)");
  });

  test("clear returns to the start screen after confirmation", async ({ page }) => {
    await page.getByTestId("mode-merge").click();
    await page.getByTestId("file-input").setInputFiles([fromFixture("photo.jpg")]);
    await expect(page.getByTestId("merge-workspace")).toBeVisible();
    await page.getByTestId("merge-clear").click();
    await page.getByTestId("merge-clear-yes").click();
    await expect(page.locator(".dropzone")).toBeVisible();
    // thumbnails are revoked
    const live = await page.evaluate(() => (window as unknown as { __urls: Set<string> }).__urls.size);
    expect(live).toBe(0);
  });
});

test.describe("responsive layout and accessibility (batch + merge)", () => {
  const widths: [number, number][] = [[360, 740], [390, 844], [768, 1024], [1024, 768], [1440, 900], [844, 390]];
  for (const [w, h] of widths) {
    test(`no horizontal overflow at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/");
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await addBatch(page, [fromFixture("sample.txt"), fromFixture("sample.md"), fromFixture("photo.jpg"), { name: "x.zip", mimeType: "application/zip", buffer: Buffer.from("PK") }, txt("a-very-long-file-name-that-should-be-truncated-rather-than-overflowing-the-row-container-1234567890.txt", "long")]);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await row(page, "sample.md").getByTestId("row-expand").click();
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.getByTestId("start-batch").click();
      await waitDone(page);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await row(page, "sample.md").getByTestId("row-expand").click();
      expect(await overflow()).toBeLessThanOrEqual(0);
      // touch targets: primary actions are at least 44px tall on coarse pointers, 36px+ otherwise
      const box = await page.getByTestId("download-zip").boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await page.getByTestId("clear-queue").click();
      await page.getByTestId("clear-yes").click();
      await page.getByTestId("mode-merge").click();
      await page.getByTestId("file-input").setInputFiles([fromFixture("photo.jpg"), fromFixture("rotated.jpg"), fromFixture("image.png")]);
      await expect(page.getByTestId("page-card")).toHaveCount(3);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.getByTestId("merge-create").click();
      await expect(page.getByTestId("merge-result")).toBeVisible({ timeout: 60000 });
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  }

  for (const theme of ["dark", "light"] as const) {
    test(`axe: batch workspace in every state and merge workspace (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("fileforge:settings:v1", JSON.stringify({ theme: t })), theme);
      await page.goto("/");
      const check = async (label: string) => {
        await page.waitForTimeout(500);
        const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(res.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
      };
      await addBatch(page, [fromFixture("sample.txt"), fromFixture("photo.jpg"), { name: "x.zip", mimeType: "application/zip", buffer: Buffer.from("PK") }, txt("dup.txt", "same"), txt("dup2.txt", "same")]);
      await check("batch queued");
      await row(page, "sample.txt").getByTestId("row-expand").click();
      await check("batch row expanded");
      await page.getByTestId("batch-output-docx").click();
      await check("batch docx note");
      await page.getByTestId("batch-output-pdf").click();
      await page.getByTestId("start-batch").click();
      await waitDone(page);
      await check("batch complete");
      await row(page, "sample.txt").getByTestId("row-expand").click();
      await check("batch result details");
      await page.getByTestId("clear-queue").click();
      await check("batch clear confirm");
      await page.getByTestId("clear-yes").click();
      await page.getByTestId("mode-merge").click();
      await check("home merge mode");
      await page.getByTestId("file-input").setInputFiles([fromFixture("photo.jpg"), fromFixture("rotated.jpg")]);
      await expect(page.getByTestId("page-card")).toHaveCount(2);
      await check("merge workspace");
      await page.getByTestId("merge-create").click();
      await expect(page.getByTestId("merge-result")).toBeVisible({ timeout: 60000 });
      await check("merge result");
    });
  }

  test("reduced motion disables row animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await addBatch(page, [txt("a.txt", "1"), txt("b.txt", "2")]);
    const dur = await row(page, "a.txt").evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(dur)).toBeLessThan(0.01);
    await row(page, "a.txt").getByTestId("row-remove").click();
    await expect(rowsOf(page)).toHaveCount(1, { timeout: 500 }); // removed immediately, no leave animation delay
  });

  test("no file content leaves the browser in a batch + merge flow", async ({ page }) => {
    const net = trackNetwork(page);
    const bodies: string[] = [];
    page.on("request", (r) => r.postData() && bodies.push(r.postData()!));
    await addBatch(page, [fromFixture("sample.md"), fromFixture("unsafe.html"), fromFixture("photo.jpg")]);
    await page.getByTestId("start-batch").click();
    await waitDone(page);
    await page.getByTestId("download-zip").click();
    await expect(page.getByTestId("zip-status")).toContainText("Downloaded");
    expect(net.external).toEqual([]);
    expect(net.writes).toEqual([]);
    expect(bodies).toEqual([]);
    expect(net.all.some((u) => /evil\.example/.test(u))).toBe(false);
  });
});
