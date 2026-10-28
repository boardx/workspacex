#!/usr/bin/env python3
"""Shared host allowlist for both entry points; runtime checks remain mandatory."""
import platform
import shlex
from pathlib import Path

SUPPORTED_UBUNTU = ('24.04', '26.04')

def validate_os(release, system, machine):
    values = {}
    for line in release.splitlines():
        if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        tokens = shlex.split(value)
        if key in values or len(tokens) != 1:
            raise ValueError('Invalid os-release field: ' + key)
        values[key] = tokens[0]
    if (system != 'Linux' or machine != 'x86_64' or
            values.get('ID') != 'ubuntu' or values.get('VERSION_ID') not in SUPPORTED_UBUNTU):
        raise ValueError('Requires Ubuntu ' + ' or '.join(SUPPORTED_UBUNTU) + ' x86_64')

def main():
    validate_os(Path('/etc/os-release').read_text(), platform.system(), platform.machine())

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
