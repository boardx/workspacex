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
import signal


def _run_bounded(command, env, timeout):
    """Run `command` so that its **deadline actually ends the work**, measured 2026-09-11 (issue #3403).

    Two defects in the plain `subprocess.run(..., timeout=...)` this replaces:

    1. `subprocess.run`'s timeout kills only the direct child. `soffice.bin` forks
       grandchildren, and those survive. `start_new_session=True` puts the whole
       tree in its own process group so the timeout can kill all of it.
    2. Worse, and the one that actually bit: this script inherits the caller's
       stdout/stderr, so **the grandchildren inherit them too**. The sandbox
       execution service captures that pipe. Measured: with a hung `soffice.bin`
       that had spawned a detached grandchild, this script exited in 5.07s against
       its own 5s deadline -- and the capturing caller stayed blocked on the pipe
       past 60s, because a surviving grandchild still held the write end open.
       The script looked bounded while the *caller* hung to its own much larger
       budget. Giving the children their own pipes (and closing them here) ends that.

    A normal render is nowhere near these deadlines: a 10-slide CJK deck measured
    2.4-2.7s end to end (soffice ~0.9s, pdftoppm ~1.5s) on an unloaded machine.
    """
    with subprocess.Popen(command, env=env, start_new_session=True,
                          stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as child:
        try:
            output, _ = child.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                child.kill()
            # Do NOT drain here. Measured 2026-09-11: a `setsid` grandchild is OUTSIDE
            # the group we just killed, still holds the pipe's write end, and a drain
            # blocks for its whole lifetime -- 120s against a 5s deadline, i.e. the
            # very hang this helper exists to prevent, merely moved inside the script.
            # Dropping our read end is what actually bounds us; the reader thread
            # `communicate` started is a daemon and does not hold interpreter exit.
            try:
                child.stdout.close()
            except OSError:
                pass
            child.wait()
            raise
    # LibreOffice is chatty on success; only surface it when the step actually failed.
    if child.returncode not in (0, 81):
        sys.stderr.write(output.decode('utf-8', 'replace'))
    return subprocess.CompletedProcess(command, child.returncode)


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
        result = _run_bounded(command, env, 60)
        if result.returncode == 81:
            result = _run_bounded(command, env, max(0.001, deadline - time.monotonic()))
        result.check_returncode()
    if not pdf.is_file() or pdf.stat().st_size == 0:
        raise SystemExit('renderer did not produce a PDF')
    _run_bounded(['pdftoppm', '-png', '-r', '96', str(pdf), str(target / 'page')], env, 45).check_returncode()
    pages = sorted(target.glob('page-*.png'))
    if not pages or any(p.stat().st_size == 0 for p in pages):
        raise SystemExit('renderer did not produce page images')
    print(json.dumps({'pdf': str(pdf), 'pages': [str(p) for p in pages], 'visualInspection': 'required'}))
