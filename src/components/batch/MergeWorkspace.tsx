"use client";

import { useEffect, useRef, useState } from "react";
import { MergeList, type MergeItem, type MergeSettings } from "@/engine/batch/merge";
import { formatBytes } from "@/engine/registry";
import { pageDims } from "@/engine/page";
import { useBatchContext, useMergeList } from "@/lib/batch";
import { downloadBlob } from "@/lib/download";
import { reducedMotion } from "@/lib/motion";
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon, DownloadIcon, ImagesIcon, InfoIcon, PlusIcon, StopIcon, TrashIcon } from "../icons";
import { useFilePicker } from "../UploadZone";
import { Announcer } from "./Announcer";
import { useFlip } from "./useFlip";

const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";

function PageCard({ item, index, total, settings, merge }: { item: MergeItem; index: number; total: number; settings: MergeSettings; merge: MergeList }) {
  const [leaving, setLeaving] = useState(false);
  const f = MergeList.previewFrame(item, settings);
  const d = pageDims({ pageSize: settings.pageSize, margins: settings.margins }, f.orientation);
  const landscape = f.orientation === "landscape";
  const remove = () => {
    if (reducedMotion()) return merge.remove(item.id);
    setLeaving(true);
    setTimeout(() => merge.remove(item.id), 180);
  };
  return (
    <li data-flip-id={item.id} data-testid="page-card" data-name={item.name} className={`qrow enter flex flex-col gap-2 p-2.5 ${leaving ? "leave" : ""}`}>
      <div className="relative grid aspect-[4/5] place-items-center rounded-lg bg-surface-2 p-2">
        <span className="absolute left-2 top-2 z-10 grid size-6 place-items-center rounded-full bg-accent text-xs font-bold text-white shadow" aria-hidden="true">
          {index + 1}
        </span>
        <div className="page-frame" style={{ aspectRatio: String(f.pageAspect), ...(landscape ? { width: "100%" } : { height: "100%" }), maxWidth: "100%", maxHeight: "100%" }} data-testid="page-frame" data-orientation={f.orientation} data-cropped={f.cropped}>
          <div className="content-box" style={{ left: `${(d.margin / d.width) * 100}%`, top: `${(d.margin / d.height) * 100}%`, right: `${(d.margin / d.width) * 100}%`, bottom: `${(d.margin / d.height) * 100}%` }} />
          {item.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbUrl} alt={`Page ${index + 1}: ${item.name}`} className="absolute" style={{ left: `${f.left * 100}%`, top: `${f.top * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%`, objectFit: f.cropped ? "cover" : "fill" }} />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-[0.65rem] text-slate-500">Preview…</span>
          )}
        </div>
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-xs font-semibold" title={item.name}>{item.name}</p>
        <p className="text-[0.7rem] text-muted">
          {item.width}×{item.height} • {formatBytes(item.sizeBytes)}
        </p>
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="flex gap-1">
          <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={index === 0} onClick={() => merge.move(item.id, -1)} aria-label={`Move ${item.name} earlier (currently page ${index + 1})`} data-testid="page-up">
            <ArrowUpIcon size={16} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={index === total - 1} onClick={() => merge.move(item.id, 1)} aria-label={`Move ${item.name} later (currently page ${index + 1})`} data-testid="page-down">
            <ArrowDownIcon size={16} />
          </button>
        </span>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={remove} aria-label={`Remove ${item.name}`} data-testid="page-remove">
          <CloseIcon size={16} />
        </button>
      </div>
    </li>
  );
}

