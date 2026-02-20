import type { ReactNode } from "react";

interface HeadingBlock {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

interface ParagraphBlock {
  type: "paragraph";
  text: string;
}

interface ListBlock {
  type: "list";
  ordered: boolean;
  items: string[];
}

interface CodeBlock {
  type: "code";
  language: string;
  code: string;
}

interface QuoteBlock {
  type: "quote";
  lines: string[];
}

interface TableBlock {
  type: "table";
  headers: string[];
  rows: string[][];
}

type MarkdownBlock = HeadingBlock | ParagraphBlock | ListBlock | CodeBlock | QuoteBlock | TableBlock;

function parseTableCells(line: string): string[] {
  const rawCells = line.split("|").map((cell) => cell.trim());
  if (rawCells.length > 0 && rawCells[0] === "") {
    rawCells.shift();
  }
  if (rawCells.length > 0 && rawCells[rawCells.length - 1] === "") {
    rawCells.pop();
  }
  return rawCells;
}

function isTableDividerLine(line: string): boolean {
  const trimmed = line.trim();
  return /^[:\-\s|]+$/.test(trimmed) && trimmed.includes("-");
}

function isTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return trimmed.includes("|");
}

function parseBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    const headingMatch = /^#{1,6}\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: Math.min(6, Math.max(1, trimmed.match(/^#+/)?.[0].length ?? 1)) as HeadingBlock["level"],
        text: headingMatch[1].trim()
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", language, code: codeLines.join("\n") });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    if (index + 1 < lines.length) {
      const headerLine = lines[index];
      const dividerLine = lines[index + 1];

      if (isTableRowLine(headerLine) && isTableDividerLine(dividerLine)) {
        const headers = parseTableCells(headerLine);
        index += 2;

        const rows: string[][] = [];
        while (index < lines.length && isTableRowLine(lines[index])) {
          const cells = parseTableCells(lines[index]);
          if (cells.length === 0) {
            break;
          }

          const normalizedRow = [...cells];
          while (normalizedRow.length < headers.length) {
            normalizedRow.push("");
          }
          rows.push(normalizedRow.slice(0, headers.length));
          index += 1;
        }

        blocks.push({ type: "table", headers, rows });
        continue;
      }
    }

    const paragraphLines: string[] = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (
        next.length === 0 ||
        /^#{1,6}\s+/.test(next) ||
        next.startsWith("```") ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^>\s?/.test(next)
      ) {
        break;
      }

      paragraphLines.push(next);
      index += 1;
    }

    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let cursor = 0;
  let match = pattern.exec(text);
  let index = 0;

  while (match) {
    if (match.index > cursor) {
      tokens.push(<span key={`${keyPrefix}-text-${index}`}>{text.slice(cursor, match.index)}</span>);
      index += 1;
    }

    if (match[1]) {
      tokens.push(
        <code
          key={`${keyPrefix}-code-${index}`}
          className="rounded bg-slate-800/90 px-1 py-0.5 font-mono text-[0.92em] text-cyan-200"
        >
          {match[1]}
        </code>
      );
      index += 1;
    } else if (match[2]) {
      tokens.push(
        <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-slate-100">
          {match[2]}
        </strong>
      );
      index += 1;
    } else if (match[3] && match[4]) {
      tokens.push(
        <a
          key={`${keyPrefix}-link-${index}`}
          href={match[4]}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-300 underline decoration-cyan-500/70 underline-offset-2 hover:text-cyan-200"
        >
          {match[3]}
        </a>
      );
      index += 1;
    }

    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    tokens.push(<span key={`${keyPrefix}-tail-${index}`}>{text.slice(cursor)}</span>);
  }

  return tokens;
}

interface MarkdownRendererProps {
  markdown: string;
}

export function MarkdownRenderer({ markdown }: MarkdownRendererProps) {
  const blocks = parseBlocks(markdown);

  return (
    <article className="space-y-3 text-sm leading-relaxed text-slate-300">
      {blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          const classNameByLevel: Record<HeadingBlock["level"], string> = {
            1: "text-2xl",
            2: "text-xl",
            3: "text-lg",
            4: "text-base",
            5: "text-sm",
            6: "text-sm"
          };

          return (
            <h3
              key={`heading-${blockIndex}`}
              className={`${classNameByLevel[block.level]} mt-4 font-display font-semibold text-slate-100`}
            >
              {renderInline(block.text, `heading-${blockIndex}`)}
            </h3>
          );
        }

        if (block.type === "paragraph") {
          return <p key={`paragraph-${blockIndex}`}>{renderInline(block.text, `paragraph-${blockIndex}`)}</p>;
        }

        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={`list-${blockIndex}`} className="ml-5 list-outside space-y-1 marker:text-slate-500">
              {block.items.map((item, itemIndex) => (
                <li key={`list-${blockIndex}-${itemIndex}`}>{renderInline(item, `list-${blockIndex}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }

        if (block.type === "code") {
          return (
            <pre
              key={`code-${blockIndex}`}
              className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-950/80 p-3 text-xs text-slate-200"
            >
              <code>{block.code}</code>
            </pre>
          );
        }

        if (block.type === "table") {
          return (
            <div key={`table-${blockIndex}`} className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="min-w-full border-collapse bg-slate-950/60 text-left text-xs text-slate-200">
                <thead className="bg-slate-900/90">
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th
                        key={`table-${blockIndex}-header-${headerIndex}`}
                        className="border-b border-slate-700 px-3 py-2 font-semibold text-slate-100"
                      >
                        {renderInline(header, `table-${blockIndex}-header-${headerIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`table-${blockIndex}-row-${rowIndex}`} className="odd:bg-slate-950/70 even:bg-slate-900/40">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`table-${blockIndex}-row-${rowIndex}-cell-${cellIndex}`}
                          className="border-t border-slate-800 px-3 py-2 align-top text-slate-300"
                        >
                          {renderInline(cell, `table-${blockIndex}-row-${rowIndex}-cell-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <blockquote
            key={`quote-${blockIndex}`}
            className="rounded-r-lg border-l-4 border-slate-600 bg-slate-900/50 px-3 py-2 text-slate-300"
          >
            {block.lines.map((line, lineIndex) => (
              <p key={`quote-${blockIndex}-${lineIndex}`}>{renderInline(line, `quote-${blockIndex}-${lineIndex}`)}</p>
            ))}
          </blockquote>
        );
      })}
    </article>
  );
}
