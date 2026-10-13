#!/usr/bin/env python3
"""Fixed entry preflight. Intentionally no arbitrary command/state/credential API.

Six live journeys execute only after fixed runtime closure, actual clear and
independent A5 approval checks. Action is exclusive; readback never logs in or
replays a journey. Missing target installation blocks before hold.
"""
import argparse
import datetime as dt
import fcntl
import importlib.util
import select
import signal
import subprocess
import time
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

APPROVALS=Path('/etc/workspacex-cn/release-approvals')
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}
FIELDS={'sourceRevision','baselineRevision','controlRevision','publicationAttemptId','attemptId','requestedAt','deadlineAt'}


def need(v,code):
    if not v:raise ValueError(code)


def private(path):
    for p in path.parents:
        s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'ROOT_PARENT')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb')as f:
        s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=1048576,'ROOT_FILE')
        raw=f.read(1048577);need(len(raw)==s.st_size,'ROOT_FILE_CHANGED');return raw


def validate_approval(raw,expected_sha,mode):
    need(re.fullmatch('[a-f0-9]{64}',expected_sha),'APPROVAL_SHA')
    need(hashlib.sha256(raw).hexdigest()==expected_sha,'APPROVAL_HASH')
    def pairs(items):
        v={}
        for k,val in items:need(k not in v,'DUPLICATE_KEY');v[k]=val
        return v
    a=json.loads(raw,object_pairs_hook=pairs)
    need(a['kind']=='cn-fixed-release-approval-v1' and a['target']==TARGET,'APPROVAL_SCOPE')
    need(set(a['identity'])==FIELDS,'APPROVAL_IDENTITY')
    need(mode in ('acceptance','observe','readback','rollback','rollback-readback','baseline-health','preflight'),'MODE')
    return a