export function MergeWorkspace() {
  const { merge, setMode } = useBatchContext();
  const { snap } = useMergeList();
  const { inputRef: pickInput, pick: pickFiles, onChange: onPickChange } = useFilePicker((files) => void merge.addFiles(files), { accept: IMAGE_ACCEPT });
  const list = useRef<HTMLOListElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dropping, setDropping] = useState(false);
  const depth = useRef(0);
  useFlip(list);
  useEffect(() => title.current?.focus(), []);
  const { settings: st, items, phase } = snap;
  const busy = phase === "preparing" || phase === "rendering" || phase === "verifying";
  const set = (p: Partial<MergeSettings>) => merge.setSettings(p);
  const isFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const total = items.reduce((n, i) => n + i.sizeBytes, 0);

  return (
    <div className="enter space-y-4" data-testid="merge-workspace">
      <Announcer message={snap.announcement} seq={snap.announceSeq} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 ref={title} tabIndex={-1} className="text-2xl font-extrabold tracking-tight outline-none sm:text-3xl">
            Merge images into one PDF
          </h1>
          <p className="text-sm text-muted">One image per page, in the order shown. The PDF contains pictures only (no OCR, text isn&apos;t searchable).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => pickFiles()} disabled={busy} data-testid="merge-add">
            <PlusIcon size={16} /> Add images
          </button>
          <input ref={pickInput} type="file" multiple accept={IMAGE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPickChange} data-testid="merge-input" />
          {!confirmClear ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)} data-testid="merge-clear">
              <TrashIcon size={15} /> Clear
            </button>
          ) : (
            <div role="alertdialog" aria-label="Confirm clearing images" className="enter flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-1.5 text-sm" data-testid="merge-clear-confirm">
              <span>Remove all {items.length} images?</span>
              <button type="button" className="btn btn-sm btn-secondary" autoFocus onClick={() => (merge.clear(), setConfirmClear(false), setMode("convert"))} data-testid="merge-clear-yes">
                Yes, clear
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmClear(false)}>
                Keep
              </button>
            </div>
          )}
        </div>
      </div>

      {snap.notices.length > 0 && (
        <div role="status" className="enter space-y-1.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="merge-notices">
          {snap.notices.map((n, i) => (
            <p key={i} className="flex gap-2">
              <AlertIcon size={17} className="mt-0.5 shrink-0 text-warning" /> {n}
            </p>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => merge.dismissNotices()}>
            <CloseIcon size={14} /> Dismiss
          </button>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section className="card space-y-4 p-4 sm:p-5 lg:col-start-2 lg:row-start-1" aria-labelledby="mg-gen" data-testid="merge-generate">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="mg-gen" className="text-base font-bold">Create PDF</h2>
            <span className="text-xs text-muted">{items.length}/{snap.limits.maxFiles} images • {formatBytes(total)}</span>
          </div>

          {busy ? (
            <div className="space-y-3" data-testid="merge-progress">
              <div className="indeterminate" role="progressbar" aria-label="Creating PDF" />
              <ol className="space-y-1.5 text-sm">
                <li className={phase === "preparing" ? "font-semibold text-accent-text" : "text-success"} aria-current={phase === "preparing" ? "step" : undefined}>
                  {phase === "preparing" ? `Preparing image ${Math.min(snap.prepared + 1, items.length)} of ${items.length}…` : `✓ Prepared ${items.length} images`}
                </li>
                <li className={phase === "rendering" ? "font-semibold text-accent-text" : phase === "verifying" ? "text-success" : "text-muted"}>{phase === "verifying" ? "✓ Built the PDF" : "Building the PDF"}</li>
                <li className={phase === "verifying" ? "font-semibold text-accent-text" : "text-muted"}>Verifying output</li>
              </ol>
              <button type="button" className="btn btn-secondary w-full" onClick={() => merge.cancel()} data-testid="merge-cancel">
                <StopIcon size={16} /> Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary w-full" disabled={!items.length} onClick={() => void merge.generate()} data-testid="merge-create">
              <ImagesIcon size={18} /> Create PDF ({items.length} page{items.length === 1 ? "" : "s"})
            </button>
          )}

          {phase === "error" && snap.error && (
            <p role="alert" className="flex gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm" data-testid="merge-error">
              <AlertIcon size={18} className="mt-0.5 shrink-0 text-danger" /> {snap.error}
            </p>
          )}

          {phase === "done" && snap.result && (
            <div className="enter space-y-3 rounded-xl border border-success/40 bg-success/10 p-3" data-testid="merge-result">
              <p className="flex items-start gap-2 text-sm">
                <span className="pop mt-0.5"><CheckIcon size={18} className="text-success" /></span>
                <span>
                  <strong data-testid="merge-result-name">{snap.result.filename}</strong>
                  <br />
                  <span className="text-xs text-muted">{snap.result.pageCount} pages • {formatBytes(snap.result.sizeBytes)}</span>
                </span>
              </p>
              <button type="button" className="btn btn-primary w-full" onClick={() => downloadBlob(snap.result!.blob, snap.result!.filename)} data-testid="merge-download">
                <DownloadIcon size={17} /> Download PDF
              </button>
              <ul className="space-y-1.5" data-testid="merge-checks">
                {snap.result.checks.map((c) => (
                  <li key={c.id} className="flex gap-2 text-[0.8rem] leading-snug">
                    {c.passed ? <CheckIcon size={15} className="mt-px shrink-0 text-success" /> : <AlertIcon size={15} className="mt-px shrink-0 text-warning" />}
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Checks inspect file structure, not appearance. Open the PDF to confirm.</p>
            </div>
          )}
        </section>

        <section
          aria-label="Pages"
          className="queue-drop min-w-0 space-y-3 rounded-2xl border border-dashed border-transparent lg:col-start-1 lg:row-span-2 lg:row-start-1"
          data-dragging={dropping}
          onDragEnter={(e) => {
            if (!isFiles(e)) return;
            e.preventDefault();
            depth.current++;
            setDropping(true);
          }}
          onDragOver={(e) => isFiles(e) && e.preventDefault()}
          onDragLeave={() => {
            depth.current = Math.max(0, depth.current - 1);
            if (!depth.current) setDropping(false);
          }}
          onDrop={(e) => {
            if (!isFiles(e)) return;
            e.preventDefault();
            depth.current = 0;
            setDropping(false);
            void merge.addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <p className="flex items-center gap-2 text-xs text-muted">
            <InfoIcon size={14} /> Each frame shows how its image will sit on the page. The dashed box is the margin area.
          </p>
          <ol ref={list} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4" data-testid="page-grid" aria-label={`${items.length} pages in order`}>
            {items.map((item, i) => (
              <PageCard key={item.id} item={item} index={i} total={items.length} settings={st} merge={merge} />
            ))}
          </ol>
          <button type="button" className="flex w-full min-h-14 items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-fg" onClick={() => pickFiles()} disabled={busy}>
            <PlusIcon size={16} /> Add more images or drop them here
          </button>
        </section>

        <section className="card space-y-4 p-4 sm:p-5 lg:col-start-2 lg:row-start-2" aria-labelledby="mg-set" data-testid="merge-settings">
          <h2 id="mg-set" className="text-base font-bold">PDF settings</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="mg-size" className="block text-xs font-semibold text-muted">Page size</label>
              <select id="mg-size" className="field" value={st.pageSize} onChange={(e) => set({ pageSize: e.target.value as MergeSettings["pageSize"] })}>
                <option value="A4">A4</option>
                <option value="LETTER">Letter</option>
                <option value="LEGAL">Legal</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="mg-margins" className="block text-xs font-semibold text-muted">Margins</label>
              <select id="mg-margins" className="field" value={st.margins} onChange={(e) => set({ margins: e.target.value as MergeSettings["margins"] })}>
                <option value="narrow">Narrow</option>
                <option value="normal">Normal</option>
                <option value="wide">Wide</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="mg-orient" className="block text-xs font-semibold text-muted">Orientation</label>
            <select id="mg-orient" className="field" value={st.orientation} onChange={(e) => set({ orientation: e.target.value as MergeSettings["orientation"] })}>
              <option value="auto">Auto (each page matches its image)</option>
              <option value="portrait">Portrait for every page</option>
              <option value="landscape">Landscape for every page</option>
            </select>
          </div>
          <div className="space-y-2">
            <p id="mg-fit" className="text-xs font-semibold text-muted">Image placement</p>
            <div role="radiogroup" aria-labelledby="mg-fit" className="grid gap-2">
              <button type="button" role="radio" aria-checked={st.fit === "fit"} className="choice !min-h-12" onClick={() => set({ fit: "fit" })} data-testid="fit-fit">
                <span>
                  <span className="block text-sm font-bold">Fit within margins</span>
                  <span className="block text-[0.7rem] text-muted">Whole image visible, proportions kept, never cropped</span>
                </span>
              </button>
              <button type="button" role="radio" aria-checked={st.fit === "fill"} className="choice !min-h-12" onClick={() => set({ fit: "fill" })} data-testid="fit-fill">
                <span>
                  <span className="block text-sm font-bold">Fill the page area (crops)</span>
                  <span className="block text-[0.7rem] text-muted">Edges that don&apos;t fit are cropped. Choose only if that&apos;s what you want</span>
                </span>
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="mg-quality" className="block text-xs font-semibold text-muted">Image quality</label>
            <select id="mg-quality" className="field" value={st.quality} onChange={(e) => set({ quality: e.target.value as MergeSettings["quality"] })}>
              <option value="high">High (original pixels)</option>
              <option value="balanced">Balanced</option>
              <option value="small">Small file</option>
            </select>
            <p className="pt-1 text-xs text-muted">Transparent areas appear on white.</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="mg-name" className="block text-xs font-semibold text-muted">File name</label>
            <div className="flex items-center gap-2">
              <input id="mg-name" className="field" value={st.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} data-testid="merge-name" />
              <span className="text-sm text-muted">.pdf</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
