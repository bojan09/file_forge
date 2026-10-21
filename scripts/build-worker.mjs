// Bundles the conversion worker (pdfmake, docx, fonts and the renderers) into public/workers/convert.worker.js.
// It is loaded by URL only when the first conversion starts, so none of it is part of the page's own scripts
// (Next/Turbopack would otherwise list the worker's 2 MB bundle among the page's script tags).
import { build } from "rolldown";
import { mkdirSync } from "node:fs";

mkdirSync("public/workers", { recursive: true });
const t0 = Date.now();
await build({
  input: "src/engine/convert.worker.ts",
  platform: "browser",
  logLevel: "warn",
  transform: { define: { "process.env.NODE_ENV": '"production"' } },
  output: { file: "public/workers/convert.worker.js", format: "esm", minify: true, sourcemap: false, codeSplitting: false },
});
console.log(`Built public/workers/convert.worker.js in ${Date.now() - t0} ms`);
