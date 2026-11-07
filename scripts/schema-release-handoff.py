#!/usr/bin/env python3
"""Protocol for separately installed/reviewed full-release adapters, NOT a SQL writer.

Only a root-owned host policy can enable this route. An unchanged-image engine
never consumes these receipts or waives its schema guard. Unknown execution is
reconciled by an operator; a retry must never dispatch a second migration writer.
"""
import json
from pathlib import Path
import re
import subprocess

PROOFS=('backup-restore','baseline-compatibility','migration-ledger','candidate-acceptance')
IDENTITY=('environment','tag','sourceRevision','planSha256','manifestSha256')


def need(value,code):
    if not value: raise ValueError(code)


def validate_policy(plan,policy,check_file):
    need(plan.get('complete') is True,'COMPLETE_SCHEMA_PLAN_REQUIRED')
    need(plan.get('route')=='schema-preparation','MAINTENANCE_REVIEW_REQUIRED')
    need(type(policy) is dict and bool(policy),'SCHEMA_RELEASE_ADAPTER_REQUIRED')
    need(set(policy)=={'kind','environment','writer','verifier','timeoutSeconds'},'SCHEMA_RELEASE_POLICY_INVALID')
    need(policy['kind']=='installed-schema-release-adapter-v1' and policy['environment']==plan['environment'],'SCHEMA_RELEASE_POLICY_BINDING')
    need(type(policy['timeoutSeconds']) is int and 30<=policy['timeoutSeconds']<=600,'SCHEMA_RELEASE_TIMEOUT')
    for name in ('writer','verifier'):
        ref=policy[name]
        need(type(ref) is dict and set(ref)=={'path','sha256'},'SCHEMA_RELEASE_COMMAND_INVALID')
        need(type(ref['path']) is str and Path(ref['path']).is_absolute() and '..' not in Path(ref['path']).parts and
             type(ref['sha256']) is str and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'SCHEMA_RELEASE_COMMAND_INVALID')
        check_file(ref)
    need(policy['writer']['path']!=policy['verifier']['path'],'SEPARATE_SCHEMA_VERIFIER_REQUIRED')
    return policy


def read_receipt(path):
    with open(path,'rb') as stream:
        raw=stream.read(65537)
    need(len(raw)<=65536,'SCHEMA_RELEASE_RECEIPT_SIZE')
    def unique(items):
        result={}
        for key,value in items:
            need(key not in result,'SCHEMA_RELEASE_DUPLICATE_KEY')
            result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=unique)


def verify_receipt(request,receipt):
    need(type(receipt) is dict and receipt.get('kind')=='schema-release-result-v1' and
         receipt.get('status')=='SUCCEEDED','SCHEMA_RELEASE_RECONCILIATION_REQUIRED')
    need(all(receipt.get(key)==request[key] for key in IDENTITY),'SCHEMA_RELEASE_RECEIPT_BINDING')
    proofs=receipt.get('proofs')
    need(type(proofs) is dict and set(proofs)==set(PROOFS),'SCHEMA_RELEASE_PROOFS_REQUIRED')
    for ref in proofs.values():
        need(type(ref) is dict and set(ref)=={'path','sha256'} and type(ref['path']) is str and
             Path(ref['path']).is_absolute() and '..' not in Path(ref['path']).parts and type(ref['sha256']) is str and
             re.fullmatch('[a-f0-9]{64}',ref['sha256']),'SCHEMA_RELEASE_PROOF_REFERENCE')


def invoke(command,request,receipt,timeout,lock_fd=None):
    """No output from an adapter is forwarded. Only its protected receipt is read."""
    try:
        kwargs={'pass_fds':(lock_fd,)} if lock_fd is not None else {}
        reply=subprocess.Popen([*command,'--request',str(request),'--receipt',str(receipt)],
                             stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                             env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8',
                                                 **({'WSX_RELEASE_LOCK_FD':str(lock_fd)} if lock_fd is not None else {})},**kwargs)
        try:reply.communicate(timeout=timeout)
        except BaseException:
            if reply.poll() is None:
                reply.terminate()
                try:reply.communicate(timeout=15)
                except subprocess.TimeoutExpired:reply.kill();reply.communicate(timeout=5)
            raise
        need(reply.returncode==0 and receipt.is_file() and not receipt.is_symlink(),
             'SCHEMA_RELEASE_RECONCILIATION_REQUIRED')
    except (subprocess.TimeoutExpired,OSError):
        raise ValueError('SCHEMA_RELEASE_RECONCILIATION_REQUIRED') from None
