import { useEffect, useRef } from "react";
import type { Block, ImageData, Inline } from "@/engine/types";

const MAX_CHARS = 6000;
const MAX_BLOCKS = 80;
const MAX_TABLE_ROWS = 25;

function Runs({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: React.ReactNode = r.text;
        if (r.code) node = <code>{node}</code>;
        if (r.bold) node = <strong>{node}</strong>;
        if (r.italic) node = <em>{node}</em>;
        if (r.strike) node = <s>{node}</s>;
        if (r.underline && !r.link) node = <u>{node}</u>;
        if (r.link)
          node = (
            <a href={r.link} target="_blank" rel="noopener noreferrer nofollow">
              {node}
            </a>
          );
        return (
          <span key={i} style={r.color && !r.link ? { color: r.color } : undefined}>
            {node}
          </span>
        );
      })}
    </>
  );
}

/** Object URL for embedded image bytes, revoked on unmount. */
function PreviewImage({ image, align }: { image: ImageData; align?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const u = URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.mime }));
    el.src = u;
    return () => {
      el.removeAttribute("src");
      URL.revokeObjectURL(u);
    };
  }, [image]);
  return (
    <figure style={{ textAlign: (align as "left") ?? "left" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={ref} alt={image.alt || "Embedded image"} className="inline-block h-auto max-w-full" width={image.width} height={image.height} />
    </figure>
  );
}

function BlockView({ b }: { b: Block }): React.ReactNode {
  switch (b.type) {
    case "heading": {
      const Tag = `h${Math.min(b.level, 6)}` as "h1";
      return (
        <Tag style={b.align ? { textAlign: b.align } : undefined}>
          <Runs runs={b.runs} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p style={b.align ? { textAlign: b.align } : undefined}>
          <Runs runs={b.runs} />
        </p>
      );
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag style={b.plain ? { listStyle: "none", paddingLeft: "0.25rem" } : undefined}>
          {b.items.map((it, i) => (
            <li key={i}>
              <Runs runs={it.runs} />
              {it.children?.map((c, j) => <BlockView key={j} b={c} />)}
            </li>
          ))}
        </Tag>
      );
    }
    case "code":
      return (
        <pre>
          <code>{b.text}</code>
        </pre>
      );
    case "quote":
      return <blockquote>{b.blocks.map((c, i) => <BlockView key={i} b={c} />)}</blockquote>;
    case "rule":
      return <hr />;
    case "pagebreak":
      return (
        <div role="separator" aria-label="Page break" className="my-4 flex items-center gap-2 text-[0.68rem] uppercase tracking-wide text-[var(--paper-muted)]">
          <span className="h-px flex-1 border-t border-dashed border-current" /> Page break <span className="h-px flex-1 border-t border-dashed border-current" />
        </div>
      );
    case "image":
      return <PreviewImage image={b.image} align={b.align} />;
    case "table": {
      const rows = b.rows.slice(0, MAX_TABLE_ROWS);
      return (
        <div className="paper-scroll">
          <table>
            {b.header && (
              <thead>
                <tr>{b.header.map((c, i) => <th key={i}><Runs runs={c} /></th>)}</tr>
              </thead>
            )}
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j}><Runs runs={c} /></td>)}</tr>
              ))}
            </tbody>
          </table>
          {b.rows.length > rows.length && <p className="!text-xs !text-[var(--paper-muted)]">Showing the first {rows.length} of {b.rows.length.toLocaleString()} rows.</p>}
        </div>
      );
    }
  }
}

function weight(b: Block): number {
  if (b.type === "paragraph" || b.type === "heading") return b.runs.reduce((n, r) => n + r.text.length, 0) + 40;
  if (b.type === "code") return b.text.length + 40;
  if (b.type === "table") return 600;
  if (b.type === "image") return 900;
  if (b.type === "list") return b.items.length * 60;
  return 80;
}

/** Renders a bounded slice of the normalized document so huge files don't freeze the preview. */
export function DocPreview({ blocks }: { blocks: Block[] }) {
  const shown: Block[] = [];
  let budget = MAX_CHARS;
  for (const b of blocks) {
    if (shown.length >= MAX_BLOCKS || budget <= 0) break;
    shown.push(b);
    budget -= weight(b);
  }
  const truncated = shown.length < blocks.length;
  return (
    <div className="paper p-5 text-[0.9rem] sm:p-7" data-testid="doc-preview">
      {shown.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
      {truncated && <p className="!text-xs !text-[var(--paper-muted)]">Preview shows the first part of the document. The converted file contains all of it.</p>}
    </div>
  );
}
