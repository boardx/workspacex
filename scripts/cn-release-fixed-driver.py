#!/usr/bin/env python3
"""Single invocation, receipt-driven CN release coordinator.

The immutable root-installed router builds packages from canonical generators.
This driver never retries an uncertain mutation or chooses recovery itself.
"""
import argparse
import fcntl
import importlib.util
import os
from pathlib import Path
import stat
import sys

ROOT=Path(__file__).resolve().parents[1]

def module(path,name):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

e=module(ROOT/'.harness/scripts/vm/cn-release-advance.py','fixed_driver_entry')
APPROVALS=Path('/etc/workspacex-cn/release-approvals')
DRIVER_STATE=Path('/var/lib/workspacex-cn/release-driver')
IDENTITY=('sourceRevision','baselineRevision','controlRevision','publicationAttemptId','attemptId','requestedAt','deadlineAt')
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}


def validate(sha,raw,now):
    e.need(e.HEX.fullmatch(sha) and e.digest(raw)==sha,'APPROVAL_HASH')
    a=e.decode(raw);e.need(a['kind']=='cn-fixed-release-approval-v1' and a['target']==TARGET,'APPROVAL_SCOPE')
    r=a['identity'];e.need(set(r)==set(IDENTITY),'IDENTITY_FIELDS')
    for k in IDENTITY[:3]:e.need(e.SHA.fullmatch(r[k]),'REVISION')
    for k in ('attemptId','publicationAttemptId'):e.need(e.ATTEMPT.fullmatch(r[k]),'ATTEMPT')
    start,end=e.instant(r['requestedAt']),e.instant(r['deadlineAt'])
    e.need(start<end and (end-start).total_seconds()<=1800,'TOTAL_BUDGET')
    e.need(start<=e.instant(a['issuedAt'])<e.instant(a['expiresAt'])<=end,'APPROVAL_WINDOW')
    # Status and reconciliation remain available after the original deadline.
    e.need(e.instant(a['issuedAt'])<=now,'APPROVAL_NOT_YET_VALID')
    return a


def package_identity(request,approval,stage,previous,release,transport=None):
    transport = e if transport is None else transport
    m,files=transport.load_package(request,approval['identity']['attemptId'])
    e.need(e.digest(files['authorization.json'])==release and e.decode(files['authorization.json'])==approval,'PACKAGE_RELEASE_AUTHORITY')
    # The complete original approval binds publicationAttemptId although the
    # lower-level transport manifest predates that acquire identity field.
    e.need(e.decode(files['authorization.json'])['identity']['publicationAttemptId']==approval['identity']['publicationAttemptId'],'PUBLICATION_ATTEMPT')
    e.need(m['scope']==getattr(transport,'scope','runtime-only-reviewed-continuation') and m['stage']==stage,'ROUTER_STAGE')
    for k in ('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt'):
        e.need(m[k]==approval['identity'][k],'ROUTER_IDENTITY')
    e.need(m['previousReceiptSha256']==previous,'ROUTER_PREVIOUS')
    return m


