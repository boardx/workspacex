#!/usr/bin/env python3
"""Prepare one source-bound approval proposal from protected blueprint and originals.

No installation or approval-store write. Interrupted attempts require manual
reconciliation: the exclusive intent is never silently retried.
"""
import copy
import importlib.util
import os
import re
from pathlib import Path


def module(name):
    s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

E=module('cn-release-mvp-evidence')
T=module('cn-release-mvp-transfer-input')
P=module('cn-release-approval-plan')
C=module('cn-release-mvp-trusted-collector')
S=module('cn-release-mvp-stage-evidence')
BLUEPRINTS=Path('/etc/workspacex-cn/mvp-approval-blueprints')
OUTPUTS=Path('/var/lib/workspacex-cn/release-generated/mvp-approval')


def derive(blueprint_raw,probe_raw,*,github):
    """Deterministic validation with a provider I/O seam; no success callbacks."""
    bp=S.parse(blueprint_raw)
    E.need(set(bp)=={'kind','selector','parameters','probeSha256','controlBundleSha256','githubPolicy','codeFiles'}
        and bp['kind']=='cn-mvp-approved-blueprint-v1','BLUEPRINT_SCHEMA')
    closure=module('cn-release-installation-closure')
    inventory=closure.inventory(P.ROOT)
    E.need(bp['codeFiles']==inventory and bp['controlBundleSha256']==closure.digest(inventory),'BLUEPRINT_CODE_CLOSURE')
    payload=bp['selector'];E.selector('approval',payload);identity=payload['identity']
    E.need(E.sha(probe_raw)==bp['probeSha256'],'BLUEPRINT_PROBE')
    parameters=copy.deepcopy(bp['parameters']);ident=parameters['identity']
    E.need(all(ident[k]==identity[k]for k in ('sourceRevision','controlRevision'))
        and all(ident[k]==payload[k]for k in ('requestedAt','deadlineAt')),'BLUEPRINT_IDENTITY')
    contract=module('cn-release-mvp-contract');contract.validate_metadata(parameters['mvp'])
    E.need('stageInputs'in parameters['mvp'] and parameters['mvp']['contentManifestSha256']==identity['contentManifestSha256'],'BLUEPRINT_STAGE_AUTHORITY')
    build_id=payload['buildRunId'];transfer_id=payload['transferRunId']
    build=github(f'/repos/boardx/workspacex/actions/runs/{build_id}')
    listing=github(f'/repos/boardx/workspacex/actions/runs/{build_id}/artifacts?per_page=100')
    bound=E.module().bind(identity,build,listing)
    plan=T.metadata_zip(bound['artifacts']['plan'],{'cn-candidate-plan.json'},github)['cn-candidate-plan.json']
    packed=T.metadata_zip(bound['artifacts']['set'],{'candidate-plan.json','candidate-set.json'},github)
    E.need(packed['candidate-plan.json']==plan,'CANDIDATE_PLAN_CHANGED')
    parsed_plan=S.parse(plan)
    E.need(all(parsed_plan[k]==identity[k]for k in ('sourceRevision','controlRevision')),'CANDIDATE_PLAN_IDENTITY')
    transfer=github(f'/repos/boardx/workspacex/actions/runs/{transfer_id}')
    E.need(transfer.get('id')==transfer_id and transfer.get('repository',{}).get('full_name')=='boardx/workspacex'
        and transfer.get('path')=='.github/workflows/transfer-cn-candidates-via-hongkong.yml'
        and transfer.get('head_sha')==identity['controlRevision'] and transfer.get('head_branch')=='main'
        and transfer.get('event')=='workflow_dispatch' and transfer.get('run_attempt')==1
        and transfer.get('status')=='completed' and transfer.get('conclusion')=='success','TRANSFER_ADMISSION')
    originals=C.transfer_metadata(payload,github)
    proof=originals['proof.json'];policy=originals['policy.json']
    pol=S.parse(policy);pr=S.parse(proof)
    import base64
    content=github(f'/repos/boardx/workspacex/contents/.github/workflows/build-cn-image-candidates.yml?ref={identity["controlRevision"]}')
    E.need(content.get('encoding')=='base64','PRODUCER_WORKFLOW_ENCODING')
    producer_sha=E.sha(base64.b64decode(content['content']))
    E.need(pol['producerWorkflowSha256']==producer_sha,'PRODUCER_WORKFLOW_PIN')
    upload=S.parse(originals['upload-plan.json']);template=S.parse(originals['hk-template.json'])
    E.need(upload['sourceRun']==build_id and upload['sourceRunAttempt']==1
        and upload['producerControl']==identity['controlRevision'] and upload['sourceRevision']==identity['sourceRevision']
        and upload['candidatePlanRawSha256']==E.sha(plan) and upload['revalidationTemplateSha256']==E.sha(originals['hk-template.json'])
        and template['runId']==build_id and template['runAttempt']==1,'TRANSFER_PLAN_BINDING')
    E.need(pol['runId']==build_id and pol['runAttempt']==1 and pol['controlRevision']==pol['verifierRevision']==identity['controlRevision']
        and pol['candidatePlanRawSha256']==E.sha(plan) and pol['candidateSetRawSha256']==E.sha(packed['candidate-set.json'])
        and pol['artifactIds']=={k:v['id']for k,v in bound['artifacts'].items()},'TRANSFER_POLICY_BINDING')
    E.need(pr['sourceRevision']==identity['sourceRevision'],'TRANSFER_PROOF_SOURCE')
    now=module('cn-release-acquire-delegation').instant(payload['requestedAt'])
    E.need(now<=module('cn-release-acquire-delegation').instant(pol['issuedAt'])
        <module('cn-release-acquire-delegation').instant(pol['expiresAt']),'TRANSFER_PROOF_WINDOW')
    pins={'plan':E.sha(plan),'set':E.sha(packed['candidate-set.json']),'proof':E.sha(proof),'policy':E.sha(policy)}
    E.need(github(f'/repos/boardx/workspacex/actions/runs/{build_id}')==build
        and github(f'/repos/boardx/workspacex/actions/runs/{transfer_id}')==transfer,'PROVIDER_RUN_CHANGED')
    parameters['mvp'].update(buildRunId=build_id,transferRunId=transfer_id)
    for request in parameters['acquireRequests'].values():
        request.update(runId=build_id,runAttempt=1,producerWorkflowSha256=pol['producerWorkflowSha256'])
        request['inputs'].update(pins)
    import tempfile
    with tempfile.TemporaryDirectory(prefix='cn-mvp-approval-offline-')as folder:
        probe=Path(folder)/'probe.json';probe.write_bytes(probe_raw)
        raw,installation,report=P.generate(parameters,probe)
    E.need(S.parse(report)['controlBundleSha256']==bp['controlBundleSha256'] and S.parse(raw)['codeFiles']==bp['codeFiles'],'BLUEPRINT_CODE_CLOSURE')
    files={'approval.json':raw,'installation-plan.json':installation,'size-report.json':report,'blueprint.json':blueprint_raw,'probe.json':probe_raw,
        'candidate-plan.json':plan,'candidate-set.json':packed['candidate-set.json'],'proof.json':proof,'policy.json':policy,
        'transfer-plan.json':originals['upload-plan.json'],'transfer-template.json':originals['hk-template.json'],'build-run.json':E.encode(build),'build-artifacts.json':E.encode(listing),'transfer-run.json':E.encode(transfer),'selector.json':E.encode(payload)}
    return files,{'kind':'cn-mvp-approval-preparation-v1','approvalSha256':E.sha(raw),'selectorSha256':E.sha(E.encode(payload)),
        'installationReady':False,'installed':False,'authorityGranted':False,'retryAllowed':False,'files':{n:E.sha(r)for n,r in files.items()}}


