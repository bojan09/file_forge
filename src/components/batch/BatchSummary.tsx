"use client";

import { useState } from "react";
import { buildZip, type ZipEntry, type ZipProgress } from "@/engine/batch/zip";
import { zipFileName } from "@/engine/batch/naming";
import { summarize } from "@/engine/batch/queue";
import type { BatchSnapshot } from "@/engine/batch/types";
import { formatBytes } from "@/engine/registry";
import { useBatchContext } from "@/lib/batch";
import { downloadBlob } from "@/lib/download";
import { AlertIcon, ArchiveIcon, CheckIcon, PauseIcon, PlayIcon, RefreshIcon, StopIcon } from "../icons";

type ZipState = { phase: "idle" } | { phase: "building"; progress: ZipProgress } | { phase: "error"; message: string } | { phase: "done"; name: string };

export function BatchSummary({ snap }: { snap: BatchSnapshot }) {
  const { queue } = useBatchContext();
  const s = summarize(snap);
  const [zipName, setZipName] = useState("fileforge-converted");
  const [originals, setOriginals] = useState(false);
  const [zip, setZip] = useState<ZipState>({ phase: "idle" });

  const settled = s.done + s.failed + s.cancelled;
  const toProcess = s.total - s.blocked;
  const pct = toProcess > 0 ? Math.min(100, Math.round((settled / toProcess) * 100)) : 0;
  const runnable = queue.hasRunnable();
  const running = snap.run === "running" || snap.run === "pausing";
  const finished = snap.run === "finished";

  const makeZip = async () => {
    const entries: ZipEntry[] = snap.items.filter((i) => i.output).map((i) => ({ name: i.output!.filename, blob: i.output!.blob }));
    if (originals) for (const i of snap.items) if (i.output) entries.push({ name: i.name, blob: i.file, folder: "originals" });
    if (!entries.length) return;
    setZip({ phase: "building", progress: { read: 0, total: entries.length, phase: "reading" } });
    try {
      const blob = await buildZip(entries, (progress) => setZip({ phase: "building", progress }));
      const name = zipFileName(zipName);
      downloadBlob(blob, name);
      setZip({ phase: "done", name });
    } catch (e) {
      setZip({ phase: "error", message: e instanceof Error ? e.message : "The archive could not be created." });
    }
  };

  return (
    <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="sum-title" data-testid="batch-summary">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="sum-title" className="text-base font-bold">
          Conversion summary
        </h2>
        <span className="text-xs text-muted" data-testid="sum-limits">
          {s.total}/{snap.limits.maxFiles} files • {formatBytes(s.inputBytes)} of {Math.round(snap.limits.maxTotalBytes / 1048576)} MB
        </span>
      </div>

      <dl className="grid grid-cols-4 gap-2 text-center" data-testid="sum-counts">
        {[
          ["Waiting", s.queued + s.converting, ""],
          ["Done", s.done, "text-success"],
          ["Failed", s.failed, s.failed ? "text-danger" : ""],
          ["Skipped", s.blocked + s.cancelled, s.blocked + s.cancelled ? "text-warning" : ""],
        ].map(([label, n, tone]) => (
          <div key={label as string} className="card-flat px-1 py-2">
            <dd className={`text-lg font-extrabold ${tone}`} data-testid={`count-${(label as string).toLowerCase()}`}>{n}</dd>
            <dt className="text-[0.7rem] text-muted">{label}</dt>
          </div>
        ))}
      </dl>

      <div>
        <div className="determinate" role="progressbar" aria-label="Files finished" aria-valuemin={0} aria-valuemax={toProcess} aria-valuenow={settled}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted" data-testid="sum-progress">
          {settled} of {toProcess} file{toProcess === 1 ? "" : "s"} finished{s.blocked ? `, ${s.blocked} skipped (can't produce the selected format)` : ""}
        </p>
      </div>

      {finished && s.total > 0 && (
        <div className={`enter flex items-start gap-3 rounded-xl border p-3 text-sm ${s.failed ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10"}`} role="status" data-testid="batch-complete">
          <span className="pop mt-0.5">{s.failed || s.cancelled ? <AlertIcon size={20} className="text-warning" /> : <CheckIcon size={20} className="text-success" />}</span>
          <p>
            <strong>{s.failed || s.cancelled ? "Batch finished with issues." : "All files converted."}</strong> {s.done} converted
            {s.failed ? `, ${s.failed} failed (use Retry on each file)` : ""}
            {s.cancelled ? `, ${s.cancelled} cancelled` : ""}.
          </p>
        </div>
      )}

      <div className="grid gap-2">
        {snap.run === "paused" ? (
          <button type="button" className="btn btn-primary" onClick={() => queue.resume()} data-testid="resume-batch">
            <PlayIcon size={17} /> Resume
          </button>
        ) : snap.run === "pausing" ? (
          <button type="button" className="btn btn-secondary" onClick={() => queue.resume()} data-testid="resume-batch">
            <PlayIcon size={17} /> Pausing after this file. Keep going
          </button>
        ) : snap.run === "running" ? (
          <button type="button" className="btn btn-secondary" onClick={() => queue.pause()} data-testid="pause-batch">
            <PauseIcon size={17} /> Pause after current file
          </button>
        ) : runnable || !(s.done || s.failed) ? (
          <button type="button" className="btn btn-primary" disabled={!runnable} onClick={() => queue.start()} data-testid="start-batch">
            <PlayIcon size={17} /> {s.done || s.failed ? "Convert remaining files" : `Start conversion (${s.queued} file${s.queued === 1 ? "" : "s"})`}
          </button>
        ) : null}
        {(running || snap.run === "paused") && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => queue.cancelAll()} data-testid="cancel-batch">
            <StopIcon size={15} /> Cancel remaining files
          </button>
        )}
        {s.failed > 0 && !running && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => queue.retryFailed()} data-testid="retry-failed">
            <RefreshIcon size={15} /> Retry {s.failed} failed file{s.failed > 1 ? "s" : ""}
          </button>
        )}
        {s.cancelled > 0 && !running && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => queue.requeueCancelled()}>
            <RefreshIcon size={15} /> Re-queue {s.cancelled} cancelled
          </button>
        )}
        {!runnable && !running && s.queued > 0 && s.blocked === s.queued && <p className="text-xs text-warning">No waiting file can produce the selected format.</p>}
      </div>

      {s.done > 0 && (
        <div className="space-y-3 border-t border-line pt-4" data-testid="zip-panel">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <ArchiveIcon size={16} /> Download
          </h3>
          <div className="space-y-1">
            <label htmlFor="zip-name" className="block text-xs font-semibold text-muted">Archive name</label>
            <div className="flex items-center gap-2">
              <input id="zip-name" className="field" value={zipName} maxLength={60} onChange={(e) => setZipName(e.target.value)} data-testid="zip-name" />
              <span className="text-sm text-muted">.zip</span>
            </div>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={originals} onChange={(e) => setOriginals(e.target.checked)} data-testid="zip-originals" />
            Include the original files (in an &quot;originals&quot; folder)
          </label>
          <button type="button" className="btn btn-primary w-full" onClick={makeZip} disabled={zip.phase === "building"} data-testid="download-zip">
            <ArchiveIcon size={17} /> Download all ({s.done}) as ZIP
          </button>
          <div role="status" aria-live="polite" data-testid="zip-status" className="text-xs">
            {zip.phase === "building" && (
              <div className="space-y-1.5">
                <div className="indeterminate" />
                <p className="text-muted">{zip.progress.phase === "reading" ? `Adding file ${zip.progress.read} of ${zip.progress.total}…` : `Compressing ${zip.progress.total} file${zip.progress.total > 1 ? "s" : ""}…`}</p>
              </div>
            )}
            {zip.phase === "done" && <p className="text-success">Downloaded {zip.name}.</p>}
            {zip.phase === "error" && (
              <p className="rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-danger" data-testid="zip-error">
                Couldn&apos;t create the ZIP: {zip.message} Your converted files are still available. Use Download on each file.
              </p>
            )}
          </div>
          <p className="text-xs text-muted">Files stay in this browser tab until you remove them or close it. Nothing is uploaded.</p>
        </div>
      )}
    </section>
  );
}
