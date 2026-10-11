#!/usr/bin/env python3
"""Derive four normal-phase approvals from one root-owned release delegation.

No cloud calls. GitHub supplies only release hash and phase. Fixed root evidence
must be written by the separately approved validator/journal service. This does
not convert arbitrary receipts or booleans into authority. Finalize/acquire and
recovery are deliberately unsupported by this normal-release delegation.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import tempfile

RELEASE_APPROVALS=Path('/etc/workspacex-cn/release-approvals')
PHASE_APPROVALS=Path('/etc/workspacex-cn/continuation-approvals')
EVIDENCE_ROOT=Path('/var/lib/workspacex-cn/continuation-evidence')
REQUEST_ROOT=Path('/var/lib/workspacex-cn/continuation-derived-requests')
CONTROL_ROOT=Path(__file__).resolve().parents[1]
BINDER=CONTROL_ROOT/'scripts/cn-release-continuation-bind.py'
PACKAGE=CONTROL_ROOT/'.harness/scripts/vm/cn-runtime-continuation'
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}
IDENTITY=('sourceRevision','baselineRevision','controlRevision','publicationAttemptId','attemptId','requestedAt','deadlineAt')
PRECEDING={'hold':['publish'],'stop':['publish','hold'],
           'backup':['publish','hold','stop','sessionzero'],
           'switch':['publish','hold','stop','sessionzero','backup','rds-backup']}
PACKAGE_FILES={'prepare-phase.py','upgrade-draft.py','backup-host.DRAFT.py','sessions-after-stop.py','sessions-after-stop.sh'}


def need(v,code):
    if not v:raise ValueError(code)


def sha(v):return hashlib.sha256(v).hexdigest()


def parse(raw):
    def pairs(xs):
        out={}
        for k,v in xs:need(k not in out,'DUPLICATE_JSON_KEY');out[k]=v
        return out
    return json.loads(raw,object_pairs_hook=pairs)


def encode(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()


def stamp(v):
    d=dt.datetime.fromisoformat(v.replace('Z','+00:00'));need(d.tzinfo is not None,'TIMEZONE');return d


def trusted_dir(path):
    for p in (path,*path.parents):
        s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'ROOT_DIRECTORY_REQUIRED')


def private_read(path):
    trusted_dir(path.parent)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb')as f:
        s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1
            and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=1048576,'ROOT_PRIVATE_FILE_REQUIRED')
        return f.read()


def input_names(phase):
    need(phase in PRECEDING,'UNSUPPORTED_PHASE_SCOPE')
    names={'authorization','publication','template','migrationDiff'}
    if phase!='hold':names.add('hold')
    if phase in ('backup','switch'):names.add('stop')
    if phase=='switch':names|={'hostBackup','rdsBackup'}
    return names


def derive(release_sha, approval_raw, journal_raw, inputs, phase, *, validate, preceding_receipts, now=None):
    """Pure fixture seam. Production uses only fixed root paths and pinned binder."""
    need(re.fullmatch('[a-f0-9]{64}',release_sha),'RELEASE_SHA')
    names=input_names(phase);a=parse(approval_raw);j=parse(journal_raw)
    now=now or dt.datetime.now(dt.timezone.utc)
    need(a['kind']=='cn-release-once-delegation-v1' and a['scope']=='normal-four-phase-materialization', 'DELEGATION_SCOPE')
    need(a['releaseRequestSha256']==release_sha,'RELEASE_ID')
    r=a['release'];need(set(r)==set(IDENTITY),'RELEASE_IDENTITY_FIELDS')
    for k in ('sourceRevision','baselineRevision','controlRevision'):need(re.fullmatch('[a-f0-9]{40}',r[k]),'REVISION')
    for k in ('attemptId','publicationAttemptId'):need(re.fullmatch('[a-z0-9-]{1,64}',r[k]),'ATTEMPT')
    need(a['target']==TARGET,'FIXED_TARGET')
    need(a['allowedPhases']==list(PRECEDING),'ALLOWED_PHASES')
    requested,deadline=stamp(r['requestedAt']),stamp(r['deadlineAt'])
    need(requested<=now<deadline and dt.timedelta(0)<deadline-requested<=dt.timedelta(minutes=30),'RELEASE_DEADLINE')
    need(stamp(a['issuedAt'])<=now<stamp(a['expiresAt'])<=deadline,'DELEGATION_EXPIRED')
    need(set(a['templateHashes'])==PACKAGE_FILES,'TEMPLATE_CLOSURE')
    for value in [*a['templateHashes'].values(),a['derivationSha256'],a['binderSha256'],a['evidenceValidatorSha256']]:
        need(re.fullmatch('[a-f0-9]{64}',value),'CODE_HASH_REQUIRED')
    need(j['kind']=='cn-release-validated-journal-v1' and j['releaseRequestSha256']==release_sha
         and j['identity']==r and j['target']==TARGET,'JOURNAL_IDENTITY')
    need(j['phaseReady']==phase and j['validatorSha256']==a['evidenceValidatorSha256'],'JOURNAL_ADMISSION')
    need(j['activeOperations']==[] and j['uncertainOperations']==[],'UNKNOWN_OPERATION_RECONCILE')
    entries=j['completed'];need([x['phase']for x in entries]==PRECEDING[phase],'PHASE_SKIP_OR_REPLAY')
    need(set(preceding_receipts)==set(PRECEDING[phase]),'PRECEDING_RECEIPT_CLOSURE')
    previous=requested
    for entry in entries:
        need(entry['status']=='succeeded' and entry['releaseRequestSha256']==release_sha
             and entry['attemptId']==r['attemptId'] and entry['validatorSha256']==a['evidenceValidatorSha256'], 'UNVALIDATED_PRECEDING_RECEIPT')
        when=stamp(entry['observedAt']);need(previous<=when<=now,'JOURNAL_ORDER');previous=when
        need(re.fullmatch('[a-f0-9]{64}',entry['receiptSha256']) and sha(preceding_receipts[entry['phase']])==entry['receiptSha256'],'PRECEDING_RAW_HASH')
    need(dt.timedelta(0)<=now-stamp(j['observedAt'])<=dt.timedelta(minutes=10),'JOURNAL_STALE')
    need(set(inputs)==names==set(j['inputHashes']),'EVIDENCE_CLOSURE')
    hashes={k:sha(v)for k,v in inputs.items()}
    need(hashes==j['inputHashes'],'EVIDENCE_RAW_HASH')
    # Target is also verified inside the original validator; reject before code
    # execution if root evidence targets a different host/account/region.
    template=parse(inputs['template']);need({k:template[k]for k in TARGET}==TARGET,'EVIDENCE_TARGET')
    request={'schemaVersion':1,**r,'phase':phase,'inputs':hashes}
    request_raw=encode(request)
    derived={'kind':'cn-continuation-materialization-approval-v1','requestSha256':sha(request_raw),
             'issuedAt':a['issuedAt'],'expiresAt':a['expiresAt'],'packageFiles':a['templateHashes'],
             'delegation':{'releaseRequestSha256':release_sha,'approvalRawSha256':sha(approval_raw),
                           'validatedJournalRawSha256':sha(journal_raw),'phase':phase}}
    approval_bytes=encode(derived)
    # Mandatory real materializer validation; publishing occurs only afterwards.
    # Production pins the binder and its original package. Tests inject fixtures.
    validate(request_raw,approval_bytes,inputs)
    return request_raw,approval_bytes


def publish(path,raw):
    """EXCL is intentional: an uncertain prior attempt requires reconciliation."""
    trusted_dir(path.parent)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--release-sha256',required=True)
    p.add_argument('--phase',choices=list(PRECEDING),required=True);args=p.parse_args()
    need(os.geteuid()==0,'ROOT_REQUIRED');release=args.release_sha256
    need(re.fullmatch('[a-f0-9]{64}',release),'RELEASE_SHA')
    approval=private_read(RELEASE_APPROVALS/(release+'.json'));a=parse(approval)
    # Executable code is itself root-owned and approved, not workspace code.
    need(sha(private_read(Path(__file__).resolve()))==a['derivationSha256'],'DERIVATION_PIN')
    need(sha(private_read(BINDER))==a['binderSha256'],'BINDER_PIN')
    for name,expected in a['templateHashes'].items():
        need(name in PACKAGE_FILES and sha(private_read(PACKAGE/name))==expected,'TEMPLATE_PIN')
    spec=importlib.util.spec_from_file_location('installed_cn_binder',BINDER)
    binder=importlib.util.module_from_spec(spec);spec.loader.exec_module(binder)
    evidence=EVIDENCE_ROOT/release/args.phase
    journal=private_read(evidence/'journal.json')
    inputs={name:private_read(evidence/(name+'.json'))for name in input_names(args.phase)}
    def validate(req,app,raws):
        with tempfile.TemporaryDirectory(prefix='cn-derived-check-')as tmp:
            binder.bind(req,app,PACKAGE,raws,Path(tmp)/'materialized')
    for entry in parse(journal)['completed']:
        need(re.fullmatch('[a-f0-9]{64}',entry['receiptSha256']),'RECEIPT_PATH_HASH')
    preceding={entry['phase']:private_read(EVIDENCE_ROOT/release/'receipts'/(entry['receiptSha256']+'.json'))
               for entry in parse(journal)['completed']}
    request,derived=derive(release,approval,journal,inputs,args.phase,validate=validate,preceding_receipts=preceding)
    # Fixed request filename prevents a second derivation for this phase even if
    # a caller swaps the journal. Incomplete publication is never blindly retried.
    publish(REQUEST_ROOT/(release+'-'+args.phase+'.json'),request)
    publish(PHASE_APPROVALS/(sha(request)+'.json'),derived)
    print(json.dumps({'kind':'cn-derived-phase-approval-v1','releaseRequestSha256':release,
                      'phase':args.phase,'requestSha256':sha(request),'cloudCalls':0}))


if __name__=='__main__':main()
