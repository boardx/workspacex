"""Offline LibreOffice/Poppler rendering, inside the existing native session sandbox.
Usage: python3 render-office.py /workspace/input.docx /workspace/rendered
PDFs are copied; OOXML is converted by LibreOffice. Successful conversion is not visual QA.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile
import time

source = Path(sys.argv[1])
target = Path(sys.argv[2])
if source.suffix.lower() not in ('.docx', '.pptx', '.xlsx', '.pdf'):
    raise SystemExit('unsupported input format')
for path in (source, target):
    if not path.is_absolute() or '..' in path.parts or not path.is_relative_to('/workspace') or not path.resolve().is_relative_to('/workspace'):
        raise SystemExit('paths must be canonical /workspace paths')
if not source.is_file() or target.exists():
    raise SystemExit('input must be a file and output directory must be new')
if source.suffix.lower() != '.pdf' and not zipfile.is_zipfile(source):
    raise SystemExit('input is not an OOXML ZIP archive')
target.mkdir()
# fontconfig's normal /etc location is deliberately absent from the namespace.
# A private config points only at the already read-only preinstalled font directory.
with tempfile.TemporaryDirectory(prefix='office-render-') as scratch:
    config = Path(scratch) / 'fonts.conf'
    config.write_text('<fontconfig><dir>/usr/share/fonts</dir><cachedir>' + scratch + '/cache</cachedir></fontconfig>')
    env = dict(os.environ, FONTCONFIG_FILE=str(config), SAL_USE_VCLPLUGIN='svp', LD_LIBRARY_PATH='/usr/lib/libreoffice/program')
    pdf = target / (source.stem + '.pdf')
    if source.suffix.lower() == '.pdf':
        shutil.copyfile(source, pdf)
    else:
        command = ['/usr/lib/libreoffice/program/soffice.bin',
                   '-env:UserInstallation=' + (Path(scratch) / 'profile').as_uri(),
                   '--headless', '--convert-to', 'pdf', '--outdir', str(target), str(source)]
        # Official oosplash restarts EXITHELPER_NORMAL_RESTART (81) with all args.
        # Fresh profiles request this once. No crash retry and no renewed deadline.
        deadline = time.monotonic() + 60
        result = subprocess.run(command, env=env, timeout=60)
        if result.returncode == 81:
            result = subprocess.run(command, env=env, timeout=max(0.001, deadline - time.monotonic()))
        result.check_returncode()
    if not pdf.is_file() or pdf.stat().st_size == 0:
        raise SystemExit('renderer did not produce a PDF')
    subprocess.run(['pdftoppm', '-png', '-r', '96', str(pdf), str(target / 'page')], env=env, check=True, timeout=45)
    pages = sorted(target.glob('page-*.png'))
    if not pages or any(p.stat().st_size == 0 for p in pages):
        raise SystemExit('renderer did not produce page images')
    print(json.dumps({'pdf': str(pdf), 'pages': [str(p) for p in pages], 'visualInspection': 'required'}))
