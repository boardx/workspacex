#!/usr/bin/env python3
"""
add-source.py — admit a research report to the site's register of sources.

The demo may quote a consultancy or analyst report only through
docs/sources/index.json, and a sentence gets into that register only by being
found, word for word, in the report itself. This script is that finding.

It reads a PDF (or a saved page as .txt / .html), extracts its text page by
page, and looks for each quote after normalizing only what extraction breaks:
Unicode compatibility forms (ligatures such as "ﬁ"), curly versus straight
quotes, hyphens split across line ends, and runs of whitespace. Nothing else
is forgiven — a changed word, number or order is a miss. On a miss it prints
the closest passage it did find and exits 1, writing nothing.

On success it records, for the source: firm, title, date, URL, the SHA-256 of
the exact file read, and each quote with its page. The file itself and its
full text are NOT committed (docs/sources/raw/ is ignored): the repository is
open source and the reports are not ours to republish. The hash lets anyone
holding the same file re-run this and get the same answer.

  python3 scripts/add-source.py docs/sources/raw/state-of-ai-2026.pdf \\
      --id mckinsey-state-of-ai-2026 --firm McKinsey \\
      --title "The state of AI in 2026: On the road to ROI" \\
      --date 2026-08 --url https://www.mckinsey.com/... \\
      --quote "exact sentence as printed" [--quote "another"]

  python3 scripts/add-source.py FILE --id ID --verify
      re-read FILE and confirm every quote already registered for ID is still
      found, on the page recorded, and that the file's hash matches.

Needs pypdf for PDFs (pip install pypdf).
"""
import argparse
import difflib
import hashlib
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / 'docs' / 'sources' / 'index.json'


def normalize(text: str) -> str:
    text = unicodedata.normalize('NFKC', text)
    text = text.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    text = text.replace('­', '')                     # soft hyphen
    text = re.sub(r'(\w)-\s*\n\s*(\w)', r'\1\2', text)     # word-\nbreak -> wordbreak
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def pages_of(path: Path) -> list[str]:
    suffix = path.suffix.lower()
    if suffix == '.pdf':
        try:
            from pypdf import PdfReader
        except ImportError:
            sys.exit('add-source: reading a PDF needs pypdf — pip install pypdf')
        return [page.extract_text() or '' for page in PdfReader(str(path)).pages]
    raw = path.read_text(encoding='utf-8', errors='replace')
    if suffix in ('.html', '.htm'):
        raw = re.sub(r'(?is)<(script|style)\b.*?</\1>', ' ', raw)
        raw = html.unescape(re.sub(r'(?s)<[^>]+>', ' ', raw))
    return [raw]


def find(quote: str, pages: list[str]):
    q = normalize(quote)
    for number, text in enumerate(pages, start=1):
        if q in normalize(text):
            return number
    return None


def nearest(quote: str, pages: list[str]) -> str:
    q = normalize(quote)
    best, best_ratio, where = '', 0.0, 0
    for number, text in enumerate(pages, start=1):
        t = normalize(text)
        step = max(1, len(q) // 4)
        for i in range(0, max(1, len(t) - len(q) + 1), step):
            window = t[i:i + len(q)]
            ratio = difflib.SequenceMatcher(None, q, window).ratio()
            if ratio > best_ratio:
                best, best_ratio, where = window, ratio, number
    return f'p.{where} ({best_ratio:.0%} similar): "{best}"' if best else '(no text extracted)'


def load_index() -> list:
    return json.loads(INDEX.read_text(encoding='utf-8')) if INDEX.exists() else []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('file', type=Path)
    ap.add_argument('--id', required=True)
    ap.add_argument('--firm')
    ap.add_argument('--title')
    ap.add_argument('--date')
    ap.add_argument('--url')
    ap.add_argument('--quote', action='append', default=[])
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--index', type=Path, help='register to use (default docs/sources/index.json; for testing)')
    a = ap.parse_args()
    global INDEX
    if a.index:
        INDEX = a.index.resolve()

    data = a.file.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    pages = pages_of(a.file)
    index = load_index()
    entry = next((e for e in index if e['id'] == a.id), None)

    if a.verify:
        if not entry:
            print(f'✗ no source "{a.id}" in {INDEX}'); return 1
        ok = entry['sha256'] == sha
        if not ok:
            print(f'✗ {a.file}: hash {sha[:12]}… is not the file registered ({entry["sha256"][:12]}…)')
        for q in entry['quotes']:
            page = find(q['text'], pages)
            if page is None or (q['page'] is not None and page != q['page']):
                ok = False
                print(f'✗ "{q["text"][:60]}…" — registered on p.{q["page"]}, found on {page}')
        print('✓ every registered quote is still in the file' if ok else '')
        return 0 if ok else 1

    missing_meta = [k for k in ('firm', 'title', 'date', 'url') if not getattr(a, k)]
    if missing_meta:
        print(f'✗ a new source needs --{", --".join(missing_meta)}'); return 1
    if not a.url.startswith('https://'):
        print('✗ --url must be the https address the file was downloaded from'); return 1
    if not re.fullmatch(r'\d{4}(-\d{2}(-\d{2})?)?', a.date):
        print('✗ --date is YYYY, YYYY-MM or YYYY-MM-DD'); return 1
    if not a.quote:
        print('✗ nothing to register — pass at least one --quote'); return 1

    found, failed = [], False
    for quote in a.quote:
        page = find(quote, pages)
        if page is None:
            failed = True
            print(f'✗ not in the file: "{quote}"\n    closest: {nearest(quote, pages)}')
        else:
            # A web page has no pages: record none rather than a meaningless 1.
            found.append({'text': quote.strip(), 'page': page if a.file.suffix.lower() == '.pdf' else None})
            print(f'✓ {"p." + str(page) if a.file.suffix.lower() == ".pdf" else "found"}: "{quote[:70]}{"…" if len(quote) > 70 else ""}"')
    if failed:
        print('\nNothing written. Copy the sentence exactly as printed.'); return 1

    record = {'id': a.id, 'firm': a.firm, 'title': a.title, 'date': a.date, 'url': a.url,
              'sha256': sha, 'kind': 'pdf' if a.file.suffix.lower() == '.pdf' else 'page', 'quotes': found}
    if entry:
        known = {q['text'] for q in entry['quotes']}
        record['quotes'] = entry['quotes'] + [q for q in found if q['text'] not in known]
        index = [record if e['id'] == a.id else e for e in index]
    else:
        index.append(record)
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'\n✓ wrote {INDEX} — {a.id}, {len(record["quotes"])} quote(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
