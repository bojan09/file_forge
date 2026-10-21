/// <reference lib="webworker" />
import { runRender } from "./render";
import type { RenderJob, RenderResult, Stage } from "./types";
import { FileForgeError } from "./types";

export type WorkerRequest = { id: number; job: RenderJob };
export type WorkerResponse =
  | { id: number; type: "stage"; stage: Stage }
  | { id: number; type: "done"; result: RenderResult }
  | { id: number; type: "error"; code: string; message: string; retryable: boolean };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, job } = e.data;
  const post = (m: WorkerResponse, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);
  try {
    const result = await runRender(job, (stage) => post({ id, type: "stage", stage }));
    post({ id, type: "done", result }, [result.bytes.buffer]);
  } catch (err) {
    if (err instanceof FileForgeError) post({ id, type: "error", code: err.code, message: err.message, retryable: err.retryable });
    else post({ id, type: "error", code: "render-failed", message: err instanceof Error ? err.message : "Unknown error while rendering.", retryable: true });
  }
};
