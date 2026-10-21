// Copies the pdf.js legacy-build worker (runs on browsers without the newest JS built-ins) next to the app so the PDF preview loads it from the same origin (CSP: worker-src 'self').
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const src = path.resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
const dest = path.resolve("public/vendor/pdf.worker.min.mjs");
if (!existsSync(src)) {
  console.warn("pdfjs-dist not installed yet; skipping worker copy.");
  process.exit(0);
}
mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("Copied pdf.js worker to public/vendor/");
