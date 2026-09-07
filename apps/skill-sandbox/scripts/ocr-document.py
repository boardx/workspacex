"""Bounded adapter for installed Poppler and Tesseract; no recognition engine here.

All policy limits are supplied by the trusted API from its shared contract.
The enclosing session execution supplies process-group cancellation and isolation.
"""
import argparse
import csv
import io
import json
import os
from pathlib import Path
import re
import resource
import tempfile
import subprocess
import time

from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--media-type', required=True, choices=['application/pdf', 'image/png', 'image/jpeg'])
    parser.add_argument('--directory', required=True)
    for name in ['max-pages', 'max-pixels', 'max-dimension', 'max-output-bytes', 'timeout-ms']:
        parser.add_argument('--' + name, required=True, type=int)
    args = parser.parse_args()
    if any(value <= 0 for value in [args.max_pages, args.max_pixels, args.max_dimension, args.max_output_bytes, args.timeout_ms]):
        raise ValueError('invalid trusted limits')
    source, directory = Path(args.source), Path(args.directory)
    if not source.is_file() or not str(source).startswith('/inputs/'):
        raise ValueError('original input required')
    if not re.fullmatch(r'/workspace/parsed-[a-f0-9-]{36}', str(directory)):
        raise ValueError('invalid output directory')
    directory.mkdir(exist_ok=False)
    deadline = time.monotonic() + args.timeout_ms / 1000
    environment = dict(os.environ, OMP_THREAD_LIMIT='1', OMP_NUM_THREADS='1')
    resource.setrlimit(resource.RLIMIT_FSIZE, (args.max_output_bytes, args.max_output_bytes))

    def command(argv):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('OCR deadline exceeded')
        # File-size rlimit bounds child output before allocation in this process.
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            subprocess.run(argv, check=True, stdout=output, stderr=errors, timeout=remaining, env=environment)
            output.seek(0)
            value = output.read(args.max_output_bytes + 1)
            if len(value) > args.max_output_bytes:
                raise ValueError('engine output limit exceeded')
            return value

    if args.media_type == 'application/pdf':
        info = command(['pdfinfo', str(source)]).decode('utf-8', errors='strict')
        match = re.search(r'^Pages:\s+(\d+)\s*$', info, re.MULTILINE)
        if not match or not 1 <= int(match[1]) <= args.max_pages:
            raise ValueError('PDF page limit exceeded or unknown')
        count = int(match[1])
    else:
        count = 1

    pages, sections = [], []
    for number in range(1, count + 1):
        image_path = source
        if args.media_type == 'application/pdf':
            image_path = directory / 'page.png'
            command(['pdftoppm', '-f', str(number), '-l', str(number), '-singlefile', '-scale-to', str(args.max_dimension), '-png', str(source), str(directory / 'page')])
        with Image.open(image_path) as image:
            width, height = image.size
            if width * height > args.max_pixels or max(width, height) > args.max_dimension:
                raise ValueError('image pixel limit exceeded')
            if getattr(image, 'n_frames', 1) != 1:
                raise ValueError('multi-frame image unsupported')
        # Tesseract's documented TSV output supplies real pixels and word confidence.
        raw = command(['tesseract', str(image_path), 'stdout', '-l', 'chi_sim+eng', 'tsv'])
        if len(raw) > args.max_output_bytes:
            raise ValueError('OCR output limit exceeded')
        words = []
        for row in csv.DictReader(io.StringIO(raw.decode('utf-8', errors='strict')), delimiter='\t', quoting=csv.QUOTE_NONE):
            if row['level'] != '5' or not row['text'].strip():
                continue
            left, top, word_width, word_height = (int(row[key]) for key in ['left', 'top', 'width', 'height'])
            confidence = float(row['conf'])
            if not (0 <= left <= width and 0 <= top <= height and 0 <= word_width <= width - left and 0 <= word_height <= height - top and 0 <= confidence <= 100):
                raise ValueError('invalid engine geometry/confidence')
            words.append({'text': row['text'], 'bbox': {'x': left, 'y': top, 'width': word_width, 'height': word_height}, 'confidence': confidence})
        pages.append({'pageNumber': number, 'width': width, 'height': height, 'words': words})
        sections.append('## Page ' + str(number) + '\n\n' + ' '.join(word['text'] for word in words))
        if args.media_type == 'application/pdf':
            image_path.unlink()
    if not any(page['words'] for page in pages):
        raise ValueError('OCR produced no recognized text')
    structure = json.dumps({'engine': 'tesseract', 'coordinateSpace': 'rendered_page_pixels', 'pages': pages}, ensure_ascii=False, allow_nan=False).encode('utf-8')
    markdown = ('\n\n'.join(sections) + '\n').encode('utf-8')
    if len(structure) + len(markdown) > args.max_output_bytes:
        raise ValueError('OCR output limit exceeded')
    (directory / 'structure.json').write_bytes(structure)
    (directory / 'document.md').write_bytes(markdown)


if __name__ == '__main__':
    main()
