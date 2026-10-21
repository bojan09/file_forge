// Generates out/sw.js from scripts/sw.template.js: the precache list is every file in the static export that the app needs
// offline, and the cache version is a hash of their contents, so any deploy that changes a file produces a new cache.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve("out");
const SKIP = [/\.map$/, /^\/404\//, /^\/sw\.js$/, /^\/404\.html$/, /^\/_not-found\//, /^\/_headers$/, /^\/_next\/static\/[^/]+\/_buildManifest/];

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

function urlFor(rel) {
  if (rel.endsWith("/index.html")) return rel.slice(0, -"index.html".length);
  return rel;
}

const files = walk(OUT).filter((rel) => !SKIP.some((re) => re.test(rel))).sort();
const hash = createHash("sha256");
const urls = [];
let bytes = 0;
for (const rel of files) {
  const content = readFileSync(path.join(OUT, rel));
  hash.update(rel).update(content);
  bytes += content.length;
  urls.push(urlFor(rel));
}
// "/index.html" also answers "/", and the exported page route "/formats.html" style is not used (trailingSlash).
const version = hash.digest("hex").slice(0, 12);
const template = readFileSync(path.resolve("scripts/sw.template.js"), "utf8");
writeFileSync(path.join(OUT, "sw.js"), template.replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify([...new Set(urls)], null, 1)));
console.log(`sw.js: version ${version}, ${urls.length} files, ${(bytes / 1048576).toFixed(1)} MB precached`);
