#!/usr/bin/env python3
"""Root-only local-Postgres source adapter for isolated tag rehearsal.

Does NOT migrate production, stop writers, activate images, grant sudo rights or
create a qualified prepared receipt. Managed CN source binding is not enabled.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shlex
import signal
import stat
import tarfile
import tempfile
import time
import uuid

HERE=Path(__file__).resolve().parent


def need(value,code):
    if not value:raise ValueError(code)


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


def trusted(path,private=False,directory=False):
    path=Path(path);need(path.is_absolute(),'ABSOLUTE_PATH_REQUIRED')
    for parent in (*reversed(path.parents),path):
        value=parent.lstat();need(not stat.S_ISLNK(value.st_mode) and value.st_uid==0 and not value.st_mode&0o022,'UNTRUSTED_PREPARE_PATH')
    value=path.stat();need(stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode) and value.st_nlink==1,'PREPARE_PATH_TYPE')
    if private:need(not value.st_mode&0o077,'PREPARE_PATH_PRIVATE_REQUIRED')
    return path


def installed_consumer():
    wrapper=trusted('/usr/local/bin/workspacex-image-release').read_text().splitlines()
    need(len(wrapper)>=2,'INSTALLED_CONSUMER_REQUIRED')
    files=[Path(value) for value in shlex.split(wrapper[1]) if value.endswith('/deploy-registry-images.py')]
    need(len(files)==1 and files[0].is_relative_to('/usr/local/lib/workspacex-image-release'),'INSTALLED_CONSUMER_REQUIRED')
    return load('installed_consumer',trusted(files[0]))


def inspect_one(docker,ident):
    values=docker.json(['container','inspect',ident]);need(len(values)==1,'CONTAINER_AMBIGUOUS');return values[0]


def live_service(docker,project,service):
    ids=docker.run(['ps','--no-trunc','--filter','label=com.docker.compose.project='+project,
                    '--filter','label=com.docker.compose.service='+service,'--format','{{.ID}}']).decode().split()
    need(len(ids)==1,'EXACT_LIVE_SERVICE_REQUIRED')
    value=inspect_one(docker,ids[0]);labels=value.get('Config',{}).get('Labels',{})
    need(value.get('Id')==ids[0] and value['State']['Running'] is True and labels.get('com.docker.compose.project')==project and
         labels.get('com.docker.compose.service')==service,'LIVE_SERVICE_BINDING')
    return value


def env_map(container):
    result={}
    for value in container.get('Config',{}).get('Env',[]):
        need(isinstance(value,str) and '=' in value,'RUNTIME_ENV_INVALID')
        key,text=value.split('=',1)
        need(key not in result,'RUNTIME_ENV_AMBIGUOUS')
        result[key]=text
    return result


def source_binding(api,source):
    source_env=env_map(source);api_env=env_map(api)
    api_networks=api.get('NetworkSettings',{}).get('Networks',{})
    source_networks=source.get('NetworkSettings',{}).get('Networks',{})
    shared=[network for name,network in source_networks.items()
            if name in api_networks and network.get('NetworkID') and
            network['NetworkID']==api_networks[name].get('NetworkID')]
    aliases={alias for network in shared for alias in network.get('Aliases',[]) or []}
    need(api_env.get('PGHOST') in aliases and api_env.get('PGPORT')=='5432' and
         api_env.get('PGDATABASE')=='workspacex' and
         source_env.get('POSTGRES_USER','postgres')=='postgres','LOCAL_DATABASE_BINDING_UNQUALIFIED')


# Fixed read-only statements. No caller-provided query or production DDL exists.
SOURCE_METADATA="""BEGIN READ ONLY;
SELECT json_build_object('database',current_database(),'role',current_user,
 'bytes',pg_database_size(current_database()),'serverVersion',current_setting('server_version_num'),
 'ledger',(SELECT COALESCE(json_object_agg(name,checksum),'{}'::json) FROM public._kernel_migrations),
 'roles',(SELECT COALESCE(json_agg(rolname),'[]'::json) FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname<>'postgres'));
