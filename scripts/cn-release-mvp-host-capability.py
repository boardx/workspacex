#!/usr/bin/env python3
"""Unprivileged, bounded cloud-host metadata probe; never reads credentials."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

PATHS = (
    '/usr/local/bin/workspacex-cn-fixed-release',
    '/usr/local/bin/workspacex-cn-mvp-evidence',
    '/usr/local/bin/workspacex-cn-deploy',
    '/usr/local/lib/workspacex-cn/release-control',
    '/usr/local/lib/workspacex-cn/release-source',
    '/etc/workspacex-cn/release-approvals',
    '/var/lib/workspacex-cn/release-inputs',
)


def collect():
    rows=[]
    for name in PATHS:
        path=Path(name);row={'path':name}
        try:
            st=path.lstat()
            row.update(exists=True,uid=st.st_uid,gid=st.st_gid,mode=oct(st.st_mode & 0o777),symlink=path.is_symlink())
            if path.is_file() and not path.is_symlink() and st.st_size<=1048576:
                try:row['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
                except PermissionError:row['bytesReadable']=False
        except FileNotFoundError:row['exists']=False
        except PermissionError:row['metadataReadable']=False
        rows.append(row)
    try:
        proc=subprocess.run(['/usr/bin/sudo','-n','-l'],capture_output=True,timeout=10)
        listing=proc.stdout.decode(errors='replace')
        rules={name:name in listing for name in PATHS[:3]}
        sudo={'exitCode':proc.returncode,'entryMentioned':rules,'rawListingRetained':False}
    except (OSError,subprocess.TimeoutExpired):sudo={'status':'unavailable','rawListingRetained':False}
    try:instance=Path('/var/lib/cloud/data/instance-id').read_text().strip()
    except (OSError,UnicodeError):instance=None
    return {'kind':'cn-mvp-host-capability-unprivileged-v1','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'instanceId':instance if instance=='i-uf6ga92ewloganobbln6' else None,'targetInstanceMatches':instance=='i-uf6ga92ewloganobbln6',
            'paths':rows,'sudo':sudo,'rootGithubAuthenticationVerified':False,'runtimeClosureVerified':False,'productionChanges':False}


if __name__=='__main__':print(json.dumps(collect(),sort_keys=True))
