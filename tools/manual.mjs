/** Explicit ownership and navigation for the user manual. No link traversal. */
import fs from 'node:fs';
import path from 'node:path';

export function slugify(text) {
  return text.replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/`([^`]+)`/g, '$1').replace(/\*+/g, '').replace(/\b_([^_]+)_\b/g, '$1').toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

export function withoutCode(markdown) {
  let fence = null;
  return markdown.replace(/<!--(?!\s*manual-contents:)[\s\S]*?-->/g, '')
    .split('\n').map(line => {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
        return '';
      }
      if (match) { fence = match[1]; return ''; }
      return /^(?: {4}|\t)/.test(line) ? '' : line;
    }).join('\n');
}

export function headings(markdown) {
  const counts = new Map();
  return [...withoutCode(markdown).matchAll(/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/gm)].map(match => {
    const text = match[2];
    const base = slugify(text);
    let slug = base;
    let count = counts.get(base) || 0;
    while (counts.has(slug)) slug = `${base}-${++count}`;
    counts.set(base, count);
    counts.set(slug, 0);
    return { level: match[1].length, text, slug };
  });
}

function mdFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? mdFiles(file) : /\.md$/i.test(file) ? [file] : [];
  });
}

export function loadManual(root) {
  root = fs.realpathSync(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manual.json'), 'utf8'));
  if (manifest.version !== 1) throw new Error('Unsupported manual manifest version');
  const entries = [];
  const owned = new Set();
  const realFiles = new Set();
  function resolve(relative) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || !/\.md$/.test(relative)) throw new Error(`Invalid manual path: ${relative}`);
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) throw new Error(`Manual path escapes documentation: ${relative}`);
    if (!fs.existsSync(file)) throw new Error(`Missing manual page: ${relative}`);
    const realFile = fs.realpathSync(file);
    if (!realFile.startsWith(root + path.sep)) throw new Error(`Manual symlink escapes documentation: ${relative}`);
    if (!fs.statSync(file).isFile()) throw new Error(`Manual page is not a file: ${relative}`);
    if (owned.has(file) || realFiles.has(realFile)) throw new Error(`Duplicate manual ownership: ${relative}`);
    owned.add(file);
    realFiles.add(realFile);
    return file;
  }
  function visit(node, parent = null, depth = 0) {
    if (!node || typeof node !== 'object') throw new Error('Manual entries must be objects with a page path');
    const file = resolve(node.path);
    const markdown = fs.readFileSync(file, 'utf8');
    const titles = headings(markdown).filter(h => h.level === 1);
    if (titles.length !== 1 || !markdown.startsWith('# ')) throw new Error(`${node.path}: expected one opening H1 title`);
    const entry = { file, path: node.path, title: titles[0].text, markdown, parent, depth, children: [] };
    entries.push(entry);
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error(`${node.path}: children must be an array`);
    entry.children = (node.children || []).map(child => visit(child, entry, depth + 1));
    return entry;
  }
  const tree = visit(manifest.root);
  if (!Array.isArray(manifest.excluded)) throw new Error('Manual exclusions must be an explicit array');
  const excluded = manifest.excluded.map(item => {
    if (typeof item.reason !== 'string' || !item.reason.trim()) throw new Error(`Exclusion needs a reason: ${item.path}`);
    return { ...item, file: resolve(item.path) };
  });
  const unclassified = mdFiles(root).filter(file => !owned.has(file));
  if (unclassified.length) throw new Error(`Unclassified Markdown pages: ${unclassified.map(file => path.relative(root, file)).join(', ')}`);
  return { root, tree, entries, excluded };
}

export function selectEntries(manual, input) {
  const resolved = fs.existsSync(input) ? fs.realpathSync(input) : path.resolve(input);
  const entry = manual.entries.find(item => item.file === resolved);
  if (!entry) throw new Error(`Input is not a declared manual page: ${input}`);
  const result = [];
  function visit(item) { result.push(item); item.children.forEach(visit); }
  visit(entry);
  return result;
}

function relativeLink(from, to) { return path.relative(path.dirname(from.file), to.file).split(path.sep).join('/'); }
export function navigation(manual, entry) {
  const index = manual.entries.indexOf(entry);
  const links = [];
  if (entry.parent) links.push(`[Up](${relativeLink(entry, entry.parent)})`);
  if (index > 0) links.push(`[Previous](${relativeLink(entry, manual.entries[index - 1])})`);
  if (index + 1 < manual.entries.length) links.push(`[Next](${relativeLink(entry, manual.entries[index + 1])})`);
  return `**Navigation:**${links.length ? ' ' + links.join(' | ') : ''}`;
}

export function contents(entry, recursive = false) {
  const lines = [];
  function visit(child, indent) {
    lines.push(`${'  '.repeat(indent)}- [${child.title}](${relativeLink(entry, child)})`);
    if (recursive) child.children.forEach(item => visit(item, indent + 1));
  }
  entry.children.forEach(child => visit(child, 0));
  return `<!-- manual-contents:start -->\n${lines.join('\n')}\n<!-- manual-contents:end -->`;
}

export function anchors(markdown) {
  return new Set([...headings(markdown).map(h => h.slug),
    ...[...withoutCode(markdown).matchAll(/<(?:a|span)\b[^>]*\bid=["']([^"']+)["'][^>]*>/g)].map(m => m[1])]);
}

export function validateManual(manual) {
  const errors = [];
  const anchorCache = new Map();
  for (const entry of manual.entries) {
    const expected = navigation(manual, entry);
    const lines = entry.markdown.trimEnd().split('\n');
    const navs = lines.filter(line => line.startsWith('**Navigation:**'));
    if (navs.length !== 2 || navs.some(line => line !== expected) || lines[2] !== expected || lines.at(-1) !== expected) {
      errors.push(`${entry.path}: navigation must match the manifest and occur after the title and at the end`);
    }
    const blocks = [...entry.markdown.matchAll(/<!-- manual-contents:start -->[\s\S]*?<!-- manual-contents:end -->/g)];
    if (entry.children.length && (blocks.length !== 1 || blocks[0][0] !== contents(entry))) errors.push(`${entry.path}: contents must match the manifest`);
    if (!entry.children.length && blocks.length) errors.push(`${entry.path}: a leaf page cannot declare contents`);
    for (const heading of headings(entry.markdown)) {
      const title = heading.text.replace(/[*_`]/g, '').normalize('NFKD').replace(/\p{M}/gu, '');
      if (/^(english|french|german|spanish|francais|deutsch|espanol)\b/i.test(title) || /^screenshots?$/i.test(title)) errors.push(`${entry.path}: prohibited heading ${heading.text}`);
    }
    const source = withoutCode(entry.markdown);
    const targets = [...source.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)].map(m => m[1]);
    targets.push(...[...source.matchAll(/<(?:img|a)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)].map(m => m[1]));
    for (const target of targets) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
      const [rawFile, rawFragment] = target.split('#');
      let file;
      let fragment;
      try {
        file = rawFile ? path.resolve(path.dirname(entry.file), decodeURIComponent(rawFile)) : entry.file;
        fragment = rawFragment ? decodeURIComponent(rawFragment) : '';
      } catch { errors.push(`${entry.path}: invalid link ${target}`); continue; }
      if (!fs.existsSync(file)) { errors.push(`${entry.path}: missing local target ${target}`); continue; }
      if (fragment && /\.md$/i.test(file)) {
        if (!anchorCache.has(file)) anchorCache.set(file, anchors(fs.readFileSync(file, 'utf8')));
        if (!anchorCache.get(file).has(fragment)) errors.push(`${entry.path}: missing heading anchor ${target}`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

export function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, key) => {
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)));
    return named[key] || entity;
  });
}

