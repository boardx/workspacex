#!/usr/bin/env python3
"""Installed host consumer. No source checkout, build, migration or caller-selected config."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import uuid

HERE=Path(__file__).resolve().parent

def sibling(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),HERE/(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

registry=sibling('registry-images')
engine=sibling('minimal-docker-release')

def trusted(path, directory=False, private=False):
    path=Path(path)
    registry.need(path.is_absolute(),'ABSOLUTE_PATH_REQUIRED')
    for parent in [*reversed(path.parents),path]:
        info=parent.lstat()
        registry.need(not stat.S_ISLNK(info.st_mode) and info.st_uid==0 and not info.st_mode & 0o022,'UNTRUSTED_HOST_PATH')
    info=path.stat()
    if not directory: registry.need(info.st_nlink==1,'HOST_FILE_HARDLINK')
    registry.need(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode),'HOST_PATH_TYPE')
    if private: registry.need(not info.st_mode & 0o077,'HOST_PATH_NOT_PRIVATE')
    return path

def atomic(path, value):
    path=Path(path)
    fd,name=tempfile.mkstemp(prefix='.release-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as output:
            output.write(engine.encoded(value));output.flush();os.fsync(output.fileno())
        os.replace(name,path)
        directory=os.open(path.parent,os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(name): os.unlink(name)

def admission_command(config,environment):
    command=config.get('admissionCommand')
    if environment=='cn': registry.need(isinstance(command,list) and bool(command),'CN_ADMISSION_REQUIRED')
    if command:
        registry.need(isinstance(command,list) and all(isinstance(v,str) for v in command),'INVALID_ADMISSION_COMMAND')
        trusted(command[0])
    return command

def deploy(environment,tag,config_root=Path('/etc/workspacex-image-release')):
    registry.need(environment in ('devapp','cn'),'INVALID_ENVIRONMENT')
    registry.need(registry.TAG.fullmatch(tag),'INVALID_RELEASE_TAG')
    config_path=trusted(config_root/(environment+'.json'),private=True)
    config=json.loads(config_path.read_bytes())
    registry.need(config['environment']==environment,'ENVIRONMENT_POLICY_MISMATCH')
    registry.coordinates(config['registryPrefix'],tag)
    docker=str(trusted(config['docker']))
    docker_config=trusted(config['dockerConfig'],directory=True,private=True)
    # Existing root-managed Docker login is used only for pulling. Nothing is read from runner env.
    trusted(docker_config/'config.json',private=True)
    state=trusted(config['stateDirectory'],directory=True,private=True)
    lock_path=trusted(config['lockFile'],private=True)
    expected_lock={'devapp':'/run/workspacex-devapp-deploy.lock','cn':'/var/lib/workspacex-cn/runtime/release.lock'}
    registry.need(str(lock_path)==expected_lock[environment],'CANONICAL_LOCK_REQUIRED')
    for reference in [*config['composeFiles'],config['envFile']]:
        engine.trusted_file(str(trusted(reference['path'])),reference['sha256'])
    admission=admission_command(config,environment)
    probe=config.get('verificationCommand')
    registry.need(isinstance(probe,list) and probe and all(isinstance(v,str) for v in probe),'BUSINESS_PROBE_REQUIRED')
    trusted(probe[0])
    # Pins cover any script/config arguments that the fixed probe consumes.
    for reference in config.get('verificationFiles',[]):
        engine.trusted_file(str(trusted(reference['path'])),reference['sha256'])
    lock=os.open(lock_path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('ENVIRONMENT_DEPLOYMENT_BUSY')
        current_path=state/'current.json'
        current=None
        compose_files=list(config['composeFiles'])
        if current_path.exists():
            trusted(current_path,private=True);current=json.loads(current_path.read_bytes())
            prior=trusted(current['path'])
            registry.need(prior.is_relative_to(state),'ACTIVE_OVERRIDE_OUTSIDE_STATE')
            engine.trusted_file(str(prior),current['sha256'])
            compose_files.append({'path':str(prior),'sha256':current['sha256']})
        # A durable intent blocks new writes after host/daemon loss or uncertain state commit.
        pending=state/'pending.json'
        registry.need(not pending.exists(),'UNRESOLVED_DEPLOYMENT_REQUIRES_RECONCILIATION')
        images={role:registry.resolve([docker,'--config',str(docker_config)],config['registryPrefix'],tag,role) for role in registry.SERVICES}
        sources=[image.get('sourceRevision') for image in images.values()]
        registry.need(all(isinstance(source,str) and registry.SHA.fullmatch(source) for source in sources) and len(set(sources))==1,'IMAGE_SOURCE_MISMATCH')
        source=sources[0]
        attempt=state/('attempt-'+uuid.uuid4().hex);attempt.mkdir(mode=0o700)
        if admission:
            # Fixed host adapter retains CN preactivation/backup/compatibility admission.
            checked=subprocess.run([*admission,tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=120,
                                   env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8'})
            registry.need(checked.returncode==0,'HOST_ADMISSION_REJECTED')
        manifest={'kind':'registry-images-v1','sourceRevision':source,'tag':tag,'platform':'linux/amd64','images':images}
        manifest_file=attempt/'manifest.json';engine.save(manifest_file,manifest)
        effective={k:config[k] for k in ('project','services','envFile','health','lockFile','verificationCommand')}
        effective.update(docker=docker,composeFiles=compose_files,automaticRollback=True,
                         manifestSha256=engine.sha_file(manifest_file),readinessTimeoutSeconds=config.get('readinessTimeoutSeconds',120))
        effective_file=attempt/'config.json';engine.save(effective_file,effective)
        atomic(pending,{'tag':tag,'attempt':str(attempt),'previous':current})
        def commit(override):
            atomic(current_path,{'tag':tag,'sourceRevision':source,'path':str(override.resolve()),'sha256':engine.sha_file(override)})
        result=engine.release(effective_file,manifest_file,attempt/'deployment',True,lock_fd=lock,commit=commit)
        if result['status']=='ROLLED_BACK':
            # Recovery used immutable IDs, which can change the Compose config hash.
            # Keep that exact overlay as the next release's baseline.
            atomic(current_path,{'tag':current['tag'] if current else 'baseline',**result['rollbackOverride']})
        elif result['status']=='REJECTED':
            if current is None: current_path.unlink(missing_ok=True)
            else: atomic(current_path,current)
        if result['status'] in ('SUCCEEDED','REJECTED','ROLLED_BACK'):
            pending.unlink()
        # ROLLBACK_FAILED keeps the pending intent and blocks subsequent releases.
        return {**result,'environment':environment,'tag':tag,'evidenceDirectory':str(attempt)}
    finally: os.close(lock)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('environment',choices=('devapp','cn'));parser.add_argument('tag')
    parser.add_argument('--execute',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args()
    registry.need(os.geteuid()==0,'INSTALLED_ENTRY_REQUIRES_ROOT')
    registry.need(registry.TAG.fullmatch(args.tag),'INVALID_RELEASE_TAG')
    if not args.execute:
        # The worker outlives the Actions runner and performs recovery on cancellation.
        # systemd grants recovery time rather than letting runner shutdown kill it midway.
        command=['/usr/bin/systemd-run','--wait','--collect','--quiet','--unit=wsx-image-'+args.environment+'-'+uuid.uuid4().hex,
                 '--property=RuntimeMaxSec=900','--property=TimeoutStopSec=360','--property=KillMode=mixed',
                 '/usr/bin/python3','-I','-B',str(Path(__file__).resolve()),args.environment,args.tag,'--execute']
        return subprocess.run(command,env={'PATH':'/usr/bin:/bin'},check=False).returncode
    result=deploy(args.environment,args.tag)
    print(json.dumps(result,sort_keys=True))
    return 0 if result['status']=='SUCCEEDED' else 1

if __name__=='__main__':
    try: raise SystemExit(main())
    except Exception as error:
        code=str(error) if isinstance(error,(ValueError,engine.Rejected)) else type(error).__name__
        print(json.dumps({'status':'DEPLOYMENT_FAILED','code':code}),file=sys.stderr)
        raise SystemExit(1)
