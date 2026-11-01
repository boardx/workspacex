#!/usr/bin/env python3
"""Installed host consumer. No source checkout, build, migration or caller-selected config."""
import argparse
import base64
from contextlib import contextmanager
import datetime
import fcntl
import hashlib
import hmac
import importlib.util
import json
import os
import re
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import uuid

HERE=Path(__file__).resolve().parent

def sibling(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),HERE/(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

registry=sibling('registry-images')
engine=sibling('minimal-docker-release')
schema_plans=sibling('tag-schema-plan')
schema_handoff=sibling('schema-release-handoff')

class NoAuthRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('ECS_ACR_AUTH_FAILED')

@contextmanager
def ecs_docker_config(policy, docker, host, runtime_directory):
    """Refresh the host's ECS identity for each release; never persist STS credentials."""
    region=policy.get('region','')
    registry.need(bool(re.fullmatch(r'[a-z]{2}-[a-z]+(?:-\d+)?',region)), 'ECS_ACR_REGION_INVALID')
    registry.need(bool(re.fullmatch(r'[a-z0-9][a-z0-9-]*\.'+re.escape(region)+r'\.cr\.aliyuncs\.com',host)), 'ECS_ACR_REGISTRY_MISMATCH')
    for key,pattern in [('instanceId',r'cri-[a-zA-Z0-9]+'),('roleName',r'[a-zA-Z0-9.-]{1,64}'),('ecsInstanceId',r'i-[a-zA-Z0-9]+')]:
        registry.need(bool(re.fullmatch(pattern,policy.get(key,''))), 'ECS_ACR_POLICY_INVALID')
    try:
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoAuthRedirect())
        base='http://100.100.100.200/latest/'
        token=opener.open(urllib.request.Request(base+'api/token',method='PUT',headers={'X-aliyun-ecs-metadata-token-ttl-seconds':'300'}),timeout=5).read(4096).decode()
        def metadata(path):
            request=urllib.request.Request(base+'meta-data/'+path,headers={'X-aliyun-ecs-metadata-token':token})
            return opener.open(request,timeout=5).read(65536)
        registry.need(metadata('instance-id').decode().strip()==policy['ecsInstanceId'],'ECS_INSTANCE_MISMATCH')
        credentials=json.loads(metadata('ram/security-credentials/'+policy['roleName']))
        registry.need(credentials.get('Code')=='Success','ECS_ROLE_UNAVAILABLE')
        params={'Action':'GetAuthorizationToken','InstanceId':policy['instanceId'],'RegionId':region,'Version':'2018-12-01','Format':'JSON',
                'AccessKeyId':credentials['AccessKeyId'],'SecurityToken':credentials['SecurityToken'],'SignatureMethod':'HMAC-SHA1','SignatureVersion':'1.0',
                'SignatureNonce':str(uuid.uuid4()),'Timestamp':datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
        quote=lambda value:urllib.parse.quote(str(value),safe='~')
        canonical='&'.join(quote(key)+'='+quote(value) for key,value in sorted(params.items()))
        params['Signature']=base64.b64encode(hmac.new((credentials['AccessKeySecret']+'&').encode(),('POST&%2F&'+quote(canonical)).encode(),hashlib.sha1).digest()).decode()
        request=urllib.request.Request('https://cr.'+region+'.aliyuncs.com/',data=urllib.parse.urlencode(params).encode())
        reply=json.loads(opener.open(request,timeout=30).read(65536))
        registry.need(reply.get('IsSuccess') is True and reply['ExpireTime']>time.time()*1000+960000,'ACR_CREDENTIAL_LIFETIME')
        username,password=reply['TempUsername'],reply['AuthorizationToken']
        registry.need(all(isinstance(v,str) and v and not any(ord(c)<32 or ord(c)==127 for c in v) for v in (username,password)),'ACR_CREDENTIAL_FORMAT')
    except Exception:
        raise ValueError('ECS_ACR_AUTH_FAILED') from None
    # systemd removes the parent even after SIGKILL, power loss or a timed-out pull.
    with tempfile.TemporaryDirectory(prefix='acr-pull-',dir=runtime_directory) as directory:
        try:
            result=subprocess.run([docker,'--config',directory,'login',host,'--username',username,'--password-stdin'],
                                  input=password,capture_output=True,text=True,timeout=30,env={'PATH':'/usr/bin:/bin'})
            registry.need(result.returncode==0,'ECS_ACR_LOGIN_FAILED')
            os.chmod(Path(directory)/'config.json',0o600)
        except Exception:
            raise ValueError('ECS_ACR_LOGIN_FAILED') from None
        yield Path(directory)

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
    registry.need(environment in ('devapp','cn','us'),'INVALID_ENVIRONMENT')
    registry.need(registry.TAG.fullmatch(tag),'INVALID_RELEASE_TAG')
    config_path=trusted(config_root/(environment+'.json'),private=True)
    config=json.loads(config_path.read_bytes())
    registry.need(config['environment']==environment,'ENVIRONMENT_POLICY_MISMATCH')
    registry.coordinates(config['registryPrefix'],tag)
    docker=str(trusted(config['docker']))
    if 'ecsAuth' in config:
        registry.need('dockerConfig' not in config,'AMBIGUOUS_REGISTRY_AUTH')
        runtime=trusted(os.environ.get('RUNTIME_DIRECTORY',''),directory=True,private=True)
        registry.need(runtime.parent==Path('/run') and runtime.name.startswith('wsx-image-'),'SYSTEMD_RUNTIME_DIRECTORY_REQUIRED')
        with ecs_docker_config(config['ecsAuth'],docker,config['registryPrefix'].split('/')[0],runtime) as docker_config:
            return deploy_config(environment,tag,config,docker,docker_config)
    docker_config=trusted(config['dockerConfig'],directory=True,private=True)
    # Existing root-managed Docker login is used only for pulling. Nothing is read from runner env.
    trusted(docker_config/'config.json',private=True)
    return deploy_config(environment,tag,config,docker,docker_config)

def schema_preflight(environment,tag,source,config,images,out,docker,roles=('api','agent')):
    """Read actual stopped-image inventories before downloading unrelated images.

    This only classifies a release. The image-only engine repeats all binding,
    config-hash and schema checks under the same lock before any mutation.
    """
    d=engine.Docker(docker)
    base=['compose','--project-name',config['project'],'--env-file',config['envFile']['path']]
    for row in config['composeFiles']: base+=['--file',row['path']]
    before={};after={};old={};new={}
    for role in roles:
        services=[service for service,value in config['services'].items() if value==role]
        registry.need(len(services)==1,'SCHEMA_SERVICE_AMBIGUOUS')
        service=services[0]
        ids=d.run(base+['ps','--quiet',service]).decode().split()
        registry.need(len(ids)==1,'EXISTING_CONTAINER_REQUIRED')
        rows=d.json(['container','inspect',ids[0]])
        registry.need(len(rows)==1,'LIVE_BINDING')
        value=rows[0];labels=value.get('Config',{}).get('Labels',{})
        registry.need(labels.get('com.docker.compose.project')==config['project'] and
                      labels.get('com.docker.compose.service')==service and
                      value.get('State',{}).get('Running') is True,'LIVE_BINDING')
        old[role]=value['Image'];new[role]=images[role]['imageId']
        before[role]=engine.schema(d,old[role],role,out)
        after[role]=engine.schema(d,new[role],role,out)
    return schema_plans.plan(environment,tag,source,old,new,before,after,roles)

def schema_release(environment,tag,config,manifest,schema_plan,attempt,state,lock,pending,previous=None):
    """Dispatch a separately admitted complete release, never waive engine.schema.

    The root-installed writer owns backup, hold/drain, exact migration, DB-aware
    recovery and activation. Its separately pinned verifier must consume actual
    proof files. A second independent runtime check runs here before commit.
    """
    services=config.get('services')
    registry.need(type(services) is dict and len(services) in (4,5) and
                  set(services.values())=={'api','web','agent','sandbox'} and
                  all(re.fullmatch('[a-z][a-z0-9_-]{0,40}',name) and name not in ('postgres','redis')
                      for name in services),'SCHEMA_APPLICATION_SERVICES')
    registry.need(schema_plan.get('environment')==environment and schema_plan.get('tag')==tag and
                  schema_plan.get('sourceRevision')==manifest.get('sourceRevision'),'SCHEMA_RELEASE_REQUEST_BINDING')
    def check_ref(ref):
        return engine.trusted_file(str(trusted(ref['path'])),ref['sha256'])
    policy=schema_handoff.validate_policy(schema_plan,config.get('schemaRelease'),check_ref)
    manifest_file=attempt/'manifest.json';engine.save(manifest_file,manifest)
    config_file=attempt/'schema-config.json';atomic(config_file,config)
    override=attempt/'images.json'
    engine.save(override,{'services':{service:{'image':manifest['images'][role]['imageId']}
                                    for service,role in config['services'].items()}})
    request={key:schema_plan[key] for key in ('environment','tag','sourceRevision','planSha256')}
    request.update(kind='schema-release-request-v1',manifestSha256=engine.sha_file(manifest_file),
                   manifest={'path':str(manifest_file),'sha256':engine.sha_file(manifest_file)},
                   schemaPlan={'path':str(attempt/'schema-plan.json'),'sha256':engine.sha_file(attempt/'schema-plan.json')},
                   config={'path':str(config_file),'sha256':engine.sha_file(config_file)},
                   canonicalLock={'path':config['lockFile'],'device':os.fstat(lock).st_dev,'inode':os.fstat(lock).st_ino})
    deadline=time.monotonic()+policy['timeoutSeconds']
    request['expiresAt']=int(time.time())+policy['timeoutSeconds']
    def remaining():
        value=deadline-time.monotonic()
        registry.need(value>1,'SCHEMA_RELEASE_DEADLINE')
        return value
    request_file=attempt/'schema-request.json';atomic(request_file,request)
    result_file=attempt/'schema-result.json'
    # Persist uncertainty before handing any capability to the full release.
    atomic(pending,{'tag':tag,'attempt':str(attempt),'route':'schema-preparation',
                    'requestSha256':engine.sha_file(request_file),'previous':previous,'automaticRetry':False})
    try:
        schema_handoff.invoke([policy['writer']['path']],request_file,result_file,remaining(),lock)
        trusted(result_file,private=True)
        result=schema_handoff.read_receipt(result_file);schema_handoff.verify_receipt(request,result)
        for proof in result['proofs'].values():
            registry.need(Path(proof['path']).resolve().is_relative_to(attempt.resolve()),'SCHEMA_PROOF_OUTSIDE_ATTEMPT')
            proof_path=trusted(proof['path'],private=True)
            registry.need(proof_path.stat().st_size<=1048576,'SCHEMA_PROOF_SIZE')
            check_ref(proof)
        result_hash=engine.sha_file(result_file)
        # The verifier is a read-only, independently reviewed executable; it
        # must reject stale/fixture receipts and inspect the actual DB/proofs.
        schema_handoff.invoke([policy['verifier']['path']],request_file,result_file,remaining(),lock)
        registry.need(engine.sha_file(result_file)==result_hash,'SCHEMA_VERIFIER_CHANGED_RECEIPT')
        for ref in [*config['composeFiles'],config['envFile']]: check_ref(ref)
        check_ref(policy['writer']);check_ref(policy['verifier'])
        d=engine.Docker(config['docker'])
        base=['compose','--project-name',config['project'],'--env-file',config['envFile']['path']]
        for ref in config['composeFiles']:base+=['--file',ref['path']]
        base+=['--file',str(override)]
        live=engine.verify_runtime(d,base,config['services'],
            {service:manifest['images'][role]['imageId'] for service,role in config['services'].items()},
            {**config,'readinessTimeoutSeconds':min(config.get('readinessTimeoutSeconds',120),int(remaining()))})
        atomic(state/'current.json',{'tag':tag,'sourceRevision':manifest['sourceRevision'],
                                    'path':str(override),'sha256':engine.sha_file(override)})
        final={'status':'SUCCEEDED','environment':environment,'tag':tag,'route':'schema-preparation',
               'sourceRevision':manifest['sourceRevision'],'schemaPlanComplete':True,'health':live,
               'schemaReceiptSha256':result_hash,'evidenceDirectory':str(attempt)}
        atomic(attempt/'receipt.json',final);pending.unlink()
        return final
    except Exception:
        # May include a committed DB change. Do NOT apply the image-only rollback,
        # clear intent, rerun SQL, or describe old images as recovered data.
        final={'status':'FAILED_OR_UNCERTAIN','code':'SCHEMA_RELEASE_RECONCILIATION_REQUIRED',
               'stage':'schema-release','environment':environment,'tag':tag,'automaticRetry':False,
               'evidenceDirectory':str(attempt)}
        atomic(attempt/'receipt.json',final)
        return final

def deploy_config(environment,tag,config,docker,docker_config):
    state=trusted(config['stateDirectory'],directory=True,private=True)
    lock_path=trusted(config['lockFile'],private=True)
    expected_lock={'devapp':'/run/workspacex-devapp-deploy.lock','cn':'/var/lib/workspacex-cn/runtime/release.lock','us':'/run/workspacex-selfhost-deploy.lock'}
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
        # Establish source using the two schema-bearing images first. CN/US
        # must not download Web/Sandbox/Postgres only to reject known schema drift.
        early=('api',) if environment in ('cn','us') else registry.SERVICES
        images={role:registry.resolve([docker,'--config',str(docker_config)],config['registryPrefix'],tag,role) for role in early}
        sources=[image.get('sourceRevision') for image in images.values()]
        registry.need(all(isinstance(source,str) and registry.SHA.fullmatch(source) for source in sources) and len(set(sources))==1,'IMAGE_SOURCE_MISMATCH')
        source=sources[0]
        attempt=state/('attempt-'+uuid.uuid4().hex);attempt.mkdir(mode=0o700)
        schema_plan=None
        if environment in ('cn','us'):
            baseline={**config,'composeFiles':compose_files}
            for roles in (('api',),('api','agent')):
                if 'agent' in roles:
                    images['agent']=registry.resolve([docker,'--config',str(docker_config)],config['registryPrefix'],tag,'agent')
                    registry.need(images['agent'].get('sourceRevision')==source,'IMAGE_SOURCE_MISMATCH')
                schema_plan=schema_preflight(environment,tag,source,baseline,images,attempt,docker,roles)
                atomic(attempt/'schema-plan.json',schema_plan)
                if schema_plan['route']!='image-only':
                    if config.get('schemaRelease') and schema_plan['route']=='schema-preparation':
                        continue
                    result={'status':'REJECTED','code':'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE',
                            'environment':environment,'tag':tag,'stage':'schema-preflight',
                            'route':schema_plan['route'],'schemaChanges':schema_plan['changes'],
                            'schemaPlanComplete':schema_plan.get('complete',False),
                            'uncheckedRoles':schema_plan.get('uncheckedRoles',[]),
                            'planSha256':schema_plan['planSha256'],'applyAttempted':False,
                            'evidenceDirectory':str(attempt),'nextAction':'PREPARE_REVIEWED_SCHEMA_RELEASE'}
                    atomic(attempt/'receipt.json',result)
                    return result
        for role in registry.SERVICES:
            if role not in images:
                images[role]=registry.resolve([docker,'--config',str(docker_config)],config['registryPrefix'],tag,role)
        registry.need(all(image.get('sourceRevision')==source for image in images.values()),'IMAGE_SOURCE_MISMATCH')
        if schema_plan and schema_plan['route']!='image-only':
            # This route owns the WHOLE release; the old image-only admission and
            # engine are never bypassed then reused on a changed database.
            return schema_release(environment,tag,{**config,'composeFiles':compose_files},
                {'kind':'registry-images-v1','sourceRevision':source,'tag':tag,'platform':'linux/amd64','images':images},
                schema_plan,attempt,state,lock,pending,current)
        if admission:
            # Fixed host adapter retains CN preactivation/backup/compatibility admission.
            with tempfile.TemporaryFile() as diagnostic:
                checked=subprocess.run([*admission,tag],stdout=subprocess.DEVNULL,stderr=diagnostic,timeout=120,
                                       env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8'})
                diagnostic.seek(0)
                code=schema_plans.admission_code(diagnostic.read(129))
            if checked.returncode!=0:
                result={'status':'REJECTED','code':code,'stage':'host-admission',
                        'environment':environment,'tag':tag,'applyAttempted':False,'evidenceDirectory':str(attempt)}
                atomic(attempt/'receipt.json',result)
                return result
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

def report_worker_result(unit):
    """Forward only the worker's structured outcome, without coupling its lifetime to CI pipes."""
    try:
        rows=subprocess.run(['/usr/bin/journalctl','--boot','--unit='+unit,'--output=cat','--no-pager','--lines=20'],
                            capture_output=True,text=True,timeout=10,env={'PATH':'/usr/bin:/bin'})
        for line in reversed(rows.stdout.splitlines()):
            try: result=json.loads(line)
            except ValueError: continue
            if not isinstance(result,dict) or result.get('status') not in ('SUCCEEDED','REJECTED','ROLLED_BACK','ROLLBACK_FAILED','DEPLOYMENT_FAILED','FAILED_OR_UNCERTAIN'):
                continue
            allowed=('status','code','environment','tag','evidenceDirectory','stage','applyAttempted','route','schemaChanges','schemaPlanComplete','uncheckedRoles','planSha256','nextAction')
            print(json.dumps({key:result[key] for key in allowed if key in result},sort_keys=True))
            return
    except (OSError,subprocess.TimeoutExpired): pass
    print(json.dumps({'status':'STATUS_REPORT_UNAVAILABLE','unit':unit}))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('environment',choices=('devapp','cn','us'));parser.add_argument('tag')
    parser.add_argument('--execute',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args()
    registry.need(os.geteuid()==0,'INSTALLED_ENTRY_REQUIRES_ROOT')
    registry.need(registry.TAG.fullmatch(args.tag),'INVALID_RELEASE_TAG')
    if not args.execute:
        # The worker outlives the Actions runner and performs recovery on cancellation.
        # systemd grants recovery time rather than letting runner shutdown kill it midway.
        unit='wsx-image-'+args.environment+'-'+uuid.uuid4().hex
        command=['/usr/bin/systemd-run','--wait','--collect','--quiet','--unit='+unit,
                 '--property=RuntimeMaxSec=900','--property=TimeoutStopSec=360','--property=KillMode=mixed',
                 '--property=RuntimeDirectory='+unit,'--property=RuntimeDirectoryMode=0700','--property=RuntimeDirectoryPreserve=no',
                 '/usr/bin/python3','-I','-B',str(Path(__file__).resolve()),args.environment,args.tag,'--execute']
        completed=subprocess.run(command,env={'PATH':'/usr/bin:/bin'},check=False)
        report_worker_result(unit)
        return completed.returncode
    result=deploy(args.environment,args.tag)
    print(json.dumps(result,sort_keys=True))
    return 0 if result['status']=='SUCCEEDED' else 1

if __name__=='__main__':
    try: raise SystemExit(main())
    except Exception as error:
        code=str(error) if isinstance(error,(ValueError,engine.Rejected)) else type(error).__name__
        print(json.dumps({'status':'DEPLOYMENT_FAILED','code':code}),file=sys.stderr)
        raise SystemExit(1)
