#!/usr/bin/env python3
"""Fixed-root terminal materialization; no clear/recovery execution or cloud calls.
Normal final consumes the complete verified entry chain. Recovery requires its
own fresh approval and terminal observation; the original release clock stays.
"""
import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import threading

BASE=Path(__file__).resolve().parents[1]
APPROVALS=Path('/etc/workspacex-cn/release-approvals')
RECOVERY_APPROVALS=Path('/etc/workspacex-cn/release-recovery-approvals')
WRITER_APPROVALS=Path('/etc/workspacex-cn/writer-resume-approvals')
INPUTS=Path('/var/lib/workspacex-cn/release-inputs')
GENERATED=Path('/var/lib/workspacex-cn/release-generated')
ENTRY_CODE='.harness/scripts/vm/cn-release-advance.py'
FINAL_CODE='scripts/cn-release-continuation-finalize.py'
SELF_CODE='scripts/cn-release-terminal-delegation.py'
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}
FIELDS=('sourceRevision','baselineRevision','controlRevision','publicationAttemptId','attemptId','requestedAt','deadlineAt')


def need(v,c):
    if not v:raise ValueError(c)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def enc(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()


def parse(raw):
    def pairs(xs):
        out={}
        for k,v in xs:need(k not in out,'DUPLICATE_JSON_KEY');out[k]=v
        return out
    return json.loads(raw,object_pairs_hook=pairs)


def stamp(v):
    t=dt.datetime.fromisoformat(v.replace('Z','+00:00'));need(t.tzinfo is not None,'TIMEZONE');return t


def private(path):
    for p in path.parents:
        s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'ROOT_PARENT')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb')as f:
        s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1
            and not s.st_mode&0o077 and s.st_size<=1048576,'ROOT_FILE');return f.read()


def load_code(relative,a):
    raw=private(BASE/relative);need(sha(raw)==a['codeFiles'][relative],'CODE_PIN')
    spec=importlib.util.spec_from_file_location('terminal_'+Path(relative).stem,BASE/relative)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def release(raw):
    a=parse(raw);need(a['kind']=='cn-fixed-release-approval-v1' and a['target']==TARGET,'RELEASE_SCOPE')
    need(set(a['identity'])==set(FIELDS),'IDENTITY_FIELDS')
    for key in ('sourceRevision','baselineRevision','controlRevision'):need(re.fullmatch('[a-f0-9]{40}',a['identity'][key]),'IDENTITY_REVISION')
    for key in ('attemptId','publicationAttemptId'):need(re.fullmatch('[a-z0-9-]{1,64}',a['identity'][key]),'IDENTITY_ATTEMPT')
    return a,sha(raw)


# Only this module's live lock context can mint a capability. No serialized
# bool/token or independently opened fd is accepted as an owned entry lock.
_WRITER_LOCKS = {}


class _WriterLock:
    __slots__ = ()

    def __reduce__(self):
        raise TypeError('WRITER_LOCK_NOT_SERIALIZABLE')


def owned_writer_root(capability, entry, identity):
    record = _WRITER_LOCKS.get(capability)
    need(record is not None, 'WRITER_LOCK_CAPABILITY')
    actual_entry, actual_identity, root, fd, inode, pid, thread = record
    need(pid == os.getpid() and thread == threading.get_ident(), 'WRITER_LOCK_EXECUTION_OWNER')
    need(actual_entry is entry and actual_identity == identity, 'WRITER_LOCK_BINDING')
    s = os.fstat(fd)
    named = (entry.STATE/'entry.lock').lstat()
    need((s.st_dev, s.st_ino) == inode == (named.st_dev, named.st_ino)
         and stat.S_ISREG(named.st_mode) and not stat.S_ISLNK(named.st_mode)
         and s.st_uid == entry.OWNER and s.st_nlink == 1 and not s.st_mode & 0o077,
         'WRITER_LOCK_REPLACED')
    need(entry.decode(entry.read(entry.STATE/'active-attempt.json')) == identity['attemptId'], 'ACTIVE_ATTEMPT')
    actual = entry.decode(entry.read(root/'identity.json'))
    need(actual == {**{k: identity[k] for k in FIELDS if k != 'publicationAttemptId'},
                    'scope': 'runtime-only-reviewed-continuation'}, 'ENTRY_IDENTITY')
    return root


