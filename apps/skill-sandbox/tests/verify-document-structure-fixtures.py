"""Executable real-file assertions for the W08 structure adapter."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).parents[1]
FIXTURES = Path(__file__).parent / "fixtures" / "document-structure"
PARSER = ROOT / "scripts" / "structure-document.py"
FILES = {
    "pdf": ("cross-page-table.pdf", "application/pdf"),
    "docx": ("native-locators.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "pptx": ("native-locators.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    "xlsx": ("native-locators.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory(prefix="w08-structure-") as directory:
    parsed = {}
    before = {kind: digest(FIXTURES / filename) for kind, (filename, _) in FILES.items()}
    for kind, (filename, media_type) in FILES.items():
        output = Path(directory) / f"{kind}.json"
        subprocess.run(
            [sys.executable, str(PARSER), "--source", str(FIXTURES / filename), "--media-type", media_type, "--output", str(output)],
            check=True,
        )
        parsed[kind] = json.loads(output.read_text(encoding="utf-8"))
    after = {kind: digest(FIXTURES / filename) for kind, (filename, _) in FILES.items()}
    assert before == after

    pdf = parsed["pdf"]
    assert [table["pageNumber"] for table in pdf["tables"]] == [1, 2]
    assert pdf["tables"][0]["tableId"] == pdf["tables"][1]["tableId"]
    assert pdf["tables"][1]["continuationDetection"] == "repeated_header_and_columns"
    assert any(chunk["type"] == "pdf_text" and chunk["locator"]["pageNumber"] == 2 for chunk in pdf["chunks"])
    assert any(chunk["text"] == "450" and chunk["locator"]["pageNumber"] == 2 for chunk in pdf["chunks"])

    docx = parsed["docx"]
    assert any(chunk["type"] == "docx_paragraph" and chunk["locator"] == {"paragraphIndex": 0} for chunk in docx["chunks"])
    assert any(chunk["type"] == "docx_table_cell" and chunk["text"] == "120" and chunk["locator"] == {"tableIndex": 0, "rowIndex": 1, "columnIndex": 1} for chunk in docx["chunks"])
    assert all("pageNumber" not in chunk["locator"] for chunk in docx["chunks"])

    pptx = parsed["pptx"]
    assert any(chunk["type"] == "pptx_element" and chunk["locator"]["slideNumber"] == 1 for chunk in pptx["chunks"])
    assert any(chunk["type"] == "pptx_table_cell" and chunk["locator"]["slideNumber"] == 2 and chunk["text"] == "120" for chunk in pptx["chunks"])

    xlsx = parsed["xlsx"]
    assert any(chunk["locator"]["sheetName"] == "数据" and chunk["locator"]["address"] == "B2" and chunk["text"] == "120" for chunk in xlsx["chunks"])
    assert any(chunk["locator"]["address"] == "C2" and chunk["text"] == "=B2*2" for chunk in xlsx["chunks"])
    assert any(chunk["locator"]["address"] == "A4" and chunk["locator"]["mergedRange"] == "A4:B4" for chunk in xlsx["chunks"])

    unsupported = subprocess.run(
        [sys.executable, str(PARSER), "--source", str(FIXTURES / FILES["docx"][0]), "--media-type", "application/vnd.oasis.opendocument.text", "--output", str(Path(directory) / "unsupported.json")],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    assert unsupported.returncode != 0
    assert not (Path(directory) / "unsupported.json").exists()
    print(json.dumps({
        "engines": {kind: value["engine"] for kind, value in parsed.items()},
        "pdfPages": [table["pageNumber"] for table in pdf["tables"]],
        "pdfTableId": pdf["tables"][0]["tableId"],
        "docxChunks": len(docx["chunks"]),
        "pptxChunks": len(pptx["chunks"]),
        "xlsxChunks": len(xlsx["chunks"]),
        "sourceBytesUnchanged": True,
        "unsupportedRejected": True,
    }, ensure_ascii=False))