def state_module(a):
    path=Path(__file__).resolve().with_name('cn-release-business-state.py')
    need(hashlib.sha256(private(path)).hexdigest()==a['codeFiles']['scripts/cn-release-business-state.py'],'STATE_CODE_PIN')
    spec=importlib.util.spec_from_file_location('fixed_business_state',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def preflight(a):
    need(a['kind']=='cn-fixed-release-approval-v1' and a['target']==TARGET,'APPROVAL_SCOPE')
    need(set(a['identity'])==FIELDS,'APPROVAL_IDENTITY')
    for key in ('sourceRevision','baselineRevision','controlRevision'):need(re.fullmatch('[a-f0-9]{40}',a['identity'][key]),'IDENTITY_SHA')
    for key in ('attemptId','publicationAttemptId'):need(re.fullmatch('[a-z0-9-]{1,64}',a['identity'][key]),'IDENTITY_ATTEMPT')
    return state_module(a).preflight(a)


def save(path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(parent)
    finally:os.close(parent)


def run_child(argv,payload,read_state,session_path,timeout,*,popen=subprocess.Popen):
    # Parent has canonical lock. The outer entry cgroup also contains Chromium.
    p=popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
        start_new_session=True,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/root'})
    end=time.monotonic()+timeout;buffer=b'';result=None;session_seen=False
    try:
        initial=json.dumps(payload,separators=(',',':')).encode()+b'\n';need(len(initial)<=65536,'CHILD_INPUT_BOUND');p.stdin.write(initial);p.stdin.flush()
        while True:
            need(time.monotonic()<end,'BUSINESS_DEADLINE_UNKNOWN')
            ready,_,_=select.select([p.stdout],[],[],min(.2,max(.001,end-time.monotonic())))
            if not ready:
                need(p.poll()is None,'BUSINESS_CHILD_FAILED');continue
            chunk=os.read(p.stdout.fileno(),8192)
            if not chunk:break
            buffer+=chunk;need(len(buffer)<=65536,'CHILD_OUTPUT_BOUND')
            while b'\n'in buffer:
                line,buffer=buffer.split(b'\n',1);msg=json.loads(line)
                if msg.get('type')=='read-state':
                    need(set(msg)=={'type'} and result is None,'RPC_ORDER')
                    p.stdin.write(json.dumps(read_state(),separators=(',',':')).encode()+b'\n');p.stdin.flush()
                elif msg.get('type')=='private-session':
                    need(payload['operation']=='action' and not session_seen and result is None and set(msg)=={'type','token'},'SESSION_ORDER')
                    token=msg['token'];need(type(token)is str and 0<len(token.encode())<=16384,'SESSION_BOUND');save(session_path,token.encode());session_seen=True
                elif msg.get('type')=='result':need(result is None and set(msg)=={'type','receipt'},'RESULT_ORDER');result=msg['receipt']
                else:raise ValueError('BUSINESS_CHILD_UNKNOWN')
        need(not buffer and p.wait(timeout=max(.01,end-time.monotonic()))==0 and result is not None,'BUSINESS_CHILD_FAILED')
        need(payload['operation']=='readback' or session_seen,'SESSION_MISSING');return result
    finally:
        # Never retry. A killed browser alone does not prove provider terminal.
        try:os.killpg(p.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        finally:
            try:p.wait(timeout=5)
            finally:p.stdin.close();p.stdout.close()


def recovery_module(a):
    path=Path(__file__).resolve().with_name('cn-release-business-recovery.py')
    need(hashlib.sha256(private(path)).hexdigest()==a['codeFiles']['scripts/cn-release-business-recovery.py'],'RECOVERY_CODE_PIN')
    spec=importlib.util.spec_from_file_location('fixed_business_recovery',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def baseline_health(a,release_sha,recovery_sha):
    m=state_module(a);prepared=preflight(a)
    raw=m.Reader().pinned(Path('/etc/workspacex-cn/release-recovery-approvals')/(recovery_sha+'.json'),recovery_sha)
    lock=Path('/var/lib/workspacex-cn/runtime/release.lock');m.Reader().file(lock)
    fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if fd!=9:os.dup2(fd,9);os.close(fd)
        fd=9;os.set_inheritable(fd,True)
        return recovery_module(a).health(a,release_sha,raw,prepared,m)
    finally:os.close(fd)


def execute(a,release_sha,mode,recovery_sha=None):
    m=state_module(a);prepared=preflight(a);need(mode in ('observe','readback','rollback','rollback-readback'),'HELD_HEALTH_USES_CANONICAL_STATUS')
    recovering=mode.startswith('rollback');readonly=mode.endswith('readback');fresh_raw=None;fresh=None
    if recovering:
        need(re.fullmatch('[a-f0-9]{64}',recovery_sha or ''),'RECOVERY_SHA')
        fresh_raw=m.Reader().pinned(Path('/etc/workspacex-cn/release-recovery-approvals')/(recovery_sha+'.json'),recovery_sha);fresh=m.parse(fresh_raw)
    lock=Path('/var/lib/workspacex-cn/runtime/release.lock');m.Reader().file(lock)
    fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if fd!=9:os.dup2(fd,9);os.close(fd)
        fd=9;os.set_inheritable(fd,True)
        def live_read():
            return recovery_module(a).public(a,release_sha,fresh_raw,prepared,m,read_only=readonly) if recovering else m.read_public(a,release_sha,prepared,read_only=readonly)
        live,envelope=live_read()
        execution={'mode':'rollback'if recovering else'observe','releaseSha256':release_sha,'identity':a['identity'],'publicOrigin':'https://app.boardx.com.cn/',
            'plan':prepared['recoveryPlan'if recovering else'plan'],'bindingSha256':live['bindingSha256'],'switchReceiptSha256':live['switchReceiptSha256'],
            'holdGeneration':live['holdGeneration'],'stableWindowSeconds':0 if recovering else a['business']['stableWindowSeconds'],'writerResumeApproval':envelope}
        if recovering:execution['rollbackApproval']={'baselineRevision':a['identity']['baselineRevision'],'issuedAt':fresh['issuedAt'],'expiresAt':fresh['expiresAt'],'approvalSha256':recovery_sha}
        base=Path('/var/lib/workspacex-cn/business-evidence');m.Reader().directory(base)
        root=base/(('recovery-'+recovery_sha)if recovering else a['identity']['attemptId']);session=root/'session-token'
        intent={'releaseSha256':release_sha,'identity':a['identity']}
        if recovering:intent['recoveryApprovalSha256']=recovery_sha
        operation='readback'if readonly else'action'
        payload={'operation':operation,'execution':execution}
        if operation=='action':
            cgroup=Path('/proc/self/cgroup').read_text();need(re.fullmatch(r'0::/workspacex-cn-continuation/op-[a-f0-9]{32}\n?',cgroup),'ENFORCED_CGROUP_REQUIRED')
            os.mkdir(root,0o700)
            parent=os.open(base,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(parent)
            finally:os.close(parent)
            save(root/'intent.json',m.enc(intent))
        else:
            need(m.parse(m.Reader().file(root/'intent.json'))==intent,'BUSINESS_ATTEMPT')
            raw=m.Reader().file(root/'receipt.json',65536);receipt=m.parse(raw)
            for k,v in a['identity'].items():need(receipt[k]==v,'BUSINESS_IDENTITY')
            need(receipt['kind']=='cn-independent-business-acceptance-v1' and receipt['mode']==execution['mode'] and receipt['stableWindowSeconds']==execution['stableWindowSeconds'],'BUSINESS_RECEIPT')
            need(set(receipt['checks'])=={'login','hello','asr','githubFeedbackRead','skillTool','pdfDownload'} and all(v is True for v in receipt['checks'].values()),'SIX_JOURNEYS')
            need(receipt['runtimeInventorySha256']==live['runtimeInventorySha256'],'BUSINESS_ACCEPTED_INVENTORY_CHANGED')
            need(receipt['bindingSha256']==live['bindingSha256'] and receipt['switchReceiptSha256']==live['switchReceiptSha256'] and receipt['holdGeneration']==live['holdGeneration'],'BUSINESS_RUNTIME_LINK')
            need(m.stamp(fresh['issuedAt']if recovering else a['identity']['requestedAt'])<=m.stamp(receipt['observedAt'])<=m.stamp(fresh['expiresAt']if recovering else a['identity']['deadlineAt']),'BUSINESS_EXECUTION_WINDOW')
            if recovering:need(receipt['recoveryApprovalSha256']==recovery_sha and receipt['runtimeRecoveryReceiptSha256']==live['switchReceiptSha256'],'BUSINESS_RECOVERY_LINK')
            payload.update(receiptRaw=raw.decode(),receipt=receipt,token=m.Reader().file(session,16384).decode())
        deadline=m.stamp(fresh['expiresAt']if recovering else a['identity']['deadlineAt']);remaining=90 if readonly else(deadline-dt.datetime.now(dt.timezone.utc)).total_seconds();need(remaining>0,'RELEASE_DEADLINE')
        def read_state():
            state,current=live_read();need(current==envelope,'A5_CHANGED');return state
        profile=prepared['profile'];argv=['/usr/bin/node',str(Path(profile['runtimeRoot'])/profile['entryRelative'])]
        result=run_child(argv,payload,read_state,session,remaining)
        need(preflight(a)==prepared,'RUNTIME_CHANGED')
        if operation=='action':
            save(root/'receipt.json',m.enc(result));return result
        need(result['kind']=='cn-business-terminal-observation-v1' and result['externalWritesTerminal']is True and result['businessReceiptSha256']==hashlib.sha256(raw).hexdigest() and result['identity']==a['identity'] and result['releaseSha256']==release_sha,'READBACK_TERMINAL')
        return receipt
    finally:os.close(fd)


def verify(raw,manifest,previous,mode,release_sha):
    a=validate_approval(private(APPROVALS/(release_sha+'.json')),release_sha,'readback')
    need(manifest['stage']=='observe' and manifest['previousReceiptSha256']==previous,'VERIFY_STAGE')
    for k,v in a['identity'].items():
        if k!='publicationAttemptId':need(manifest[k]==v,'VERIFY_IDENTITY')
    observation=execute(a,release_sha,'readback')
    need(mode in ('advance','reconcile','terminal'),'VERIFY_MODE')
    need(raw==state_module(a).enc(observation),'BUSINESS_ORIGINAL_RAW')
    return {'externalWritesTerminal':True} if mode=='terminal' else True



def main():
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['acceptance','observe','readback','rollback','rollback-readback','baseline-health','preflight']);p.add_argument('release_sha');p.add_argument('recovery_sha',nargs='?');args=p.parse_args()
    try:
        need(bool(re.fullmatch('[a-f0-9]{64}',args.release_sha)),'APPROVAL_SHA')
        need((args.mode in ('rollback','rollback-readback','baseline-health'))==(args.recovery_sha is not None),'RECOVERY_ARGUMENT')
        if args.recovery_sha is not None:need(bool(re.fullmatch('[a-f0-9]{64}',args.recovery_sha)),'RECOVERY_SHA')
        need(os.geteuid()==0,'ROOT_REQUIRED')
        a=validate_approval(private(APPROVALS/(args.release_sha+'.json')),args.release_sha,args.mode)
        if args.mode=='preflight':preflight(a);result={'kind':'cn-business-preflight-v1','ready':True,'businessAccepted':False}
        elif args.mode=='baseline-health':result=baseline_health(a,args.release_sha,args.recovery_sha)
        else:result=execute(a,args.release_sha,args.mode,args.recovery_sha)
        print(json.dumps(result,sort_keys=True,separators=(',',':')));return 0
    except Exception:
        # No raw exceptions, credentials, paths, or provider body on either stream.
        print(json.dumps({'schemaVersion':1,'kind':'cn-business-observer-blocked-v1','status':'BLOCKED','reason':'LIVE_BUSINESS_ADAPTER_UNAVAILABLE','businessAccepted':False,'externalWritesTerminal':False}))
        return 2
    return 2

if __name__=='__main__':sys.exit(main())
