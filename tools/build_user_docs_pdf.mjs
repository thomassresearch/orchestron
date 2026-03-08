#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const defaults = {
    input: "documentation/user_documentation.md",
    output: "documentation/user_documentation.pdf",
    logo: "frontend/src/assets/orchestron-icon.png",
    title: "Orchestron User Documentation",
    keepTemp: false
  };

  const args = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input" && argv[index + 1]) {
      args.input = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--logo" && argv[index + 1]) {
      args.logo = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--title" && argv[index + 1]) {
      args.title = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--keep-temp") {
      args.keepTemp = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown or incomplete argument: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`Build the user documentation PDF.

Usage:
  node tools/build_user_docs_pdf.mjs [options]

Options:
  --input <path>    Entry markdown file (default: documentation/user_documentation.md)
  --output <path>   Output PDF path (default: documentation/user_documentation.pdf)
  --logo <path>     Header logo path (default: frontend/src/assets/orchestron-icon.png)
  --title <text>    Document title (default: Orchestron User Documentation)
  --keep-temp       Keep generated temporary HTML files
`);
}

function resolvePath(p) {
  if (path.isAbsolute(p)) {
    return path.normalize(p);
  }
  return path.resolve(repoRoot, p);
}

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`${label} is not a file: ${filePath}`);
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function countPdfPages(pdfPath) {
  const pdfText = fs.readFileSync(pdfPath, "latin1");
  const matches = pdfText.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

function safeDecodeUriComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseMarkdownLinkTargets(markdown) {
  const links = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("**Navigation:**")) {
      continue;
    }
    linkRegex.lastIndex = 0;
    let match = linkRegex.exec(line);
    while (match) {
      let target = match[1].trim();
      if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1).trim();
      }
      const firstSpace = target.search(/\s/);
      if (firstSpace > -1) {
        target = target.slice(0, firstSpace);
      }
      links.push(target);
      match = linkRegex.exec(line);
    }
  }

  return links;
}

function isLocalMarkdownLink(target) {
  if (!target) {
    return false;
  }
  if (target.startsWith("#")) {
    return false;
  }
  if (/^[a-z]+:/i.test(target)) {
    return false;
  }
  const hashIndex = target.indexOf("#");
  const withoutHash = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  return withoutHash.toLowerCase().endsWith(".md");
}

function collectMarkdownFiles(entryFile, documentationRoot) {
  const files = [];
  const visited = new Set();

  function visit(currentFile) {
    const normalized = path.normalize(currentFile);
    if (visited.has(normalized)) {
      return;
    }
    visited.add(normalized);
    files.push(normalized);

    const markdown = fs.readFileSync(normalized, "utf8");
    const links = parseMarkdownLinkTargets(markdown);
    for (const link of links) {
      if (!isLocalMarkdownLink(link)) {
        continue;
      }
      const targetWithoutHash = link.split("#")[0];
      const resolved = path.resolve(path.dirname(normalized), targetWithoutHash);
      if (!fs.existsSync(resolved)) {
        continue;
      }
      const relativeToDocs = path.relative(documentationRoot, resolved);
      if (relativeToDocs.startsWith("..") || path.isAbsolute(relativeToDocs) || relativeToDocs === "") {
        continue;
      }
      visit(resolved);
    }
  }

  visit(entryFile);
  return files;
}

function parseHtmlAttributes(fragment) {
  const attributes = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(fragment);
  while (match) {
    const name = match[1].toLowerCase();
    const value = (match[3] ?? match[4] ?? "").trim();
    attributes[name] = value;
    match = pattern.exec(fragment);
  }
  return attributes;
}

function parseHtmlImageFromLine(line) {
  const match = /<img\b([^>]*)>/i.exec(line);
  if (!match) {
    return null;
  }
  const attributes = parseHtmlAttributes(match[1]);
  if (!attributes.src) {
    return null;
  }
  return {
    src: attributes.src,
    alt: attributes.alt ?? "",
    width: attributes.width ?? ""
  };
}

