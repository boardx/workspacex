#!/usr/bin/env python3
"""CN fixed source read-only backup and isolated restore; never production DDL."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import signal
import sys
import tempfile
import uuid

HERE=Path(__file__).resolve().parent
DB='workspacex_a1cb_20261006'
HOST='pgm-uf6rg214cp381149.rwlb.rds.aliyuncs.com'
ENV='/var/lib/workspacex-cn/runtime/a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0-newdb-20261006/migration.env'
ENV_SHA='d0199bc4e0674ea70348832b4fd82fe2be695253bcbc2ae0447eb45094510773'
TOOL='sha256:af6e55371441513bbe1093a588ff4b2b5c9dbc3c96e2b8e432f4ee1a283973c'
NETWORK='workspacex-cn-runtime'

def need(ok,code):
    if not ok:raise ValueError(code)

def trusted(path):
    path=Path(path);need(path.is_absolute(),'ABSOLUTE_PATH_REQUIRED')
    for parent in (*reversed(path.parents),path):
        item=parent.lstat()
        need(not stat.S_ISLNK(item.st_mode) and item.st_uid==0 and not item.st_mode&0o022,'UNTRUSTED_PREPARE_PATH')
    item=path.stat();need(stat.S_ISREG(item.st_mode) and item.st_nlink==1,'PREPARE_PATH_TYPE')
    return path


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/(name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

def bind_env(p):
    raw=p.trusted(ENV,private=True).read_bytes()
    need(hashlib.sha256(raw).hexdigest()==ENV_SHA,'CN_ENV_PIN')
    values={}
    for line in raw.decode().splitlines():
        if not line or line.startswith('#'):continue
        key,sep,value=line.partition('=');need(sep and key not in values,'CN_ENV_AMBIGUOUS');values[key]=value
    need(values.get('PGHOST')==HOST and values.get('PGDATABASE')==DB and values.get('PGPORT','5432')=='5432' and
         values.get('MIGRATION_DB_USER')=='migration_admin' and values.get('MIGRATION_DB_PASSWORD'),'CN_DATABASE_BINDING')
    # Actual installed API uses disable. Do not silently alter a configured TLS mode.
    need(values.get('PGSSLMODE','disable')=='disable','CN_TLS_PROFILE_REQUIRES_REVIEW')

# Credentials stay in container environment and never enter argv or output.
SHELL='export PGUSER="$MIGRATION_DB_USER" PGPASSWORD="$MIGRATION_DB_PASSWORD" PGSSLMODE=disable PGCONNECT_TIMEOUT=10 PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=30000"; '
QUERY="BEGIN READ ONLY; SELECT json_build_object('database',current_database(),'role',current_user,'bytes',pg_database_size(current_database()),'ledger',(SELECT json_object_agg(name,checksum) FROM public._kernel_migrations),'roles',(SELECT json_agg(rolname) FROM pg_roles WHERE rolname='app_rw')); ROLLBACK;"

def command(operation):
    need(operation in ('metadata','dump'),'CN_FIXED_OPERATION')
    args=['/usr/bin/docker','run','--rm','--pull=never','--network',NETWORK,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--pids-limit=128','--tmpfs','/tmp:rw,nosuid,nodev,size=32m','--env-file',ENV,'--entrypoint','/bin/sh',TOOL,'-c']
    if operation=='dump':tail='exec pg_dump --no-password --format=custom --no-owner --no-acl'
    else:tail='exec psql --no-password -X -qAt -v ON_ERROR_STOP=1 -c '+"'"+QUERY.replace("'","'\\''")+"'"
    return args+[SHELL+tail]

def helper(docker,operation,execute):
    token=uuid.uuid4().hex;name='wsx-cn-source-'+token;label='wsx.cn.source='+token
    args=command(operation);args[2:2]=['--name',name,'--label',label]
    try:return execute(args)
    finally:
        ids=docker.run(['ps','--all','--no-trunc','--filter','label='+label,'--format','{{.ID}}']).decode().split()
        need(len(ids)<=1,'CN_HELPER_AMBIGUOUS')
        for cid in ids:
            values=docker.json(['container','inspect',cid]);need(len(values)==1,'CN_HELPER_INSPECT')
            value=values[0]
            need(value.get('Id')==cid and value.get('Name')=='/'+name and value.get('Image')==TOOL and
                 value.get('HostConfig',{}).get('NetworkMode')==NETWORK and
                 value.get('Config',{}).get('Labels',{}).get('wsx.cn.source')==token,'CN_HELPER_OWNER')
            docker.run(['rm','--force',cid])
        need(not docker.run(['ps','--all','--no-trunc','--filter','label='+label,'--format','{{.ID}}']).strip(),'CN_HELPER_CLEANUP_UNPROVEN')


def read_source(docker):
    value=json.loads(helper(docker,'metadata',lambda args:docker.run(args[1:],timeout=45)))
    need(value.get('database')==DB and value.get('role')=='migration_admin','CN_CONNECTED_IDENTITY')
    need(type(value.get('bytes')) is int and 0<value['bytes']<=64*1024*1024,'CN_SOURCE_SIZE_UNQUALIFIED')
    need(value.get('roles')==['app_rw'],'CN_APP_ROLE_REQUIRED');return value

def prepare(tag):
    need(os.geteuid()==0,'ROOT_PREPARATION_REQUIRED')
    for name in ('schema-tag-prepare-cn','schema-tag-prepare','schema-restore-rehearsal','minimal-docker-release'):trusted(HERE/(name+'.py'))
    p=load('schema-tag-prepare');core=load('schema-restore-rehearsal');engine=load('minimal-docker-release')
    consumer=p.installed_consumer();need(consumer.registry.TAG.fullmatch(tag),'IMMUTABLE_TAG_REQUIRED')
    cfgpath=p.trusted('/etc/workspacex-image-release/cn.json',private=True);cfg=json.loads(cfgpath.read_bytes())
    need(cfg['environment']=='cn' and cfg['lockFile']=='/var/lib/workspacex-cn/runtime/release.lock','CN_CONFIG_BINDING')
    lockpath=p.trusted(cfg['lockFile'],private=True);fd=os.open(lockpath,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);opened=os.fstat(fd);named=lockpath.stat()
        need((opened.st_ino,opened.st_dev)==(named.st_ino,named.st_dev) and stat.S_IMODE(opened.st_mode)==0o600,'CN_LOCK_DRIFT')
        state=p.trusted(cfg['stateDirectory'],private=True,directory=True);need(not (state/'pending.json').exists(),'PRODUCTION_RECONCILIATION_REQUIRED')
        bind_env(p);docker=engine.Docker(str(p.trusted(cfg['docker'])))
        for ref in (*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[])):engine.trusted_file(str(p.trusted(ref['path'])),ref['sha256'])
        tool=docker.json(['image','inspect',TOOL]);need(len(tool)==1 and tool[0]['Id']==TOOL,'CN_TOOL_IDENTITY')
        api=p.live_service(docker,cfg['project'],'api');env=p.env_map(api)
        need(env.get('PGHOST')==HOST and env.get('PGDATABASE')==DB and env.get('PGPORT')=='5432' and env.get('APP_DB_USER')=='app_rw','CN_APP_DATABASE_BINDING')
        target=consumer.registry.resolve(cfg['docker'],cfg['registryPrefix'],tag,'api',pull=False)
        need(re.fullmatch('[a-f0-9]{40}',target.get('sourceRevision','')),'TARGET_SOURCE_BINDING')
        attempt=Path(tempfile.mkdtemp(prefix='cn-source-rehearsal-',dir=state));attempt.chmod(0o700)
        core.save(attempt/'intent.json',{'environment':'cn','tag':tag,'target':target,'baselineApiImageId':api['Image'],'activationAllowed':False})
        before=engine.schema(docker,api['Image'],'api',attempt);after=engine.schema(docker,target['imageId'],'api',attempt)
        need(len(before)==len(after)==1,'API_INVENTORY_AMBIGUOUS');baseline=next(iter(before.values()));candidate=next(iter(after.values()))
        core.check_ledger(baseline)
        need(candidate=={**baseline,**core.MIGRATIONS},'REVIEWED_ADDITIVE_SET_REQUIRED')
        metadata=read_source(docker);need(metadata['ledger']==baseline,'LIVE_LEDGER_IMAGE_MISMATCH')
        core.save(attempt/'source-snapshot.json',metadata);files=p.exact_sql(docker,target['imageId'],core.MIGRATIONS,core)
        archive,key=helper(docker,'dump',lambda args:core.encrypt_dump(args,attempt))
        result=core.rehearse(cfg['docker'],TOOL,archive,key,baseline,metadata['roles'],files,attempt/'isolated')
        bind_env(p);fresh=read_source(docker)
        need(fresh['ledger']==baseline and p.live_service(docker,cfg['project'],'api')['Id']==api['Id'],'SOURCE_DRIFT_DURING_REHEARSAL')
        receipt={**result,'environment':'cn','tag':tag,'evidenceDirectory':str(attempt),'sourceDatabaseWriteAttempted':False,'activationAllowed':False,'writersStopped':False}
        core.save(attempt/'receipt.json',receipt);return receipt
    finally:os.close(fd)

def install_signal_handler():
    def interrupted(*_):raise InterruptedError('CN_PREPARATION_INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupted)


if __name__=='__main__':
    install_signal_handler()
    try:
        need(len(sys.argv)==2,'TAG_REQUIRED');print(json.dumps(prepare(sys.argv[1]),sort_keys=True))
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z0-9_]{1,100}',str(error)) else 'CN_REHEARSAL_FAILED'
        print(json.dumps({'status':'REHEARSAL_FAILED','code':code,'activationAllowed':False}));sys.exit(1)
