#!/usr/bin/env python3
"""Fixed readonly runtime observers. Output is original helper/result bytes.
No action execution, synthesized terminal verdict, cloud call or approval write.
"""
import argparse
import datetime as dt
import fcntl
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys

BASE=Path(__file__).resolve().parents[1]
READBACK=BASE/'scripts/cn-release-runtime-readback.py'
APPROVALS=Path('/etc/workspacex-cn/runtime-observer-approvals')
RUNTIME=Path('/var/lib/workspacex-cn/runtime')
ETC=Path('/etc/workspacex-cn')
VAR=Path('/var/lib/workspacex-cn')
HOLD_HELPER=Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py')
FINAL_TEMPLATE=BASE/'.harness/scripts/vm/cn-runtime-continuation/finalize/runtime.py'
FINAL_GENERATOR=BASE/'scripts/cn-release-continuation-finalize.py'


def load_readback():
    spec=importlib.util.spec_from_file_location('runtime_readback',READBACK)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def observe(a,*,readback=None,reader=None,runtime_root=RUNTIME,hold_read=None,run_readonly=None,now=None):
    """Library injection is for fixtures; production CLI admits pinned code first."""
    rb=readback or load_readback();now=now or dt.datetime.now(dt.timezone.utc)
    rb.need(a['kind']=='cn-runtime-readonly-observer-approval-v1' and a['mode']in ('hold','stop','sessions','backup','switch','clear-hold'),'OBSERVER_SCOPE')
    rb.need(rb.timestamp(a['issuedAt'])<=now<rb.timestamp(a['expiresAt']) and rb.timestamp(a['expiresAt'])-rb.timestamp(a['issuedAt'])<=dt.timedelta(minutes=30),'OBSERVER_EXPIRED')
    rb.need(type(a['maxSeconds'])is int and 1<=a['maxSeconds']<=120,'OBSERVER_TIMEOUT')
    root=Path(a['remoteRoot']);rb.need(root.parent==runtime_root and re.fullmatch('upgrade-f0eb-[a-z0-9-]{1,64}',root.name),'RUNTIME_SCOPE')
    reader=reader or rb.Reader(max_seconds=a['maxSeconds'])
    # Pin delegated source even for callers of the library API.
    rb.need(rb.sha(reader.file(READBACK))==a['codeFiles']['scripts/cn-release-runtime-readback.py'],'READBACK_CODE_PIN')
    binding_raw=reader.file(root/'binding.json');rb.need(rb.sha(binding_raw)==a['bindingSha256'],'BINDING_HASH')
    b=rb.parse(binding_raw);rb.need({k:b[k]for k in rb.IDENTITY}==a['identity'],'BINDING_IDENTITY')
    for name,field in [('upgrade-draft.py','scriptSha256'),('sessions-after-stop.py','sessionsHelperSha256')]:
        rb.need(rb.sha(reader.file(root/name))==b[field]==a['runtimePins'][field],'RUNTIME_PIN')
    rb.trusted_module(reader.file(root/'upgrade-draft.py'),'observer_upgrade')['validate_binding'](b)
    rb.need(b['holdHelperSha256']==a['runtimePins']['holdHelperSha256'],'HOLD_PIN')
    if run_readonly is None:
        def run_readonly(argv):
            reader.tick();p=subprocess.run(argv,capture_output=True,
                timeout=min(a['maxSeconds'],max(.01,reader.deadline-__import__('time').monotonic())),
                env={'PATH':'/usr/bin:/bin','LANG':'C'})
            rb.need(p.returncode==0 and len(p.stdout)<=65536,'READONLY_COMMAND_FAILED');return p.stdout
    if hold_read is None:
        rb.need(rb.sha(reader.file(HOLD_HELPER,modes=(0o600,0o700)))==b['holdHelperSha256'],'HOLD_CODE_PIN')
        def hold_read():return run_readonly(['/usr/bin/python3','-I','-S','-B',str(HOLD_HELPER),'read',str(runtime_root)])
    if a['mode']=='clear-hold':
        return observe_cleared(a,b,binding_raw,rb,reader,hold_read,run_readonly,runtime_root,now)
    if a['mode']=='backup':
        delegated=dict(kind='cn-runtime-backup-readback-approval-v1',remoteRoot=str(root),bindingSha256=a['bindingSha256'],
            identity=a['identity'],holdGeneration=b['hold']['generation'],issuedAt=a['issuedAt'],expiresAt=a['expiresAt'],
            observerSha256=a['codeFiles']['scripts/cn-release-runtime-readback.py'],upgradeSha256=a['runtimePins']['scriptSha256'],
            backupHelperSha256=a['runtimePins']['backupHelperSha256'],holdHelperSha256=a['runtimePins']['holdHelperSha256'],maxSeconds=a['maxSeconds'])
        return rb.observe(delegated,runtime_root=runtime_root,reader=reader,hold_reader=lambda:rb.parse(hold_read()),now=now)
    if a['mode']in ('stop','sessions'):
        # Original session helper owns canonical release.lock and performs the
        # real Docker/readonly-session checks. Never nest the same lock here.
        first=hold_read();rb.need(rb.parse(first)==b['hold'],'HOLD_CHANGED')
        raw=run_readonly(['/usr/bin/python3','-I','-S','-B',str(root/'sessions-after-stop.py'),str(root),a['bindingSha256']])
        rb.need(reader.file(root/'binding.json')==binding_raw and hold_read()==first,'SESSION_READBACK_DRIFT')
        rb.need(dt.datetime.now(dt.timezone.utc)<rb.timestamp(a['expiresAt']),'OBSERVER_EXPIRED')
        return raw
    if a['mode']=='switch':
        # Original final runtime performs all hold/container/config validations.
        generator=reader.file(FINAL_GENERATOR);template=reader.file(FINAL_TEMPLATE)
        rb.need(rb.sha(generator)==a['codeFiles']['scripts/cn-release-continuation-finalize.py']
            and rb.sha(template)==a['codeFiles']['.harness/scripts/vm/cn-runtime-continuation/finalize/runtime.py'],'FINAL_CODE_PIN')
        ns=rb.trusted_module(generator,'final_generator')
        specialized=ns['specialize'](template,b['sourceRevision'])
        switch=reader.file(root/'switch-result.json')
        config=dict(mode='status',root=str(root),bindingSha256=a['bindingSha256'],hold=b['hold'],
            switchReceiptSha256=rb.sha(switch),issuedAt=a['issuedAt'],expiresAt=a['expiresAt'])
        source=specialized.decode().replace('__CONFIG__',repr(config))
        # Root-approved source only; exec namespace __main__ is intentionally not
        # used so the original run() result is returned without logging extras.
        final=rb.trusted_module(source.encode(),'final_status')
        result=final['run'](config)
        import json
        return (json.dumps(result,sort_keys=True)+'\n').encode()
    lock,s=reader.opened(runtime_root/'release.lock')
    try:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('CANONICAL_RELEASE_BUSY')from None
        rb.need(reader.file(root/'binding.json')==binding_raw,'BINDING_CHANGED')
        intent=rb.parse(reader.file(root/'hold-intent.json'))
        identity={k:b[k]for k in ('sourceRevision','baselineRevision','attemptId')}
        identity['migrationPlanSha256']=b['migrationDiffEvidenceSha256']
        rb.need(intent=={'bindingSha256':a['bindingSha256'],'identity':identity},'HOLD_INTENT')
        result_raw=reader.file(root/'hold-result.json');result=rb.parse(result_raw)
        first=hold_read();actual=rb.parse(first)
        rb.need(actual==result and actual['state']=='held' and actual['identity']==identity,'HOLD_RESULT_CHANGED')
        # Output precisely the independently read helper bytes, not action's
        # {operation, actualHold, writerStopExecuted} wrapper or reconstructed JSON.
        rb.need(hold_read()==first and reader.file(root/'hold-result.json')==result_raw
            and reader.file(root/'binding.json')==binding_raw,'HOLD_READBACK_DRIFT')
        reader.tick();rb.need(dt.datetime.now(dt.timezone.utc)<rb.timestamp(a['expiresAt']),'OBSERVER_EXPIRED')
        return first
    finally:os.close(lock)


