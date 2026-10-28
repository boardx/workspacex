#!/usr/bin/env python3
"""Numeric directory ownership and narrowly scoped, non-destructive setup recovery."""
import os
import stat
import sys
import tempfile
from pathlib import Path


def numeric_owner(path, uid, gid):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Refuse symlink ownership: ' + str(path))
    os.chown(path, uid, gid, follow_symlinks=False)


def numeric_directory(path, uid=1000, gid=1000):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Refuse symlink directory: ' + str(path))
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not path.is_dir():
        raise ValueError('Expected directory: ' + str(path))
    numeric_owner(path, uid, gid)
    path.chmod(0o700)


def archive_prebootstrap(stage, runtime, data, state, templates, backup_parent, input_digest):
    stage, runtime, data, state, templates, backup_parent = map(
        Path, (stage, runtime, data, state, templates, backup_parent))
    # Only the exact early failure reported by the installer may use this path.
    # No application data, subdirectories, state markers or edited runtime files.
    for root in (stage, runtime, data, state):
        if root.is_symlink() or not root.is_dir():
            raise ValueError('Expected real setup directory: ' + str(root))
        for p in (root, *root.iterdir()):
            metadata = p.lstat()
            if stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != os.geteuid() or metadata.st_mode & 0o022:
                raise ValueError('Untrusted setup path: ' + str(p))
    if any(data.iterdir()) or any(state.iterdir()):
        raise ValueError('Data or state is nonempty; prebootstrap recovery refused')
    expected = {p.name: p for p in stage.iterdir()}
    if not {'stable-secrets.json', 'input-config.sha256'} <= set(expected):
        raise ValueError('Incomplete stable staging')
    if (stage/'input-config.sha256').read_text().strip() != input_digest:
        raise ValueError('Input .env differs from original setup')
    for name in ('docker-seccomp.json', 'docker-apparmor-sessions'):
        expected[name] = templates/name
    if {p.name for p in runtime.iterdir()} != set(expected):
        raise ValueError('Unexpected or incomplete runtime files; recovery refused')
    for name, original in expected.items():
        current = runtime/name
        if not original.is_file() or not current.is_file() or original.read_bytes() != current.read_bytes():
            raise ValueError('Runtime differs from stable staging: ' + name)
    if any(p.stat().st_dev != backup_parent.stat().st_dev for p in (runtime, data, state)):
        raise ValueError('Setup paths are on different filesystems; archive refused')
    backup = Path(tempfile.mkdtemp(prefix='workspacex-host-setup-backup-', dir=backup_parent))
    # Rename rather than delete; preserve stable staging for the ordinary retry.
    # A host-level interruption leaves all originals under this private backup.
    try:
        for name, source in (('runtime', runtime), ('data', data), ('state', state)):
            source.rename(backup/name)
    except OSError as error:
        raise ValueError('Archive incomplete; inspect preserved paths at ' + str(backup)) from error
    return backup


if __name__ == '__main__':
    try:
        if len(sys.argv) == 2:
            numeric_directory(sys.argv[1])
        elif len(sys.argv) >= 5 and sys.argv[1] == 'owner':
            for path in sys.argv[4:]:
                numeric_owner(path, int(sys.argv[2]), int(sys.argv[3]))
        else:
            raise ValueError('Usage: host_setup.py <directory> | owner <uid> <gid> <paths...>')
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
