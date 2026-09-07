"""Finite DOCX/PPTX whole-text-node replacement with byte preservation."""
import json
import re
import sys
import zipfile
from xml.etree import ElementTree
from xml.sax.saxutils import escape


def fail(code, message, objects=None):
    print(json.dumps({"code": code, "message": message, "unsupportedObjects": objects or []}), file=sys.stderr)
    raise SystemExit(2)


try:
    source, target, member, old, new = sys.argv[1:]
    if source == target or not old:
        fail("OFFICE_EDIT_INVALID_TARGET", "Use a different output file and nonempty exact source text")
    is_docx = source.endswith(".docx")
    is_pptx = source.endswith(".pptx")
    if not ((is_docx and member == "word/document.xml") or
            (is_pptx and re.fullmatch(r"ppt/slides/slide[1-9][0-9]*\.xml", member))):
        fail("OFFICE_EDIT_UNSUPPORTED_TARGET", "Only the Word body or one explicit slide is supported")
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) != len({entry.filename for entry in entries}):
            fail("OFFICE_EDIT_AMBIGUOUS_ARCHIVE", "Duplicate ZIP entries are unsupported")
        if len(entries) > 4096 or sum(entry.file_size for entry in entries) > 64 * 1024 * 1024:
            fail("OFFICE_EDIT_STRUCTURE_LIMIT", "Archive exceeds the finite editing limit")
        try:
            xml = archive.read(member).decode("utf-8")
        except KeyError:
            fail("OFFICE_EDIT_TARGET_NOT_FOUND", "The requested OOXML part does not exist")
        unsupported_patterns = ({
            "embeddedObject": r"<w:(?:object|control)\b",
            "legacyDrawing": r"<w:pict\b",
            "externalChunk": r"<w:altChunk\b",
            "subDocument": r"<w:subDoc\b",
        } if is_docx else {
            "embeddedObject": r"<p:oleObj\b",
            "chartOrSmartArt": r"<p:graphicFrame\b",
            "nestedGroup": r"<p:grpSp\b",
            "contentPart": r"<p:contentPart\b",
        })
        unsupported = [name for name, pattern in unsupported_patterns.items() if re.search(pattern, xml)]
        if unsupported:
            fail("OFFICE_EDIT_UNSUPPORTED_OBJECT", "Unsupported objects make preservation unverifiable", unsupported)
        tag = "w:t" if is_docx else "a:t"
        pattern = re.compile(r"(<" + tag + r"(?:\s[^>]*)?>)" + re.escape(escape(old)) + r"(</" + tag + r">)")
        if len(pattern.findall(xml)) != 1:
            fail("OFFICE_EDIT_AMBIGUOUS_TEXT", "Expected exactly one whole text node; split runs and duplicate matches are unsupported")
        changed = pattern.sub(lambda match: match[1] + escape(new) + match[2], xml)
        ElementTree.fromstring(changed)
        with zipfile.ZipFile(target, "w") as output:
            for entry in entries:
                output.writestr(entry, changed.encode("utf-8") if entry.filename == member else archive.read(entry))
    print(json.dumps({"code": "OFFICE_EDIT_OK", "changedPart": member,
                      "preservation": "all_other_zip_entry_bytes_identical",
                      "visualInspection": "required"}))
except (UnicodeDecodeError, zipfile.BadZipFile) as error:
    fail("OFFICE_EDIT_INVALID_ARCHIVE", str(error))
