#!/usr/bin/env python3
"""Read-only root evidence portal. Never generate/grant/install release authority."""
import argparse, hashlib, importlib.util, json, os, re, stat
from pathlib import Path

ROOT = Path('/etc/workspacex-cn/mvp-evidence')
def need(ok, code):
    if not ok: raise ValueError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encode(value): return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def selector(mode,payload):
    need(mode in ('approval','terminal'),'PORTAL_MODE')
    fields={'identity','buildRunId','transferRunId','requestedAt','deadlineAt'}
    if mode=='terminal':fields.add('productionRunId')
    need(set(payload)==fields,'SELECTOR_FIELDS')
    for key in fields&{'buildRunId','transferRunId','productionRunId'}:
        need(type(payload[key])is int and payload[key]>0,'SELECTOR_RUN')
    module().identity(payload['identity'])
    from datetime import datetime
    start=datetime.fromisoformat(payload['requestedAt'].replace('Z','+00:00'));end=datetime.fromisoformat(payload['deadlineAt'].replace('Z','+00:00'))
    need(start.tzinfo is not None and end.tzinfo is not None and 0<(end-start).total_seconds()<=1800,'SELECTOR_WINDOW')
def private(path):
    for parent in path.parents:
        s=parent.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'ROOT_PARENT')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as stream:
        s=os.fstat(stream.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and s.st_mode&0o777==0o600 and s.st_size<=65536,'ROOT_FILE')
        raw=stream.read(65537);need(len(raw)==s.st_size,'ROOT_FILE_CHANGED');return raw