/** wkhtmltopdf replaces HTML ids with WKANCHOR names in its outline. Match the
 * complete emitted heading sequence, not depth or title alone: even repeated
 * titles and nested manual pages then have unambiguous positions. */
export function reconcilePageNumbers(outline, files, firstContentPage) {
  const items = [...outline.matchAll(/<item\b[^>]*>/g)].map(([tag]) => ({
    page: Number(/\bpage="(\d+)"/.exec(tag)?.[1]),
    title: decodeEntities(/\btitle="([^"]*)"/.exec(tag)?.[1] || '')
  })).filter(item => item.page >= firstContentPage);
  const expectedCount = files.reduce((sum, file) => sum + file.outlineHeadings.length, 0);
  if (items.length !== expectedCount) throw new Error(`PDF outline has ${items.length} headings; expected ${expectedCount}`);
  let position = 0;
  return files.map(file => {
    const page = items[position].page;
    for (const title of file.outlineHeadings) {
      const actual = items[position++];
      if (actual.title !== title) throw new Error(`PDF outline heading mismatch: expected ${title}, found ${actual.title}`);
    }
    return page;
  });
}

export function pdfLink(rawHref, currentFile, anchorsByFile, headingsByFile, repositoryUrl) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawHref)) return rawHref;
  const [rawFile, rawFragment] = rawHref.split('#');
  const file = rawFile ? path.resolve(path.dirname(currentFile), decodeURIComponent(rawFile)) : currentFile;
  const fragment = rawFragment ? decodeURIComponent(rawFragment) : '';
  if (anchorsByFile.has(file)) {
    // anchors() lists source headings first, starting with the required page H1.
    // Link directly to that heading: Qt positions empty/block anchors differently.
    const destination = fragment || headingsByFile.get(file)?.values().next().value;
    if (!destination || !headingsByFile.get(file)?.has(destination)) throw new Error(`Missing PDF heading: ${rawHref} in ${currentFile}`);
    return `#${anchorsByFile.get(file)}-${destination}`;
  }
  return repositoryUrl(file, fragment);
}
