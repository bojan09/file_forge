"use client";

import { useState } from "react";
import { formatBytes, getFormat } from "@/engine/registry";
import { effectiveOutput, eligibility } from "@/engine/batch/queue";
import type { QueueItem, SharedSettings } from "@/engine/batch/types";
import type { Stage } from "@/engine/types";
import { useBatchContext } from "@/lib/batch";
import { downloadBlob } from "@/lib/download";
import { reducedMotion } from "@/lib/motion";
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon, DownloadIcon, GripIcon, InfoIcon, RefreshIcon, SlidersIcon, StopIcon } from "../icons";
import { FileTypeIcon } from "../FileTypeIcon";
import { ItemSettings } from "./ItemSettings";

const STAGES: { id: Stage; label: string }[] = [
  { id: "reading", label: "Reading" },
  { id: "rendering", label: "Building" },
  { id: "verifying", label: "Verifying" },
];

function StatusBadge({ item, shared }: { item: QueueItem; shared: SharedSettings }) {
  const el = eligibility(item, shared);
  if (item.status === "rejected") return <span className="badge badge-danger">Not accepted</span>;
  if (item.status === "converting")
    return (
      <span className="badge badge-info" data-testid="status-badge">
        <span className="spinner" aria-hidden="true" /> {STAGES.find((s) => s.id === item.stage)?.label ?? "Working"}…
      </span>
    );
  if (item.status === "done")
    return (
      <span className="badge badge-success" data-testid="status-badge">
        <CheckIcon size={12} /> Done
      </span>
    );
  if (item.status === "failed")
    return (
      <span className="badge badge-danger" data-testid="status-badge">
        <AlertIcon size={12} /> Failed
      </span>
    );
  if (item.status === "cancelled") return <span className="badge badge-warn">Cancelled</span>;
  if (!el.ok) return <span className="badge badge-warn">Can&apos;t convert</span>;
  return <span className="badge" data-testid="status-badge">Waiting</span>;
}

export interface RowProps {
  item: QueueItem;
  index: number;
  total: number;
  shared: SharedSettings;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
}

