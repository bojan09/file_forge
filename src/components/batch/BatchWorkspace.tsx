"use client";

import { useEffect, useRef, useState } from "react";
import { ACCEPT_ATTR } from "@/engine/registry";
import { summarize } from "@/engine/batch/queue";
import { useBatchContext, useBatchQueue, useLimitWarning } from "@/lib/batch";
import { AlertIcon, CloseIcon, InfoIcon, PlusIcon, TrashIcon } from "../icons";
import { useFilePicker } from "../UploadZone";
import { Announcer } from "./Announcer";
import { BatchSettingsPanel } from "./BatchSettingsPanel";
import { BatchSummary } from "./BatchSummary";
import { QueueRow } from "./QueueRow";
import { useFlip } from "./useFlip";

export function BatchWorkspace() {
  const { queue, setMode } = useBatchContext();
  const { snap } = useBatchQueue();
  const limitWarning = useLimitWarning();
  const list = useRef<HTMLUListElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const depth = useRef(0);
  const { inputRef: pickInput, pick: pickFiles, onChange: onPickChange } = useFilePicker((files) => void queue.addFiles(files), { accept: ACCEPT_ATTR });
  useFlip(list);
  useEffect(() => title.current?.focus(), []);
  const s = summarize(snap);
  const running = snap.run === "running" || snap.run === "pausing";

  const isFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <div className="enter space-y-4" data-testid="batch-workspace">
      <Announcer message={snap.announcement} seq={snap.announceSeq} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 ref={title} tabIndex={-1} className="text-2xl font-extrabold tracking-tight outline-none sm:text-3xl">
            Batch conversion
          </h1>
          <p className="text-sm text-muted">Files convert one at a time, on your device, in the order shown.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => pickFiles()} data-testid="add-files">
            <PlusIcon size={16} /> Add files
          </button>
          <input ref={pickInput} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPickChange} data-testid="batch-input" />
          {!confirmClear ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)} data-testid="clear-queue">
              <TrashIcon size={15} /> Clear queue
            </button>
          ) : (
            <div role="alertdialog" aria-label="Confirm clearing the queue" className="enter flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-1.5 text-sm" data-testid="clear-confirm">
              <span>
                Remove all {snap.items.length} file{snap.items.length > 1 ? "s" : ""}{running ? " and stop the current conversion" : ""}?
              </span>
              <button type="button" className="btn btn-sm btn-secondary" autoFocus onClick={() => (queue.clear(), setConfirmClear(false), setMode("convert"))} data-testid="clear-yes">
                Yes, clear
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmClear(false)} data-testid="clear-no">
                Keep
              </button>
            </div>
          )}
        </div>
      </div>

      {limitWarning && (
        <p role="note" className="flex gap-2 rounded-xl border border-info/40 bg-info/10 p-3 text-sm">
          <InfoIcon size={18} className="mt-0.5 shrink-0 text-info" /> {limitWarning}
        </p>
      )}
      {snap.notices.length > 0 && (
        <div role="status" className="enter space-y-1.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="batch-notices">
          {snap.notices.map((n, i) => (
            <p key={i} className="flex gap-2">
              <AlertIcon size={17} className="mt-0.5 shrink-0 text-warning" /> {n}
            </p>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => queue.dismissNotices()}>
            <CloseIcon size={14} /> Dismiss
          </button>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="lg:col-start-2 lg:row-start-1">
          <BatchSummary snap={snap} />
        </div>

        <section
          aria-label="File queue"
          className="queue-drop min-w-0 space-y-3 rounded-2xl border border-dashed border-transparent lg:col-start-1 lg:row-span-2 lg:row-start-1"
          data-dragging={dropping}
          onDragEnter={(e) => {
            if (!isFiles(e)) return;
            e.preventDefault();
            depth.current++;
            setDropping(true);
          }}
          onDragOver={(e) => {
            if (isFiles(e)) e.preventDefault();
          }}
          onDragLeave={() => {
            depth.current = Math.max(0, depth.current - 1);
            if (!depth.current) setDropping(false);
          }}
          onDrop={(e) => {
            if (!isFiles(e)) return;
            e.preventDefault();
            depth.current = 0;
            setDropping(false);
            void queue.addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <ul ref={list} className="space-y-2.5" data-testid="queue-list" aria-label={`${snap.items.length} files in the queue`}>
            {snap.items.map((item, index) => (
              <QueueRow
                key={item.id}
                item={item}
                index={index}
                total={snap.items.length}
                shared={snap.shared}
                dragging={dragId === item.id}
                dropTarget={overId === item.id && dragId !== item.id}
                onDragStart={setDragId}
                onDragOver={setOverId}
                onDrop={(target) => {
                  const to = snap.items.findIndex((i) => i.id === target);
                  if (dragId && to >= 0) queue.moveTo(dragId, to);
                  setDragId(null);
                  setOverId(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
              />
            ))}
          </ul>
          <button type="button" className="flex w-full min-h-14 items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-fg" onClick={() => pickFiles()}>
            <PlusIcon size={16} /> Add more files or drop them here
            <span className="sr-only">({s.total} of {snap.limits.maxFiles} used)</span>
          </button>
          {s.rejected > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => queue.clearRejected()}>
              Remove {s.rejected} not accepted file{s.rejected > 1 ? "s" : ""} from the list
            </button>
          )}
        </section>

        <div className="lg:col-start-2 lg:row-start-2">
          <BatchSettingsPanel snap={snap} />
        </div>
      </div>
    </div>
  );
}
