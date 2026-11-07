#!/usr/bin/env python3
"""Actual Docker/whole-simulation SIGKILL counterexample; GitHub Linux only.

Requires a CI-predeclared CN_SIM14_OWNER_ROOT with target/control roots.
The CI supervisor must recover both after its outer cgroup is empty, even
if this fixture itself dies. This file does not claim that future wiring exists.
No pull, prune, credential, published port, or production service is involved.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import signal
import sys
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]

def need(value,code):
    if not value:raise RuntimeError(code)

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
    previous=sys.dont_write_bytecode
    try:sys.dont_write_bytecode=True;spec.loader.exec_module(module)
    finally:sys.dont_write_bytecode=previous
    return module

def create(module,owner,image,deadline):
    record={'token':owner.token,'containerName':'wsx-cn-api-'+secrets.token_hex(8),'imageId':image}
    module.durable(owner.directory,'api-create-intent.json',record)
    facts=json.loads(module.command([owner.docker,'image','inspect',image],deadline=deadline))[0]
    need(facts['Id']==image and facts['Os']=='linux' and facts['Architecture']=='amd64','IMAGE_IDENTITY')
    volumes=facts.get('Config',{}).get('Volumes')or{}
    need(isinstance(volumes,dict)and len(volumes)<=8,'IMAGE_VOLUME_BOUND')
    mounts=[]
    for path in volumes:
        need(re.fullmatch('/[a-zA-Z0-9_/-]+',path)and '..'not in path.split('/'),'IMAGE_VOLUME_PATH')
        mounts+=['--tmpfs',path+':rw,nosuid,nodev,noexec,size=1048576']
    cid=module.command([owner.docker,'run','--pull=never','--detach','--network=none',
        '--memory=64m','--memory-swap=64m','--cpus=.25','--pids-limit=16','--cap-drop=ALL',
        '--security-opt=no-new-privileges','--read-only',*mounts,'--name',record['containerName'],
        '--label','cn-startup-fixture='+owner.token,'--entrypoint=/bin/sh',image,'-c','exec sleep 240'],deadline=deadline)
    need(re.fullmatch('[a-f0-9]{64}',cid),'CONTAINER_ID')
    observed=json.loads(module.command([owner.docker,'inspect',cid],deadline=deadline))[0]
    need(observed['Id']==cid and observed['Image']==image and observed['Config']['Labels']['cn-startup-fixture']==owner.token and observed['Name']=='/'+record['containerName'],'CONTAINER_BINDING')
    need(observed['HostConfig']['NetworkMode']=='none'and all(v['Type']=='tmpfs'for v in observed['Mounts']),'CONTAINER_ISOLATION')
    module.durable(owner.directory,'api-create-receipt.json',{**record,'containerId':cid})
    return cid

def readonly_docker_script(real_docker,token):
    """Only the exact original owner-list operation may reach the daemon."""
    allowed=['ps','--all','--quiet','--no-trunc','--filter','label=cn-startup-fixture='+token]
    return '#!'+sys.executable+'\nimport os,sys\nif sys.argv[1:] != '+repr(allowed)+': sys.exit(91)\nos.execv('+repr(real_docker)+', ['+repr(real_docker)+']+sys.argv[1:])\n'

def child():
    module=load('owner_child',ROOT/'scripts/cn-release-fixture-docker-cleanup.py')
    base=Path(os.environ['CN_SIM14_CHILD_ROOT']);module.trusted_directory(base)
    folder=base/'round-01';folder.mkdir(mode=0o700)
    for registry in module.REGISTRY_NAMES:
        owner=module.Owner(folder,os.environ['GITHUB_RUN_ID'],'round-01',registry)
        create(module,owner,os.environ['CN_API_STARTUP_PG_IMAGE'],float(os.environ['CN_SIM14_DEADLINE']))
    os.kill(os.getpid(),signal.SIGKILL)
    raise AssertionError('SIGKILL_DID_NOT_TERMINATE')

def main():
    started=time.monotonic()
    if sys.platform!='linux'or os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':
        print(json.dumps({'verified':False,'reason':'GITHUB_LINUX_ROOT_REQUIRED'}));return 2
    module=load('owner_supervisor',ROOT/'scripts/cn-release-fixture-docker-cleanup.py')
    ci=load('original_ci',ROOT/'scripts/cn-release-simulation-ci.py')
    base=Path(os.environ['CN_SIM14_OWNER_ROOT']);module.trusted_directory(base)
    need(base.name=='api-outer-recovery','FIXED_OWNER_ROOT_REQUIRED')
    roots={name:base/name for name in ('target','control')}
    for path in roots.values():module.trusted_directory(path)
    image=os.environ['CN_API_STARTUP_PG_IMAGE'];run_id=os.environ['GITHUB_RUN_ID']
    need(re.fullmatch('sha256:[a-f0-9]{64}',image)and re.fullmatch('[1-9][0-9]*',run_id),'FIXTURE_IDENTITY')
    commit=subprocess.check_output(['git','-c','safe.directory='+str(ROOT),'-C',str(ROOT),'rev-parse','HEAD'],text=True,timeout=10).strip()
    need(re.fullmatch('[a-f0-9]{40}',commit),'EXACT_CONTROL_COMMIT')
    deadline=started+120;recovery_deadline=started+330;proofs={};failure=None;control=None
    # No provider credentials or application configuration cross into the child.
    env={k:os.environ[k]for k in ('PATH','GITHUB_RUN_ID','GITHUB_ACTIONS','CN_API_STARTUP_PG_IMAGE')if k in os.environ}
    env.update(CN_SIM14_CHILD_ROOT=str(roots['target']),CN_SIM14_DEADLINE=str(deadline))
    try:
        folder=roots['control']/'round-01';folder.mkdir(mode=0o700)
        control=module.Owner(folder,run_id,'round-01');cid=create(module,control,image,deadline)
        success=base/'success';success.mkdir(mode=0o700)
        code=ci.run_owned_simulation([sys.executable,'-I','-B',str(Path(__file__).resolve()),'--child'],ROOT,env,{},commit,run_id,success,timeout=max(.1,deadline-time.monotonic()),api_owner_root=roots['target'],recovery_deadline=recovery_deadline,fault_injection='api-outer-sigkill')
        need(code==-signal.SIGKILL,'WHOLE_SIMULATION_NOT_SIGKILLED')
        actual=json.loads((success/'six-recovery.json').read_bytes())
        owners=actual['registries']['api-and-application']['owners']
        need(set(owners)=={'round-01/'+v for v in module.REGISTRY_NAMES},'BOTH_OWNERS_REQUIRED')
        need(all(v['verified']and len(v['removedContainerIds'])==1 for v in owners.values()),'BOTH_TARGETS_NOT_REMOVED')
        need(module.command([control.docker,'inspect','--format','{{.Id}} {{.State.Running}}',cid],deadline=deadline)==cid+' true','CONTROL_WAS_REMOVED')
        proofs['wholeSimulationSigkill']=actual
        negative=base/'negative-evidence';negative.mkdir(mode=0o700)
        folder=negative/'round-01';folder.mkdir(mode=0o700)
        directory=folder/'api-container-owner';directory.mkdir(mode=0o700);token=secrets.token_hex(16)
        # This branch never submits a create. A separate CLI mechanically permits
        # only this token's read-only ps request, even if recovery regresses.
        module.durable(directory,'owner.json',{'kind':'cn-api-fixture-owner-v1','token':token,'runId':run_id,'roundId':'round-01'})
        module.durable(directory,'api-create-intent.json',{'token':token,'containerName':'wsx-cn-api-'+secrets.token_hex(8),'imageId':image})
        guard=base/'readonly-bin';guard.mkdir(mode=0o700)
        executable=guard/'docker';executable.write_text(readonly_docker_script(control.docker,token));executable.chmod(0o700)
        module.durable(negative,'negative-provenance.json',{'kind':'never-submitted-negative-fixture-v1','requestNeverSubmitted':True,'allowedOperation':'exact-token-ps-only','activeRegistry':False})
        uncertain=base/'uncertain';uncertain.mkdir(mode=0o700)
        old_path=os.environ.get('PATH','');os.environ['PATH']=str(guard)
        try:
            try:ci.run_owned_simulation([sys.executable,'-I','-B',str(Path(__file__).resolve()),'--noop'],ROOT,env,{},commit,run_id,uncertain,timeout=max(.1,min(10,recovery_deadline-time.monotonic())),api_owner_root=negative,recovery_deadline=recovery_deadline,fault_injection='api-outer-noop')
            except ci.SetupCleanupUnproven:pass
            else:raise RuntimeError('UNKNOWN_CREATE_FALSE_GREEN')
        finally:os.environ['PATH']=old_path
        proofs['unknown']=json.loads((uncertain/'six-recovery.json').read_bytes())
        need(proofs['unknown']['verified']is False,'UNKNOWN_FALSE_GREEN')
        rejection=proofs['unknown']['registries']['api-and-application']['owners']['round-01/api-container-owner']
        need(rejection.get('unacknowledgedCreate')is True and rejection.get('daemonReadbackEmpty')is True and rejection.get('verified')is False,'ORIGINAL_UNKNOWN_REJECTION_REQUIRED')
    except Exception as error:failure=type(error).__name__
    finally:
        # Original outer helper receipts, not invented process-empty evidence.
        success=base/'success/simulation-outer-cleanup.json'
        if success.is_file():
            actual_cleanup=json.loads(success.read_bytes())
            for name,path in roots.items():
                try:proofs['final-'+name]=module.recover_all(path,run_id,actual_cleanup,deadline=recovery_deadline)
                except Exception as error:failure=failure or type(error).__name__
        else:failure=failure or 'OUTER_CLEANUP_UNPROVEN'
        for name in ('target','control'):
            if proofs.get('final-'+name,{}).get('verified')is not True:failure=failure or 'FINAL_RESOURCE_CLEANUP_UNPROVEN'
    passed=failure is None
    print(json.dumps({'kind':'cn-whole-simulation-docker-recovery-v1','verified':passed,'failure':failure,
        'durationSeconds':round(time.monotonic()-started,3),'proofs':proofs,'evidenceDirectory':str(base),
        'controlPreserved':passed,'unknownRejected':passed,'productionAccepted':False},sort_keys=True))
    return 0 if passed else 1

if __name__=='__main__':
    if sys.argv[1:]==['--child']:sys.exit(child())
    if sys.argv[1:]==['--noop']:sys.exit(0)
    need(not sys.argv[1:],'FIXED_FIXTURE_ARGUMENTS')
    sys.exit(main())
