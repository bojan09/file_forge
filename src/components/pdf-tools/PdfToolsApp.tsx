"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, FileIcon, InfoIcon, RotateCcwIcon, RotateCwIcon, TrashIcon } from "@/components/icons";
import { UploadZone } from "@/components/UploadZone";
import { buildZip } from "@/engine/batch/zip";
import { sanitizeFileName, splitName } from "@/engine/batch/naming";
import { formatBytes } from "@/engine/registry";
import { runPdfTool } from "@/engine/pdf-tools/client";
import { PDF_TOOL_LIMITS, type PdfInfo, type PdfMeta, type PlanItem, type ToolOutput } from "@/engine/pdf-tools/ops";
import { everyN, flattenUnique, parseRanges } from "@/engine/pdf-tools/ranges";
import { setBusy } from "@/lib/activity";
import { downloadBlob } from "@/lib/download";
import { FileForgeError } from "@/engine/types";
import { PageThumb, usePdfDocument } from "./PageThumb";

type Tool = "merge" | "organize" | "split" | "metadata" | "compress";
const TOOLS: { id: Tool; label: string; hint: string; multi?: boolean; experimental?: boolean }[] = [
  { id: "merge", label: "Merge", hint: "Combine files in the order listed", multi: true },
  { id: "organize", label: "Organize", hint: "Reorder, rotate, delete or extract pages" },
  { id: "split", label: "Split", hint: "Cut one file into several" },
  { id: "metadata", label: "Properties", hint: "Edit title, author, subject, keywords" },
  { id: "compress", label: "Compress", hint: "Lossless size reduction", experimental: true },
];

interface Item {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array | null;
  info?: PdfInfo;
  error?: string;
}
interface PageState {
  index: number;
  rotate: number;
  keep: boolean;
}
interface Outcome {
  outputs: ToolOutput[];
  notes: string[];
  before?: number;
  tool: Tool;
}

let counter = 0;
const newId = () => `p${Date.now().toString(36)}${(counter++).toString(36)}`;
const stemOf = (n: string) => splitName(n).stem;
const errorText = (e: unknown) => (e instanceof FileForgeError ? e.message : e instanceof Error ? e.message : "Something went wrong.");

