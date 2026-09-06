"""Replace one complete plain-text OOXML text node; preserve every other ZIP entry.
Usage: python3 edit-ooxml.py input.docx output.docx member.xml old-text new-text
Not arbitrary paragraph/run rewriting, layout editing, or a PptxGenJS import engine.
"""
import sys, zipfile, re
from xml.sax.saxutils import escape
from xml.etree import ElementTree
source, target, member, old, new = sys.argv[1:]
if source == target or not old:
    raise ValueError('Use a different output file and nonempty exact source text')
if not ((source.endswith('.docx') and member == 'word/document.xml') or
        (source.endswith('.pptx') and re.fullmatch(r'ppt/slides/slide[1-9][0-9]*\.xml', member))):
    raise ValueError('Only document body or explicit slide text is supported')
with zipfile.ZipFile(source) as archive:
    if len(archive.namelist()) != len(set(archive.namelist())):
        raise ValueError('Ambiguous duplicate ZIP entries')
    if sum(entry.file_size for entry in archive.infolist()) > 64 * 1024 * 1024:
        raise ValueError('Expanded file too large')
    xml = archive.read(member).decode('utf-8')
    tag = 'w:t' if source.endswith('.docx') else 'a:t'
    pattern = re.compile(r'(<'+tag+r'(?:\s[^>]*)?>)'+re.escape(escape(old))+r'(</'+tag+r'>)')
    if len(pattern.findall(xml)) != 1:
        raise ValueError('Expected exactly one whole text node; split runs or ambiguous text unsupported')
    changed = pattern.sub(lambda match: match[1]+escape(new)+match[2], xml)
    ElementTree.fromstring(changed)
    with zipfile.ZipFile(target, 'w') as output:
        for entry in archive.infolist():
            output.writestr(entry, changed.encode() if entry.filename == member else archive.read(entry))
print('Changed one text node; all other ZIP entry bytes preserved. Render QA still required.')