function sanitizeInlineHtmlText(value) {
  return value.replace(/<[^>]+>/g, "").trim();
}

function sanitizeMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sanitized = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("**Navigation:**")) {
      continue;
    }
    sanitized.push(line);
  }

  return sanitized.join("\n").trim();
}

function parseTableCells(line) {
  const cells = line.split("|").map((cell) => cell.trim());
  if (cells.length > 0 && cells[0] === "") {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1] === "") {
    cells.pop();
  }
  return cells;
}

function isTableDividerLine(line) {
  const trimmed = line.trim();
  return /^[:\-\s|]+$/.test(trimmed) && trimmed.includes("-");
}

function isTableRowLine(line) {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.includes("|");
}

function attachCaptionToPreviousImage(blocks, captionText) {
  if (!captionText) {
    return false;
  }
  if (blocks.length === 0) {
    return false;
  }
  const previous = blocks[blocks.length - 1];
  if (previous.type !== "image") {
    return false;
  }
  if (typeof previous.caption === "string" && previous.caption.trim().length > 0) {
    return false;
  }
  previous.caption = captionText;
  return true;
}

function parseBlocks(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    if (/^<p\s+align=["']center["']\s*>$/i.test(trimmed) || /^<\/p>$/i.test(trimmed)) {
      index += 1;
      continue;
    }

    const centeredEmphasisMatch = /^<p\s+align=["']center["']\s*>\s*<em>(.*?)<\/em>\s*<\/p>$/i.exec(trimmed);
    if (centeredEmphasisMatch) {
      const captionText = sanitizeInlineHtmlText(centeredEmphasisMatch[1]);
      if (!attachCaptionToPreviousImage(blocks, captionText)) {
        blocks.push({ type: "paragraph", text: captionText });
      }
      index += 1;
      continue;
    }

    const htmlImage = parseHtmlImageFromLine(trimmed);
    if (htmlImage) {
      blocks.push({
        type: "image",
        src: htmlImage.src,
        alt: htmlImage.alt,
        width: htmlImage.width,
        caption: ""
      });
      index += 1;
      continue;
    }

    const markdownImageMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (markdownImageMatch) {
      blocks.push({
        type: "image",
        src: markdownImageMatch[2].trim(),
        alt: markdownImageMatch[1].trim(),
        width: "",
        caption: ""
      });
      index += 1;
      continue;
    }

    const headingMatch = /^#{1,6}\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(6, Math.max(1, (trimmed.match(/^#+/)?.[0].length ?? 1)));
      blocks.push({ type: "heading", level, text: headingMatch[1].trim() });
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      index += 1;
      const codeLines = [];
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
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
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
        const rows = [];
        while (index < lines.length && isTableRowLine(lines[index])) {
          const cells = parseTableCells(lines[index]);
          if (cells.length === 0) {
            break;
          }
          const normalized = [...cells];
          while (normalized.length < headers.length) {
            normalized.push("");
          }
          rows.push(normalized.slice(0, headers.length));
          index += 1;
        }
        blocks.push({ type: "table", headers, rows });
        continue;
      }
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      const nextIsCenteredParagraphOpen = /^<p\s+align=["']center["']\s*>$/i.test(next);
      const nextIsCenteredParagraphClose = /^<\/p>$/i.test(next);
      const nextIsCenteredCaption = /^<p\s+align=["']center["']\s*>\s*<em>.*?<\/em>\s*<\/p>$/i.test(next);
      const nextIsHtmlImage = parseHtmlImageFromLine(next) !== null;
      const nextIsMarkdownImage = /^!\[([^\]]*)\]\(([^)]+)\)$/.test(next);
      if (
        next.length === 0 ||
        /^#{1,6}\s+/.test(next) ||
        next.startsWith("```") ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^>\s?/.test(next) ||
        nextIsCenteredParagraphOpen ||
        nextIsCenteredParagraphClose ||
        nextIsCenteredCaption ||
        nextIsHtmlImage ||
        nextIsMarkdownImage
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

function resolveLinkHref(rawHref, currentFile, anchorsByFile) {
  if (rawHref.startsWith("http://") || rawHref.startsWith("https://") || rawHref.startsWith("mailto:")) {
    return rawHref;
  }
  if (rawHref.startsWith("#")) {
    return rawHref;
  }

  const [filePart] = rawHref.split("#");
  if (!filePart.toLowerCase().endsWith(".md")) {
    return null;
  }

  const absoluteTarget = path.resolve(path.dirname(currentFile), filePart);
  if (!anchorsByFile.has(absoluteTarget)) {
    return null;
  }
  return `#${anchorsByFile.get(absoluteTarget)}`;
}

function resolveImageSource(rawSource, currentFile) {
  if (!rawSource || rawSource.trim().length === 0) {
    return null;
  }

  const source = rawSource.trim();
  if (/^(https?:|data:|file:)/i.test(source)) {
    return source;
  }

  const baseCandidates = [source, safeDecodeUriComponent(source)];
  for (const candidate of baseCandidates) {
    const absolutePath = path.resolve(path.dirname(currentFile), candidate);
    if (fs.existsSync(absolutePath)) {
      return pathToFileURL(absolutePath).toString();
    }
  }

  const fallback = path.resolve(path.dirname(currentFile), source);
  return pathToFileURL(fallback).toString();
}

function renderInline(text, context) {
  const parts = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      parts.push(escapeHtml(text.slice(cursor, match.index)));
    }
    if (match[1]) {
      parts.push(`<code>${escapeHtml(match[1])}</code>`);
    } else if (match[2]) {
      parts.push(`<strong>${escapeHtml(match[2])}</strong>`);
    } else if (match[3] && match[4]) {
      const href = resolveLinkHref(match[4].trim(), context.currentFile, context.anchorsByFile);
      if (href) {
        const target = href.startsWith("http://") || href.startsWith("https://") ? ' target="_blank" rel="noreferrer"' : "";
        parts.push(`<a href="${escapeAttribute(href)}"${target}>${escapeHtml(match[3])}</a>`);
      } else {
        parts.push(escapeHtml(match[3]));
      }
    }
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    parts.push(escapeHtml(text.slice(cursor)));
  }

  return parts.join("");
}

function renderBlocks(blocks, context) {
  const html = [];
  const headingCounts = new Map();

  for (const block of blocks) {
    if (block.type === "heading") {
      const base = slugify(block.text) || "section";
      const count = headingCounts.get(base) ?? 0;
      headingCounts.set(base, count + 1);
      const suffix = count === 0 ? "" : `-${count + 1}`;
      const headingId = `${context.sectionAnchor}-${base}${suffix}`;
      html.push(`<h${block.level} id="${escapeAttribute(headingId)}">${renderInline(block.text, context)}</h${block.level}>`);
      continue;
    }

    if (block.type === "paragraph") {
      html.push(`<p>${renderInline(block.text, context)}</p>`);
      continue;
    }

    if (block.type === "list") {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((item) => `<li>${renderInline(item, context)}</li>`).join("");
      html.push(`<${tag}>${items}</${tag}>`);
      continue;
    }

    if (block.type === "code") {
      html.push(`<pre><code>${escapeHtml(block.code)}</code></pre>`);
      continue;
    }

    if (block.type === "quote") {
      const lines = block.lines.map((line) => `<p>${renderInline(line, context)}</p>`).join("");
      html.push(`<blockquote>${lines}</blockquote>`);
      continue;
    }

    if (block.type === "table") {
      const headers = block.headers.map((header) => `<th>${renderInline(header, context)}</th>`).join("");
      const rows = block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, context)}</td>`).join("")}</tr>`)
        .join("");
      html.push(`<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`);
      continue;
    }

    if (block.type === "image") {
      const resolvedSource = resolveImageSource(block.src, context.currentFile);
      const altText = block.alt && block.alt.trim().length > 0 ? block.alt : "Documentation image";
      const captionHtml =
        typeof block.caption === "string" && block.caption.trim().length > 0
          ? `<figcaption class="image-caption">${escapeHtml(block.caption.trim())}</figcaption>`
          : "";
      if (resolvedSource) {
        html.push(
          `<figure class="image-block"><img class="doc-image" src="${escapeAttribute(resolvedSource)}" alt="${escapeAttribute(altText)}" loading="lazy" />${captionHtml}</figure>`
        );
      } else {
        html.push(`<p>${escapeHtml(altText)}</p>`);
      }
      continue;
    }
  }

  return html.join("\n");
}