def observe_cleared(a,b,binding_raw,rb,reader,hold_read,run_readonly,runtime_root,now):
    """Independent current CAS readback, never manufacture original action bytes."""
    import json
    release_sha=a['releaseSha256'];writer_sha=a['writerApprovalSha256']
    rb.need(re.fullmatch('[a-f0-9]{64}',release_sha) and re.fullmatch('[a-f0-9]{64}',writer_sha),'CLEAR_AUTHORITY_SHA')
    etc=ETC;var=VAR
    raw=reader.file(etc/'writer-resume-approvals'/(writer_sha+'.json'));rb.need(rb.sha(raw)==writer_sha,'A5_APPROVAL_HASH');w=rb.parse(raw)
    rb.need(rb.parse(reader.file(etc/'writer-resume-approvals'/'by-release'/(release_sha+'.json')))=={'approvalSha256':writer_sha},'A5_POINTER')
    rb.need(w['kind']=='cn-writer-resume-approval-v1' and w['releaseSha256']==release_sha
        and w['scope']=='a5-resume-writers-and-a6-scoped-business-observation','A5_SCOPE')
    for k,v in a['identity'].items():rb.need(w['identity'][k]==v,'A5_IDENTITY')
    rb.need(rb.timestamp(w['issuedAt'])<=now<rb.timestamp(w['expiresAt'])<=rb.timestamp(w['identity']['deadlineAt']),'A5_WINDOW')
    root=Path(a['remoteRoot']);out=var/'release-generated'/release_sha/'terminal'/'writer-resume'
    p=rb.parse(reader.file(out/'writer-resume-provenance.json'))
    rb.need(p['kind']=='cn-writer-resume-materialization-v1' and p['releaseSha256']==release_sha
        and p['writerApprovalSha256']==writer_sha and p['testDataScopeSha256']==w['testDataScopeSha256'],'A5_PROVENANCE')
    for name,pin in p['files'].items():
        rb.need(Path(name).name==name and name not in ('.','..'),'A5_FILE_SCOPE');rb.need(rb.sha(reader.file(out/name))==pin,'A5_FILE_PIN')
    for key,wkey in [('binding','bindingSha256'),('switchReceipt','switchReceiptSha256'),('status','heldHealthSha256'),('hold','holdRawSha256'),('testDataScope','testDataScopeSha256'),('userAuthorization','userAuthorizationEvidenceSha256')]:
        rb.need(p['inputHashes'][key]==w[wkey],'A5_INPUT_PIN')
    cfg=rb.parse(reader.file(out/'binding-summary.json'))
    rb.need(cfg['mode']=='clear-hold' and cfg['root']==str(root) and cfg['bindingSha256']==w['bindingSha256']==a['bindingSha256']
        and cfg['statusSha256']==w['heldHealthSha256'] and cfg['hold']==b['hold'],'A5_CONFIG_LINK')
    import base64
    status_raw=base64.b64decode(cfg['statusBase64'],validate=True);rb.need(rb.sha(status_raw)==w['heldHealthSha256'],'A5_STATUS_PIN')
    status=rb.parse(status_raw)
    template=reader.file(FINAL_TEMPLATE);rb.need(rb.sha(template)==a['codeFiles']['.harness/scripts/vm/cn-runtime-continuation/finalize/runtime.py'],'FINAL_CODE_PIN')
    canonical=rb.trusted_module(template.replace(b'__CONFIG__',b'{}'),'cleared_validator')
    lock,_=reader.opened(runtime_root/'release.lock')
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        first=hold_read();actual=rb.parse(first)
        rb.need(actual=={**b['hold'],'state':'cleared'} and actual['generation']==w['holdGeneration'],'LIVE_CLEAR_HOLD')
        switch=reader.file(root/'switch-result.json');rb.need(rb.sha(switch)==w['switchReceiptSha256'],'CLEAR_SWITCH_LINK')
        rb.need(rb.parse(reader.file(root/'switch-intent.json'))=={'bindingSha256':a['bindingSha256'],'holdGeneration':w['holdGeneration']},'CLEAR_SWITCH_INTENT')
        for ref in b['composeFiles']+b['envFiles']:rb.need(rb.sha(reader.file(Path(ref['path'])))==ref['sha256'],'CLEAR_CONFIG_DRIFT')
        xs=rb.parse(run_readonly(['/usr/bin/docker','--host','unix:///run/docker.sock','inspect',*b['expectedContainers']]))
        observed=canonical['validate_status'](b,root,xs);rb.need(status['containers']==observed,'CLEAR_CONTAINERS_CHANGED')
        rb.need(hold_read()==first and reader.file(root/'binding.json')==binding_raw,'CLEAR_READBACK_DRIFT')
        result=dict(kind='f0eb-hold-cleared-v1',actualHoldCleared=True,generation=actual['generation'],identity=actual['identity'],
            bindingSha256=a['bindingSha256'],statusSha256=w['heldHealthSha256'],observedAt=now.isoformat(),
            applicationRecreated=False,businessAcceptancePassed=False,writerApprovalSha256=writer_sha,testDataScopeSha256=w['testDataScopeSha256'])
        return (json.dumps(result,sort_keys=True)+'\n').encode()
    finally:os.close(lock)


