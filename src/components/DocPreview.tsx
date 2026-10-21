import type { Block, Inline } from "@/engine/types";

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
        if (r.link)
          node = (
            <a href={r.link} target="_blank" rel="noopener noreferrer nofollow">
              {node}
            </a>
          );
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

function BlockView({ b }: { b: Block }): React.ReactNode {
  switch (b.type) {
    case "heading": {
      const Tag = `h${Math.min(b.level, 6)}` as "h1";
      return (
        <Tag>
          <Runs runs={b.runs} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          <Runs runs={b.runs} />
        </p>
      );
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag>
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