function getFirstHeadingText(blocks, fallbackTitle) {
  const heading = blocks.find((block) => block.type === "heading");
  return heading ? heading.text : fallbackTitle;
}

function getTocLevel(filePath, entryFile, documentationRoot) {
  const normalizedFile = path.normalize(filePath);
  const normalizedEntry = path.normalize(entryFile);
  if (normalizedFile === normalizedEntry) {
    return 1;
  }

  const relative = path.relative(documentationRoot, normalizedFile).replaceAll(path.sep, "/");
  const segments = relative.split("/");
  if (segments.length === 1) {
    return 1;
  }
  if (segments.length === 2 && path.basename(relative) === `${segments[0]}.md`) {
    return 1;
  }
  return 2;
}

function buildTocMarkup(entries, pageBreakAfter) {
  const leaderText = ". ".repeat(240);
  const rows = entries
    .map(
      (entry) => `<div class="toc-entry level-${entry.level}">
  <span class="toc-page-wrap"><a class="toc-page" href="#${escapeAttribute(entry.anchor)}">${escapeHtml(String(entry.page))}</a></span>
  <span class="toc-title-wrap"><a class="toc-title" href="#${escapeAttribute(entry.anchor)}">${escapeHtml(entry.title)}</a></span>
  <span class="toc-leader" aria-hidden="true">${leaderText}</span>
</div>`
    )
    .join("\n");

  const sectionClass = pageBreakAfter ? "toc-section toc-section-break" : "toc-section";
  return `<section class="${sectionClass}">
  <div class="toc-heading">Table of Contents</div>
  <div class="toc-list">
${rows}
  </div>
</section>`;
}

