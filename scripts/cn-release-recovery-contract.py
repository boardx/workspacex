#!/usr/bin/env python3
"""Independent read-only terminal contract for a completed durable recovery."""
import importlib.util
from pathlib import Path
import sys
import os
import stat
import hashlib
import json
import re
ROOT=Path(__file__).resolve().parents[1]
def driver(release):
    if os.geteuid()!=0 or not re.fullmatch('[a-f0-9]{64}',release):raise ValueError('ROOT_AUTHORITY')
    def private(path):
        for parent in path.parents:
            info=parent.lstat()
            if not stat.S_ISDIR(info.st_mode)or info.st_uid!=0 or info.st_mode&0o022:raise ValueError('ROOT_PARENT')
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,'rb')as f:
            info=os.fstat(f.fileno())
            if not stat.S_ISREG(info.st_mode)or info.st_uid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>1048576:raise ValueError('ROOT_FILE')
            return f.read(1048577)
    raw=private(Path('/etc/workspacex-cn/release-approvals')/(release+'.json'))
    if hashlib.sha256(raw).hexdigest()!=release:raise ValueError('RELEASE_HASH')
    a=json.loads(raw);path=ROOT/'scripts/cn-release-recovery-driver.py'
    if hashlib.sha256(private(path)).hexdigest()!=a['codeFiles']['scripts/cn-release-recovery-driver.py']:raise ValueError('DRIVER_PIN')
    spec=importlib.util.spec_from_file_location('fixed_recovery_driver',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def observe(release,fresh):
    d=driver(release);raw,a,fraw,f=d.load(release,fresh);e=d.module(d.ENTRY)
    d.need(d.parse(e.read(e.STATE/'active-attempt.json'))==a['identity']['attemptId'],'ACTIVE_ATTEMPT')
    root=d.VAR/'release-generated'/release/('recovery-driver-'+fresh)
    return d.enc(d.sealed_result(root,{'releaseSha256':release,'recoveryApprovalSha256':fresh,'identity':a['identity']},d.Operations(release,fresh,a,f,e),e))

def verify(raw,manifest,previous,mode,release,fresh):
    d=driver(release);authority,a,fraw,f=d.load(release,fresh);e=d.module(d.ENTRY)
    d.need(manifest['scope']=='runtime-only-reviewed-recovery'and manifest['recoveryOf']==f['failedRequestSha256']and manifest['stage']==f['failedStage']and manifest['authorizationEvidenceSha256']==release,'SEAL_SCOPE')
    for key in ('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt'):d.need(manifest[key]==a['identity'][key],'SEAL_IDENTITY')
    d.need(manifest['issuedAt']==f['issuedAt']and manifest['expiresAt']==f['expiresAt'],'SEAL_WINDOW')
    expected,_=d.seal_payload(release,fresh,authority,a,f,e);d.need(manifest==expected,'EXACT_READONLY_SEAL_PACKAGE')
    original,_=e.load_package(f['failedRequestSha256'],a['identity']['attemptId'])
    d.need(manifest['previousReceiptSha256']==original['previousReceiptSha256']==(d.sha(d.enc(previous))if previous is not None else None),'SEAL_PREVIOUS')
    actual=observe(release,fresh);d.need(raw==actual,'RECOVERY_FINAL_BYTES')
    d.need(mode in ('pre-recovery','recover','reconcile-recovery','terminal'),'SEAL_MODE')
    if mode=='pre-recovery':return {'externalWritesTerminal':True,'safeToRecover':True}
    if mode=='terminal':return {'externalWritesTerminal':True}
    return {'baselineBusinessAccepted':True,'holdCleared':True,'externalWritesTerminal':True}

if __name__=='__main__':
    try:
        if len(sys.argv)!=4 or sys.argv[1]!='observe':raise ValueError('FIXED_READONLY')
        sys.stdout.buffer.write(observe(sys.argv[2],sys.argv[3]))
    except Exception:
        print('{"status":"RECOVERY_TERMINAL_UNPROVEN"}',file=sys.stderr);sys.exit(1)
