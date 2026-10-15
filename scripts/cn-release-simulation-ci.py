#!/usr/bin/env python3
"""Run isolated tests from a root-owned local clone of the exact CI checkout."""
import argparse
import json
import importlib.util
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time


def absolute_directory(value):
    path=Path(value)
    if not path.is_absolute() or path.resolve(strict=True)!=path or not path.is_dir():
        raise ValueError('CI_DIRECTORY_MUST_BE_CANONICAL_ABSOLUTE')
    return path


class SetupCleanupUnproven(RuntimeError):
    pass


def setup_domain(checkout):
    spec=importlib.util.spec_from_file_location('ci_setup_domain',checkout/'scripts/cn_release_simulation_domain.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.Domain()


def setup_simulation_unit(checkout,receipt_root,sha,run_id,timeout):
    spec=importlib.util.spec_from_file_location('ci_simulation_resource_unit',checkout/'scripts/cn-release-simulation-unit.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.Unit(checkout,receipt_root,sha,run_id,timeout)


def setup_fault_domain(command,checkout,env,sha,run_id,receipt_root,mode):
    spec=importlib.util.spec_from_file_location('ci_fault_admission',checkout/'scripts/cn-release-simulation-unit.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    evidence=module.admit_fault(command,checkout,env,sha,run_id,receipt_root,mode)
    module.write(receipt_root/'fault-admission.json',evidence)
    # Contained by the already verified outer Unit. Never create a sibling
    # service that could outlive the original supervisor's containment.
    return setup_domain(checkout)

def run_owned_setup(command,checkout,env,timeout=660,receipt_path=None):
    domain=setup_domain(checkout);process=None
    try:
        process=domain.spawn(command,cwd=checkout,env=env,start_new_session=True)
        code=process.wait(timeout=timeout)
        if code:raise subprocess.CalledProcessError(code,command)
    finally:
        try:cleanup=domain.close(process)
        except Exception as error:raise SetupCleanupUnproven('CI_SETUP_OUTER_CLEANUP_UNPROVEN')from error
        if not isinstance(cleanup,dict)or cleanup.get('verified')is not True:raise SetupCleanupUnproven('CI_SETUP_OUTER_CLEANUP_UNPROVEN')
        if receipt_path is not None:
            with receipt_path.open('x')as stream:json.dump(cleanup,stream);stream.flush();os.fsync(stream.fileno())
    return cleanup


def run_owned_simulation(command,checkout,env,registries,sha,run_id,receipt_root,timeout=16500,api_owner_root=None,recovery_deadline=None,fault_injection=None):
    """CI finally remains alive if a Session/simulation child is SIGKILLed."""
    # Only the worker crosses the resource-unit boundary. This parent and its
    # existing exact Docker recovery remain alive when that unit is killed.
    domain=(setup_simulation_unit(checkout,receipt_root,sha,run_id,timeout) if fault_injection is None else setup_fault_domain(command,checkout,env,sha,run_id,receipt_root,fault_injection));process=None;code=1;cleanup=None;recovery=None
    try:
        process=domain.spawn(command,cwd=checkout,env=env,start_new_session=True)
        code=process.wait(timeout=timeout)
    finally:
        try:
            cleanup=domain.close(process)
            if cleanup.get('verified')is not True or cleanup.get('populated')!=0:raise RuntimeError('CI_SIMULATION_DOMAIN_UNPROVEN')
            with (receipt_root/'simulation-outer-cleanup.json').open('x')as f:json.dump(cleanup,f);f.flush();os.fsync(f.fileno())
            spec=importlib.util.spec_from_file_location('ci_six_recovery',checkout/'scripts/cn-release-six-infra.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            recovery_deadline=recovery_deadline if recovery_deadline is not None else time.monotonic()+360
            results={}
            for name,path in registries.items():
                try:results[name]=module.recover_all(path,run_id,sha,cleanup,deadline=recovery_deadline)
                except Exception as error:results[name]={'verified':False,'errorType':type(error).__name__}
            # One unknown registry must never prevent recovery of the others.
            try:
                spec=importlib.util.spec_from_file_location('ci_api_recovery',checkout/'scripts/cn-release-fixture-docker-cleanup.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
                results['api-and-application']=api.recover_all(api_owner_root if api_owner_root is not None else receipt_root/'api-owners',run_id,cleanup,deadline=recovery_deadline)
            except Exception as error:results['api-and-application']={'verified':False,'errorType':type(error).__name__}
            # Only the two active real-resource roots; synthetic negative evidence
            # is deliberately excluded and remains a false diagnostic receipt.
            for index in range(1,11):
                for name in ('target','control'):
                    path=receipt_root/'sim14-owners'/('round-%02d'%index)/'api-outer-recovery'/name
                    if not path.exists()and not path.is_symlink():continue
                    key='sim14-%02d-%s'%(index,name)
                    try:results[key]=api.recover_all(path,run_id,cleanup,deadline=recovery_deadline)
                    except Exception as error:results[key]={'verified':False,'errorType':type(error).__name__}
            recovery={'verified':all(v.get('verified')is True for v in results.values()),'registries':results}
            with (receipt_root/'six-recovery.json').open('x')as f:json.dump(recovery,f);f.flush();os.fsync(f.fileno())
            if recovery.get('verified')is not True:raise RuntimeError('CI_SIX_RECOVERY_UNPROVEN')
        except Exception as exc:raise SetupCleanupUnproven('CI_SIMULATION_OR_DAEMON_CLEANUP_UNPROVEN')from exc
    return code


SUITES=('all','release','linux-api-outer-recovery','linux-application-recovery-complete','linux-six-business','linux-boundary-reap')

def execute(sha,rounds,seed,suite='all',workers=3,mode='acceptance'):
    if not re.fullmatch('[a-f0-9]{40}',sha):raise ValueError('CI_EXACT_SHA_REQUIRED')
    if rounds not in (1,10):raise ValueError('CI_ROUNDS_REQUIRED')
    if type(seed)is not int or not 0<=seed<=2**32-1:raise ValueError('CI_SEED_REQUIRED')
    if suite not in SUITES or type(workers)is not int or workers not in (1,3):raise ValueError('CI_FIXED_LANE_REQUIRED')
    if mode not in ('acceptance','development'):raise ValueError('CI_MODE_REQUIRED')
    if rounds==10 and suite!='all':raise ValueError('CI_TEN_ALL_REQUIRED')
    if sys.platform!='linux' or os.geteuid()!=0:raise ValueError('CI_LINUX_ROOT_REQUIRED')
    source=absolute_directory(os.environ['GITHUB_WORKSPACE'])
    temporary=absolute_directory(os.environ['RUNNER_TEMP'])
    if not (source/'.git').is_dir() or (source/'.git').is_symlink():raise ValueError('CI_LOCAL_CHECKOUT_REQUIRED')
    # No global Git configuration, cloud/GitHub credentials, hooks or network.
    owned=Path(tempfile.mkdtemp(prefix='wsx-cn-simulation-',dir='/var/lib'));owned_cleanup_verified=True
    try:
        owned.chmod(0o700);home=owned/'home';home.mkdir(mode=0o700)
        env={'PATH':os.environ.get('PATH',os.defpath),'HOME':str(home),'LANG':'C.UTF-8',
             'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null',
             'GIT_TERMINAL_PROMPT':'0','GIT_ALLOW_PROTOCOL':'file','PYTHONDONTWRITEBYTECODE':'1'}
        git=['/usr/bin/git','-c','safe.directory='+str(source),'-c','safe.directory='+str(source/'.git'),'-c','core.hooksPath=/dev/null']
        def read(*args):return subprocess.check_output([*git,*args],env=env,text=True,timeout=60).strip()
        if read('-C',str(source),'rev-parse','HEAD')!=sha:raise ValueError('CI_SOURCE_HEAD_CHANGED')
        if read('-C',str(source),'rev-parse','--is-shallow-repository')!='false':raise ValueError('CI_FULL_HISTORY_REQUIRED')
        if read('-C',str(source),'status','--porcelain','--untracked-files=all'):raise ValueError('CI_SOURCE_NOT_CLEAN')
        tree=read('-C',str(source),'rev-parse',sha+'^{tree}')
        checkout=owned/'checkout'
        subprocess.run([*git,'clone','--no-hardlinks','--no-checkout','--',str(source),str(checkout)],env=env,check=True,timeout=120)
        subprocess.run([*git,'-C',str(checkout),'checkout','--detach',sha],env=env,check=True,timeout=60)
        if read('-C',str(checkout),'rev-parse','HEAD')!=sha or read('-C',str(checkout),'rev-parse','HEAD^{tree}')!=tree:raise ValueError('CI_CLONE_IDENTITY_CHANGED')
        if read('-C',str(checkout),'status','--porcelain','--untracked-files=all'):raise ValueError('CI_CLONE_NOT_CLEAN')
        for parent in (checkout,*checkout.parents):
            info=parent.stat()
            if info.st_uid!=0 or info.st_gid!=0 or info.st_mode&0o022:raise ValueError('CI_CLONE_ANCESTOR_UNTRUSTED')
        for key in ('CN_ARCHIVE_TEST_NODE','CN_ARCHIVE_TEST_RUNTIME','CN_TEST_PLAYWRIGHT','CN_TEST_CHROMIUM','NODE_PATH','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_ACTIONS','CN_API_STARTUP_PG_IMAGE','CN_SIX_REDIS_IMAGE'):
            if key in os.environ:env[key]=os.environ[key]
        setup=owned/'fullstack-setup'
        outer_cleanup=run_owned_setup([sys.executable,'-I','-B',str(checkout/'scripts/cn-release-fullstack-fixture-setup.py'),
            '--repo',str(checkout),'--output',str(setup),'--pg-image',env['CN_API_STARTUP_PG_IMAGE']],checkout,env,receipt_path=owned/'setup-outer-cleanup.json')
        facts=json.loads((setup/'setup.json').read_bytes())
        if facts.get('prepared')is not True or facts.get('commit')!=sha:raise ValueError('CI_FULLSTACK_SETUP_UNPROVEN')
        for key in ('CN_API_STARTUP_NODE','CN_API_STARTUP_PG_IMAGE'):env[key]=facts['environment'][key]
        registries={}
        for key,name in (('CN_SIX_OWNER_ROOT','six-owners'),('CN_SIX_KILL_TARGET_ROOT','six-kill-targets'),('CN_SIX_KILL_CONTROL_ROOT','six-kill-controls')):
            registry=owned/name;registry.mkdir(mode=0o700);registries[name]=registry;env[key]=str(registry)
        sim14=owned/'sim14-owners';sim14.mkdir(mode=0o700);env['CN_SIM14_REGISTRY_ROOT']=str(sim14)
        api_owners=owned/'api-owners';api_owners.mkdir(mode=0o700);env['CN_API_OWNER_ROOT']=str(api_owners)
        env['CN_SIX_SOURCE_COMMIT']=sha
        return run_owned_simulation([sys.executable,'-I','-B',str(checkout/'scripts/cn-release-simulation.py'),
            '--output',str(temporary/'cn-simulation'),'--workers',str(workers),'--timeout-seconds','300',
            '--rounds',str(rounds),'--seed',str(seed),'--suite',suite,'--mode',mode],checkout,env,registries,sha,env['GITHUB_RUN_ID'],owned,api_owner_root=api_owners)
    except SetupCleanupUnproven:
        owned_cleanup_verified=False
        raise
    finally:
        # Preserve only bounded setup reports, including dependency failures.
        try:
            report=temporary/'cn-simulation'
            for origin,name in ((owned/'fullstack-setup/setup.json','fullstack-setup.json'),(owned/'fullstack-setup/install.log','fullstack-install.log'),(owned/'setup-outer-cleanup.json','fullstack-outer-cleanup.json'),(owned/'simulation-outer-cleanup.json','simulation-outer-cleanup.json'),(owned/'six-recovery.json','six-recovery.json')):
                if origin.is_file()and not origin.is_symlink():
                    info=origin.stat()
                    if info.st_uid!=0 or info.st_size>16*1024*1024:raise ValueError('CI_SETUP_REPORT_REJECTED')
                    report.mkdir(mode=0o700,exist_ok=True)
                    with (report/name).open('xb')as sink,origin.open('rb')as source:shutil.copyfileobj(source,sink,65536)
            six_names=('session-intent.json','port-reservation.json','session-ready.json','next-launch-intent.json','next-launch-started.json','next-launch-exit.json','playwright-report.json','session-cleanup.json','result.json','application.log')
            six_names+=tuple('next-worker-%02d-%s.json'%(n,phase)for n in range(1,17)for phase in ('started','exit','error'))+('next-worker-overflow.json',)
            owner_names=('owner.json','postgres-create-intent.json','postgres-create-receipt.json','postgres-start-intent.json','redis-create-intent.json','redis-create-receipt.json','redis-start-intent.json','database-create-intent.json','infra-receipt.json','cleanup.json','recovery-cleanup.json')
            for index in range(1,11):
                rid='round-%02d'%index;folder=owned/'six-owners'/rid
                for names,origin_dir,destination in ((six_names,folder,report/rid/'six-business'),(owner_names,folder/'six-infra-owner',report/rid/'six-infra-owner')):
                    for name in names:
                        origin=origin_dir/name
                        if not origin.exists():continue
                        info=origin.lstat()
                        if not stat.S_ISREG(info.st_mode)or origin.is_symlink()or info.st_uid!=0 or info.st_nlink!=1 or info.st_size>16*1024*1024:raise ValueError('CI_SIX_REPORT_REJECTED')
                        destination.mkdir(mode=0o700,parents=True,exist_ok=True)
                        with (destination/name).open('xb')as sink,origin.open('rb')as src:shutil.copyfileobj(src,sink,65536)
            for index in range(1,11):
                rid='round-%02d'%index
                for registry in ('api-container-owner','application-recovery-owner','application-recovery-complete-owner'):
                    for name in ('owner.json','api-create-intent.json','api-create-receipt.json','cleanup.json','recovery-cleanup.json'):
                        origin=owned/'api-owners'/rid/registry/name
                        if not origin.exists():continue
                        info=origin.lstat()
                        if not stat.S_ISREG(info.st_mode)or origin.is_symlink()or info.st_uid!=0 or info.st_nlink!=1 or info.st_size>16384:raise ValueError('CI_API_OWNER_REPORT_REJECTED')
                        destination=report/rid/registry;destination.mkdir(mode=0o700,parents=True,exist_ok=True)
                        with (destination/name).open('xb')as sink,origin.open('rb')as src:shutil.copyfileobj(src,sink,65536)
            for index in range(1,11):
                rid='round-%02d'%index;base=owned/'sim14-owners'/rid/'api-outer-recovery';destination=report/rid/'sim14-evidence'
                paths={}
                for case in ('success','uncertain'):
                    for name in ('simulation-outer-cleanup.json','six-recovery.json'):paths[case+'-'+name]=base/case/name
                paths['negative-provenance.json']=base/'negative-evidence/negative-provenance.json'
                for scope in ('target','control','negative-evidence'):
                    for registry in ('api-container-owner','application-recovery-owner'):
                        for name in ('owner.json','api-create-intent.json','api-create-receipt.json','cleanup.json','recovery-cleanup.json'):
                            paths[scope+'-'+registry+'-'+name]=base/scope/'round-01'/registry/name
                for name,origin in paths.items():
                    if not origin.exists():continue
                    info=origin.lstat()
                    if not stat.S_ISREG(info.st_mode)or origin.is_symlink()or info.st_uid!=0 or info.st_nlink!=1 or info.st_size>16384:raise ValueError('CI_SIM14_REPORT_REJECTED')
                    destination.mkdir(mode=0o700,parents=True,exist_ok=True)
                    with (destination/name).open('xb')as sink,origin.open('rb')as src:shutil.copyfileobj(src,sink,65536)
            for registry_name,destination_name in (('six-kill-targets','six-kill-target-owner'),('six-kill-controls','six-kill-control-owner')):
                for index in range(1,11):
                    rid='round-%02d'%index;origin_dir=owned/registry_name/rid/'six-infra-owner';destination=report/rid/destination_name
                    for name in owner_names:
                        origin=origin_dir/name
                        if not origin.exists():continue
                        info=origin.lstat()
                        if not stat.S_ISREG(info.st_mode)or origin.is_symlink()or info.st_uid!=0 or info.st_nlink!=1 or info.st_size>16384:raise ValueError('CI_KILL_OWNER_REPORT_REJECTED')
                        destination.mkdir(mode=0o700,parents=True,exist_ok=True)
                        with (destination/name).open('xb')as sink,origin.open('rb')as src:shutil.copyfileobj(src,sink,65536)
        finally:
            # This invocation created exactly this root; never chown/chmod source.
            if owned_cleanup_verified:shutil.rmtree(owned)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sha',required=True);parser.add_argument('--rounds',type=int,choices=(1,10),default=1);parser.add_argument('--seed',type=int,default=0)
    parser.add_argument('--suite',choices=SUITES,default='all');parser.add_argument('--workers',type=int,choices=(1,3),default=3)
    parser.add_argument('--mode',choices=('acceptance','development'),default='acceptance')
    args=parser.parse_args();return execute(args.sha,args.rounds,args.seed,args.suite,args.workers,args.mode)


if __name__=='__main__':sys.exit(main())