function buildCoverHtml({ title, generatedAt, logoUrl }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} - Cover</title>
    <style>
      :root {
        --muted: #5b6472;
        --line: #d9deea;
        --accent: #0e547d;
      }
      html, body {
        margin: 0;
        padding: 0;
      }
      body {
        font-family: "Helvetica Neue", "Segoe UI", Arial, sans-serif;
        color: #1d2430;
      }
      .cover {
        min-height: 72vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 42px;
        margin: 20px 0;
      }
      .cover h1 {
        font-size: 32pt;
        margin: 0 0 10px;
        color: var(--accent);
        line-height: 1.1;
      }
      .cover .subtitle {
        color: var(--muted);
        font-size: 14pt;
      }
      .cover .cover-logo-wrap {
        margin-top: 28px;
        margin-bottom: 8px;
        display: flex;
        justify-content: center;
      }
      .cover .cover-logo {
        display: block;
        width: 58%;
        min-width: 90mm;
        max-width: 132mm;
        height: auto;
      }
      .cover .date {
        margin-top: 20px;
        color: var(--muted);
        font-size: 10pt;
      }
    </style>
  </head>
  <body>
    <section class="cover">
      <h1>${escapeHtml(title)}</h1>
      <div class="subtitle">Compiled from markdown documentation</div>
      <div class="cover-logo-wrap">
        <img class="cover-logo" src="${escapeAttribute(logoUrl)}" alt="Orchestron logo" />
      </div>
      <div class="date">Generated on ${escapeHtml(generatedAt)}</div>
    </section>
  </body>