def coordinate(release,approval,router,*,mode='run',executor=None,clock=e.now,transport=None):
    """Router returns a request SHA; executor remains the original durable entry.

    Test seams model external terminal outcomes; they do not claim cloud E2E.
    A single approval permits the fixed ordered chain, never skip or reset time.
    """
    transport = e if transport is None else transport
    executor = transport.entry if executor is None else executor
    e.need(mode in ('run','status','reconcile'),'DRIVER_MODE')
    previous=None;receipts=[];attempt=approval['identity']['attemptId']
    # Validate the entire installed route before consuming or stopping writers.
    # Missing later observers/recovery capabilities cannot be deferred to stop.
    if mode=='run':router.preflight(release)
    for stage in transport.STAGES:
        # Lookup is read-only. The router may create the next package only after
        # all previous receipts passed original immutable-file checks.
        request=router.lookup(release,stage)
        if request is None:
            if mode!='run':return {'status':'NOT_STARTED','stage':stage,'completed':receipts}
            e.need(clock()<e.instant(approval['expiresAt']),'RELEASE_DEADLINE')
            admission=router.admission(release,stage)
            if admission is not None:return {'status':admission,'stage':stage,'completed':receipts,'intentCreated':False}
            request=router.generate(release,stage,previous)
        package_identity(request,approval,stage,previous,release,transport)
        current=executor('status',request,attempt)
        if current['status']=='UNCERTAIN':
            if mode!='reconcile':
                return {'status':'UNKNOWN_RECONCILE_REQUIRED','stage':stage,'completed':receipts,'mutationRetried':False}
            # Explicit read-only reconciliation, never an implicit retry.
            current=executor('reconcile',request,attempt)
        elif current['status']=='NOT_STARTED':
            if mode!='run':return {'status':'NOT_STARTED','stage':stage,'completed':receipts}
            e.need(clock()<e.instant(approval['expiresAt']),'RELEASE_DEADLINE')
            if stage=='clear-hold':
                # A durable generated package is not a permanent writer grant.
                # Recheck policy revocation even when lookup found the package.
                admission=router.admission(release,stage)
                if admission is not None:return {'status':admission,'stage':stage,'completed':receipts,'intentCreated':False}
            current=executor('advance',request,attempt)
        e.need(current['status']=='COMPLETED','ENTRY_NOT_COMPLETED')
        # Re-read through the original status path after execution, including
        # independent observer hashes, before deriving the next stage.
        verified=executor('status',request,attempt)
        e.need(verified['status']=='COMPLETED' and verified['receiptSha256']==current['receiptSha256'],'RECEIPT_CHANGED')
        previous=verified['receiptSha256'];receipts.append({'stage':stage,'requestSha256':request,'receiptSha256':previous})
    return {'status':'CHAIN_COMPLETED','completed':receipts,'requestedAt':approval['identity']['requestedAt'],
            'deadlineAt':approval['identity']['deadlineAt'],'productionAcceptanceClaimedByDriver':False}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=('run','status','reconcile'));p.add_argument('release_sha256');args=p.parse_args()
    e.need(os.geteuid()==0 and e.HEX.fullmatch(args.release_sha256),'ROOT_RELEASE_REQUIRED')
    raw=e.read(APPROVALS/(args.release_sha256+'.json'));a=validate(args.release_sha256,raw,e.now())
    # Fixed installed code paths only. Root approval pins the complete closure;
    # caller cannot supply a router module, shell command, workspace or env.
    pins={'scripts/cn-release-fixed-driver.py':Path(__file__).resolve(),
          'scripts/cn-release-stage-router.py':ROOT/'scripts/cn-release-stage-router.py',
          '.harness/scripts/vm/cn-release-advance.py':ROOT/'.harness/scripts/vm/cn-release-advance.py'}
    for name,path in pins.items():e.need(e.digest(e.read(path))==a['codeFiles'][name],'CODE_PIN')
    router=module(pins['scripts/cn-release-stage-router.py'],'fixed_stage_router').Router(args.release_sha256,a,raw)
    if args.mode=='status':
        print(e.encode(coordinate(args.release_sha256,a,router,mode=args.mode)).decode(),end='');return
    e.directory(DRIVER_STATE)
    fd=os.open(DRIVER_STATE/'driver.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        st=os.fstat(fd);e.need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o077,'DRIVER_LOCK')
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise e.Rejected('ANOTHER_DRIVER_ACTIVE')from None
        result=coordinate(args.release_sha256,a,router,mode=args.mode)
        print(e.encode(result).decode(),end='')
        # A durable wait/unknown result is observable, but not successful execution.
        # Preserve its exact JSON; status remains a successful read-only query.
        return 0 if result['status']=='CHAIN_COMPLETED' else 2
    finally:os.close(fd)

if __name__=='__main__':
    try:sys.exit(main())
    except Exception:
        print('{"status":"BLOCKED_OR_UNKNOWN","automaticRetry":false,"automaticRecovery":false}',file=sys.stderr);sys.exit(1)
