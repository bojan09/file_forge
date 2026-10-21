import { expect, type Download, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const fixture = (name: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/** Records every request so tests can prove no file data leaves the browser. */
export function trackNetwork(page: Page) {
  const external: string[] = [];
  const writes: { url: string; method: string; size: number }[] = [];
  const all: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    all.push(req.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname) && !["data:", "blob:"].includes(url.protocol)) external.push(req.url());
    if (req.method() !== "GET" && req.method() !== "HEAD") writes.push({ url: req.url(), method: req.method(), size: req.postData()?.length ?? 0 });
  });
  return { external, writes, all };
}

export async function uploadFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByTestId("file-input").setInputFiles(file);
}

export async function waitForWorkspace(page: Page) {
  await expect(page.getByTestId("convert-button")).toBeVisible({ timeout: 20000 });
}

export async function convertAndDownload(page: Page): Promise<{ download: Download; bytes: Buffer }> {
  await page.getByTestId("convert-button").click();
  await expect(page.getByRole("heading", { name: "Conversion Complete!" })).toBeVisible({ timeout: 90000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-link").click()]);
  const p = await download.path();
  return { download, bytes: readFileSync(p) };
}
