// Generates public/sw.js from scripts/sw.template.js BEFORE `next build`, so it is part of what hosts publish
// (Vercel's adapter ignores files created after the build). The worker discovers Next's hashed files itself at install time.
// The cache version changes with any change to the files in public/ and with every new commit/deploy.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const PUBLIC = path.resolve("public");
const SKIP = [/\.map$/, /^\/sw\.js$/, /^\/_headers$/, /^\/\./];

function walk(dir, base = "") {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = `${base}/${name}`;
    if (statSync(full).isDirectory()) files.push(...walk(full, rel));
    else files.push(rel);
  }
  return files;
}

// Every route with a page.tsx becomes an exported page with a trailing slash.
const pages = ["/"];
for (const name of readdirSync("src/app").sort()) {
  const dir = path.join("src/app", name);
  if (statSync(dir).isDirectory() && existsSync(path.join(dir, "page.tsx"))) pages.push(`/${name}/`);
}

const files = walk(PUBLIC).filter((rel) => !SKIP.some((re) => re.test(rel))).sort();
const hash = createHash("sha256");
let bytes = 0;
for (const rel of files) {
  const content = readFileSync(path.join(PUBLIC, rel));
  hash.update(rel).update(content);
  bytes += content.length;
}
hash.update(process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || String(Date.now()));
const version = hash.digest("hex").slice(0, 12);
const template = readFileSync(path.resolve("scripts/sw.template.js"), "utf8");
writeFileSync(
  path.join(PUBLIC, "sw.js"),
  template.replace("__VERSION__", version).replace("__PAGES__", JSON.stringify(pages)).replace("__STATIC__", JSON.stringify(files, null, 1)),
);
console.log(`sw.js: version ${version}, ${pages.length} pages + ${files.length} static files (${(bytes / 1048576).toFixed(1)} MB) plus the app's hashed files found at install`);
