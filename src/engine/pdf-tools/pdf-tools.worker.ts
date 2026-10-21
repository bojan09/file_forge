/// <reference lib="webworker" />
import { FileForgeError } from "../types";
import { runTool, type ToolRequest, type ToolResult } from "./run";

export type ToolWorkerRequest = { id: number; req: ToolRequest };
export type ToolWorkerResponse = { id: number; type: "done"; result: ToolResult } | { id: number; type: "error"; code: string; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<ToolWorkerRequest>) => {
  const { id, req } = e.data;
  try {
    const result = await runTool(req);
    ctx.postMessage({ id, type: "done", result } satisfies ToolWorkerResponse, result.outputs.map((o) => o.bytes.buffer));
  } catch (err) {
    const code = err instanceof FileForgeError ? err.code : "tool-failed";
    const message = err instanceof Error ? err.message : "Unknown error.";
    ctx.postMessage({ id, type: "error", code, message } satisfies ToolWorkerResponse);
  }
};
