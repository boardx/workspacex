#!/usr/bin/env python3
"""Installed CN image-only admission. No schema/data migration or caller config."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import subprocess
import sys
import tempfile
import time

POLICY = Path('/etc/workspacex-image-release/cn-admission.json')

class Rejected(Exception):
    pass

def need(value, code):
    if not value:
        raise Rejected(code)

def private(path):
    p = Path(path)
    for parent in [*reversed(p.parents), p]:
        s = parent.lstat()
        need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, 'UNTRUSTED_PATH')
    s = p.stat()
    need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, 'INPUT_NOT_REGULAR')
    return p

def pinned(row):
    p = private(row['path'])
    need(hashlib.sha256(p.read_bytes()).hexdigest() == row['sha256'], 'INPUT_DRIFT')
    return p

def run(args, **kwargs):
    r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                       timeout=kwargs.pop('timeout', 30), **kwargs)
    need(r.returncode == 0, 'COMMAND_REJECTED')
    return r.stdout

def check_ledger(result, expected):
    need(result.get('status') == 'COMPLETE' and result.get('readOnly') is True,
         'DATABASE_LEDGER_REJECTED')
    rows = result.get('ledger')
    need(isinstance(rows, list) and result.get('count') == len(rows) == len(expected),
         'DATABASE_LEDGER_COUNT')
    actual = {}
    for row in rows:
        need(set(row) == {'name', 'checksum'} and row['name'] not in actual,
             'DATABASE_LEDGER_DUPLICATE')
        actual[row['name']] = row['checksum']
    need(actual == expected, 'DATABASE_LEDGER_DRIFT')

def verify_backup(key, archive, image):
    with os.fdopen(os.memfd_create('cn-backup-toc', flags=os.MFD_CLOEXEC), 'w+b') as clear:
        r = subprocess.run(['/usr/bin/openssl', 'enc', '-d', '-aes-256-cbc', '-pbkdf2',
                            '-pass', 'file:' + str(key), '-in', str(archive)],
                           stdout=clear, stderr=subprocess.DEVNULL, timeout=35)
        need(r.returncode == 0, 'BACKUP_DECRYPT_FAILED')
        clear.seek(0)
        raw = run(['/usr/bin/docker', 'run', '--rm', '--pull=never', '--network', 'none',
                   '--read-only', '--entrypoint', 'pg_restore', '-i', image, '--list'], stdin=clear)
        need(b'_kernel_migrations' in raw, 'BACKUP_TOC_REJECTED')

def backup(policy, image, attempt):
    env_file = pinned(policy['migrationEnv'])
    key = attempt / 'backup.key'
    fd = os.open(key, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(secrets.token_hex(32).encode())
    archive = attempt / 'database.pgdump.enc'
    fd = os.open(archive, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    args = ['/usr/bin/docker', 'run', '--rm', '--pull=never', '--network', policy['network'],
            '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--tmpfs', '/tmp:rw,nosuid,nodev,size=32m', '--env-file', str(env_file),
            '--entrypoint', '/bin/sh', image, '-c',
            'export PGUSER="$MIGRATION_DB_USER" PGPASSWORD="$MIGRATION_DB_PASSWORD"; exec pg_dump --format=custom --no-owner --no-acl']
    dump = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    cipher = None
    try:
        with os.fdopen(fd, 'wb') as out:
            cipher = subprocess.Popen(['/usr/bin/openssl', 'enc', '-aes-256-cbc', '-pbkdf2',
                                       '-salt', '-pass', 'file:' + str(key)],
                                      stdin=dump.stdout, stdout=out, stderr=subprocess.DEVNULL)
            dump.stdout.close()
            need(cipher.wait(timeout=35) == 0 and dump.wait(timeout=5) == 0, 'BACKUP_FAILED')
            out.flush()
            os.fsync(out.fileno())
    finally:
        for child in (cipher, dump):
            if child is not None and child.poll() is None:
                child.kill()
                child.wait()
    need(archive.stat().st_size > 1024, 'BACKUP_EMPTY')
    verify_backup(key, archive, image)
    return {'encrypted': True, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
            'bytes': archive.stat().st_size, 'consistentPgDumpSnapshot': True,
            'writersStopped': False, 'archiveTocVerified': True, 'restoreTest': 'NOT_PERFORMED'}

def main(tag):
    need(os.geteuid() == 0 and socket.gethostname() == 'workspacex-cn-prod', 'ROOT_CN_REQUIRED')
    need(re.fullmatch(r'[0-9a-f]{40}-[0-9]+-[0-9]+', tag), 'TAG_INVALID')
    policy = json.loads(private(POLICY).read_bytes())
    root = Path(policy['evidenceDirectory'])
    root_info = root.lstat()
    need(stat.S_ISDIR(root_info.st_mode) and root_info.st_uid == 0 and
         not root_info.st_mode & 0o077, 'EVIDENCE_DIRECTORY_PRIVATE')
    attempt = Path(tempfile.mkdtemp(prefix='admission-', dir=root))
    consumer = pinned(policy['consumer'])
    spec = importlib.util.spec_from_file_location('consumer', consumer)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    docker = module.engine.Docker('/usr/bin/docker')
    images = {role: module.registry.resolve('/usr/bin/docker', policy['registryPrefix'], tag,
                                            role, pull=False) for role in module.registry.SERVICES}
    expected = None
    for service, role in [('api', 'api'), ('agent', 'agent')]:
        row = docker.json(['container', 'inspect', 'workspacex-cn-' + service + '-1'])[0]
        need(row['State']['Running'] and row['Config']['Labels'].get('com.docker.compose.project')
             == 'workspacex-cn', 'BASELINE_BINDING')
        old = module.engine.schema(docker, row['Image'], role, attempt)
        new = module.engine.schema(docker, images[role]['imageId'], role, attempt)
        need(old == new, 'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE')
        if role == 'api':
            expected = next(iter(new.values()))
            expected = {Path(n).name: value for n, value in expected.items()}
            need(len(expected) == len(next(iter(new.values()))), 'DUPLICATE_MIGRATION_NAME')
            # Compare protected migration target to the actual application's target.
            live_env = dict(v.split('=', 1) for v in row['Config']['Env'])
            migration_env = dict(l.split('=', 1) for l in pinned(policy['migrationEnv']).read_text().splitlines()
                                 if l and not l.startswith('#') and '=' in l)
            need(all(live_env.get(k) == migration_env.get(k) == policy['database'][k]
                     for k in ['PGHOST', 'PGPORT', 'PGDATABASE']), 'DATABASE_TARGET_MISMATCH')
    driver = pinned(policy['ledgerDriver']).read_bytes()
    raw = run(['/usr/bin/docker', 'run', '--rm', '--pull=never', '--network', policy['network'],
               '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
               '--memory=256m', '--pids-limit=128', '--tmpfs', '/tmp:rw,nosuid,nodev,size=32m',
               '--env-file', str(pinned(policy['migrationEnv'])), '--entrypoint', 'node', '-i',
               images['api']['imageId'], '--import', 'tsx', '--input-type=module', '-e', driver.decode()],
              input=json.dumps(policy['database']).encode())
    ledger = json.loads(raw)
    check_ledger(ledger, expected)
    receipt = {'status': 'ADMITTED', 'tag': tag, 'schemaUnchanged': True,
               'fullLedgerMatched': True, 'ledgerCount': len(expected), 'migrationExecuted': False,
               'dataInitializationExecuted': False, 'backup': backup(policy, images['postgres']['imageId'], attempt),
               'createdAt': time.time()}
    fd = os.open(attempt / 'receipt.json', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(receipt, f)
        f.flush()
        os.fsync(f.fileno())
    print('CN_IMAGE_ADMITTED')

if __name__ == '__main__':
    try:
        need(len(sys.argv) == 2, 'TAG_REQUIRED')
        main(sys.argv[1])
    except Exception as error:
        print(str(error) if isinstance(error, Rejected) else 'CN_ADMISSION_FAILED', file=sys.stderr)
        raise SystemExit(1)