def bootstrap_read(path):
    import stat
    for p in path.parents:
        s=p.lstat()
        if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:raise ValueError('ROOT_PARENT')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb')as f:
        s=os.fstat(f.fileno())
        if not stat.S_ISREG(s.st_mode)or s.st_uid!=0 or s.st_nlink!=1 or s.st_mode&0o077 or s.st_size>1048576:raise ValueError('ROOT_FILE')
        return f.read()


def approval_by_sha(value):
    import hashlib,json
    if os.geteuid()!=0 or not re.fullmatch('[a-f0-9]{64}',value):raise ValueError('ROOT_APPROVAL')
    raw=bootstrap_read(APPROVALS/(value+'.json'))
    if hashlib.sha256(raw).hexdigest()!=value:raise ValueError('APPROVAL_HASH')
    a=json.loads(raw)
    for relative in ('scripts/cn-release-runtime-observe.py','scripts/cn-release-runtime-readback.py'):
        if hashlib.sha256(bootstrap_read(BASE/relative)).hexdigest()!=a['codeFiles'][relative]:raise ValueError('CODE_PIN')
    return a


def verify_observation(raw,live,approval,binding,*,now=None,canonical_final=None):
    """Compare original raw to independently obtained live bytes; never rewrite it.
    Injectable canonical_final is a test/library dependency, not a CLI option.
    """
    rb=load_readback();now=now or dt.datetime.now(dt.timezone.utc)
    phase=approval['mode'];old=rb.parse(raw);fresh=rb.parse(live)
    if phase in ('hold','backup'):
        rb.need(raw==live,'OBSERVATION_RAW_CHANGED');return True
    field='observedAt' if phase in ('switch','clear-hold') else 'finishedAt'
    for value in (old,fresh):
        rb.need(dt.timedelta(0)<=now-rb.timestamp(value[field])<=dt.timedelta(minutes=10),'OBSERVATION_STALE')
    if phase=='switch':
        rb.need(canonical_final is not None,'CANONICAL_FINAL_REQUIRED')
        c=dict(bindingSha256=approval['bindingSha256'],switchReceiptSha256=fresh['switchReceiptSha256'],hold=binding['hold'])
        canonical_final['validate_clear'](c,binding,old,now)
        canonical_final['validate_clear'](c,binding,fresh,now)
    else:rb.need(phase in ('stop','sessions','clear-hold'),'OBSERVATION_MODE')
    rb.need({k:v for k,v in old.items()if k!=field}=={k:v for k,v in fresh.items()if k!=field},'OBSERVATION_STATE_CHANGED')
    return True


