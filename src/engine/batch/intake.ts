import { SOURCE_FORMATS, type SourceFormat } from "../registry";
import { checkImageBytes, validateFileMeta } from "../validate";
import { FileForgeError, type Processing } from "../types";

export interface IntakeResult {
  format: SourceFormat;
  extension: string;
}

const HEAD_TEXT = 8 * 1024;
const HEAD_IMAGE = 1024 * 1024;

async function readHead(file: File, bytes: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
}

/**
 * Cheap, per-file validation done when a file is added: extension, size, emptiness, binary content
 * for text formats, and header checks (type, dimensions, megapixels) for images. Full parsing happens
 * later, one file at a time, so a large batch never holds every file's contents in memory at once.
 * Throws FileForgeError with a user-facing message.
 */
export async function validateIntake(file: File, processing: Processing): Promise<IntakeResult> {
  const { format, extension } = validateFileMeta(file);
  if (format.id === "image") {
    const head = await readHead(file, HEAD_IMAGE);
    try {
      checkImageBytes(head, extension, processing);
    } catch (e) {
      // The JPEG size marker can sit beyond the first megabyte (large embedded thumbnails). Defer that case to conversion time.
      if (!(e instanceof FileForgeError && e.code === "bad-image" && file.size > HEAD_IMAGE && /dimensions/.test(e.message))) throw e;
    }
  } else {
    const head = await readHead(file, HEAD_TEXT);
    const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
    if (!utf16 && head.includes(0)) throw new FileForgeError("binary-file", "This looks like a binary file, not text.");
  }
  return { format, extension };
}

export function supportedExtensionsLabel(): string {
  return SOURCE_FORMATS.flatMap((f) => f.extensions.map((e) => e.toUpperCase())).join(", ");
}

/** SHA-256 hex of the file contents; used only to confirm that same-size files are exact duplicates. */
export async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
