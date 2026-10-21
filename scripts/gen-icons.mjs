// Renders public/icon.svg to the PNG icons the web manifest and iOS need, using the Chromium that Playwright provides.
// Run: PW_CHROMIUM_PATH=/path/to/chromium node scripts/gen-icons.mjs
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync("public/icon.svg", "utf8");
const BG = "#0b1226";
const jobs = [
  { file: "public/icons/icon-192.png", size: 192, bg: null, scale: 1 },
  { file: "public/icons/icon-512.png", size: 512, bg: null, scale: 1 },
  // Maskable icons keep the artwork inside the central 80% safe zone, on a solid background.
  { file: "public/icons/icon-maskable-512.png", size: 512, bg: BG, scale: 0.7 },
  { file: "public/icons/apple-touch-icon.png", size: 180, bg: BG, scale: 0.78 },
  { file: "public/icons/favicon-32.png", size: 32, bg: null, scale: 1 },
];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const j of jobs) {
  await page.setViewportSize({ width: j.size, height: j.size });
  const inner = Math.round(j.size * j.scale);
  await page.setContent(`<style>html,body{margin:0;background:${j.bg ?? "transparent"};width:${j.size}px;height:${j.size}px;display:grid;place-items:center}svg{width:${inner}px;height:${inner}px}</style>${svg}`);
  const buf = await page.screenshot({ omitBackground: j.bg === null, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  writeFileSync(j.file, buf);
  console.log(j.file, buf.length, "bytes");
}
await browser.close();
