#!/usr/bin/env python3
"""Explicit fresh baseline writer-resume CAS. No automatic retry or data restore."""
import argparse
import datetime as dt
import fcntl
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
ETC=Path('/etc/workspacex-cn')
VAR=Path('/var/lib/workspacex-cn')
SELF='scripts/cn-release-recovery-writer.py'
STATE='scripts/cn-release-business-state.py'
HEALTH='scripts/cn-release-business-recovery.py'
FIELDS={'kind','scope','releaseSha256','identity','target','issuedAt','expiresAt','bindingSha256','runtimeRecoveryReceiptSha256','heldHealthSha256','holdRawSha256','holdGeneration','userAuthorizationEvidenceSha256','testDataScopeSha256','publicOrigin','recoveryApprovalSha256'}


def immutable(path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def clear(a,release_sha,fresh_raw,writer_raw,prepared,state,recovery,*,reader=None,call=None,clear_call=None,now=None):
    """Caller owns canonical fd9; CLI supplies only fixed root authority paths.
    Test dependency injection never appears in production argv/approval schema.
    """
    reader=reader or state.Reader();call=call or state.invoke;now=now or dt.datetime.now(dt.timezone.utc)
    n=state.need;w=state.parse(writer_raw);fresh=state.parse(fresh_raw);writer_sha=state.sha(writer_raw)
    n(set(w)==FIELDS and w['kind']=='cn-recovery-writer-resume-approval-v1'
      and w['scope']=='resume-baseline-writers-and-scoped-business-observation','RECOVERY_WRITER_SCHEMA')
    n(w['releaseSha256']==release_sha and w['identity']==a['identity'] and w['target']==recovery.TARGET
      and w['recoveryApprovalSha256']==state.sha(fresh_raw),'RECOVERY_WRITER_IDENTITY')
    n(w['publicOrigin']=='https://app.boardx.com.cn/' and w['testDataScopeSha256']==a['business']['recoveryTestDataScopeSha256'],'RECOVERY_WRITER_SCOPE')
    n(state.stamp(fresh['issuedAt'])<=state.stamp(w['issuedAt'])<=now<state.stamp(w['expiresAt'])<=state.stamp(fresh['expiresAt']),'RECOVERY_WRITER_WINDOW')
    for key in FIELDS:
        if key.endswith('Sha256'):n(isinstance(w[key],str) and re.fullmatch('[a-f0-9]{64}',w[key]),'RECOVERY_WRITER_HASH')
    pointer=state.parse(reader.file(state.ETC/'recovery-writer-resume-approvals'/'by-recovery'/(state.sha(fresh_raw)+'.json')))
    n(pointer=={'approvalSha256':writer_sha},'RECOVERY_WRITER_POINTER')
    out=state.VAR/'release-generated'/release_sha/'terminal'/'recovery-writer-resume';reader.directory(out)
    # These are preserved actual root observations, not booleans in the approval.
    held_raw=reader.pinned(out/'held-health.json',w['heldHealthSha256']);held=state.parse(held_raw)
    hold_raw=reader.pinned(out/'held-hold.json',w['holdRawSha256']);hold=state.parse(hold_raw)
    n(bool(reader.pinned(out/'user-authorization.json',w['userAuthorizationEvidenceSha256'])),'EXPLICIT_USER_EVIDENCE_REQUIRED')
    reader.pinned(out/'test-data-scope.json',w['testDataScopeSha256'])
    n(state.stamp(w['issuedAt'])-dt.timedelta(minutes=10)<=state.stamp(held['observedAt'])<=now
      and now-state.stamp(held['observedAt'])<=dt.timedelta(minutes=10),'BASELINE_HEALTH_STALE')
    current=recovery.health(a,release_sha,fresh_raw,prepared,state,reader=reader,call=call,now=now)
    n({k:v for k,v in current.items()if k!='observedAt'}=={k:v for k,v in held.items()if k!='observedAt'},'BASELINE_HEALTH_CHANGED')
    n(current['bindingSha256']==w['bindingSha256'] and current['runtimeRecoveryReceiptSha256']==w['runtimeRecoveryReceiptSha256']
      and current['hold']==hold and hold['state']=='held' and hold['generation']==w['holdGeneration'],'BASELINE_CLEAR_BINDING')
    links={k:w[k]for k in ('releaseSha256','identity','bindingSha256','runtimeRecoveryReceiptSha256','heldHealthSha256','holdRawSha256','testDataScopeSha256')}
    links.update(approvalSha256=writer_sha,recoveryApprovalSha256=state.sha(fresh_raw))
    intent={'kind':'cn-recovery-hold-clear-intent-v1',**links}
    n(not(out/'recovery-clear-result.json').exists() and not(out/'recovery-clear-intent.json').exists(),'CLEAR_ALREADY_ATTEMPTED_RECONCILE_NO_RETRY')
    immutable(out/'recovery-clear-intent.json',state.enc(intent))
    command=[prepared['profile']['pythonPath'],'-I','-S','-B','/usr/local/lib/workspacex-cn/cn_maintenance_hold.py','clear',str(state.VAR/'runtime')]
    # Once intent exists, every exception is unknown: no second call, no fake receipt.
    if clear_call is None:
        def clear_call(argv,raw):
            p=subprocess.run(argv,input=raw,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30,pass_fds=(9,),env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
            n(p.returncode==0,'CLEAR_UNKNOWN_RECONCILE_NO_RETRY')
    n(dt.datetime.now(dt.timezone.utc)<state.stamp(w['expiresAt']),'CLEAR_AUTHORITY_EXPIRED')
    clear_call(command,hold_raw)
    helper=command.copy();helper[-2]='read';actual_raw=call(helper);actual=state.parse(actual_raw)
    n(actual=={**hold,'state':'cleared'},'CLEAR_UNKNOWN_RECONCILE_NO_RETRY')
    # Actual baseline must remain healthy after CAS; failure leaves intent unknown.
    after=recovery.health(a,release_sha,fresh_raw,prepared,state,reader=reader,call=call,now=dt.datetime.now(dt.timezone.utc),cleared=True)
    n(after['containers']==current['containers'] and after['hold']==actual,'POST_CLEAR_BASELINE_CHANGED')
    immutable(out/'recovery-clear-helper.json',actual_raw)
    result={'kind':'cn-recovery-hold-cleared-v1',**links,'hold':actual,'helperResultSha256':state.sha(actual_raw),
        'businessAcceptancePassed':False,'dataRestored':False}
    immutable(out/'recovery-clear-result.json',state.enc(result))
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--release-sha256',required=True);p.add_argument('--recovery-approval-sha256',required=True)
    args=p.parse_args()
    if os.geteuid()!=0 or any(not re.fullmatch('[a-f0-9]{64}',x)for x in (args.release_sha256,args.recovery_approval_sha256)):raise ValueError('ROOT_FIXED_AUTHORITY')
    # Bootstrap private reads before importing any root-approved code.
    import stat,hashlib,json
    def private(path):
        for parent in path.parents:
            s=parent.lstat()
            if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:raise ValueError('ROOT_PARENT')
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,'rb')as f:
            s=os.fstat(f.fileno())
            if not stat.S_ISREG(s.st_mode)or s.st_uid!=0 or s.st_nlink!=1 or s.st_mode&0o077 or s.st_size>1048576:raise ValueError('ROOT_FILE')
            return f.read()
    raw=private(ETC/'release-approvals'/(args.release_sha256+'.json'))
    if hashlib.sha256(raw).hexdigest()!=args.release_sha256:raise ValueError('RELEASE_HASH')
    a=json.loads(raw);modules={}
    for name in (SELF,STATE,HEALTH):
        source=private(ROOT/name)
        if hashlib.sha256(source).hexdigest()!=a['codeFiles'][name]:raise ValueError('CODE_PIN')
        if name==SELF:continue
        spec=importlib.util.spec_from_file_location(Path(name).stem,ROOT/name);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);modules[name]=module
    state=modules[STATE];recovery=modules[HEALTH];reader=state.Reader()
    state.need(a['kind']=='cn-fixed-release-approval-v1' and a['target']==recovery.TARGET,'RELEASE_SCOPE')
    fresh=reader.pinned(ETC/'release-recovery-approvals'/(args.recovery_approval_sha256+'.json'),args.recovery_approval_sha256)
    pointer=state.parse(reader.file(ETC/'recovery-writer-resume-approvals'/'by-recovery'/(args.recovery_approval_sha256+'.json')))
    state.need(set(pointer)=={'approvalSha256'} and re.fullmatch('[a-f0-9]{64}',pointer['approvalSha256']),'WRITER_POINTER')
    writer=reader.pinned(ETC/'recovery-writer-resume-approvals'/(pointer['approvalSha256']+'.json'),pointer['approvalSha256'])
    prepared=state.preflight(a,reader)
    # Direct invocation cannot resume a superseded attempt.
    state.need(state.parse(reader.file(VAR/'continuation'/'active-attempt.json'))==a['identity']['attemptId'],'ACTIVE_ATTEMPT')
    path=VAR/'runtime'/'release.lock';reader.file(path);fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if fd!=9:os.dup2(fd,9);os.close(fd);fd=9
        result=clear(a,args.release_sha256,fresh,writer,prepared,state,recovery,reader=reader)
        sys.stdout.buffer.write(state.enc(result))
    finally:os.close(fd)


if __name__=='__main__':
    try:main()
    except Exception:
        print('{"status":"BLOCKED","code":"RECOVERY_WRITER_UNKNOWN_NO_RETRY"}',file=sys.stderr);sys.exit(1)