</html>`;
}

function buildMainHtml({ title, tocHtml, sectionsHtml }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --ink: #1d2430;
        --muted: #5b6472;
        --line: #d9deea;
        --line-strong: #bbc4d9;
        --accent: #0e547d;
        --link: #3f434a;
        --link-line: #8f939b;
        --code-bg: #f5f7fb;
      }
      html, body {
        margin: 0;
        padding: 0;
      }
      body {
        font-family: "Helvetica Neue", "Segoe UI", Arial, sans-serif;
        color: var(--ink);
        line-height: 1.45;
        font-size: 11pt;
      }
      .toc-section {
        margin: 0;
        padding: 6pt 0 0;
      }
      .toc-section-break {
        page-break-after: always;
      }
      .toc-heading {
        margin: 0 0 18pt;
        text-align: center;
        font-size: 28pt;
        font-weight: 700;
        color: #1f2732;
      }
      .toc-list {
        width: 100%;
      }
      .toc-entry {
        display: block;
        overflow: hidden;
        margin: 0 0 8pt;
        padding: 0;
        line-height: 1.25;
        white-space: nowrap;
      }
      .toc-title,
      .toc-title:link,
      .toc-title:visited,
      .toc-page,
      .toc-page:link,
      .toc-page:visited {
        color: #2d333b !important;
        text-decoration: none !important;
        border-bottom: none !important;
      }
      .toc-title-wrap {
        float: left;
        display: block;
        padding-right: 8pt;
      }
      .toc-title {
        display: block;
        font-size: 17px;
        white-space: nowrap;
      }
      .toc-entry.level-2 .toc-title-wrap {
        padding-left: 15pt;
      }
      .toc-entry.level-2 .toc-title {
        font-size: 15px;
      }
      .toc-page-wrap {
        float: right;
        display: block;
        margin-left: 4pt;
        text-align: right;
      }
      .toc-page {
        display: block;
        font-size: 17px;
        font-variant-numeric: tabular-nums;
        font-feature-settings: "tnum";
        white-space: nowrap;
      }
      .toc-entry.level-2 .toc-page {
        font-size: 15px;
      }
      .toc-leader {
        display: block;
        overflow: hidden;
        color: #6f7682;
        font-size: 17px;
        line-height: 1.25;
        letter-spacing: 0.02em;
        white-space: pre;
      }
      .toc-entry.level-2 .toc-leader {
        font-size: 15px;
      }
      .doc-section {
        page-break-before: always;
      }
      .doc-section:first-of-type {
        page-break-before: auto;
      }
      h1, h2, h3, h4, h5, h6 {
        color: var(--accent);
        line-height: 1.2;
        margin-top: 1.25em;
        margin-bottom: 0.45em;
      }
      h1 {
        font-size: 22pt;
        border-bottom: 2px solid var(--line);
        padding-bottom: 5px;
      }
      h2 {
        font-size: 17pt;
        border-bottom: 1px solid var(--line);
        padding-bottom: 3px;
      }
      h3 { font-size: 14pt; }
      h4 { font-size: 12pt; }
      p, li {
        color: var(--ink);
      }
      a,
      a:link,
      a:visited,
      a:hover,
      a:active {
        color: #3f434a !important;
        text-decoration: none !important;
        border-bottom: 1px solid #8f939b;
      }
      h1 a, h2 a, h3 a, h4 a, h5 a, h6 a {
        color: #2d333b !important;
        border-bottom: 1px solid #8f939b;
      }
      strong {
        font-weight: 700;
      }
      code {
        font-family: Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        background: var(--code-bg);
        border: 1px solid var(--line);
        border-radius: 3px;
        font-size: 0.9em;
        padding: 1px 4px;
      }
      pre {
        background: var(--code-bg);
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 10px 12px;
        overflow-x: auto;
        white-space: pre-wrap;
      }
      pre code {
        background: transparent;
        border: 0;
        padding: 0;
      }
      ul, ol {
        margin: 0.4em 0 0.7em 1.45em;
      }
      li {
        margin: 0.2em 0;
      }
      blockquote {
        margin: 0.8em 0;
        padding: 0.1em 0.9em;
        border-left: 4px solid var(--line-strong);
        color: #2f3a48;
        background: #f7f9fc;
      }
      .table-wrap {
        overflow-x: auto;
      }
      .image-block {
        margin: 0.9em auto 1.2em;
        text-align: center;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .doc-image {
        display: block;
        margin: 0 auto;
        max-width: 100%;
        width: auto;
        height: auto;
        max-height: 182mm;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #ffffff;
      }
      .image-caption {
        margin-top: 0.5em;
        color: var(--muted);
        font-size: 9pt;
        font-style: italic;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 0.7em 0 1.1em;
        table-layout: fixed;
      }
      thead th {
        background: #edf2f8;
        text-align: left;
        color: #223142;
      }
      th, td {
        border: 1px solid var(--line);
        padding: 6px 8px;
        vertical-align: top;
        font-size: 10pt;
        word-break: break-word;
      }
      tbody tr:nth-child(even) {
        background: #fafbfd;
      }
      @media print {
        a {
          color: var(--ink);
        }
      }
    </style>
  </head>
  <body>
${tocHtml}
${sectionsHtml}
  </body>
</html>`;
}