export function QueueRow({ item, index, total, shared, dragging, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd }: RowProps) {
  const { queue } = useBatchContext();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const el = eligibility(item, shared);
  const out = effectiveOutput(item, shared);
  const busy = item.status === "converting";
  const label = item.kind ? getFormat(item.kind).label : "Unsupported";
  const panelId = `panel-${item.id}`;

  const remove = () => {
    if (reducedMotion()) return queue.remove(item.id);
    setLeaving(true);
    setTimeout(() => queue.remove(item.id), 180);
  };

  const canReorder = item.status !== "rejected";
  return (
    <li
      data-flip-id={item.id}
      data-testid="queue-row"
      data-status={item.status}
      data-name={item.name}
      data-dragging={dragging}
      data-drop-target={dropTarget}
      draggable={canReorder && !busy}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-fileforge-item", item.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(item.id);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("application/x-fileforge-item")) return;
        e.preventDefault();
        onDragOver(item.id);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("application/x-fileforge-item")) return;
        e.preventDefault();
        e.stopPropagation();
        onDrop(item.id);
      }}
      onDragEnd={onDragEnd}
      className={`qrow enter ${leaving ? "leave" : ""}`}
    >
      <div className="flex items-start gap-3 p-3">
        <span className="mt-2 hidden cursor-grab text-muted sm:block" aria-hidden="true" title="Drag to reorder">
          <GripIcon size={18} />
        </span>
        <FileTypeIcon ext={item.extension || item.name.split(".").pop() || ""} size={30} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={item.name} data-testid="row-name">
            {item.name}
          </p>
          <p className="text-xs text-muted">
            {label} • {formatBytes(item.sizeBytes)}
            {item.status !== "rejected" && el.ok ? ` • to ${out.toUpperCase()}` : ""}
            {item.status === "done" && item.output ? ` • ${formatBytes(item.output.sizeBytes)}${item.output.pageCount ? `, ${item.output.pageCount} page${item.output.pageCount === 1 ? "" : "s"}` : ""}` : ""}
          </p>
          {item.status === "rejected" && <p className="mt-1 text-xs text-danger" data-testid="row-reason">{item.rejectReason}</p>}
          {item.status === "queued" && !el.ok && <p className="mt-1 text-xs text-warning" data-testid="row-reason">{(el as { reason: string }).reason}</p>}
          {item.status === "failed" && <p className="mt-1 text-xs text-danger" data-testid="row-error">{item.error}</p>}
          {item.status === "done" && item.output && <p className="mt-1 truncate text-xs text-success" data-testid="row-output" title={item.output.filename}>{item.output.filename}</p>}
        </div>
        <StatusBadge item={item} shared={shared} />
      </div>

      {busy && (
        <div className="px-3 pb-3" data-testid="row-progress">
          <div className="indeterminate" role="progressbar" aria-label={`Converting ${item.name}`} />
          <ol className="mt-2 flex gap-3 text-[0.7rem]">
            {STAGES.map((s, i) => {
              const cur = STAGES.findIndex((x) => x.id === item.stage);
              return (
                <li key={s.id} className={i < cur ? "text-success" : i === cur ? "font-semibold text-accent-text" : "text-muted"} aria-current={i === cur ? "step" : undefined}>
                  {i < cur ? "✓ " : ""}
                  {s.label}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
        {item.status === "done" && item.output && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => downloadBlob(item.output!.blob, item.output!.filename)} aria-label={`Download ${item.output.filename}`} data-testid="row-download">
            <DownloadIcon size={15} /> Download
          </button>
        )}
        {(item.status === "failed" || item.status === "cancelled") && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => queue.retry(item.id)} aria-label={`${item.status === "failed" ? "Retry" : "Re-queue"} ${item.name}`} data-testid="row-retry">
            <RefreshIcon size={15} /> {item.status === "failed" ? "Retry" : "Re-queue"}
          </button>
        )}
        {item.status === "done" && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => queue.retry(item.id)} aria-label={`Convert ${item.name} again`}>
            <RefreshIcon size={15} /> Again
          </button>
        )}
        {(item.status === "converting" || item.status === "queued") && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => queue.cancelItem(item.id)} aria-label={`Cancel ${item.name}`} data-testid="row-cancel">
            <StopIcon size={15} /> Cancel
          </button>
        )}
        {item.status !== "rejected" && (
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)} data-testid="row-expand">
            <SlidersIcon size={15} /> {item.status === "done" || item.status === "failed" ? "Details" : "Settings"}
          </button>
        )}
        <span className="ml-auto flex items-center gap-1">
          {canReorder && (
            <>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => queue.move(item.id, -1)} disabled={index === 0} aria-label={`Move ${item.name} up`} data-testid="row-up">
                <ArrowUpIcon size={16} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => queue.move(item.id, 1)} disabled={index === total - 1} aria-label={`Move ${item.name} down`} data-testid="row-down">
                <ArrowDownIcon size={16} />
              </button>
            </>
          )}
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={remove} aria-label={`Remove ${item.name}`} data-testid="row-remove">
            <CloseIcon size={16} />
          </button>
        </span>
      </div>

      {open && item.status !== "rejected" && (
        <div id={panelId} className="enter space-y-4 border-t border-line p-3 sm:p-4" data-testid="row-panel">
          {item.status === "done" && item.output && (
            <section aria-label="Quality checks" className="space-y-2">
              <h4 className="text-sm font-bold">Quality checks{item.output.fidelity === "approximate" ? " (approximate conversion)" : ""}</h4>
              <ul className="space-y-1.5">
                {item.output.checks.map((c) => (
                  <li key={c.id} className="flex gap-2 text-[0.8rem] leading-snug">
                    {c.passed ? <CheckIcon size={15} className="mt-px shrink-0 text-success" /> : <AlertIcon size={15} className="mt-px shrink-0 text-warning" />}
                    <span>{c.label}</span>
                  </li>
                ))}
                {item.output.warnings.filter((w) => w.code !== "approximate").map((w) => (
                  <li key={w.code + w.message} className="flex gap-2 text-[0.8rem] leading-snug text-muted">
                    <InfoIcon size={15} className="mt-px shrink-0 text-info" />
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Checks inspect file structure, not appearance. Open the file to confirm.</p>
            </section>
          )}
          {item.status === "failed" && <p className="text-sm text-danger">{item.error}</p>}
          {!busy && <ItemSettings item={item} shared={shared} />}
        </div>
      )}
    </li>
  );
}
