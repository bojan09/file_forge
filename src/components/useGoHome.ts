"use client";

import { useBatchContext } from "@/lib/batch";
import { useConverter } from "@/lib/converter";

/**
 * The converter's screens (workspace, result, queue) live in memory, not in the URL, so a plain link to "/" does nothing
 * when you are already on "/". Going "home" there means returning to the upload screen. A batch that is still running
 * is left alone rather than cancelled by a stray click.
 */
export function useGoHome(pathname: string) {
  const { reset } = useConverter();
  const { queue, merge } = useBatchContext();
  return () => {
    if (pathname !== "/" && pathname !== "") return;
    reset();
    const run = queue.getSnapshot().run;
    if (run !== "running" && run !== "pausing" && queue.getSnapshot().items.length) queue.clear();
    if (merge.getSnapshot().items.length) merge.clear();
  };
}
