#!/usr/bin/env python3
"""Project validated immutable entry receipts into a root-only phase journal.

Never executes actions/observers. Replays only installed, approved verification
functions against original action and independent terminal-observation bytes.
Missing real terminal observations block projection; booleans are not invented.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat

ENTRY=Path('/usr/local/bin/workspacex-cn-release-advance')
APPROVALS=Path('/etc/workspacex-cn/release-approvals')
EVIDENCE=Path('/var/lib/workspacex-cn/continuation-evidence')
ENDS={'hold':3,'stop':5,'backup':8,'switch':11}
PROJECT={'publish':'publish','hold':'hold','stop':'stop','sessions':'sessionzero','backup':'backup','rds-backup':'rds-backup'}
IDENTITY=('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt')
STAGE_INPUTS={'publication':'publish','hold':'hold','stop':'sessions','hostBackup':'backup','rdsBackup':'rds-backup'}
TERMINAL_INPUTS={'hold':'hold','hostBackup':'backup'}
STATIC_INPUTS={'authorization','template','migrationDiff'}
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}


def need(value,code):
    if not value:raise ValueError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def encode(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()


def parse(raw):
    def pairs(items):
        out={}
        for k,v in items:need(k not in out,'DUPLICATE_JSON_KEY');out[k]=v
        return out
    return json.loads(raw,object_pairs_hook=pairs)


def private(path):
    for p in path.parents:
        s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'ROOT_PARENT')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb')as f:
        s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1
            and not s.st_mode&0o077 and s.st_size<=1048576,'ROOT_FILE')
        return f.read()


def input_names(phase):
    names={'authorization','publication','template','migrationDiff'}
    if phase!='hold':names.add('hold')
    if phase in ('backup','switch'):names.add('stop')
    if phase=='switch':names|={'hostBackup','rdsBackup'}
    return names


def project(entry,release_sha,approval_raw,phase,inputs,*,now=None):
    """Library seam. Entry paths/OWNER may point to an isolated test fixture.

    Return journal + original receipt byte map; publish() keeps lock through
    writing. This function itself always acquires the actual entry global lock.
    """
    need(phase in ENDS and re.fullmatch('[a-f0-9]{64}',release_sha),'PHASE_OR_RELEASE')
    a=parse(approval_raw);r=a['release'];now=now or entry.now()
    need(a['kind']=='cn-release-once-delegation-v1' and a['scope']=='normal-four-phase-materialization'
         and a['releaseRequestSha256']==release_sha,'DELEGATION_SCOPE')
    need(a['target']==TARGET and phase in a['allowedPhases'],'TARGET_OR_PHASE')
    need(entry.instant(a['issuedAt'])<=now<entry.instant(a['expiresAt'])<=entry.instant(r['deadlineAt']),'APPROVAL_EXPIRED')
    need(entry.instant(r['requestedAt'])<=now<entry.instant(r['deadlineAt'])
         and entry.instant(r['deadlineAt'])-entry.instant(r['requestedAt'])<=dt.timedelta(minutes=30),'RELEASE_BUDGET')
    need(set(inputs)==input_names(phase),'INPUT_CLOSURE')
    need(set(a['inputHashes'])==STATIC_INPUTS,'APPROVED_STATIC_INPUT_CLOSURE')
    for name in STATIC_INPUTS:
        need(sha(inputs[name])==a['inputHashes'][name],'STATIC_INPUT_HASH_'+name)
        value=parse(inputs[name])
        for field in ('sourceRevision','baselineRevision'):
            need(value[field]==r[field],'STATIC_INPUT_IDENTITY_'+name)
    authorization=parse(inputs['authorization'])
    need(authorization['attemptId']==r['attemptId'],'STATIC_AUTH_ATTEMPT')
    need(entry.instant(r['requestedAt'])<=entry.instant(authorization['issuedAt'])
         <=now<entry.instant(authorization['expiresAt'])<=entry.instant(r['deadlineAt']),'STATIC_AUTH_BUDGET')
    attempt=r['attemptId'];need(entry.ATTEMPT.fullmatch(attempt),'ATTEMPT')
    # A generator cannot stand in for the separately reviewed live stage verifier.
    need(re.fullmatch('[a-f0-9]{64}',a['evidenceValidatorSha256']),'PROJECTOR_PIN')
    root=entry.STATE/attempt;entry.directory(root)
    lockfd=os.open(entry.STATE/'entry.lock',os.O_RDWR|os.O_NOFOLLOW)
    try:
        s=os.fstat(lockfd);need(stat.S_ISREG(s.st_mode) and s.st_uid==entry.OWNER and s.st_nlink==1
                              and not s.st_mode&0o077,'ENTRY_LOCK_UNTRUSTED')
        try:fcntl.flock(lockfd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('ENTRY_ACTIVE')from None
        need(entry.decode(entry.read(entry.STATE/'active-attempt.json'))==attempt,'CROSS_ATTEMPT')
        identity={k:r[k]for k in IDENTITY};identity['scope']='runtime-only-reviewed-continuation'
        need(entry.decode(entry.read(root/'identity.json'))==identity,'ENTRY_IDENTITY')
        # Only the active attempt participates in this projection. Entry owns
        # the cross-attempt recovery-completion CAS; old recovered attempts
        # retain their failed intents permanently. Within the current attempt,
        # any incomplete normal/recovery/future intent remains unresolved.
        for intent in root.glob('*.intent.json'):
            receipt=intent.with_name(intent.name.replace('.intent.json','.receipt.json'))
            need(receipt.exists(),'UNFINISHED_INTENT')
        receipts=sorted(root.glob('*.receipt.json'))
        expected=[root/('%02d-%s.receipt.json'%(i,entry.STAGES[i]))for i in range(ENDS[phase]+1)]
        need(receipts==expected,'PHASE_SKIP_OR_FUTURE_RECEIPT')
        previous=None;completed=[];raw_receipts={};stage_refs=[];action_bytes={};terminal_bytes={};last=entry.instant(r['requestedAt'])
        for index,path in enumerate(expected):
            raw=entry.read(path);v=entry.decode(raw);stage=entry.STAGES[index]
            need(v['stage']==stage and v['mode']in ('advance','reconcile'),'RECOVERY_OR_STAGE')
            need(all(v[k]==identity[k]for k in identity),'RECEIPT_IDENTITY')
            need(v['previousReceiptSha256']==(sha(previous)if previous else None),'PREVIOUS_RECEIPT_HASH')
            manifest,files=entry.load_package(v['requestSha256'],attempt)
            need(manifest['stage']==stage and all(manifest[k]==identity[k]for k in identity)
                 and manifest['previousReceiptSha256']==v['previousReceiptSha256'],'MANIFEST_IDENTITY')
            need(manifest['verifierSha256']==a['stageVerifierSha256'][stage],'LIVE_VERIFIER_NOT_APPROVED')
            need(manifest['observerSha256']==a['stageObserverSha256'][stage],'LIVE_OBSERVER_NOT_APPROVED')
            prefix=path.name.removesuffix('.receipt.json')
            intent=entry.decode(entry.read(root/(prefix+'.intent.json')))
            need(intent['requestSha256']==v['requestSha256'],'INTENT_REQUEST')
            process=entry.decode(entry.read(root/(prefix+'.process.json')))
            need(process['requestSha256']==v['requestSha256'],'EXECUTION_REQUEST_CHANGED')
            evidence=entry.read(root/(prefix+'.evidence.json'))
            terminal=entry.read(root/(prefix+'.terminal-observation.json'))
            need(sha(evidence)==v['evidenceSha256'] and sha(terminal)==v['terminalObservationSha256'],'RAW_EVIDENCE_HASH')
            prev=entry.decode(previous)if previous else None
            # Original root-protected receipt attests admission already passed.
            # Do not re-run old live probes after later phases changed state.
            entry.verify_historical_receipt(path,v,manifest)
            action_bytes[stage]=evidence;terminal_bytes[stage]=terminal
            finished=entry.instant(v['finishedAt']);need(last<=finished<=now and finished<=entry.instant(r['deadlineAt']),'RECEIPT_TIME')
            last=finished
            stage_refs.append({'stage':stage,'receiptSha256':sha(raw),'evidenceSha256':sha(evidence),
                               'terminalObservationSha256':sha(terminal),'requestSha256':v['requestSha256']})
            if stage in PROJECT:
                business_phase=PROJECT[stage];raw_receipts[business_phase]=raw
                completed.append({'phase':business_phase,'status':'succeeded','releaseRequestSha256':release_sha,
                    'attemptId':attempt,'validatorSha256':a['evidenceValidatorSha256'],
                    'observedAt':v['finishedAt'],'receiptSha256':sha(raw)})
            previous=raw
        # Fixed backup readback emits the exact backup-result bytes after live
        # archive/config/hold verification. Bind that independent observation,
        # never the action's completion summary. Hold likewise uses the independent helper readback; its action emits a wrapper. Other inputs remain action bytes.
        for name,stage in STAGE_INPUTS.items():
            if name in inputs:
                if name=='publication':
                    publication_input(inputs[name],action_bytes[stage],terminal_bytes[stage]);continue
                originals=terminal_bytes if name in TERMINAL_INPUTS else action_bytes
                need(stage in originals and inputs[name]==originals[stage],
                     'INPUT_NOT_ORIGINAL_STAGE_EVIDENCE_'+name)
        journal={'kind':'cn-release-validated-journal-v1','releaseRequestSha256':release_sha,'identity':r,
            'target':TARGET,'phaseReady':phase,'validatorSha256':a['evidenceValidatorSha256'],
            'activeOperations':[],'uncertainOperations':[],'observedAt':now.isoformat(),
            'completed':completed,'inputHashes':{k:sha(v)for k,v in inputs.items()},'entryStages':stage_refs}
        yield journal,raw_receipts
    finally:os.close(lockfd)


def publication_input(original, action, terminal):
    """Bind pure published.json bytes without parsing/re-encoding their content.

    Normal action stdout has one exact prefix and print's extra newline. A
    reconciled action is the independently verified observation itself.
    """
    observed=parse(terminal)
    need(observed.get('kind')=='cn-publication-readonly-observation-v1'
         and observed.get('phase')=='publish'
         and observed.get('publishedReceiptSha256')==sha(original),
         'INPUT_NOT_ORIGINAL_STAGE_EVIDENCE_publication')
    need(action==b'CN_CANDIDATE_PUBLISHED='+original+b'\n' or action==terminal,
         'INPUT_NOT_ORIGINAL_STAGE_EVIDENCE_publication')
    return original


def publish(entry,release_sha,approval_raw,phase,inputs,evidence_root=EVIDENCE,*,now=None):
    """Publish while project still holds the global entry lock; EXCL only."""
    iterator=project(entry,release_sha,approval_raw,phase,inputs,now=now)
    try:
        journal,receipts=next(iterator)
        base=evidence_root/release_sha;entry.directory(base/'receipts');entry.directory(base/phase)
        for raw in receipts.values():
            path=base/'receipts'/(sha(raw)+'.json')
            if path.exists():need(entry.read(path)==raw,'EXISTING_RECEIPT_CHANGED')
            else:entry.create(path,raw)
        entry.create(base/phase/'journal.json',encode(journal))
        return journal
    finally:iterator.close()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--release-sha256',required=True)
    p.add_argument('--phase',choices=list(ENDS),required=True);args=p.parse_args()
    need(os.geteuid()==0 and re.fullmatch('[a-f0-9]{64}',args.release_sha256),'ROOT_AND_HASH_REQUIRED')
    approval=private(APPROVALS/(args.release_sha256+'.json'));a=parse(approval)
    need(sha(private(Path(__file__).resolve()))==a['evidenceValidatorSha256'],'PROJECTOR_CODE_PIN')
    # Entry may be executable 0700; private reader permits owner execute only.
    need(sha(private(ENTRY))==a['entrySha256'],'ENTRY_CODE_PIN')
    from importlib.machinery import SourceFileLoader
    loader=SourceFileLoader('installed_cn_entry',str(ENTRY));spec=importlib.util.spec_from_loader(loader.name,loader)
    entry=importlib.util.module_from_spec(spec);loader.exec_module(entry)
    inputs={n:entry.read(EVIDENCE/args.release_sha256/args.phase/(n+'.json'))for n in input_names(args.phase)}
    result=publish(entry,args.release_sha256,approval,args.phase,inputs)
    print(json.dumps({'kind':'cn-journal-published-v1','phase':args.phase,'journalSha256':sha(encode(result)),'cloudCalls':0}))


if __name__=='__main__':main()