@contextmanager
def writer_lock(entry, identity):
    root = entry.STATE/identity['attemptId']; entry.directory(root)
    fd = os.open(entry.STATE/'entry.lock', os.O_RDWR | os.O_NOFOLLOW)
    capability = _WriterLock()
    try:
        s = os.fstat(fd)
        need(stat.S_ISREG(s.st_mode) and s.st_uid == entry.OWNER and s.st_nlink == 1
             and not s.st_mode & 0o077, 'LOCK_FILE')
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('ENTRY_ACTIVE') from None
        _WRITER_LOCKS[capability] = (entry, dict(identity), root, fd, (s.st_dev, s.st_ino), os.getpid(), threading.get_ident())
        owned_writer_root(capability, entry, identity)
        yield capability
    finally:
        _WRITER_LOCKS.pop(capability, None)
        os.close(fd)


@contextmanager
def locked(entry, identity):
    with writer_lock(entry, identity) as capability:
        yield owned_writer_root(capability, entry, identity)


def chain(entry,root,identity,verifiers,end):
    need(sorted(root.glob('*.receipt.json'))==[root/('%02d-%s.receipt.json'%(i,entry.STAGES[i]))for i in range(end+1)],'CHAIN_LENGTH')
    for intent in root.glob('*.intent.json'):need(intent.with_name(intent.name.replace('.intent.json','.receipt.json')).exists(),'UNKNOWN_INTENT')
    prior=None;observations={};last=stamp(identity['requestedAt'])
    for i,stage in enumerate(entry.STAGES[:end+1]):
        prefix=root/('%02d-%s'%(i,stage));raw=entry.read(Path(str(prefix)+'.receipt.json'));v=entry.decode(raw)
        need(v['stage']==stage and v['mode']in ('advance','reconcile'),'CHAIN_STAGE')
        for k in FIELDS:
            if k!='publicationAttemptId':need(v[k]==identity[k],'CHAIN_IDENTITY')
        need(v['previousReceiptSha256']==(sha(prior)if prior else None),'CHAIN_PREVIOUS')
        manifest,files=entry.load_package(v['requestSha256'],identity['attemptId'])
        need(manifest['stage']==stage and manifest['scope']=='runtime-only-reviewed-continuation'
             and manifest['previousReceiptSha256']==v['previousReceiptSha256'],'CHAIN_MANIFEST')
        for k in FIELDS:
            if k!='publicationAttemptId':need(manifest[k]==identity[k],'MANIFEST_IDENTITY')
        need(manifest['verifierSha256']==verifiers[stage],'VERIFIER_PIN')
        entry.verify_historical_receipt(Path(str(prefix)+'.receipt.json'),v,manifest)
        action=entry.read(Path(str(prefix)+'.evidence.json'));terminal=entry.read(Path(str(prefix)+'.terminal-observation.json'))
        when=stamp(v['finishedAt']);need(last<=when<=stamp(identity['deadlineAt']),'CHAIN_TIME');last=when
        observations[stage]=(action,terminal,raw);prior=raw
    return observations