function buildHeaderHtml({ title, logoUrl }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        font-family: "Helvetica Neue", "Segoe UI", Arial, sans-serif;
        color: #2b3440;
      }
      .header {
        position: relative;
        height: 16mm;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 1.3mm 2mm 0.8mm;
        box-sizing: border-box;
      }
      .header::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: 13.4mm;
        border-bottom: 1px solid #ced5e3;
      }
      .left {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
      }
      .left img {
        width: 11mm;
        height: 11mm;
        transform: translateY(2mm);
        object-fit: contain;
      }
      .title {
        font-size: 9pt;
        font-weight: 600;
        color: #21354f;
        margin-top: 0.6mm;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .section {
        font-size: 8pt;
        color: #5d6674;
        margin-top: 1.3mm;
        white-space: nowrap;
      }
    </style>
  </head>
  <body onload="subst()">
    <div class="header">
      <div class="left">
        <img src="${escapeAttribute(logoUrl)}" alt="Orchestron logo" />
        <span class="title">${escapeHtml(title)}</span>
      </div>
      <span class="section"></span>
    </div>
    <script>
      function subst() {
        var vars = {};
        var pairs = document.location.search.substring(1).split("&");
        for (var i = 0; i < pairs.length; i += 1) {
          if (!pairs[i]) continue;
          var token = pairs[i].split("=", 2);
          vars[token[0]] = decodeURIComponent(token[1] || "");
        }
        var nodes = document.getElementsByClassName("section");
        for (var index = 0; index < nodes.length; index += 1) {
          nodes[index].textContent = vars.section || "";
        }
      }
    </script>
  </body>
</html>`;
}

function buildFooterHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        font-family: "Helvetica Neue", "Segoe UI", Arial, sans-serif;
        color: #586170;
      }
      .footer {
        height: 10mm;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid #ced5e3;
        padding: 1.8mm 2mm 0;
        box-sizing: border-box;
        font-size: 8pt;
      }
    </style>
  </head>
  <body onload="subst()">
    <div class="footer">
      <span>Orchestron</span>
      <span>Page <span class="page"></span> / <span class="topage"></span></span>
      <span class="isodate"></span>
    </div>
    <script>
      function subst() {
        var vars = {};
        var pairs = document.location.search.substring(1).split("&");
        for (var i = 0; i < pairs.length; i += 1) {
          if (!pairs[i]) continue;
          var token = pairs[i].split("=", 2);
          vars[token[0]] = decodeURIComponent(token[1] || "");
        }
        var classes = ["page", "topage", "isodate"];
        for (var c = 0; c < classes.length; c += 1) {
          var nodes = document.getElementsByClassName(classes[c]);
          for (var n = 0; n < nodes.length; n += 1) {
            nodes[n].textContent = vars[classes[c]] || "";
          }
        }
      }
    </script>
  </body>
</html>`;
}

