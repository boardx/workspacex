#!/usr/bin/env python3
"""Materialize reviewed normal-budget finalization; never dispatch or clear hold.

Original template validators remain authoritative for hold/container/status.
Independent business acceptance must already have been admitted by the canonical
cnReleaseBrowserSchema verifier and attested in the root-owned approval. This
module checks its exact evidence hash and release identity, not a second journey
schema. No expired-release recovery API is exposed here.
"""
import argparse
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

APPROVAL_ROOT = Path('/etc/workspacex-cn/continuation-finalize-approvals')
TEMPLATES = Path(__file__).resolve().parents[1] / '.harness/scripts/vm/cn-runtime-continuation/finalize'
SCHEMA = Path(__file__).resolve().parents[1] / 'packages/cloud-deploy/src/cn-release-browser-contract.ts'
OLD_SOURCE = 'f0eb9d07398a66fdd5646a9e6b855fa1b940e571'


def need(value, code):
    if not value: raise ValueError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def parse(raw):
    def pairs(items):
        out = {}
        for k,v in items:
            need(k not in out, 'DUPLICATE_JSON_KEY'); out[k]=v
        return out
    return json.loads(raw, object_pairs_hook=pairs)


def timestamp(value):
    result=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    need(result.tzinfo is not None,'TIMEZONE_REQUIRED'); return result


def load_approval(request_sha):
    need(re.fullmatch('[a-f0-9]{64}',request_sha),'REQUEST_SHA')
    path=APPROVAL_ROOT/(request_sha+'.json')
    for parent in path.parents:
        s=parent.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'APPROVAL_PARENT')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb')as f:
        s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=1048576,'APPROVAL_FILE')
        return f.read()


def specialize(raw, source):
    """Exactly one legacy identity comparison; other code/imports unchanged."""
    tree=ast.parse(raw)
    expected=ast.dump(ast.parse("b['sourceRevision']=="+repr(OLD_SOURCE),mode='eval').body)
    matches=[n for n in ast.walk(tree) if isinstance(n,ast.Compare) and ast.dump(n)==expected]
    need(len(matches)==1,'SOURCE_GUARD_CHANGED')
    matches[0].comparators[0]=ast.Constant(source)
    return (ast.unparse(ast.fix_missing_locations(tree))+'\n').encode()