def verify(raw,manifest,previous,mode,context):
    """Fixed router wrapper contract; context must contain only approved raw SHA.
    Independent observer validates actual host state. Entry additionally proves
    local invocation termination; this function does not assert RDS/cloud state.
    """
    if set(context)!={'approvalSha256'}:raise ValueError('FIXED_OBSERVER_CONTEXT')
    a=approval_by_sha(context['approvalSha256']);rb=load_readback()
    rb.need(mode in ('advance','reconcile','terminal'),'UNSUPPORTED_VERIFY_MODE')
    for key,value in a['identity'].items():rb.need(manifest[key]==value,'OBSERVER_MANIFEST_IDENTITY')
    phase=a['mode'];rb.need(manifest['stage']==phase or phase=='switch' and manifest['stage']=='acceptance','OBSERVER_STAGE')
    live=observe(a);b=rb.parse(bootstrap_read(Path(a['remoteRoot'])/'binding.json'))
    rb.need(rb.sha(bootstrap_read(Path(a['remoteRoot'])/'binding.json'))==a['bindingSha256'],'BINDING_DRIFT')
    if mode=='advance' and phase=='clear-hold':
        old=rb.parse(raw);current=rb.parse(live)
        rb.need(set(old)==set(current)-{'writerApprovalSha256','testDataScopeSha256'},'CLEAR_ACTION_FIELDS')
        rb.need(dt.timedelta(0)<=dt.datetime.now(dt.timezone.utc)-rb.timestamp(old['observedAt'])<=dt.timedelta(minutes=10),'CLEAR_ACTION_STALE')
        rb.need({k:v for k,v in old.items()if k!='observedAt'}=={k:v for k,v in current.items()if k not in ('observedAt','writerApprovalSha256','testDataScopeSha256')},'CLEAR_ACTION_CHANGED')
        return True
    if mode=='advance' and manifest['stage']!='acceptance' and phase in ('hold','stop','backup','switch'):
        x=rb.parse(raw)
        if phase=='hold':rb.need(x=={'operation':'hold','actualHold':rb.parse(live),'writerStopExecuted':False},'HOLD_ACTION')
        elif phase=='stop':rb.need(x=={'operation':'stop','knownFiveStopped':True,'otherDatabaseClientSessions':None,'holdRetained':True,'sessionReadbackRequired':True},'STOP_ACTION')
        else:rb.need(x=={'operation':phase,'completed':True,'holdRetained':True},'RUNTIME_ACTION')
    else:
        canonical=None
        if phase=='switch':
            template=bootstrap_read(FINAL_TEMPLATE)
            rb.need(rb.sha(template)==a['codeFiles']['.harness/scripts/vm/cn-runtime-continuation/finalize/runtime.py'],'FINAL_CODE_PIN')
            canonical=rb.trusted_module(template.replace(b'__CONFIG__',b'{}'),'verify_final')
        verify_observation(raw,live,a,b,canonical_final=canonical)
    return {'externalWritesTerminal':True}if mode=='terminal' else True


def main():
    import hashlib,json
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--approval-sha256',required=True);args=p.parse_args()
    if os.geteuid()!=0 or not re.fullmatch('[a-f0-9]{64}',args.approval_sha256):raise ValueError('ROOT_APPROVAL')
    raw=bootstrap_read(APPROVALS/(args.approval_sha256+'.json'))
    if hashlib.sha256(raw).hexdigest()!=args.approval_sha256:raise ValueError('APPROVAL_HASH')
    a=json.loads(raw)
    for relative in ('scripts/cn-release-runtime-observe.py','scripts/cn-release-runtime-readback.py'):
        if hashlib.sha256(bootstrap_read(BASE/relative)).hexdigest()!=a['codeFiles'][relative]:raise ValueError('CODE_PIN')
    sys.stdout.buffer.write(observe(a))


if __name__=='__main__':
    try:main()
    except Exception:
        print('{"status":"BLOCKED","code":"RUNTIME_READBACK_UNPROVEN"}',file=sys.stderr);sys.exit(1)