def derive_final(approval_raw,inputs,entry,finalizer,output,*,now=None):
    a,release_sha=release(approval_raw);identity=a['identity'];now=now or dt.datetime.now(dt.timezone.utc)
    need(stamp(a['issuedAt'])<=now<stamp(a['expiresAt'])<=stamp(identity['deadlineAt']),'NORMAL_EXPIRED')
    need(stamp(identity['requestedAt'])<=now<stamp(identity['deadlineAt']) and stamp(identity['deadlineAt'])-stamp(identity['requestedAt'])<=dt.timedelta(minutes=30),'NORMAL_BUDGET')
    need(a['finalize']['allowedModes']==['clear-hold'],'FINALIZE_SCOPE')
    need(set(inputs)=={'binding','hold','switchReceipt','status','businessReceipt'},'FINAL_INPUTS')
    with locked(entry,identity)as root:
        observed=chain(entry,root,identity,a['finalize']['stageVerifierSha256'],14)
        need(inputs['businessReceipt']==observed['acceptance'][0] and inputs['status']==observed['acceptance'][1],'ACCEPTANCE_RAW_LINK')
        need(inputs['switchReceipt']==observed['switch'][1],'SWITCH_RAW_LINK')
        need(inputs['hold']==observed['hold'][1],'HOLD_RAW_LINK')
        status=parse(inputs['status']);need(status['bindingSha256']==sha(inputs['binding']),'BINDING_STATUS_LINK')
        need(a['finalize']['businessValidatorSourceSha256']==sha(finalizer.SCHEMA.read_bytes()),'CANONICAL_SCHEMA_PIN')
        r={k:identity[k]for k in ('sourceRevision','controlRevision','attemptId','requestedAt','deadlineAt')}
        r.update(schemaVersion=1,mode='clear-hold',remoteRoot=a['finalize']['remoteRoot'],
                 issuedAt=now.isoformat(),expiresAt=a['expiresAt'],inputs={k:sha(v)for k,v in inputs.items()})
        raw=enc(r);derived=dict(kind='cn-continuation-finalize-approval-v1',requestSha256=sha(raw),
            issuedAt=a['issuedAt'],expiresAt=a['expiresAt'],packageFiles=a['finalize']['packageFiles'],
            businessAcceptance=dict(receiptSha256=sha(inputs['businessReceipt']),validator='cnReleaseBrowserSchema',
                validatorSourceSha256=a['finalize']['businessValidatorSourceSha256'],independentEvidenceSha256=sha(observed['acceptance'][2])))
        result=finalizer.generate(raw,enc(derived),inputs,output,now=now)
        return {'request':raw,'approval':enc(derived),'materialization':result,'releaseSha256':release_sha}


