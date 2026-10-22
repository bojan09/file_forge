// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { inspectFile } from "@/engine/convert";

const txt = (chars: number, name = "book.txt") => new File(["A line of book text that goes on for a while, and then some more.\n\n".repeat(Math.ceil(chars / 68))], name, { type: "text/plain" });

describe("very long documents", () => {
  it("accepts a text file near the page limit and refuses one far above it before parsing", async () => {
    // ~3,000 characters per page: 3,000 pages (balanced) is about 9 MB of text.
    await expect(inspectFile(txt(6_000_000), "balanced")).resolves.toMatchObject({ kind: "txt" });
    await expect(inspectFile(txt(12_000_000), "balanced")).rejects.toMatchObject({ code: "doc-too-long" });
    await expect(inspectFile(txt(12_000_000), "balanced")).rejects.toThrow(/above the 3,000-page limit.*Split it/);
  }, 120000);

  it("lowers the limit in conservative mode", async () => {
    await expect(inspectFile(txt(4_000_000), "conservative")).rejects.toThrow(/above the 1,000-page limit for conservative mode \(balanced allows 3,000\)/);
  }, 60000);
});