def derive_from_policy(policy_raw,selector,probe_raw,*,github):
    """Bind future run IDs only to a separately admitted immutable policy."""
    policy=S.parse(policy_raw)
    fields={'kind','action','identity','target','requestedAt','deadlineAt','parametersTemplate','probeSha256','controlBundleSha256','githubPolicy','codeFiles','rootInputPins'}
    E.need(set(policy)==fields and policy['kind']=='cn-mvp-cloud-preparation-policy-v1'
        and policy['action']=='install-approved-control-data','POLICY_SCHEMA')
    pins=policy['rootInputPins']
    required={'mvp-profile.json','mvp-schema-request.json','mvp-content-request.json','mvp-content-backup.json','mvp-nonmodel-fixtures.json','mvp-nonmodel-credentials.json','mvp-existing-environment.json','mvp-runtime-manifest.json'}
    E.need(type(pins)is dict and required<=set(pins) and len(pins)<=128,'POLICY_ROOT_INPUTS')
    E.need(not set(pins)&{'plan.json','set.json','proof.json','policy.json'},'POLICY_PROVIDER_INPUT_COLLISION')
    E.need(all(type(name)is str and (name=='migrationDiff.json' or re.fullmatch(r'[a-z0-9][a-z0-9-]{0,95}\.json',name)) and type(pin)is str and re.fullmatch('[a-f0-9]{64}',pin)for name,pin in pins.items()),'POLICY_ROOT_INPUT_PIN')
    E.selector('approval',selector)
    E.need(selector['identity']==policy['identity'] and all(selector[k]==policy[k]for k in ('requestedAt','deadlineAt')),'POLICY_SELECTOR_BINDING')
    parameters=copy.deepcopy(policy['parametersTemplate'])
    stage_names={'profileSha256':'mvp-profile.json','schemaRequestSha256':'mvp-schema-request.json','contentRequestSha256':'mvp-content-request.json','contentBackupSha256':'mvp-content-backup.json','nonmodelFixturesSha256':'mvp-nonmodel-fixtures.json','nonmodelCredentialsSha256':'mvp-nonmodel-credentials.json'}
    E.need(all(parameters['mvp']['stageInputs'][k]==pins[name]for k,name in stage_names.items()),'POLICY_STAGE_PIN_BINDING')
    E.need(parameters['target']==policy['target']==P.module('fixed-driver').TARGET,'POLICY_TARGET')
    E.need(type(parameters['mvp']['buildRunId'])is int and parameters['mvp']['buildRunId']==0
        and type(parameters['mvp']['transferRunId'])is int and parameters['mvp']['transferRunId']==0,'POLICY_FUTURE_ID_PLACEHOLDERS')
    parameters['mvp'].update(buildRunId=selector['buildRunId'],transferRunId=selector['transferRunId'])
    for request in parameters['acquireRequests'].values():
        E.need(type(request['runId'])is int and request['runId']==0 and request['runAttempt']==1,'POLICY_ACQUIRE_PLACEHOLDERS')
        request['runId']=selector['buildRunId']
    blueprint=dict(kind='cn-mvp-approved-blueprint-v1',selector=selector,parameters=parameters,
        **{key:policy[key]for key in ('probeSha256','controlBundleSha256','githubPolicy','codeFiles')})
    files,report=derive(E.encode(blueprint),probe_raw,github=github)
    files['preparation-policy.json']=policy_raw
    report['files']['preparation-policy.json']=E.sha(policy_raw)
    return files,report


