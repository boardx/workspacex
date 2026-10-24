#!/usr/bin/env python3
"""Fixed public CN browser verification, including application pages and billing reads."""
import os
import hashlib
import json
from pathlib import Path
import socket
import stat
import subprocess
import sys

RUNTIME = Path('/usr/local/lib/workspacex-cn-browser-runtime')

def verify_runtime():
    def trusted(path):
        for p in [path, *path.parents]:
            s = p.lstat()
            if s.st_uid != 0 or s.st_mode & 0o022 or stat.S_ISLNK(s.st_mode):
                raise OSError('BROWSER_RUNTIME_UNTRUSTED')
        return path
    manifest = json.loads(trusted(RUNTIME/'manifest.json').read_bytes())
    for name, checksum in manifest.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise OSError('BROWSER_RUNTIME_PATH')
        p = trusted(RUNTIME/relative)
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != checksum:
            raise OSError('BROWSER_RUNTIME_DRIFT')

def main():
    if len(sys.argv) != 1 or os.geteuid() != 0 or socket.gethostname() != 'workspacex-cn-prod':
        return 2
    verify_runtime()
    result = subprocess.run(['/usr/bin/node', str(Path(__file__).with_suffix('.mjs')),
                             'https://app.boardx.com.cn',
                             '/etc/workspacex-image-release/cn-browser.env'],
                            env={'PATH':'/usr/bin:/bin','HOME':'/root',
                                 'CN_BROWSER_EXECUTABLE_PATH':'/usr/bin/chromium-browser'},
                            capture_output=True, timeout=100)
    if result.returncode == 0 and b'CN_BROWSER_SMOKE_PASSED' in result.stdout:
        print('CN_PUBLIC_BROWSER_PASSED')
        return 0
    print('CN_PUBLIC_BROWSER_FAILED', file=sys.stderr)
    return 1

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, subprocess.TimeoutExpired):
        print('CN_PUBLIC_BROWSER_UNAVAILABLE', file=sys.stderr)
        raise SystemExit(1)
