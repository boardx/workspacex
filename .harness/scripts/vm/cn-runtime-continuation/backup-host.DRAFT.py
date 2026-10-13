#!/usr/bin/env python3
"""Bound stopped-host backup. Contains secrets locally; emits only hashes/paths."""
import datetime, fcntl, hashlib, json, os, stat, subprocess, sys, tarfile, shutil
from pathlib import Path

def digest(raw): return hashlib.sha256(raw).hexdigest()

def read_file(path, owner=None):
    path = Path(path)
    for parent in path.parents:
        s = parent.lstat()
        assert stat.S_ISDIR(s.st_mode)
        if owner is not None: assert s.st_uid == owner and not s.st_mode & 0o022
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        s = os.fstat(f.fileno())
        assert stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size <= 1048576
        if owner is not None: assert s.st_uid == owner and stat.S_IMODE(s.st_mode) == 0o600
        return f.read()

def backup_config_files(bindings, destination, owner=None):
    """Every distinct original absolute path receives a unique local archive name."""
    expected = {}
    for entry in bindings:
        path = str(Path(entry['path']))
        assert Path(path).is_absolute() and '..' not in Path(path).parts
        if path in expected: assert expected[path] == entry['sha256']
        expected[path] = entry['sha256']
    assert expected
    raws = {p: read_file(p, owner) for p in expected}
    for p, raw in raws.items(): assert digest(raw) == expected[p], 'CONFIG_DRIFT'
    destination = Path(destination); destination.mkdir(mode=0o700)
    records = []
    for index, path in enumerate(sorted(raws)):
        name = '%03d-%s' % (index, Path(path).name)
        fd = os.open(destination / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(raws[path]); f.flush(); os.fsync(f.fileno())
        assert digest(read_file(destination / name, owner)) == expected[path]
        records.append({'originalPath': path, 'backupFile': name, 'sha256': expected[path], 'bytes': len(raws[path])})
    for path in expected: assert digest(read_file(path, owner)) == expected[path], 'CONFIG_DRIFT_AFTER_COPY'
    return records

def main():
    assert len(sys.argv) == 3 and os.geteuid() == os.getegid() == 0
    root = Path(sys.argv[1]); raw = read_file(root / 'binding.json', 0)
    assert digest(raw) == sys.argv[2]
    b = json.loads(raw); assert b['draft'] is False
    assert b['sourceRevision'] == 'f0eb9d07398a66fdd5646a9e6b855fa1b940e571'
    runtime = Path('/var/lib/workspacex-cn/runtime')
    assert root.parent == runtime and root.name.startswith('upgrade-f0eb-')
    assert digest(read_file(root / 'backup-host.py', 0)) == b['backupHelperSha256']
    lockpath = runtime / 'release.lock'; a = os.fstat(9); s = lockpath.lstat()
    assert (a.st_dev, a.st_ino) == (s.st_dev, s.st_ino) and stat.S_ISREG(s.st_mode)
    assert s.st_uid == 0 and stat.S_IMODE(s.st_mode) == 0o600 and s.st_nlink == 1
    other = os.open(lockpath, os.O_RDWR | os.O_NOFOLLOW)
    try:
        try: fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: pass
        else: raise AssertionError('LOCK_NOT_HELD')
        fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    finally: os.close(other)
    def state():
        hold = json.loads(subprocess.check_output(['/usr/bin/python3','-I','-S','-B','/usr/local/lib/workspacex-cn/cn_maintenance_hold.py','read',str(runtime)], stderr=subprocess.DEVNULL, timeout=30))
        assert hold == b['hold'] and hold['state'] == 'held'
        names = sorted(b['expectedContainers'])
        xs = json.loads(subprocess.check_output(['/usr/bin/docker','--host','unix:///run/docker.sock','inspect',*names], stderr=subprocess.DEVNULL, timeout=30))
        assert len(xs) == 5
        for x in xs:
            expected = b['expectedContainers'][x['Name']]
            assert x['Id'] == expected['id'] and x['Config']['Image'] == expected['image']
            assert not x['State']['Running'] and not x['State']['Restarting']
    state(); os.umask(0o077)
    data_paths = [Path(p) for p in b['backupPaths']]
    base = Path(b['workingDir'])
    assert set(data_paths) == {base / 'sandbox', base / 'sessions'}
    total = 0; sockets = 0
    for path in data_paths:
        assert path.is_dir() and not path.is_symlink()
        for directory, dirs, files in os.walk(path, followlinks=False):
            for name in files + dirs:
                s = (Path(directory) / name).lstat()
                assert stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode) or stat.S_ISLNK(s.st_mode) or stat.S_ISSOCK(s.st_mode)
                if stat.S_ISREG(s.st_mode): total += s.st_size
                if stat.S_ISSOCK(s.st_mode): sockets += 1
    assert shutil.disk_usage(root).free > 2 * total + 2 * 1024 ** 3
    destination = root / 'host-backup'; destination.mkdir(mode=0o700)
    # All active Compose layers, including the overlay outside BASE, are mandatory.
    config = backup_config_files(b['composeFiles'] + b['envFiles'], destination / 'config', 0)
    archives = []
    def keep(info):
        assert info.isreg() or info.isdir() or info.issym()
        return info
    for path in sorted(data_paths):
        output = destination / (path.name + '.tar')
        with tarfile.open(output, 'x', dereference=False) as archive:
            archive.add(path, arcname=path.name, filter=keep)
        h = hashlib.sha256()
        with output.open('rb') as f:
            for chunk in iter(lambda:f.read(1048576), b''): h.update(chunk)
            os.fsync(f.fileno())
        archives.append({'originalPath':str(path),'backupFile':output.name,'sha256':h.hexdigest(),'bytes':output.stat().st_size})
    state()
    for entry in b['composeFiles'] + b['envFiles']:
        assert digest(read_file(entry['path'],0)) == entry['sha256']
    result = {'scope':'host-config-and-bind-only','configFiles':config,'dataArchives':archives,'ephemeralSocketsExcluded':sockets,'restoreTested':False,'databaseBackup':False,'redisBackup':False,'ossBackup':False}
    encoded = (json.dumps(result,sort_keys=True)+'\n').encode()
    with (destination / 'manifest.json').open('xb') as f:
        f.write(encoded); f.flush(); os.fsync(f.fileno())
    print(json.dumps({'path':str(destination),'manifestSHA256':digest(encoded),'scope':result['scope'],'restoreTested':False}))

if __name__ == '__main__':
    try: main()
    except BaseException:
        print('{"ok":false,"code":"BACKUP_STOPPED_RECONCILE_NO_REPLAY"}'); sys.exit(1)
