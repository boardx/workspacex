#!/usr/bin/env python3
"""Derive four runtime phases from a fixed release's live entry journal.

Library used by the installed router. No dispatch or runner-selected filesystem
paths. Original journal, derivation and binder validators remain authoritative.
"""
import importlib.util
from pathlib import Path
import hashlib
import json

ROOT=Path(__file__).resolve().parents[1]
CODE=('scripts/cn-release-runtime-delegation.py','scripts/cn-release-continuation-journal.py',
      'scripts/cn-release-derived-approval.py','scripts/cn-release-continuation-bind.py')
TEMPLATES=ROOT/'.harness/scripts/vm/cn-runtime-continuation'


def need(v,code):
    if not v:raise ValueError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def encode(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()


def load(root,name,approval,entry):
    path=root/name;raw=entry.read(path,1048576)
    need(sha(raw)==approval['codeFiles'][name],'CODE_PIN')
    spec=importlib.util.spec_from_file_location(name.replace('/','_'),path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def materialize(release_raw,phase,inputs,output,entry,*,root=ROOT,now=None):
    release=entry.decode(release_raw);release_sha=sha(release_raw);r=release['identity'];cfg=release['runtime']
    need(release['kind']=='cn-fixed-release-approval-v1' and phase in ('hold','stop','backup','switch'),'RELEASE_SCOPE')
    for name in CODE:need(sha(entry.read(root/name,1048576))==release['codeFiles'][name],'CODE_PIN')
    journal=load(root,CODE[1],release,entry);derived=load(root,CODE[2],release,entry);binder=load(root,CODE[3],release,entry)
    need(release['target']==derived.TARGET,'TARGET')
    package=root/'.harness/scripts/vm/cn-runtime-continuation'
    need(set(cfg['templateFiles'])==derived.PACKAGE_FILES,'TEMPLATE_CLOSURE')
    for name,h in cfg['templateFiles'].items():need(sha(entry.read(package/name,1048576))==h,'TEMPLATE_PIN')
    a={'kind':'cn-release-once-delegation-v1','scope':'normal-four-phase-materialization',
       'releaseRequestSha256':release_sha,'release':r,'target':release['target'],
       'issuedAt':release['issuedAt'],'expiresAt':release['expiresAt'],'allowedPhases':list(derived.PRECEDING),
       'templateHashes':cfg['templateFiles'],'inputHashes':cfg['staticInputHashes'],
       'stageVerifierSha256':cfg['stageVerifierSha256'],'stageObserverSha256':cfg['stageObserverSha256'],
       'derivationSha256':release['codeFiles'][CODE[2]],'binderSha256':release['codeFiles'][CODE[3]],
       'evidenceValidatorSha256':release['codeFiles'][CODE[1]]}
    # Keep the canonical entry lock through complete validation and generation;
    # no action is executed here, so no recursive entry lock acquisition.
    iterator=journal.project(entry,release_sha,encode(a),phase,inputs,now=now)
    try:
        projected,receipts=next(iterator)
        captured={}
        def validate(request,approval,raws):
            captured['result']=binder.bind(request,approval,package,raws,output,now=now)
        request,approval=derived.derive(release_sha,encode(a),encode(projected),inputs,phase,
            validate=validate,preceding_receipts=receipts,now=now)
        result={'kind':'cn-fixed-runtime-delegation-v1','releaseSha256':release_sha,'phase':phase,
                'requestSha256':sha(request),'approvalSha256':sha(approval),'journalSha256':sha(encode(projected)),
                'originalReceiptHashes':{k:sha(v)for k,v in receipts.items()},'materialization':captured['result'],
                'cloudCalls':0,'dispatchAuthorizedByGenerator':False}
        entry.create(Path(output)/'delegation.json',encode(result))
        return result
    finally:iterator.close()