def derive_recovery(approval_raw,fresh_raw,inputs,entry,upgrade,*,now=None):
    a,release_sha=release(approval_raw);r=a['identity'];f=parse(fresh_raw);now=now or dt.datetime.now(dt.timezone.utc)
    need(f['kind']=='cn-release-fresh-recovery-delegation-v1' and f['releaseSha256']==release_sha
         and f['identity']==r and f['target']==TARGET,'RECOVERY_IDENTITY')
    need(f['operation']in ('abort-original','rollback'),'RECOVERY_OPERATION')
    need(stamp(f['issuedAt'])<=now<stamp(f['expiresAt']) and dt.timedelta(0)<stamp(f['expiresAt'])-stamp(f['issuedAt'])<=dt.timedelta(minutes=30),'RECOVERY_WINDOW')
    need(set(inputs)=={'binding','reconciliation','terminalObservation'},'RECOVERY_INPUTS')
    need({k:sha(v)for k,v in inputs.items()}==f['inputHashes'],'RECOVERY_RAW_PINS')
    b=parse(inputs['binding']);need(sha(inputs['binding'])==f['originalBindingSha256'],'ORIGINAL_BINDING')
    for k in FIELDS:
        if k!='publicationAttemptId':need(b[k]==r[k],'ORIGINAL_CLOCK_OR_IDENTITY')
    with locked(entry,r)as root:
        stage=f['failedStage'];need(stage in entry.STAGES,'FAILED_STAGE');index=entry.STAGES.index(stage)
        need(index>=entry.STAGES.index('stop'),'NO_STOP_ATTEMPT_TO_RECOVER')
        need((root/'13-switch.intent.json').exists() if f['operation']=='rollback' else not (root/'13-switch.intent.json').exists(),'RECOVERY_OPERATION_FOR_SWITCH_STATE')
        prefix=root/('%02d-%s'%(index,stage))
        intent=parse(entry.read(Path(str(prefix)+'.intent.json')))
        process=parse(entry.read(Path(str(prefix)+'.process.json')))
        need(intent['requestSha256']==process['requestSha256']==f['failedRequestSha256']
             and entry.execution_terminal(process),'UNKNOWN_EXECUTION_NOT_TERMINAL')
        manifest,files=entry.load_package(f['failedRequestSha256'],r['attemptId'])
        need(manifest['stage']==stage and manifest['scope']=='runtime-only-reviewed-continuation','FAILED_MANIFEST')
        for k in FIELDS:
            if k!='publicationAttemptId':need(manifest[k]==r[k],'FAILED_MANIFEST_IDENTITY')
        need(manifest['verifierSha256']==f['terminalVerifierSha256'],'RECOVERY_VERIFIER_PIN')
        previous=entry.read(root/('%02d-%s.receipt.json'%(index-1,entry.STAGES[index-1])))if index else None
        need(manifest['previousReceiptSha256']==(sha(previous)if previous else None),'RECOVERY_PREVIOUS')
        pointer=parse(entry.read(RECOVERY_APPROVALS/'by-failed-request'/(f['failedRequestSha256']+'.json')))
        need(pointer=={'approvalSha256':sha(fresh_raw)},'RECOVERY_POINTER_APPROVAL_MISMATCH')
        entry.verify(files['verify.py'],inputs['terminalObservation'],manifest,parse(previous)if previous else None,'pre-recovery')
        reconciliation=parse(inputs['reconciliation'])
        # Existing upgrade validator enforces fresh <=10m reconciliation,
        # same hold/attempt, no active commands and an independently terminal prior.
        recovery=dict(kind='f0eb-fresh-recovery-v1',operation=f['operation'],originalBindingSha256=f['originalBindingSha256'],
            **{k:b[k]for k in ('attemptId','sourceRevision','baselineRevision','hold')},issuedAt=f['issuedAt'],expiresAt=f['expiresAt'],
            authorizationEvidenceSha256=sha(fresh_raw),reconciliationSha256=sha(inputs['reconciliation']))
        upgrade.validate_binding(b)
        upgrade.validate_recovery(b,f['originalBindingSha256'],recovery,f['operation'],now,reconciliation)
        return {'recovery-binding.json':enc(recovery),'recovery-reconciliation.json':inputs['reconciliation'],
                'provenance.json':enc({'releaseSha256':release_sha,'freshApprovalSha256':sha(fresh_raw),
                    'requestedAt':r['requestedAt'],'deadlineAt':r['deadlineAt'],'cloudCalls':0,'recoveryExecuted':False})}




def derive_held_health(approval_raw,inputs,entry,finalizer,output,*,now=None):
    """Once-authorized A4 held-health read, with no browser or writer resume."""
    a,release_sha=release(approval_raw);r=a['identity'];now=now or dt.datetime.now(dt.timezone.utc)
    need(stamp(a['issuedAt'])<=now<stamp(a['expiresAt'])<=stamp(r['deadlineAt'])
         and stamp(r['requestedAt'])<=now<stamp(r['deadlineAt'])
         and dt.timedelta(0)<stamp(r['deadlineAt'])-stamp(r['requestedAt'])<=dt.timedelta(minutes=30),'HELD_HEALTH_BUDGET')
    need(set(inputs)=={'binding','hold','switchReceipt'},'HELD_HEALTH_INPUTS')
    with locked(entry,r)as root:
        observations=chain(entry,root,r,a['writerResume']['stageVerifierSha256'],13)
        need(inputs['hold']==observations['hold'][1],'HELD_HEALTH_HOLD_LINK')
        live_status=parse(observations['switch'][1])
        need(live_status['bindingSha256']==sha(inputs['binding'])
             and live_status['switchReceiptSha256']==sha(inputs['switchReceipt']),'HELD_HEALTH_SWITCH_LINK')
        request={k:r[k]for k in ('sourceRevision','controlRevision','attemptId','requestedAt','deadlineAt')}
        request.update(schemaVersion=1,mode='status',remoteRoot=a['writerResume']['remoteRoot'],issuedAt=now.isoformat(),
            expiresAt=a['expiresAt'],inputs={k:sha(v)for k,v in inputs.items()})
        raw=enc(request);approval=dict(kind='cn-continuation-finalize-approval-v1',requestSha256=sha(raw),
            issuedAt=a['issuedAt'],expiresAt=a['expiresAt'],packageFiles=a['writerResume']['packageFiles'])
        materialized=finalizer.generate(raw,enc(approval),inputs,output,now=now)
        return {'request':raw,'approval':enc(approval),'materialization':materialized,
            'releaseSha256':release_sha,'writerResumed':False,'businessAcceptancePassed':False}


