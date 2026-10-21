"use client";

import { useEffect } from "react";
import { useBatchContext, useBatchQueue, useMergeList } from "@/lib/batch";
import { useConverter } from "@/lib/converter";
import { BatchWorkspace } from "./batch/BatchWorkspace";
import { MergeWorkspace } from "./batch/MergeWorkspace";
import { ErrorView } from "./ErrorView";
import { FileTypeIcon } from "./FileTypeIcon";
import { HomeView } from "./HomeView";
import { ProgressView } from "./ProgressView";
import { ResultView } from "./ResultView";
import { Workspace } from "./Workspace";

function InspectingView() {
  const { state, reset } = useConverter();
  if (state.phase !== "inspecting") return null;
  const ext = state.fileName.split(".").pop() ?? "";
  return (
    <div className="enter mx-auto max-w-lg">
      <section className="card space-y-5 p-6 sm:p-8" aria-labelledby="inspect-title">
        <div className="flex items-center gap-3">
          <FileTypeIcon ext={ext} size={32} />
          <div className="min-w-0">
            <h1 id="inspect-title" className="text-lg font-bold">
              {state.step === "reading" ? "Reading file…" : "Parsing content…"}
            </h1>
            <p className="truncate text-xs text-muted">{state.fileName}</p>
          </div>
        </div>
        <div className="indeterminate" role="progressbar" aria-label="Inspecting file" />
        <p role="status" className="sr-only">
          {state.step === "reading" ? "Reading file" : "Parsing content"}
        </p>
        <button type="button" className="btn btn-secondary w-full" onClick={reset}>
          Cancel
        </button>
      </section>
    </div>
  );
}

/** Switches between the upload, single-file workspace, batch, merge, progress, result and error screens. */
export function ConvertApp() {
  const { state, selectFile, notice } = useConverter();
  const { queue, mode, setMode, merge } = useBatchContext();
  const batch = useBatchQueue().snap;
  const mergeSnap = useMergeList().snap;
  const batchActive = batch.items.length > 0;
  const mergeActive = mergeSnap.items.length > 0;
  // Each screen starts at the top so headings and confirmations aren't hidden under the sticky header.
  const screen = state.phase === "idle" ? (batchActive ? "batch" : mergeActive ? "merge" : "home") : state.phase;
  useEffect(() => window.scrollTo(0, 0), [screen]);

  /** One file keeps the single-file flow; several files (or merge mode) go to the batch or merge workspace. */
  const onFiles = (files: File[]) => {
    if (mode === "merge") void merge.addFiles(files);
    else if (files.length === 1) selectFile(files[0]!);
    else void queue.addFiles(files);
  };

  if (state.phase === "idle") {
    if (batchActive) return <BatchWorkspace />;
    if (mergeActive) return <MergeWorkspace />;
    return <HomeView onFiles={onFiles} notice={notice} mode={mode} onMode={setMode} />;
  }
  switch (state.phase) {
    case "inspecting":
      return <InspectingView />;
    case "ready":
      return <Workspace />;
    case "converting":
      return <ProgressView />;
    case "done":
      return <ResultView />;
    case "error":
      return state.origin === "inspect" ? <HomeView onFiles={onFiles} error={state.message} mode={mode} onMode={setMode} /> : <ErrorView />;
  }
}
