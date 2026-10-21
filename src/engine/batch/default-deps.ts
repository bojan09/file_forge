import { inspectFile, runConversion } from "../convert";
import type { Processing } from "../types";
import type { BatchDeps } from "./types";

/**
 * Real conversion for the queue: parse the file, render in a worker, verify. The parsed document is
 * local to this call, so its memory is released as soon as the file finishes.
 */
export function createDefaultDeps(getProcessing: () => Processing): BatchDeps {
  return {
    async convert(item, ctx) {
      // Let the UI paint (status change, animations) before a potentially long synchronous parse.
      await new Promise((r) => setTimeout(r, 0));
      if (ctx.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const insp = await inspectFile(item.file, getProcessing());
      if (ctx.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      return runConversion(insp, { output: ctx.output, settings: ctx.settings, suffix: ctx.suffix, signal: ctx.signal, onStage: ctx.onStage });
    },
  };
}
