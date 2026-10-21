"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createDefaultDeps } from "@/engine/batch/default-deps";
import { currentDeviceMemory, effectiveBatchLimits } from "@/engine/batch/limits";
import { MergeList, createDefaultMergeDeps, defaultMergeSettings, type MergeSnapshot } from "@/engine/batch/merge";
import { BatchQueue } from "@/engine/batch/queue";
import type { BatchSnapshot } from "@/engine/batch/types";
import { setBusy } from "./activity";
import { getSettings, parseOptionsFromSettings, styleFromSettings, useSettings } from "./settings";

export type HomeMode = "convert" | "merge";

interface BatchContextValue {
  queue: BatchQueue;
  merge: MergeList;
  mode: HomeMode;
  setMode: (m: HomeMode) => void;
}

const Ctx = createContext<BatchContextValue | null>(null);

function create() {
  const s = getSettings();
  const { limits } = effectiveBatchLimits(s.processing, currentDeviceMemory());
  const queue = new BatchQueue(createDefaultDeps(() => getSettings().processing, () => parseOptionsFromSettings(getSettings())), {
    limits,
    processing: s.processing,
    shared: {
      output: s.defaultOutput,
      // "auto" orientation: documents use portrait, images follow each image's own orientation.
      page: { pageSize: s.pageSize, orientation: s.orientation === "landscape" ? "landscape" : "auto", margins: s.margins, imageQuality: s.imageQuality, imageFit: s.imageFit, style: styleFromSettings(s) },
      suffix: s.suffix,
    },
  });
  const merge = new MergeList(createDefaultMergeDeps(), { limits, settings: defaultMergeSettings({ pageSize: s.pageSize, margins: s.margins, quality: s.imageQuality }) }, s.processing);
  return { queue, merge };
}

export function BatchProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const [stores] = useState(create);
  const [mode, setMode] = useState<HomeMode>("convert");

  useEffect(() => {
    const sync = () => {
      const run = stores.queue.getSnapshot().run;
      setBusy("batch", run === "running" || run === "pausing");
      const phase = stores.merge.getSnapshot().phase;
      setBusy("merge", phase === "preparing" || phase === "rendering" || phase === "verifying");
    };
    const u1 = stores.queue.subscribe(sync);
    const u2 = stores.merge.subscribe(sync);
    return () => {
      u1();
      u2();
    };
  }, [stores]);

  useEffect(() => {
    const { limits } = effectiveBatchLimits(settings.processing, currentDeviceMemory());
    stores.queue.setLimits(limits, settings.processing);
    stores.merge.setLimits(limits, settings.processing);
  }, [settings.processing, stores]);

  return <Ctx.Provider value={{ ...stores, mode, setMode }}>{children}</Ctx.Provider>;
}

export function useBatchContext(): BatchContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBatchContext must be used inside BatchProvider");
  return v;
}

export function useBatchQueue(): { queue: BatchQueue; snap: BatchSnapshot } {
  const { queue } = useBatchContext();
  const snap = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  return { queue, snap };
}

export function useMergeList(): { merge: MergeList; snap: MergeSnapshot } {
  const { merge } = useBatchContext();
  const snap = useSyncExternalStore(merge.subscribe, merge.getSnapshot, merge.getSnapshot);
  return { merge, snap };
}

/** Device-memory notice for the current limits profile (undefined when nothing to warn about). */
export function useLimitWarning(): string | undefined {
  const settings = useSettings();
  return effectiveBatchLimits(settings.processing, currentDeviceMemory()).warning;
}
