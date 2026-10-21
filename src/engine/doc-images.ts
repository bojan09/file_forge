import { flattenPng, pngNeedsFlatten } from "./prep-image";
import type { Block, NormalizedDoc } from "./types";

export interface ImageNormalization {
  doc: NormalizedDoc;
  flattened: number;
  /** Images that could not be prepared and were replaced by their alt text. */
  dropped: number;
}

/**
 * PDF only: PNGs with transparency, interlacing or 16-bit depth are re-encoded as plain opaque PNGs, because the PDF
 * engine would otherwise decode them in a nested Worker. Where no canvas exists the image becomes an alt-text placeholder.
 */
export async function normalizeDocImages(doc: NormalizedDoc): Promise<ImageNormalization> {
  let flattened = 0;
  let dropped = 0;
  const cache = new Map<Uint8Array, Uint8Array | null>();
  const fix = async (blocks: Block[]): Promise<Block[]> => {
    const out: Block[] = [];
    for (const b of blocks) {
      if (b.type === "image" && b.image.mime === "image/png" && pngNeedsFlatten(b.image.bytes)) {
        let bytes = cache.get(b.image.bytes);
        if (bytes === undefined) {
          try {
            bytes = await flattenPng(b.image.bytes);
          } catch {
            bytes = null;
          }
          cache.set(b.image.bytes, bytes);
        }
        if (bytes) {
          flattened++;
          out.push({ ...b, image: { ...b.image, bytes } });
        } else {
          dropped++;
          const alt = b.image.alt;
          out.push({ type: "paragraph", runs: [{ text: alt ? `[image: ${alt}]` : "[image]", italic: true }], align: b.align });
        }
      } else if (b.type === "quote") out.push({ ...b, blocks: await fix(b.blocks) });
      else if (b.type === "list") out.push({ ...b, items: await Promise.all(b.items.map(async (it) => ({ ...it, children: it.children ? await fix(it.children) : undefined }))) });
      else out.push(b);
    }
    return out;
  };
  if (!doc.imageCount) return { doc, flattened: 0, dropped: 0 };
  const blocks = await fix(doc.blocks);
  return { doc: { ...doc, blocks }, flattened, dropped };
}
