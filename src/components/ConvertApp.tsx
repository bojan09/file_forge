"use client";

import { useEffect } from "react";
import { useConverter } from "@/lib/converter";
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

/** Switches between the upload, workspace, progress, result and error screens. */
export function ConvertApp() {
  const { state, selectFile, notice } = useConverter();
  // Each phase is a new screen: start it at the top so headings and confirmations aren't hidden under the sticky header.
  useEffect(() => window.scrollTo(0, 0), [state.phase]);
  switch (state.phase) {
    case "idle":
      return <HomeView onFile={selectFile} notice={notice} />;
    case "inspecting":
      return <InspectingView />;
    case "ready":
      return <Workspace />;
    case "converting":
      return <ProgressView />;
    case "done":
      return <ResultView />;
    case "error":
      return state.origin === "inspect" ? <HomeView onFile={selectFile} error={state.message} /> : <ErrorView />;
  }
}
