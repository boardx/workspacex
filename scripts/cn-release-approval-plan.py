#!/usr/bin/env python3
"""Offline exact request/installation proposal. Does not approve or install it."""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def module(name):
    p=ROOT/'scripts'/('cn-release-'+name+'.py');s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m


def generate(parameters,probe):
    o=module('orchestrate');r=module('stage-router');d=module('fixed-driver');ac=module('acquire-delegation');e=o.e
    fields={'identity','target','issuedAt','expiresAt','acquireRequests','runtimeStaticInputHashes','runtimeRoot','business','rds'}
    e.need(set(parameters)in (fields,fields|{'mvp'}),'PARAMETER_SCHEMA')
    plan=o.installation_plan(probe);bundle=plan['controlBundle'];code={f['path']:f['sha256']for f in bundle['files']}
    a={'kind':'cn-fixed-release-approval-v1','schemaVersion':1,**{k:copy.deepcopy(parameters[k])for k in ('identity','target','issuedAt','expiresAt','business','rds')},'codeFiles':code}
    e.need(set(a['identity'])==set(d.IDENTITY) and a['target']==d.TARGET,'IDENTITY_SCOPE')
    if 'mvp' in parameters:
        m=module('mvp-contract').validate_metadata(parameters['mvp'])
        e.need(all(parameters['acquireRequests'][phase]['runId']==m['buildRunId'] and parameters['acquireRequests'][phase]['runAttempt']==1 for phase in ('consume','publication')),'MVP_ACQUIRE_BUILD_BINDING')
        a['mvp']=copy.deepcopy(m)
    e.need(set(parameters['runtimeStaticInputHashes'])=={'authorization','template','migrationDiff'},'STATIC_INPUTS')
    for h in parameters['runtimeStaticInputHashes'].values():e.need(isinstance(h,str) and e.HEX.fullmatch(h),'STATIC_PIN')
    root=parameters['runtimeRoot'];e.need(isinstance(root,str) and __import__('re').fullmatch('/var/lib/workspacex-cn/runtime/upgrade-[a-z0-9-]{1,100}',root),'RUNTIME_ROOT')
    base='.harness/scripts/vm/cn-runtime-continuation/'
    names=module('derived-approval').PACKAGE_FILES
    a['runtime']={'templateFiles':{n:code[base+n]for n in names},'staticInputHashes':parameters['runtimeStaticInputHashes'],'stageVerifierSha256':{},'stageObserverSha256':{}}
    a['runtimeStage']={'remoteRoot':root,'templateSha256':code[base+'stage-phase.py']}
    a['writerResume']={'remoteRoot':root,'packageFiles':{n:code[base+'finalize/'+n]for n in ('prepare.py','runtime.py')},'stageVerifierSha256':{}}
    contract=Path(bundle['targetRoot'])/'scripts/cn-release-stage-contract.py'
    for stage in e.STAGES:
        observer,verifier=r.render_contract(contract,code['scripts/cn-release-stage-contract.py'],stage)
        a['runtime']['stageObserverSha256'][stage]=e.digest(observer)
        a['runtime']['stageVerifierSha256'][stage]=e.digest(verifier)
        a['writerResume']['stageVerifierSha256'][stage]=e.digest(verifier)
    a['acquire']={'requests':parameters['acquireRequests'],'templateFiles':{n:code[base+'acquire/'+n]for n in ac.TEMPLATES},
        'consumeEntryCode':{'observerSha256':a['runtime']['stageObserverSha256']['consume'],'verifierSha256':a['runtime']['stageVerifierSha256']['consume']}}
    e.need('sdkFiles'not in a['rds'] and e.HEX.fullmatch(a['rds']['sdkManifestSha256']),'SDK_MANIFEST_REFERENCE_REQUIRED')
    rd=module('rds-backup');cfg=a['rds']
    e.need(set(cfg)=={'sdkRoot','sdkManifestSha256','dbInstanceId','roleName','principalArn','holdHelperSha256','permissionEvidence'},'RDS_PARAMETERS')
    e.need(cfg['sdkRoot']==str(rd.SDK_ROOT) and cfg['dbInstanceId']==rd.DB and cfg['roleName']==rd.ROLE,'RDS_FIXED_SCOPE')
    e.need(set(a['business'])=={'runtimeProfileSha256','planSha256','testDataScopeSha256','recoveryPlanSha256','recoveryTestDataScopeSha256','stableWindowSeconds'},'BUSINESS_PARAMETERS')
    e.need(type(a['business']['stableWindowSeconds'])is int and 30<=a['business']['stableWindowSeconds']<=300,'BUSINESS_WINDOW')
    for k,h in a['business'].items():
        if k!='stableWindowSeconds':e.need(isinstance(h,str) and e.HEX.fullmatch(h),'BUSINESS_PIN')
    a['rds']['adapterSha256']=code['scripts/cn-release-rds-backup.py']
    raw=e.encode(a);e.need(len(raw)<=e.MAX,'COMPLETE_APPROVAL_TOO_LARGE')
    # Validate immutable identity/time/acquire relations without current cloud
    # access. Using issuedAt here is schema checking, not a fresh admission.
    d.validate(e.digest(raw),raw,e.instant(a['issuedAt']));ac.approval(raw,now=e.instant(a['issuedAt']))
    report={'kind':'cn-release-approval-size-report-v1','approvalSha256':e.digest(raw),'approvalBytes':len(raw),'maximumBytes':e.MAX,
        'codeFiles':len(code),'controlBundleSha256':bundle['sha256'],'installationReady':False,'approvalGranted':False,
        'cloudCalls':0,'targetCapabilitiesVerified':False,'runtimeAdmissionRequired':True}
    return raw,e.encode(plan),e.encode(report)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--parameters',required=True);p.add_argument('--probe',required=True);p.add_argument('--output',required=True);args=p.parse_args()
    data=Path(args.parameters).read_bytes()
    if len(data)>1048576:raise ValueError('PARAMETERS_TOO_LARGE')
    # Reuse duplicate-key rejecting decoder, so a proposal has one meaning.
    raw,plan,report=generate(module('orchestrate').e.decode(data),args.probe)
    output=Path(args.output);output.mkdir(mode=0o700,parents=False,exist_ok=False)
    for name,body in [('approval.json',raw),('installation-plan.json',plan),('size-report.json',report)]:
        fd=os.open(output/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb')as f:f.write(body);f.flush();os.fsync(f.fileno())
    print(report.decode(),end='')

if __name__=='__main__':main()
