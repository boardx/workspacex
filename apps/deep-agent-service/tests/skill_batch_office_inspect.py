"""Read generated Office bytes, never execute generated source. Manual rendering remains required."""
import argparse
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


def inspect(path: Path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        assert len(names) <= 1000, 'unexpected package size'
        assert sum(i.file_size for i in archive.infolist()) <= 64 * 1024 * 1024, 'expanded package exceeds inspection bound'
        assert archive.testzip() is None, 'corrupt ZIP member'
        if path.suffix == '.docx':
            parts = [n for n in names if n == 'word/document.xml' or re.fullmatch(r'word/header\d+\.xml', n)]
        elif path.suffix == '.pptx':
            parts = sorted(n for n in names if re.fullmatch(r'ppt/slides/slide\d+\.xml', n))
            assert len(parts) == 3, f'expected three slides, got {len(parts)}'
        elif path.suffix == '.xlsx':
            parts = sorted(n for n in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n))
        else:
            raise ValueError('only DOCX/XLSX/PPTX supported')
        texts, formulas = {}, []
        for name in parts:
            root = ET.fromstring(archive.read(name))
            texts[name] = ' '.join(el.text or '' for el in root.iter() if el.tag.rsplit('}', 1)[-1] in ('t', 'v'))
            for cell in root.iter():
                if cell.tag.rsplit('}', 1)[-1] != 'c':
                    continue
                children = {e.tag.rsplit('}', 1)[-1]: e.text for e in cell}
                if 'f' in children:
                    formulas.append({'sheet': name, 'cell': cell.attrib.get('r'), 'formula': children['f'], 'cached': children.get('v')})
        if path.suffix == '.xlsx':
            assert any('SUM(' in (f['formula'] or '').upper() and float(f['cached'] or 'nan') == 42 for f in formulas), 'missing actual SUM formula with cached 42'
        return {'file': path.name, 'parts': texts, 'formulas': formulas, 'visualReviewStillRequired': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('path', type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect(args.path), ensure_ascii=False, indent=2))
