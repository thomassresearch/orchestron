#!/usr/bin/env python3
"""Audit a --keep-temp manual build. Requires pypdf; no backend or audio engine."""

import argparse
import html
import json
from pathlib import Path
import re

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]


def declared_pages(node, parent=None, depth=0):
    title = (ROOT / 'documentation' / node['path']).read_text().splitlines()[0][2:]
    yield title, parent, depth
    for child in node.get('children', []):
        yield from declared_pages(child, title, depth + 1)


def bookmarks(items, parents=()):
    previous = None
    for item in items:
        if isinstance(item, list):
            yield from bookmarks(item, (*parents, previous))
        else:
            previous = item.title
            yield item, parents


def page_number(reader, destination):
    # Qt sometimes stores a zero-based integer instead of a page reference.
    page = destination['/Page']
    return (page if isinstance(page, int) else reader.get_destination_page_number(destination)) + 1


def verify(pdf_path, build_dir):
    source = (build_dir / 'main.html').read_text()
    reader = PdfReader(pdf_path)
    rows = re.findall(
        r'<div class="toc-entry level-(\d+)">\s*'
        r'<span class="toc-page-wrap"><a[^>]*>(\d+)</a></span>\s*'
        r'<span class="toc-title-wrap"><a[^>]*>([^<]+)</a>', source
    )
    entries = list(declared_pages(json.loads((ROOT / 'documentation/manual.json').read_text())['root']))
    assert len(rows) == len(entries), 'PDF must contain the complete declared manual'
    first_content_page = int(rows[0][1])
    toc_text = ' '.join(' '.join(page.extract_text().split()) for page in reader.pages[1:first_content_page - 1])
    toc_links = []
    internal_count = 0
    for index, page in enumerate(reader.pages):
        for reference in page.get('/Annots', []):
            annotation = reference.get_object()
            action = annotation.get('/A', {})
            target = annotation.get('/Dest', action.get('/D') if action.get('/S') == '/GoTo' else None)
            if target is None:
                continue
            assert target in reader.named_destinations, f'Unresolved PDF link on page {index + 1}: {target}'
            number = page_number(reader, reader.named_destinations[target])
            assert 1 <= number <= len(reader.pages), f'Out-of-range PDF link: {number}'
            internal_count += 1
            if 1 <= index < first_content_page - 1:
                toc_links.append(number)
    assert len(toc_links) == len(rows) * 2, 'Each contents row must link both its title and page number'
    outline = list(bookmarks(reader.outline))
    for index, ((level, number, encoded_title), (title, parent, depth)) in enumerate(zip(rows, entries)):
        number = int(number)
        assert html.unescape(encoded_title) == title, f'Contents order mismatch: {title}'
        assert int(level) == max(1, depth), f'Wrong contents indentation: {title}'
        assert toc_links[index * 2:index * 2 + 2] == [number, number], f'Contents links miss page {number}: {title}'
        assert f'{number} {title}' in toc_text, f'Printed contents number mismatch: {title}'
        assert title in ' '.join(reader.pages[number - 1].extract_text().split()), f'Title absent from page {number}: {title}'
        matches = [(item, ancestors) for item, ancestors in outline if item.title == title and page_number(reader, item) == number]
        assert len(matches) == 1, f'Missing or duplicate bookmark: {title}'
        ancestors = matches[0][1]
        assert (ancestors[-1] if ancestors else None) == (parent if depth > 1 else None), f'Wrong bookmark parent: {title}'
    ids = set(re.findall(r'\bid="([^"]+)"', source))
    links = set(re.findall(r'href="#([^"]+)"', source))
    assert links <= ids, f'Missing HTML destinations: {links - ids}'
    print(f'PDF verified: {len(reader.pages)} pages, {len(rows)} contents entries, {internal_count} internal links; page numbers and bookmark parents agree.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pdf', type=Path, default=ROOT / 'documentation/user_documentation.pdf')
    parser.add_argument('--build-dir', type=Path, required=True, help='Temporary directory printed by --keep-temp')
    args = parser.parse_args()
    verify(args.pdf, args.build_dir)