def module():
    path=Path(__file__).with_name('cn-release-mvp-chain.py');s=importlib.util.spec_from_file_location('mvp_terminal',path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def resolve(mode,payload,pin,reader=private,root=ROOT,*,structural_only=False):
    """A trusted materializer must already have retained actual evidence here.

    The selector is content-addressed public run identity. Its existence or a
    caller's `installed=true` never confers authority; all original bytes are
    independently read, hashed and bound before any response is emitted.
    """
    need(mode in ('approval','terminal') and re.fullmatch('[a-f0-9]{64}',pin),'PORTAL_INPUT')
    selector(mode,payload)
    need(sha(encode(payload))==pin,'SELECTOR_HASH')
    record=json.loads(reader(root/(pin+'.json')))
    need(record.get('kind')=='cn-mvp-root-evidence-record-v1' and record.get('selector')==payload,'RECORD_BINDING')
    identity=module().identity(payload['identity'])
    refs=record.get('files');need(isinstance(refs,dict),'EVIDENCE_FILES')
    def read(name):
        ref=refs[name];need(set(ref)=={'name','sha256'} and re.fullmatch('[a-z0-9][a-z0-9.-]{0,100}',ref['name']),'EVIDENCE_PATH')
        raw=reader(root/'objects'/ref['name']);need(sha(raw)==ref['sha256'],'EVIDENCE_BYTES_CHANGED');return raw
    if mode=='approval':
        raw=read('approval');a=json.loads(raw)
        need(a['kind']=='cn-fixed-release-approval-v1','APPROVAL_KIND')
        if not structural_only:
            path=Path(__file__).with_name('cn-release-approval-plan.py');spec=importlib.util.spec_from_file_location('canonical_approval',path);canonical=importlib.util.module_from_spec(spec);spec.loader.exec_module(canonical)
            driver=canonical.module('fixed-driver');acquire=canonical.module('acquire-delegation')
            try:
                driver.validate(sha(raw),raw,driver.e.now())
                acquire.approval(raw,now=driver.e.now())
            except (driver.e.Rejected, ValueError) as error:
                raise ValueError('CANONICAL_APPROVAL_REJECTED') from error
        allowed={'kind','schemaVersion','identity','target','issuedAt','expiresAt','business','rds','codeFiles','runtime','runtimeStage','writerResume','acquire','mvp'}
        need(set(a)<=allowed,'APPROVAL_PRIVATE_FIELDS')
        need(a.get('target')=={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'},'APPROVAL_TARGET')
        need(a.get('mvp')=={'acceptanceScope':'mvp-non-model','contentManifestSha256':identity['contentManifestSha256'],
             'buildRunId':payload['buildRunId'],'transferRunId':payload['transferRunId']},'APPROVAL_CONTENT_AND_RUNS')
        need(all(a['acquire']['requests'][phase]['runId']==payload['buildRunId'] and a['acquire']['requests'][phase]['runAttempt']==1 for phase in ('consume','publication')),'MVP_ACQUIRE_BUILD_BINDING')
        need(all(a['identity'].get(k)==identity[k] for k in ('sourceRevision','controlRevision')),'APPROVAL_IDENTITY')
        need(a['identity']['requestedAt']==payload['requestedAt'] and a['identity']['deadlineAt']==payload['deadlineAt'],'APPROVAL_WINDOW')
        binding=json.loads(read('binding'))
        need(binding==payload,'APPROVAL_RUN_BINDING')
        # Approval object must be the actual object consumed by fixed driver.
        installed=reader(Path('/etc/workspacex-cn/release-approvals')/(sha(raw)+'.json'))
        need(installed==raw,'APPROVAL_NOT_INSTALLED')
        return {'kind':'cn-mvp-installed-approval-v1','selectorSha256':pin,'identity':identity,
                'buildRunId':payload['buildRunId'],'transferRunId':payload['transferRunId'],
                'releaseSha256':sha(raw),'rawJson':raw.decode(),'authorityGrantedByPortal':False}
    receipts=json.loads(read('receipts'))
    need(isinstance(receipts,list),'RECEIPTS_INVALID')
    for row in receipts:
        need(set(row)<={'stage','identity','status','previousReceiptSha256','evidenceSha256','checks','modelQuality','futureV2Content'},'RECEIPT_PRIVATE_FIELDS')
        evidence=read('evidence-'+row['stage'])
        need(sha(evidence)==row['evidenceSha256'],'STAGE_EVIDENCE_CHANGED')
    terminal=module().terminal(identity,receipts)
    binding=json.loads(read('binding'));need(binding==payload,'TERMINAL_RUN_BINDING')
    objects={}
    for key in refs:
        if key.startswith('original-'):
            pin=key.removeprefix('original-');need(re.fullmatch('[a-f0-9]{64}',pin),'ORIGINAL_OBJECT_KEY')
            raw=read(key);need(sha(raw)==pin,'ORIGINAL_OBJECT_HASH');objects[pin]=raw
    path=Path(__file__).with_name('cn-release-mvp-stage-evidence.py');spec=importlib.util.spec_from_file_location('stage_originals',path);validator=importlib.util.module_from_spec(spec);spec.loader.exec_module(validator)
    report=validator.validate(payload,receipts,{stage:read('evidence-'+stage)for stage in module().STAGES},objects)
    # Hash/chain correctness is not provider provenance or business validation.
    # No trusted stage-specific producer/validator exists in this closure yet.
    need(structural_only,'TRUSTED_STAGE_PROVENANCE_VALIDATOR_NOT_READY')
    return {'kind':'cn-mvp-structural-terminal-proposal-v1','productionAccepted':False,'originalClosureReport':report}
def main():
    p=argparse.ArgumentParser();p.add_argument('mode',choices=('approval','terminal'));p.add_argument('selector_sha256');args=p.parse_args()
    try:
        need(os.geteuid()==0,'ROOT_REQUIRED')
        need(re.fullmatch('[a-f0-9]{64}',args.selector_sha256),'SELECTOR_HASH')
        # No caller paths or stdin. Public selector is retained by the trusted
        # root materializer, not installed by the GitHub runner.
        payload=json.loads(private(ROOT/'selectors'/(args.selector_sha256+'.json')))
        print(json.dumps(resolve(args.mode,payload,args.selector_sha256),sort_keys=True));return 0
    except (ValueError,KeyError,OSError,TypeError):
        print('{"status":"NOT_READY","code":"ROOT_EVIDENCE_NOT_READY","authorityGranted":false}');return 20
if __name__=='__main__':raise SystemExit(main())