ROLLBACK;"""


def read_source(docker,source,database):
    raw=docker.run(['exec','--user','postgres',source['Id'],'/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','psql','--host=/var/run/postgresql','--port=5432','-X','-w','-qAt','-v','ON_ERROR_STOP=1',
                    '--username=postgres','--dbname='+database,'-c',SOURCE_METADATA],timeout=30)
    value=json.loads(raw)
    need(value.get('database')==database and value.get('role')=='postgres','SOURCE_DATABASE_BINDING')
    need(type(value.get('bytes')) is int and 0<value['bytes']<=64*1024*1024,'SOURCE_DATABASE_SIZE_UNQUALIFIED')
    need(type(value.get('roles')) is list and len(value['roles'])<=100,'SOURCE_ROLES_UNQUALIFIED')
    return value


def exact_sql(docker,image,names,core):
    token=uuid.uuid4().hex;name='wsx-reviewed-sql-'+token;label='wsx.reviewed-sql='+token
    need(not docker.json(['image','inspect',image])[0].get('Config',{}).get('Volumes'),'API_PROBE_VOLUME_UNSUPPORTED')
    result={};cid=None
    try:
        cid=docker.run(['create','--pull=never','--name',name,'--label',label,'--network','none','--entrypoint','/bin/true',image]).decode().strip()
        need(re.fullmatch('[a-f0-9]{64}',cid),'API_PROBE_ID')
        for filename in names:
            raw=docker.run(['cp',cid+':/opt/workspacex/apps/api/migrations/'+filename,'-'],limit=4*1024*1024)
            with tarfile.open(fileobj=io.BytesIO(raw),mode='r:*') as archive:
                files=[value for value in archive if not value.isdir()]
                need(len(files)==1 and files[0].isfile() and files[0].size<1048576 and
                     Path(files[0].name).name==filename and '..' not in Path(files[0].name).parts,'SQL_ARCHIVE_INVALID')
                result[filename]=archive.extractfile(files[0]).read()
        core.reviewed_sql(result)
        return result
    finally:
        ids=docker.run(['ps','--all','--no-trunc','--filter','label='+label,'--format','{{.ID}}']).decode().split()
        need(len(ids)<=1 and (cid is None or not ids or ids==[cid]),'API_PROBE_CLEANUP_AMBIGUOUS')
        for ident in ids:
            value=inspect_one(docker,ident)
            need(value['Name']=='/'+name and value['Image']==image and not value['State']['Running'] and
                 value['Config']['Labels'].get('wsx.reviewed-sql')==token,'API_PROBE_CLEANUP_OWNER')
            docker.run(['rm',ident])
        need(not docker.run(['ps','--all','--no-trunc','--filter','label='+label,'--format','{{.ID}}']).strip(),'API_PROBE_CLEANUP_UNPROVEN')


def prepare_us(tag):
    need(os.geteuid()==0,'ROOT_PREPARATION_REQUIRED')
    for name in ('schema-tag-prepare.py','schema-restore-rehearsal.py','minimal-docker-release.py'):trusted(HERE/name)
    core=load('restore_rehearsal',HERE/'schema-restore-rehearsal.py')
    engine=load('prepare_engine',HERE/'minimal-docker-release.py')
    consumer=installed_consumer();need(consumer.registry.TAG.fullmatch(tag),'IMMUTABLE_TAG_REQUIRED')
    path=trusted('/etc/workspacex-image-release/us.json',private=True);config=json.loads(path.read_bytes())
    need(config.get('environment')=='us' and config['lockFile']=='/run/workspacex-selfhost-deploy.lock','ENVIRONMENT_BINDING')
    state=trusted(config['stateDirectory'],private=True,directory=True)
    lock_path=trusted(config['lockFile'],private=True)
    lock=os.open(lock_path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        opened=os.fstat(lock);named=lock_path.stat()
        need(stat.S_IMODE(opened.st_mode)==0o600 and (opened.st_dev,opened.st_ino)==(named.st_dev,named.st_ino),'CANONICAL_LOCK_DRIFT')
        need(not (state/'pending.json').exists(),'PRODUCTION_RECONCILIATION_REQUIRED')
        for ref in (*config['composeFiles'],config['envFile'],*config.get('verificationFiles',[])):
            engine.trusted_file(str(trusted(ref['path'])),ref['sha256'])
        docker_path=str(trusted(config['docker']));docker=engine.Docker(docker_path)
        service=[name for name,role in config['services'].items() if role=='api'];need(len(service)==1,'API_SERVICE_AMBIGUOUS')
        api=live_service(docker,config['project'],service[0]);source=live_service(docker,config['project'],'postgres')
        source_binding(api,source)
        target=consumer.registry.resolve(docker_path,config['registryPrefix'],tag,'api',pull=False)
        need(re.fullmatch('[a-f0-9]{40}',target.get('sourceRevision','')),'TARGET_SOURCE_BINDING')
        attempt=Path(tempfile.mkdtemp(prefix='prepare-rehearsal-',dir=state));attempt.chmod(0o700)
        core.save(attempt/'intent.json',{'kind':'source-bound-rehearsal-v1','environment':'us','tag':tag,
            'targetSourceRevision':target['sourceRevision'],'targetApiImageId':target['imageId'],
            'baselineApiImageId':api['Image'],'sourcePostgresContainerId':source['Id'],'sourcePostgresImageId':source['Image'],
            'toolSha256':core.file_sha(HERE/'schema-restore-rehearsal.py'),'prepareToolSha256':core.file_sha(HERE/'schema-tag-prepare.py'),
            'consumerPolicySha256':core.file_sha(path),'createdAt':time.time(),'activationAllowed':False})
        before=engine.schema(docker,api['Image'],'api',attempt);after=engine.schema(docker,target['imageId'],'api',attempt)
        need(len(before)==len(after)==1,'API_INVENTORY_AMBIGUOUS')
        baseline=next(iter(before.values()));candidate=next(iter(after.values()))
        need(set(candidate)==set(baseline)|set(core.MIGRATIONS) and not set(baseline)&set(core.MIGRATIONS) and
             all(candidate.get(name)==checksum for name,checksum in baseline.items()) and
             all(candidate.get(name)==checksum for name,checksum in core.MIGRATIONS.items()),'REVIEWED_ADDITIVE_SET_REQUIRED')
        metadata=read_source(docker,source,'workspacex');need(metadata['ledger']==baseline,'LIVE_LEDGER_IMAGE_MISMATCH')
        core.save(attempt/'source-snapshot.json',metadata)
        files=exact_sql(docker,target['imageId'],core.MIGRATIONS,core)
        archive,key=core.encrypt_dump([docker_path,'exec','--user','postgres',source['Id'],'/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','pg_dump',
            '--host=/var/run/postgresql','--port=5432','--no-password',
            '--format=custom','--no-owner','--no-acl','--username=postgres','--dbname=workspacex'],attempt)
        result=core.rehearse(docker_path,source['Image'],archive,key,baseline,metadata['roles'],files,attempt/'isolated')
        fresh=read_source(docker,source,'workspacex')
        need(fresh['ledger']==baseline and live_service(docker,config['project'],service[0])['Image']==api['Image'] and
             live_service(docker,config['project'],'postgres')['Id']==source['Id'],'SOURCE_DRIFT_DURING_REHEARSAL')
        final={**result,'environment':'us','tag':tag,'targetSourceRevision':target['sourceRevision'],
               'evidenceDirectory':str(attempt),'sourceLedgerCountBefore':len(baseline),'sourceLedgerCountAfter':len(fresh['ledger']),
               'sourceReadOnlyTransactions':True,'writersStopped':False,'activationAllowed':False,
               'sourceDatabaseAccessed':True,'sourceDatabaseWriteAttempted':False}
        core.save(attempt/'receipt.json',final);return final
    finally:os.close(lock)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('environment',choices=('us',));parser.add_argument('tag');args=parser.parse_args()
    def interrupted(*_):raise InterruptedError('PREPARATION_INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupted)
    try:
        result=prepare_us(args.tag);print(json.dumps(result,sort_keys=True));return 0
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z0-9_]{1,100}',str(error)) else 'SCHEMA_PREPARATION_FAILED'
        print(json.dumps({'status':'REHEARSAL_FAILED','code':code,'activationAllowed':False}));return 1

if __name__=='__main__':raise SystemExit(main())