function runWkhtmltopdfPage({ inputPath, headerPath, footerPath, outputPath, title }) {
  const args = [
    "--enable-local-file-access",
    "--encoding",
    "utf-8",
    "--print-media-type",
    "--margin-top",
    "26",
    "--margin-bottom",
    "18",
    "--margin-left",
    "16",
    "--margin-right",
    "16",
    "--header-html",
    headerPath,
    "--header-spacing",
    "6",
    "--footer-html",
    footerPath,
    "--footer-spacing",
    "5",
    "--title",
    title,
    "--javascript-delay",
    "200",
    inputPath,
    outputPath
  ];

  const result = spawnSync("wkhtmltopdf", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const details = [
      "wkhtmltopdf failed.",
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    throw new Error(details);
  }
}

function runWkhtmltopdfDocument({ coverPath, mainPath, headerPath, footerPath, outputPath, title }) {
  const args = [
    "--enable-local-file-access",
    "--encoding",
    "utf-8",
    "--print-media-type",
    "--margin-top",
    "26",
    "--margin-bottom",
    "18",
    "--margin-left",
    "16",
    "--margin-right",
    "16",
    "--header-html",
    headerPath,
    "--header-spacing",
    "6",
    "--footer-html",
    footerPath,
    "--footer-spacing",
    "5",
    "--title",
    title,
    "--outline-depth",
    "2",
    "--javascript-delay",
    "200",
    "cover",
    coverPath,
    mainPath,
    outputPath
  ];

  const result = spawnSync("wkhtmltopdf", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const details = [
      "wkhtmltopdf failed.",
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    throw new Error(details);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const entryFile = resolvePath(args.input);
  const outputFile = resolvePath(args.output);
  const logoFile = resolvePath(args.logo);
  const docsRoot = path.resolve(path.dirname(entryFile));

  assertFileExists(entryFile, "Input markdown file");
  assertFileExists(logoFile, "Logo file");

  const wkhtmlResult = spawnSync("wkhtmltopdf", ["--version"], { encoding: "utf8" });
  if (wkhtmlResult.status !== 0) {
    throw new Error("wkhtmltopdf is required but not available on PATH.");
  }

  const markdownFiles = collectMarkdownFiles(entryFile, docsRoot);
  const anchorsByFile = new Map();
  for (const file of markdownFiles) {
    const relative = path.relative(repoRoot, file).replaceAll(path.sep, "/");
    anchorsByFile.set(file, `doc-${slugify(relative)}`);
  }

  const fileInfos = [];
  const sections = [];
  for (const file of markdownFiles) {
    const markdown = sanitizeMarkdown(fs.readFileSync(file, "utf8"));
    const blocks = parseBlocks(markdown);
    const sectionAnchor = anchorsByFile.get(file);
    const context = { currentFile: file, anchorsByFile, sectionAnchor };
    const rendered = renderBlocks(blocks, context);
    const title = getFirstHeadingText(blocks, path.basename(file, ".md"));
    const sectionHtml = `<section class="doc-section" id="${escapeAttribute(sectionAnchor)}">\n${rendered}\n</section>`;
    sections.push(sectionHtml);
    fileInfos.push({
      file,
      title,
      anchor: sectionAnchor,
      tocLevel: getTocLevel(file, entryFile, docsRoot),
      sectionHtml
    });
  }

  const generatedAt = new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });
  const coverHtml = buildCoverHtml({
    title: args.title,
    generatedAt,
    logoUrl: pathToFileURL(logoFile).toString()
  });
  const headerHtml = buildHeaderHtml({
    title: args.title,
    logoUrl: pathToFileURL(logoFile).toString()
  });
  const footerHtml = buildFooterHtml();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestron-docs-"));
  const coverPath = path.join(tempDir, "cover.html");
  const headerPath = path.join(tempDir, "header.html");
  const footerPath = path.join(tempDir, "footer.html");
  fs.writeFileSync(coverPath, coverHtml, "utf8");
  fs.writeFileSync(headerPath, headerHtml, "utf8");
  fs.writeFileSync(footerPath, footerHtml, "utf8");

  let runningContentPage = 1;
  for (let index = 0; index < fileInfos.length; index += 1) {
    const info = fileInfos[index];
    const sectionOnlyHtml = buildMainHtml({
      title: info.title,
      tocHtml: "",
      sectionsHtml: info.sectionHtml
    });
    const sectionHtmlPath = path.join(tempDir, `section-${index}.html`);
    const sectionPdfPath = path.join(tempDir, `section-${index}.pdf`);
    fs.writeFileSync(sectionHtmlPath, sectionOnlyHtml, "utf8");
    runWkhtmltopdfPage({
      inputPath: sectionHtmlPath,
      headerPath,
      footerPath,
      outputPath: sectionPdfPath,
      title: info.title
    });
    const pageCount = Math.max(1, countPdfPages(sectionPdfPath));
    info.contentStartPage = runningContentPage;
    info.pageCount = pageCount;
    runningContentPage += pageCount;
  }

  let tocPageCount = 1;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tocEntries = fileInfos.map((info) => ({
      title: info.title,
      level: info.tocLevel,
      anchor: info.anchor,
      page: info.contentStartPage + 1 + tocPageCount
    }));
    const tocOnlyHtml = buildMainHtml({
      title: args.title,
      tocHtml: buildTocMarkup(tocEntries, false),
      sectionsHtml: ""
    });
    const tocMeasureHtmlPath = path.join(tempDir, `toc-measure-${attempt}.html`);
    const tocMeasurePdfPath = path.join(tempDir, `toc-measure-${attempt}.pdf`);
    fs.writeFileSync(tocMeasureHtmlPath, tocOnlyHtml, "utf8");
    runWkhtmltopdfPage({
      inputPath: tocMeasureHtmlPath,
      headerPath,
      footerPath,
      outputPath: tocMeasurePdfPath,
      title: `${args.title} - TOC`
    });
    const measuredPages = Math.max(1, countPdfPages(tocMeasurePdfPath));
    if (measuredPages === tocPageCount) {
      break;
    }
    tocPageCount = measuredPages;
  }

  const tocEntries = fileInfos.map((info) => ({
    title: info.title,
    level: info.tocLevel,
    anchor: info.anchor,
    page: info.contentStartPage + 1 + tocPageCount
  }));
  const contentPath = path.join(tempDir, "main.html");
  const finalMainHtml = buildMainHtml({
    title: args.title,
    tocHtml: buildTocMarkup(tocEntries, true),
    sectionsHtml: sections.join("\n")
  });
  fs.writeFileSync(contentPath, finalMainHtml, "utf8");

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  runWkhtmltopdfDocument({
    coverPath,
    mainPath: contentPath,
    headerPath,
    footerPath,
    outputPath: outputFile,
    title: args.title
  });

  if (!args.keepTemp) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`PDF generated: ${outputFile}`);
  if (args.keepTemp) {
    console.log(`Temporary files: ${tempDir}`);
  }
  console.log(`Source files included: ${markdownFiles.length}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