export function PdfToolsApp() {
  const uid = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [tool, setTool] = useState<Tool>("merge");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const valid = useMemo(() => items.filter((i) => i.bytes && i.info), [items]);
  const selected = valid.find((i) => i.id === selectedId) ?? valid[0] ?? null;
  const multi = TOOLS.find((t) => t.id === tool)!.multi;

  useEffect(() => {
    setBusy("pdf-tools", running);
    return () => setBusy("pdf-tools", false);
  }, [running]);
  useEffect(() => () => abort.current?.abort(), []);

  const addFiles = useCallback((files: File[]) => {
    setOutcome(null);
    setRunError(null);
    const rejected: string[] = [];
    const accepted: { it: Item; file: File }[] = [];
    let total = items.reduce((a, i) => a + i.size, 0);
    let count = items.length;
    for (const f of files) {
      if (!/\.pdf$/i.test(f.name)) rejected.push(`${f.name}: only PDF files can be used here.`);
      else if (f.size > PDF_TOOL_LIMITS.fileBytes) rejected.push(`${f.name}: larger than ${formatBytes(PDF_TOOL_LIMITS.fileBytes)}.`);
      else if (count >= PDF_TOOL_LIMITS.files) rejected.push(`${f.name}: at most ${PDF_TOOL_LIMITS.files} files at a time.`);
      else if (total + f.size > PDF_TOOL_LIMITS.totalBytes) rejected.push(`${f.name}: the files together would exceed ${formatBytes(PDF_TOOL_LIMITS.totalBytes)}.`);
      else {
        accepted.push({ it: { id: newId(), name: f.name, size: f.size, bytes: null }, file: f });
        total += f.size;
        count++;
      }
    }
    setNotice(rejected.length ? rejected.join(" ") : null);
    if (!accepted.length) return;
    setItems((prev) => [...prev, ...accepted.map((a) => a.it)]);
    // Read and check one file at a time to keep memory use predictable.
    accepted.forEach(({ it, file }) => {
      queue.current = queue.current.then(async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const r = await runPdfTool({ kind: "inspect", input: bytes.slice(), name: it.name });
          setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, bytes, info: r.info } : x)));
        } catch (e) {
          setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, error: errorText(e) } : x)));
        }
      });
    });
  }, [items]);

  const remove = (id: string) => {
    setOutcome(null);
    setItems((p) => p.filter((i) => i.id !== id));
  };
  const move = (id: string, dir: -1 | 1) =>
    setItems((p) => {
      const i = p.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const clearAll = () => {
    abort.current?.abort();
    setItems([]);
    setOutcome(null);
    setRunError(null);
    setNotice(null);
  };

  // ---- Organize state
  const [pages, setPages] = useState<PageState[]>([]);
  const [keepText, setKeepText] = useState("");
  const [keepError, setKeepError] = useState<string | null>(null);
  const { doc, failed: thumbsFailed } = usePdfDocument(tool === "organize" && selected ? selected.bytes : null);
  useEffect(() => {
    setPages(selected?.info ? Array.from({ length: selected.info.pageCount }, (_, i) => ({ index: i, rotate: 0, keep: true })) : []);
    setKeepText("");
    setKeepError(null);
  }, [selected?.id, selected?.info]);
  const keptPages = pages.filter((p) => p.keep);
  const rotatePage = (index: number, d: 90 | -90) => setPages((p) => p.map((x) => (x.index === index ? { ...x, rotate: (x.rotate + d + 360) % 360 } : x)));
  const toggleKeep = (index: number) => setPages((p) => p.map((x) => (x.index === index ? { ...x, keep: !x.keep } : x)));
  const movePage = (pos: number, d: -1 | 1) =>
    setPages((p) => {
      const j = pos + d;
      if (j < 0 || j >= p.length) return p;
      const n = [...p];
      [n[pos], n[j]] = [n[j]!, n[pos]!];
      return n;
    });
  const applyKeepText = () => {
    if (!selected?.info) return;
    const r = parseRanges(keepText, selected.info.pageCount);
    if (!r.ok) return setKeepError(r.error ?? "Invalid range.");
    setKeepError(null);
    const set = new Set(flattenUnique(r.groups));
    setPages((p) => p.map((x) => ({ ...x, keep: set.has(x.index) })));
  };

  // ---- Split state
  const [splitMode, setSplitMode] = useState<"ranges" | "every" | "each">("ranges");
  const [splitText, setSplitText] = useState("");
  const [everyCount, setEveryCount] = useState(5);
  const splitGroups = useMemo(() => {
    const n = selected?.info?.pageCount ?? 0;
    if (!n) return { ok: false as const, error: "", groups: [] as number[][] };
    if (splitMode === "each") return { ok: true as const, groups: everyN(n, 1) };
    if (splitMode === "every") return Number.isFinite(everyCount) && everyCount >= 1 ? { ok: true as const, groups: everyN(n, everyCount) } : { ok: false as const, error: "Enter a number of pages of at least 1.", groups: [] };
    if (!splitText.trim()) return { ok: false as const, error: "", groups: [] };
    const r = parseRanges(splitText, n);
    return r.ok ? { ok: true as const, groups: r.groups } : { ok: false as const, error: r.error ?? "Invalid range.", groups: [] };
  }, [selected?.info?.pageCount, splitMode, splitText, everyCount]);

  // ---- Metadata state
  const [meta, setMeta] = useState<PdfMeta>({ title: "", author: "", subject: "", keywords: "" });
  const [clearMeta, setClearMeta] = useState(false);
  useEffect(() => {
    if (selected?.info) setMeta({ title: selected.info.title, author: selected.info.author, subject: selected.info.subject, keywords: selected.info.keywords });
    setClearMeta(false);
  }, [selected?.id, selected?.info]);

  // ---- Run
  const ready = (() => {
    if (running) return false;
    if (tool === "merge") return valid.length >= 2;
    if (!selected) return false;
    if (tool === "organize") return keptPages.length > 0;
    if (tool === "split") return splitGroups.ok && splitGroups.groups.length > 0;
    return true;
  })();

  async function run() {
    setOutcome(null);
    setRunError(null);
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    try {
      const plan = (file: number, idx: number[], rot: Record<number, number> = {}): PlanItem[] => idx.map((page) => ({ file, page, rotate: rot[page] ?? 0 }));
      let res;
      let before: number | undefined;
      if (tool === "merge") {
        const files = valid;
        res = await runPdfTool({
          kind: "build",
          inputs: files.map((f) => f.bytes!.slice()),
          names: files.map((f) => f.name),
          plan: files.flatMap((f, fi) => plan(fi, Array.from({ length: f.info!.pageCount }, (_, i) => i))),
          outName: "merged.pdf",
        }, ac.signal);
      } else if (selected) {
        const s = selected;
        const stem = sanitizeFileName(stemOf(s.name), "document");
        const input = s.bytes!.slice();
        if (tool === "organize") {
          const rot = Object.fromEntries(pages.map((p) => [p.index, p.rotate]));
          const allKept = keptPages.length === pages.length && keptPages.every((p, i) => p.index === i) && pages.every((p) => !p.rotate);
          if (allKept) throw new FileForgeError("no-change", "Nothing to change yet. Rotate, reorder or remove a page first.");
          res = await runPdfTool({ kind: "build", inputs: [input], names: [s.name], plan: keptPages.map((p) => ({ file: 0, page: p.index, rotate: rot[p.index] ?? 0 })), outName: `${stem}-edited.pdf` }, ac.signal);
        } else if (tool === "split") {
          const groups = splitGroups.groups;
          const names = groups.map((g, i) => (splitMode === "ranges" ? `${stem}-pages-${g[0]! + 1}${g.length > 1 ? `-${g[g.length - 1]! + 1}` : ""}.pdf` : `${stem}-part-${i + 1}-of-${groups.length}.pdf`));
          res = await runPdfTool({ kind: "split", input, name: s.name, groups: groups.map((g) => plan(0, g)), outNames: names }, ac.signal);
        } else if (tool === "metadata") {
          res = await runPdfTool({ kind: "metadata", input, name: s.name, meta, clearAll: clearMeta, outName: `${stem}-edited.pdf` }, ac.signal);
        } else {
          before = s.size;
          res = await runPdfTool({ kind: "compress", input, name: s.name, outName: `${stem}-compressed.pdf` }, ac.signal);
        }
      }
      if (res) setOutcome({ outputs: res.outputs, notes: res.notes, before, tool });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setRunError("Cancelled. No file was produced.");
      else setRunError(errorText(e));
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  const blobOf = (o: ToolOutput) => new Blob([o.bytes as BlobPart], { type: "application/pdf" });
  async function downloadAll() {
    if (!outcome) return;
    setZipping(true);
    try {
      const zip = await buildZip(outcome.outputs.map((o) => ({ name: o.name, blob: blobOf(o) })));
      downloadBlob(zip, `${sanitizeFileName(stemOf(selected?.name ?? "pdf-tools"), "pdf-tools")}-split.zip`);
    } catch (e) {
      setRunError(`The ZIP could not be built (${errorText(e)}). Download the files one by one instead.`);
    } finally {
      setZipping(false);
    }
  }

  const compressStats = outcome?.tool === "compress" && outcome.before !== undefined ? { before: outcome.before, after: outcome.outputs[0]!.bytes.length } : null;

  return (
    <div className="space-y-5" data-testid="pdf-tools">
      <div className="card space-y-4 p-4 sm:p-5">
        <div role="radiogroup" aria-label="Tool" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={tool === t.id}
              className="choice min-h-12 flex-col !items-start gap-0 !px-3 !py-2"
              onClick={() => {
                setTool(t.id);
                setOutcome(null);
                setRunError(null);
              }}
              data-testid={`tool-${t.id}`}
            >
              <span className="text-sm font-semibold">
                {t.label}
                {t.experimental && <span className="ml-1.5 badge badge-warn align-middle">Experimental</span>}
              </span>
              <span className="text-xs text-muted">{t.hint}</span>
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <UploadZone onFiles={addFiles} accept=".pdf,application/pdf" mode="pdf" />
        ) : (
          <div className="space-y-3">
            <ul className="space-y-2" aria-label={`${items.length} PDF files`} data-testid="pdf-file-list">
              {items.map((it, i) => (
                <li key={it.id} className={`flex items-center gap-3 rounded-xl border p-2.5 ${it.error ? "border-danger/50 bg-danger/10" : !multi && selected?.id === it.id ? "border-accent bg-accent/10" : "border-line bg-surface-2"}`} data-testid="pdf-file-row">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-accent-text">
                    <FileIcon size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{it.name}</p>
                    <p className={`text-xs ${it.error ? "text-danger" : "text-muted"}`} role={it.error ? "alert" : undefined}>
                      {it.error ?? (it.info ? `${it.info.pageCount} page${it.info.pageCount === 1 ? "" : "s"} · ${formatBytes(it.size)}` : `Checking… ${formatBytes(it.size)}`)}
                    </p>
                  </div>
                  {!multi && it.info && items.length > 1 && (
                    <button type="button" className={`btn btn-sm ${selected?.id === it.id ? "btn-secondary" : "btn-ghost"}`} aria-pressed={selected?.id === it.id} onClick={() => setSelectedId(it.id)}>
                      {selected?.id === it.id ? "Selected" : "Use this"}
                    </button>
                  )}
                  {multi && items.length > 1 && (
                    <>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${it.name} up`} disabled={i === 0} onClick={() => move(it.id, -1)}>
                        <ArrowUpIcon size={16} />
                      </button>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${it.name} down`} disabled={i === items.length - 1} onClick={() => move(it.id, 1)}>
                        <ArrowDownIcon size={16} />
                      </button>
                    </>
                  )}
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${it.name}`} onClick={() => remove(it.id)}>
                    <TrashIcon size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <label className="btn btn-secondary btn-sm cursor-pointer">
                Add PDFs
                <input type="file" accept=".pdf,application/pdf" multiple className="sr-only" data-testid="pdf-add-input" onChange={(e) => (addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
              </label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll} data-testid="pdf-clear">
                Clear all
              </button>
            </div>
          </div>
        )}
        {notice && (
          <p role="status" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="pdf-notice">
            <AlertIcon size={16} className="mt-0.5 shrink-0" />
            {notice}
          </p>
        )}
      </div>

      {items.length > 0 && (
        <section className="card space-y-4 p-4 sm:p-5" aria-label={`${TOOLS.find((t) => t.id === tool)!.label} options`} data-testid="tool-panel">
          {tool === "merge" && (
            <p className="text-sm text-muted">{valid.length >= 2 ? `${valid.reduce((a, f) => a + f.info!.pageCount, 0)} pages from ${valid.length} files, in the order listed above. Use the arrows to reorder.` : "Add at least two PDFs to merge."}</p>
          )}

          {tool === "organize" && selected?.info && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1">
                  <label htmlFor={`${uid}-keep`} className="mb-1 block text-xs font-semibold text-muted">
                    Keep only these pages (extract)
                  </label>
                  <div className="flex gap-2">
                    <input id={`${uid}-keep`} className="field" placeholder="e.g. 1-3, 5, 8-" value={keepText} onChange={(e) => setKeepText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyKeepText()} aria-invalid={!!keepError} aria-describedby={keepError ? `${uid}-keep-err` : undefined} data-testid="keep-ranges" />
                    <button type="button" className="btn btn-secondary" onClick={applyKeepText} data-testid="keep-apply">
                      Apply
                    </button>
                  </div>
                  {keepError && (
                    <p id={`${uid}-keep-err`} role="alert" className="mt-1 text-xs text-danger">
                      {keepError}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPages((p) => p.map((x) => ({ ...x, keep: true })))}>
                    Keep all
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPages((p) => p.map((x) => ({ ...x, rotate: 0 })))}>
                    Reset rotation
                  </button>
                </div>
              </div>
              <p role="status" className="text-sm text-muted" data-testid="organize-summary">
                {keptPages.length} of {pages.length} pages kept{pages.some((p) => p.rotate) ? ` · ${pages.filter((p) => p.rotate && p.keep).length} rotated` : ""}.
              </p>
              {thumbsFailed && <p className="text-xs text-muted">Thumbnails could not be drawn for this file; the page numbers and controls still work.</p>}
              <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" aria-label="Pages" data-testid="page-grid">
                {pages.map((p, pos) => (
                  <li key={p.index} className={`min-w-0 space-y-1.5 rounded-xl border p-2 ${p.keep ? "border-line bg-surface-2" : "border-line bg-surface opacity-55"}`} data-testid="page-card" data-page={p.index + 1}>
                    <PageThumb doc={doc} pageIndex={p.index} rotate={p.rotate} label={`Page ${p.index + 1}${p.rotate ? `, rotated ${p.rotate} degrees` : ""}`} />
                    <div className="space-y-1">
                      <label className="flex min-h-9 cursor-pointer items-center gap-1.5 text-xs font-semibold">
                        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={p.keep} onChange={() => toggleKeep(p.index)} data-testid="page-keep" />
                        <span>
                          <span className="sr-only">Keep page </span>
                          {p.index + 1}
                        </span>
                      </label>
                      <div className="flex flex-wrap justify-between">
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move page ${p.index + 1} earlier`} disabled={pos === 0} onClick={() => movePage(pos, -1)} data-testid="page-left">
                          <ChevronLeftIcon size={16} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move page ${p.index + 1} later`} disabled={pos === pages.length - 1} onClick={() => movePage(pos, 1)} data-testid="page-right">
                          <ChevronRightIcon size={16} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Rotate page ${p.index + 1} counter-clockwise`} onClick={() => rotatePage(p.index, -90)}>
                          <RotateCcwIcon size={16} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Rotate page ${p.index + 1} clockwise`} onClick={() => rotatePage(p.index, 90)} data-testid="page-rotate-cw">
                          <RotateCwIcon size={16} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {tool === "split" && selected?.info && (
            <div className="space-y-3">
              <div role="radiogroup" aria-label="Split by" className="grid gap-2 sm:grid-cols-3">
                {([["ranges", "Page ranges"], ["every", "Every N pages"], ["each", "Every page"]] as const).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={splitMode === id} className="choice min-h-10 justify-center text-sm font-medium" onClick={() => setSplitMode(id)} data-testid={`split-mode-${id}`}>
                    {label}
                  </button>
                ))}
              </div>
              {splitMode === "ranges" && (
                <div>
                  <label htmlFor={`${uid}-split`} className="mb-1 block text-xs font-semibold text-muted">
                    Ranges, one file each, separated by commas
                  </label>
                  <input id={`${uid}-split`} className="field" placeholder="e.g. 1-3, 4-6, 7-" value={splitText} onChange={(e) => setSplitText(e.target.value)} aria-invalid={!splitGroups.ok && !!splitGroups.error} aria-describedby={`${uid}-split-msg`} data-testid="split-ranges" />
                </div>
              )}
              {splitMode === "every" && (
                <div>
                  <label htmlFor={`${uid}-every`} className="mb-1 block text-xs font-semibold text-muted">
                    Pages per file
                  </label>
                  <input id={`${uid}-every`} type="number" min={1} className="field max-w-32" value={Number.isFinite(everyCount) ? everyCount : ""} onChange={(e) => setEveryCount(e.target.value === "" ? NaN : Number(e.target.value))} aria-describedby={`${uid}-split-msg`} data-testid="split-count" />
                </div>
              )}
              <p id={`${uid}-split-msg`} role={splitGroups.ok ? "status" : "alert"} className={`text-sm ${splitGroups.ok ? "text-muted" : "text-danger"}`} data-testid="split-summary">
                {splitGroups.ok ? `${splitGroups.groups.length} file${splitGroups.groups.length === 1 ? "" : "s"} will be created.` : splitGroups.error}
              </p>
            </div>
          )}

          {tool === "metadata" && selected?.info && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {(["title", "author", "subject", "keywords"] as const).map((k) => (
                  <div key={k}>
                    <label htmlFor={`${uid}-${k}`} className="mb-1 block text-xs font-semibold capitalize text-muted">
                      {k}
                    </label>
                    <input id={`${uid}-${k}`} className="field" value={meta[k]} disabled={clearMeta} maxLength={500} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} data-testid={`meta-${k}`} />
                  </div>
                ))}
              </div>
              <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={clearMeta} onChange={(e) => setClearMeta(e.target.checked)} data-testid="meta-clear" />
                Remove title, author, subject and keywords instead
              </label>
            </div>
          )}

          {tool === "compress" && selected?.info && (
            <p className="flex items-start gap-2 text-sm text-muted">
              <InfoIcon size={16} className="mt-0.5 shrink-0" />
              Experimental. Repacks the file structure without changing images or fonts, so text PDFs made by word processors often shrink a little and scanned or photo PDFs usually do not. If the result is not smaller, you get your original back.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => void run()} data-testid="run-tool">
              {running ? "Working…" : tool === "merge" ? "Merge PDFs" : tool === "organize" ? "Create PDF" : tool === "split" ? "Split PDF" : tool === "metadata" ? "Save properties" : "Compress PDF"}
            </button>
            {running && (
              <button type="button" className="btn btn-secondary" onClick={() => abort.current?.abort()} data-testid="cancel-tool">
                Cancel
              </button>
            )}
            {running && (
              <span className="flex items-center gap-2 text-sm text-muted" role="status">
                <span className="spinner" aria-hidden="true" /> Processing on your device…
              </span>
            )}
          </div>
          {runError && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm" data-testid="tool-error">
              <AlertIcon size={16} className="mt-0.5 shrink-0" />
              {runError}
            </p>
          )}
        </section>
      )}

      {outcome && (
        <section className="card enter space-y-3 p-4 sm:p-5" aria-labelledby={`${uid}-res`} data-testid="tool-result">
          <h2 id={`${uid}-res`} className="flex items-center gap-2 text-lg font-bold">
            <CheckIcon size={20} className="text-success" /> {outcome.outputs.length === 1 ? "Your PDF is ready" : `${outcome.outputs.length} PDFs are ready`}
          </h2>
          <p className="text-xs text-muted">Each result was opened again and its page count checked before it was offered.</p>
          {compressStats && (
            <p className="text-sm" data-testid="compress-stats">
              Before {formatBytes(compressStats.before)} · After {formatBytes(compressStats.after)}
              {compressStats.after < compressStats.before ? ` (${Math.round((1 - compressStats.after / compressStats.before) * 100)}% smaller)` : " (unchanged)"}
            </p>
          )}
          {outcome.notes.map((n) => (
            <p key={n} className="flex items-start gap-2 text-sm text-muted">
              <InfoIcon size={16} className="mt-0.5 shrink-0" />
              {n}
            </p>
          ))}
          <ul className="space-y-2">
            {outcome.outputs.map((o, i) => (
              <li key={o.name + i} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-2.5" data-testid="result-file">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{o.name}</p>
                  <p className="text-xs text-muted">
                    {o.pages} page{o.pages === 1 ? "" : "s"} · {formatBytes(o.bytes.length)}
                  </p>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => downloadBlob(blobOf(o), o.name)} data-testid={`download-${i}`}>
                  <DownloadIcon size={16} /> Download
                </button>
              </li>
            ))}
          </ul>
          {outcome.outputs.length > 1 && (
            <button type="button" className="btn btn-secondary" disabled={zipping} onClick={() => void downloadAll()} data-testid="download-zip">
              {zipping ? "Building ZIP…" : "Download all as ZIP"}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
