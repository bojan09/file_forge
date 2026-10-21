import { readFile } from "node:fs/promises";
import path from "node:path";
import { setFontLoader } from "@/engine/fonts";

// Node has no same-origin /fonts; read the same files from public/.
setFontLoader(async (file) => new Uint8Array(await readFile(path.resolve(__dirname, "../../public/fonts", file))));