def prepare(selector_sha,*,reader=E.private,github=None,outputs=OUTPUTS):
    E.need(isinstance(selector_sha,str)and re.fullmatch('[a-f0-9]{64}',selector_sha),'SELECTOR_HASH')
    blueprint=reader(BLUEPRINTS/(selector_sha+'.json'));bp=S.parse(blueprint)
    E.need(E.sha(E.encode(bp['selector']))==selector_sha,'BLUEPRINT_SELECTOR')
    probe=reader(BLUEPRINTS/'objects'/(bp['probeSha256']+'.json'))
    destination=Path(outputs)/selector_sha;destination.mkdir(mode=0o700)
    def save(name,raw):
        fd=os.open(destination/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    save('intent.json',E.encode({'blueprintSha256':E.sha(blueprint),'selectorSha256':selector_sha,'retryAllowed':False}))
    for directory in (destination,Path(outputs)):
        fd=os.open(directory,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
    provider=github or C.protected_github(bp['githubPolicy'])
    files,report=derive(blueprint,probe,github=provider)
    for name,raw in files.items():save(name,raw)
    save('report.json',E.encode(report))
    fd=os.open(destination,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
    return report


def main():
    import argparse
    p=argparse.ArgumentParser();p.add_argument('selector_sha256');a=p.parse_args()
    try:
        E.need(os.geteuid()==0,'ROOT_REQUIRED');print(E.encode(prepare(a.selector_sha256)).decode());return 0
    except (ValueError,KeyError,TypeError,OSError):
        print('{"status":"NOT_READY","authorityGranted":false,"installed":false,"retryAllowed":false}');return 20
if __name__=='__main__':raise SystemExit(main())