def _writer_resume_context(approval_raw,writer_approval_raw,inputs,*,now=None):
    """A5 is a separate human approval; A6 public/business acceptance follows.

    Reuse original prepare/runtime clear CAS without altering the old finalizer's
    separate six-business gate. No approval means no materialization or intent.
    """
    a,release_sha=release(approval_raw);r=a['identity'];now=now or dt.datetime.now(dt.timezone.utc)
    need(stamp(a['issuedAt'])<=now<stamp(a['expiresAt'])<=stamp(r['deadlineAt'])
         and stamp(r['requestedAt'])<=now<stamp(r['deadlineAt'])
         and dt.timedelta(0)<stamp(r['deadlineAt'])-stamp(r['requestedAt'])<=dt.timedelta(minutes=30),'A5_NORMAL_BUDGET_EXPIRED')
    if writer_approval_raw is None:
        return {'status':'WAITING_FOR_WRITER_APPROVAL','intentCreated':False,'cloudCalls':0}
    w=parse(writer_approval_raw)
    fields={'kind','releaseSha256','identity','target','issuedAt','expiresAt','bindingSha256',
            'switchReceiptSha256','heldHealthSha256','holdRawSha256','holdGeneration','userAuthorizationEvidenceSha256',
            'scope','testDataScopeSha256','publicOrigin'}
    need(set(w)==fields and w['kind']=='cn-writer-resume-approval-v1' and w['releaseSha256']==release_sha
         and w['identity']==r and w['target']==TARGET
         and w['scope']=='a5-resume-writers-and-a6-scoped-business-observation'
         and w['publicOrigin']=='https://app.boardx.com.cn/','WRITER_APPROVAL_IDENTITY')
    need(stamp(r['requestedAt'])<=stamp(w['issuedAt'])<=now<stamp(w['expiresAt'])<=stamp(r['deadlineAt'])
         and stamp(w['expiresAt'])-stamp(w['issuedAt'])<=dt.timedelta(minutes=30),'WRITER_APPROVAL_WINDOW')
    need(set(inputs)=={'binding','hold','switchReceipt','status','userAuthorization','testDataScope'},'A5_INPUTS')
    for name,key in [('binding','bindingSha256'),('hold','holdRawSha256'),('switchReceipt','switchReceiptSha256'),
                     ('status','heldHealthSha256'),('userAuthorization','userAuthorizationEvidenceSha256'),('testDataScope','testDataScopeSha256')]:
        need(sha(inputs[name])==w[key],'WRITER_APPROVAL_RAW_'+name)
    need(len(inputs['userAuthorization'])>0,'EXPLICIT_USER_EVIDENCE_REQUIRED')
    b=parse(inputs['binding']);hold=parse(inputs['hold']);status=parse(inputs['status'])
    for key in FIELDS:
        if key!='publicationAttemptId':need(b[key]==r[key],'A5_BINDING_IDENTITY')
    need(hold['generation']==w['holdGeneration'] and hold==b['hold'] and hold['state']=='held','A5_HOLD_GENERATION')
    # Authenticated health readback proves these exact current host file hashes.
    need(status['bindingSha256']==sha(inputs['binding']) and status['switchReceiptSha256']==sha(inputs['switchReceipt']), 'A5_HEALTH_FILE_LINK')
    return a,release_sha,r,now,w


