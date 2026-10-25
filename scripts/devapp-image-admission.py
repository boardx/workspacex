#!/usr/bin/env python3
"""DevApp image-only lane: retain the reviewed environment-specific ledger.

This does not apply migrations, initialize data, or repair historical checksums.
Candidate/current API and Agent SQL bytes are compared by the image consumer.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys

POLICY=Path('/etc/workspacex-image-release/devapp-admission.json')

def trusted(path):
    p=Path(path)
    for part in [p,*p.parents]:
        s=part.lstat()
        if s.st_uid!=0 or s.st_mode & 0o022 or stat.S_ISLNK(s.st_mode):raise ValueError('UNTRUSTED_POLICY')
    if not p.is_file() or p.stat().st_nlink!=1:raise ValueError('POLICY_FILE')
    return p

def check_ledger(actual,expected):
    if actual!=expected:raise ValueError('DATABASE_LEDGER_CHANGED_REVIEW_REQUIRED')

def main():
    if os.geteuid()!=0 or socket.gethostname()!='iZrj94o0jq479xfhoa83xoZ' or len(sys.argv)!=2 or not re.fullmatch('[0-9a-f]{40}-[0-9]+-[0-9]+',sys.argv[1]):raise ValueError('FIXED_DEVAPP_ADMISSION_ONLY')
    policy=json.loads(trusted(POLICY).read_bytes())
    reference=policy['plan'];raw=trusted(reference['path']).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=reference['sha256']:raise ValueError('PLAN_DRIFT')
    expected=json.loads(raw)['expectedLedger']
    info=json.loads(subprocess.check_output(['/usr/bin/docker','inspect','workspacex-postgres-1'],timeout=10))[0]
    owner=dict(x.split('=',1) for x in info['Config']['Env']).get('POSTGRES_USER','postgres')
    query='BEGIN READ ONLY; SELECT jsonb_object_agg(name,checksum) FROM public._kernel_migrations; ROLLBACK;'
    result=subprocess.run(['/usr/bin/docker','exec','workspacex-postgres-1','psql','-X','-q','-A','-t','--set=ON_ERROR_STOP=1','-U',owner,'-d','workspacex','-c',query],capture_output=True,timeout=20)
    if result.returncode:raise ValueError('LEDGER_READBACK_FAILED')
    check_ledger(json.loads(result.stdout),expected)
    print('DEVAPP_IMAGE_ADMITTED_LEDGER_PRESERVED')

if __name__=='__main__':
    try:main()
    except Exception as e:
        print(str(e) if isinstance(e,ValueError) else 'DEVAPP_ADMISSION_FAILED',file=sys.stderr)
        raise SystemExit(1)
