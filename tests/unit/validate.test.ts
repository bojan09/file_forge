import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCEPT_ATTR, SOURCE_FORMATS, findFormatByExtension, getExtension } from "@/engine/registry";
import { checkImageBytes, decodeText, readImageSize, sniffImage, validateFileMeta } from "@/engine/validate";
import { FileForgeError } from "@/engine/types";
import { jpegInfo } from "@/engine/prep-image";

const fx = (n: string) => new Uint8Array(readFileSync(path.resolve(__dirname, "../fixtures", n)));

describe("registry", () => {
  it("only advertises the supported conversions", () => {
    const pairs = SOURCE_FORMATS.flatMap((f) => f.outputs.map((o) => `${f.id}->${o}`));
    expect(pairs.sort()).toEqual(["csv->docx", "csv->pdf", "docx->pdf", "html->docx", "html->pdf", "image->pdf", "md->docx", "md->pdf", "pdf->docx", "txt->docx", "txt->pdf", "xlsx->pdf"]);
    // Phase 4: Office and PDF inputs exist, but only the experimental pathways; legacy and macro formats stay out.
    expect(findFormatByExtension("docx")?.id).toBe("docx");
    for (const ext of ["doc", "xls", "pptx", "docm", "xlsm", "epub"]) expect(findFormatByExtension(ext), ext).toBeUndefined();
    expect(ACCEPT_ATTR).toContain(".webp");
  });
  it("labels HTML and CSV as approximate and TXT/MD as high fidelity", () => {
    const f = (id: string) => SOURCE_FORMATS.find((x) => x.id === id)!;
    expect(f("html").fidelity.pdf).toBe("approximate");
    expect(f("csv").fidelity.docx).toBe("approximate");
    expect(f("txt").fidelity.pdf).toBe("high");
    expect(f("image").fidelity.docx).toBeUndefined();
  });
  it("applies the documented size limits", () => {
    const MB = 1024 * 1024;
    const lim = (id: string) => SOURCE_FORMATS.find((x) => x.id === id)!.maxBytes;
    expect([lim("txt"), lim("md"), lim("html"), lim("csv"), lim("image")]).toEqual([5 * MB, 5 * MB, 2 * MB, 5 * MB, 15 * MB]);
  });
  it("extracts extensions case-insensitively", () => {
    expect(getExtension("A.B.PNG")).toBe("png");
    expect(getExtension("noext")).toBe("");
  });
});

describe("validateFileMeta", () => {
  it("accepts supported files within limits", () => {
    expect(validateFileMeta({ name: "a.MD", size: 10 }).format.id).toBe("md");
    expect(validateFileMeta({ name: "p.jpeg", size: 10 }).format.id).toBe("image");
  });
  it("rejects politely with specific reasons", () => {
    const code = (f: { name: string; size: number }) => {
      try {
        validateFileMeta(f);
      } catch (e) {
        return (e as FileForgeError).code;
      }
    };
    expect(code({ name: "a.pptx", size: 5 })).toBe("unsupported-type");
    expect(code({ name: "a.pdf", size: 30 * 1024 * 1024 + 1 })).toBe("too-large");
    expect(code({ name: "README", size: 5 })).toBe("unsupported-type");
    expect(code({ name: "a.txt", size: 0 })).toBe("empty-file");
    expect(code({ name: "a.txt", size: 5 * 1024 * 1024 + 1 })).toBe("too-large");
    expect(code({ name: "a.html", size: 2 * 1024 * 1024 + 1 })).toBe("too-large");
    expect(code({ name: "a.png", size: 15 * 1024 * 1024 + 1 })).toBe("too-large");
    expect(code({ name: "a.png", size: 15 * 1024 * 1024 })).toBeUndefined();
  });
});

describe("image header checks", () => {
  it("sniffs types and reads dimensions without decoding", () => {
    expect(sniffImage(fx("photo.jpg"))).toBe("jpeg");
    expect(sniffImage(fx("image.png"))).toBe("png");
    expect(sniffImage(fx("image.webp"))).toBe("webp");
    expect(readImageSize(fx("photo.jpg"), "jpeg")).toEqual({ width: 400, height: 240 });
    expect(readImageSize(fx("image.png"), "png")).toEqual({ width: 320, height: 200 });
    expect(readImageSize(fx("image.webp"), "webp")).toEqual({ width: 300, height: 300 });
  });
  it("rejects spoofed, mismatched and oversized images", () => {
    expect(() => checkImageBytes(new TextEncoder().encode("hello"), "png", "balanced")).toThrow(/isn't a valid/);
    expect(() => checkImageBytes(fx("image.png"), "jpg", "balanced")).toThrow(/extension says/);
    expect(() => checkImageBytes(fx("huge-dimensions.png"), "png", "balanced")).toThrow(/megapixels/);
    expect(checkImageBytes(fx("photo.jpg"), "jpg", "conservative")).toMatchObject({ width: 400 });
  });
  it("reads EXIF orientation", () => {
    expect(jpegInfo(fx("photo.jpg")).orientation).toBe(1);
    expect(jpegInfo(fx("rotated.jpg")).orientation).toBe(6);
    expect(jpegInfo(fx("photo.jpg")).components).toBe(3);
  });
});

describe("decodeText", () => {
  it("handles BOMs and UTF-16", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69])).text).toBe("hi");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])).text).toBe("hi");
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69])).text).toBe("hi");
  });
  it("rejects binary data and counts invalid sequences", () => {
    expect(() => decodeText(new Uint8Array([0x50, 0x4b, 0x03, 0x00, 0x00]))).toThrow(/binary/);
    expect(decodeText(new Uint8Array([0x61, 0xff, 0x62])).replacementCount).toBe(1);
  });
});