def derive_writer_resume(approval_raw,writer_approval_raw,inputs,entry,output,*,now=None,package=None):
    context = _writer_resume_context(approval_raw,writer_approval_raw,inputs,now=now)
    if isinstance(context,dict): return context
    a,_,_,_,_ = context
    with writer_lock(entry,a['identity']) as capability:
        return derive_writer_resume_locked(approval_raw,writer_approval_raw,inputs,entry,output,
                                           capability,now=now,package=package)


def derive_writer_resume_locked(approval_raw,writer_approval_raw,inputs,entry,output,capability,*,now=None,package=None):
    context = _writer_resume_context(approval_raw,writer_approval_raw,inputs,now=now)
    if isinstance(context,dict): return context
    a,release_sha,r,now,w = context
    import subprocess
    root=owned_writer_root(capability,entry,r)
    observed=chain(entry,root,r,a['writerResume']['stageVerifierSha256'],14)
    need(inputs['status']==observed['acceptance'][0],'A5_HELD_HEALTH_NOT_ACTUAL')
    need(inputs['hold']==observed['hold'][1],'A5_HOLD_NOT_ACTUAL')
    template_root=Path(package)if package is not None else BASE/'.harness/scripts/vm/cn-runtime-continuation/finalize'
    need(set(a['writerResume']['packageFiles'])=={'prepare.py','runtime.py'},'A5_TEMPLATE_CLOSURE')
    # Use the already reviewed exact single-source-comparison specializer.
    need(sha((BASE/FINAL_CODE).read_bytes())==a['codeFiles'][FINAL_CODE],'A5_SPECIALIZER_PIN')
    spec=importlib.util.spec_from_file_location('a5_final_specializer',BASE/FINAL_CODE)
    finalizer=importlib.util.module_from_spec(spec);spec.loader.exec_module(finalizer)
    need(sha((BASE/FINAL_CODE).read_bytes())==a['codeFiles'][FINAL_CODE],'A5_SPECIALIZER_PIN')
    code={}
    for name,pin in a['writerResume']['packageFiles'].items():
        path=template_root/name;need(not path.is_symlink(),'A5_TEMPLATE_SYMLINK');raw=path.read_bytes()
        need(sha(raw)==pin,'A5_TEMPLATE_PIN');code[name]=finalizer.specialize(raw,r['sourceRevision'])
    output=Path(output).absolute();need(not output.exists(),'A5_OUTPUT_EXISTS')
    with tempfile.TemporaryDirectory(prefix='cn-writer-resume-')as td:
        folder=Path(td)
        for name,raw in code.items():(folder/name).write_bytes(raw)
        c=dict(mode='clear-hold',remoteRoot=a['writerResume']['remoteRoot'],issuedAt=w['issuedAt'],
               expiresAt=w['expiresAt'],clearHoldAuthorized=True,output=str(output))
        for key in ('binding','hold','switchReceipt','status'):
            path=folder/(key+'.json');path.write_bytes(inputs[key]);c[key]=str(path)
        config=folder/'config.json';config.write_text(json.dumps(c))
        proc=subprocess.run([__import__('sys').executable,'-I','-B',str(folder/'prepare.py'),str(config)],
            capture_output=True,timeout=30,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
        need(proc.returncode==0,'ORIGINAL_A5_CLEAR_MATERIALIZER_REJECTED')
    provenance={'kind':'cn-writer-resume-materialization-v1','releaseSha256':release_sha,
        'writerApprovalSha256':sha(writer_approval_raw),'testDataScopeSha256':w['testDataScopeSha256'],'identity':r,'inputHashes':{k:sha(v)for k,v in inputs.items()},
        'files':{p.name:sha(p.read_bytes())for p in output.iterdir()},'cloudCalls':0,'writerResumed':False,
        'businessAcceptancePassed':False,'publicBusinessAcceptanceRequiredAfterResume':True}
    save(output/'writer-resume-provenance.json',enc(provenance))
    return {'status':'MATERIALIZED_A5','intentCreated':False,'output':str(output),'provenance':provenance}

def save(path,raw):
    need(not path.exists(),'OUTPUT_EXISTS');fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as h:h.write(raw);h.flush();os.fsync(h.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--release-sha256',required=True)
    p.add_argument('--recovery-approval-sha256');p.add_argument('--writer-resume',action='store_true');p.add_argument('--writer-approval-sha256');args=p.parse_args();need(os.geteuid()==0,'ROOT_REQUIRED')
    need(re.fullmatch('[a-f0-9]{64}',args.release_sha256),'RELEASE_SHA')
    raw=private(APPROVALS/(args.release_sha256+'.json'));need(sha(raw)==args.release_sha256,'RELEASE_HASH');a,_=release(raw)
    need(sha(private(BASE/SELF_CODE))==a['codeFiles'][SELF_CODE],'SELF_PIN');entry=load_code(ENTRY_CODE,a)
    root=INPUTS/args.release_sha256;out=GENERATED/args.release_sha256/'terminal'
    entry.directory(root);entry.directory(out.parent)
    need(not (args.recovery_approval_sha256 and (args.writer_resume or args.writer_approval_sha256)),'TERMINAL_MODE_CONFLICT')
    need(args.writer_resume or not args.writer_approval_sha256,'WRITER_MODE_REQUIRED')
    if args.writer_resume:
        fresh=None;values={}
        writer_sha=args.writer_approval_sha256
        if writer_sha is None:
            pointer=WRITER_APPROVALS/'by-release'/(args.release_sha256+'.json')
            if pointer.exists():
                reference=parse(private(pointer));need(set(reference)=={'approvalSha256'},'WRITER_POINTER')
                writer_sha=reference['approvalSha256']
        if writer_sha:
            h=writer_sha;need(re.fullmatch('[a-f0-9]{64}',h),'WRITER_SHA')
            fresh=private(WRITER_APPROVALS/(h+'.json'));need(sha(fresh)==h,'WRITER_APPROVAL_HASH')
            values={k:private(root/('writer-'+k+'.json'))for k in ('binding','hold','switchReceipt','status','userAuthorization','testDataScope')}
        result=derive_writer_resume(raw,fresh,values,entry,out/'writer-resume')
        print(json.dumps(result,sort_keys=True));return
    if args.recovery_approval_sha256:
        h=args.recovery_approval_sha256;need(re.fullmatch('[a-f0-9]{64}',h),'RECOVERY_SHA')
        fresh=private(RECOVERY_APPROVALS/(h+'.json'));need(sha(fresh)==h,'RECOVERY_HASH');f=parse(fresh)
        inputs={k:private(root/('recovery-'+('original-binding'if k=='binding'else k)+'.json'))for k in ('binding','reconciliation','terminalObservation')}
        # Runtime comes from the exact approved root runtime directory, never a CLI path.
        runtime=Path(f['runtimeRoot']);need(runtime.parent==Path('/var/lib/workspacex-cn/runtime') and re.fullmatch('upgrade-f0eb-[a-z0-9-]{1,64}',runtime.name),'RUNTIME_SCOPE')
        code=private(runtime/'upgrade-draft.py');need(sha(code)==f['upgradeSha256']==parse(inputs['binding'])['scriptSha256'],'RECOVERY_RUNTIME_PIN')
        import types
        upgrade=types.ModuleType('approved_upgrade');exec(compile(code,'approved_upgrade','exec'),upgrade.__dict__)
        result=derive_recovery(raw,fresh,inputs,entry,upgrade)
        output=out/('recovery-'+h);entry.directory(out);output.mkdir(mode=0o700)
        for name,value in result.items():save(output/name,value)
    else:
        finalizer=load_code(FINAL_CODE,a)
        inputs={k:private(root/('terminal-'+k+'.json'))for k in ('binding','hold','switchReceipt','status','businessReceipt')}
        result=derive_final(raw,inputs,entry,finalizer,out)
        save(out/'derived-request.json',result['request']);save(out/'derived-approval.json',result['approval'])
    print('{"materialized":true,"cloudCalls":0,"terminalOperationExecuted":false}')


if __name__=='__main__':main()
