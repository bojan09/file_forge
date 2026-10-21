import { FileForgeError } from "../types";
import { buildFromPlan, compressPdf, inspectPdf, setMetadata, PDF_TOOL_LIMITS, type PdfInfo, type PdfMeta, type PlanItem, type ToolOutput } from "./ops";

export type ToolRequest =
  | { kind: "inspect"; input: Uint8Array; name: string }
  | { kind: "build"; inputs: Uint8Array[]; names: string[]; plan: PlanItem[]; outName: string }
  | { kind: "split"; input: Uint8Array; name: string; groups: PlanItem[][]; outNames: string[] }
  | { kind: "metadata"; input: Uint8Array; name: string; meta: PdfMeta; clearAll: boolean; outName: string }
  | { kind: "compress"; input: Uint8Array; name: string; outName: string };

export type ToolResult = { info?: PdfInfo; outputs: ToolOutput[]; notes: string[] };

export async function runTool(req: ToolRequest): Promise<ToolResult> {
  const total = req.kind === "build" ? req.inputs.reduce((a, b) => a + b.length, 0) : req.input.length;
  if (total > PDF_TOOL_LIMITS.totalBytes) throw new FileForgeError("too-large", "These files are too large to process together in the browser.");
  switch (req.kind) {
    case "inspect":
      return { info: await inspectPdf(req.input, req.name), outputs: [], notes: [] };
    case "build": {
      const r = await buildFromPlan(req.inputs, req.plan, req.names);
      return { outputs: [{ name: req.outName, bytes: r.bytes, pages: r.pages }], notes: [] };
    }
    case "split": {
      const outputs: ToolOutput[] = [];
      for (let i = 0; i < req.groups.length; i++) {
        const r = await buildFromPlan([req.input], req.groups[i]!, [req.name]);
        outputs.push({ name: req.outNames[i]!, bytes: r.bytes, pages: r.pages });
      }
      return { outputs, notes: [] };
    }
    case "metadata": {
      const r = await setMetadata(req.input, req.meta, req.clearAll, req.name);
      return { outputs: [{ name: req.outName, bytes: r.bytes, pages: r.pages }], notes: [] };
    }
    case "compress": {
      const r = await compressPdf(req.input, req.name);
      return {
        outputs: [{ name: req.outName, bytes: r.bytes, pages: r.pages }],
        notes: r.smaller ? [] : ["No smaller version could be made without re-encoding images, which FileForge does not do. Your original is returned unchanged."],
      };
    }
  }
}