def generate(request_raw, approval_raw, inputs, output, *, package=TEMPLATES, now=None):
    """Caller supplies approval from load_approval; fixtures may call directly."""
    r,a=parse(request_raw),parse(approval_raw);now=now or dt.datetime.now(dt.timezone.utc)
    need(set(r)=={'schemaVersion','mode','sourceRevision','controlRevision','attemptId','remoteRoot',
                 'requestedAt','deadlineAt','issuedAt','expiresAt','inputs'},'REQUEST_FIELDS')
    need(type(r['schemaVersion'])is int and r['schemaVersion']==1,'SCHEMA_VERSION')
    need(r['mode']in ('status','clear-hold'),'NORMAL_FINALIZE_ONLY')
    for key in ('sourceRevision','controlRevision'):need(re.fullmatch('[a-f0-9]{40}',r[key]),'EXACT_REVISION')
    need(re.fullmatch('[a-z0-9-]{1,64}',r['attemptId']),'ATTEMPT')
    requested,deadline=timestamp(r['requestedAt']),timestamp(r['deadlineAt'])
    need(requested<=now<deadline and dt.timedelta(0)<deadline-requested<=dt.timedelta(minutes=30),'END_TO_END_DEADLINE')
    need(requested<=timestamp(r['issuedAt'])<=now<timestamp(r['expiresAt'])<=deadline,'REQUEST_WINDOW')
    need(a['kind']=='cn-continuation-finalize-approval-v1' and a['requestSha256']==sha(request_raw),'APPROVAL_REQUEST')
    need(timestamp(a['issuedAt'])<=now<timestamp(a['expiresAt']),'APPROVAL_EXPIRED')
    required={'binding','hold','switchReceipt'}
    if r['mode']=='clear-hold':required|={'status','businessReceipt'}
    need(set(inputs)==set(r['inputs'])==required,'INPUT_CLOSURE')
    for key,raw in inputs.items():need(len(raw)<=65536 and sha(raw)==r['inputs'][key],'INPUT_HASH_'+key)
    b=parse(inputs['binding'])
    for key in ('sourceRevision','controlRevision','attemptId','requestedAt','deadlineAt'):
        need(b[key]==r[key],'BINDING_'+key)
    need(b['draft']is False,'EXECUTABLE_BINDING_REQUIRED')
    if r['mode']=='clear-hold':
        # A root-owned attestation from the independent verifier is mandatory.
        # A caller-supplied boolean in request/receipt cannot manufacture this.
        admission=a['businessAcceptance']
        need(set(admission)=={'receiptSha256','validator','validatorSourceSha256','independentEvidenceSha256'},'BUSINESS_ADMISSION_FIELDS')
        need(admission['receiptSha256']==sha(inputs['businessReceipt']) and admission['validator']=='cnReleaseBrowserSchema'
             and admission['validatorSourceSha256']==sha(SCHEMA.read_bytes())
             and re.fullmatch('[a-f0-9]{64}',admission['independentEvidenceSha256']),'INDEPENDENT_BUSINESS_ADMISSION_REQUIRED')
        business=parse(inputs['businessReceipt'])
        need(business['kind']=='cn-independent-business-acceptance-v1','BUSINESS_KIND')
        for key in ('sourceRevision','controlRevision','attemptId','requestedAt','deadlineAt'):
            need(business[key]==r[key],'BUSINESS_'+key)
        need(business['bindingSha256']==sha(inputs['binding']) and business['switchReceiptSha256']==sha(inputs['switchReceipt'])
             and business['holdGeneration']==parse(inputs['hold'])['generation'],'BUSINESS_BINDING')
        need(requested<=timestamp(business['observedAt'])<=now and now-timestamp(business['observedAt'])<=dt.timedelta(minutes=10),'BUSINESS_STALE')
        # This is evidence linkage only: the admission must originate from a
        # separate canonical-schema verifier, never this generator itself.
    need(set(a['packageFiles'])=={'prepare.py','runtime.py'},'PACKAGE_CLOSURE')
    code={}
    for name in a['packageFiles']:
        p=Path(package)/name;need(not p.is_symlink(),'PACKAGE_SYMLINK');raw=p.read_bytes()
        need(sha(raw)==a['packageFiles'][name],'PACKAGE_HASH_'+name)
        code[name]=specialize(raw,r['sourceRevision'])
    output=Path(output).absolute();need(not output.exists(),'OUTPUT_EXISTS')
    with tempfile.TemporaryDirectory(prefix='cn-finalize-')as td:
        root=Path(td)
        for name,raw in code.items():(root/name).write_bytes(raw)
        config={k:r[k] for k in ('mode','remoteRoot','issuedAt','expiresAt')};config['output']=str(output)
        for name,raw in inputs.items():
            p=root/(name+'.json');p.write_bytes(raw);config[name]=str(p)
        if r['mode']=='clear-hold':config['clearHoldAuthorized']=True
        path=root/'config.json';path.write_text(json.dumps(config))
        result=subprocess.run([sys.executable,'-I','-B',str(root/'prepare.py'),str(path)],
                              capture_output=True,timeout=30,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
        need(result.returncode==0,'ORIGINAL_FINALIZE_MATERIALIZER_REJECTED')
    # Original prepare binds raw binding/switch/status and runtime source hashes.
    # Attestation+business pins are additionally carried for the root transport.
    result={'kind':'cn-continuation-finalize-materialization-v1','mode':r['mode'],
            'requestSha256':sha(request_raw),'approvalRawSha256':sha(approval_raw),
            'identity':{k:r[k]for k in ('sourceRevision','controlRevision','attemptId','requestedAt','deadlineAt')},
            'inputHashes':r['inputs'],'templateHashes':a['packageFiles'],
            'specializedTemplateHashes':{k:sha(v)for k,v in code.items()},
            'files':{p.name:sha(p.read_bytes())for p in output.iterdir()},
            'cloudCalls':0,'dispatchAuthorizedByGenerator':False,'businessAcceptanceGenerated':False}
    fd=os.open(output/'provenance.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w')as f:json.dump(result,f,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())
    fd=os.open(output,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request',type=Path,required=True);parser.add_argument('--request-sha256',required=True)
    parser.add_argument('--inputs',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();raw=args.request.read_bytes();need(sha(raw)==args.request_sha256,'REQUEST_HASH')
    approval=load_approval(args.request_sha256)
    # Validate key names before constructing filesystem paths.
    keys=parse(raw)['inputs'];need(set(keys)<={'binding','hold','switchReceipt','status','businessReceipt'},'INPUT_NAMES')
    inputs={key:(args.inputs/(key+'.json')).read_bytes()for key in keys}
    print(json.dumps(generate(raw,approval,inputs,args.output),sort_keys=True))


if __name__=='__main__':main()
