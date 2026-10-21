import { readFile } from "node:fs/promises";
import path from "node:path";
import { setFontLoader } from "@/engine/fonts";

// Node has no same-origin /fonts; read the same files from public/.
setFontLoader(async (file) => new Uint8Array(await readFile(path.resolve(__dirname, "../../public/fonts", file))));

// Node has no Worker: run the render on the main thread, as the production worker would.
import { runRender } from "@/engine/render";
import { setRenderFallback } from "@/engine/worker-client";
setRenderFallback((job, onStage) => runRender(job, onStage));
import { runTool } from "@/engine/pdf-tools/run";
import { setToolFallback } from "@/engine/pdf-tools/client";
setToolFallback((req) => runTool(req));
