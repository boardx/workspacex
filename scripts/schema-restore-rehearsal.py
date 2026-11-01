#!/usr/bin/env python3
"""Isolated restore + exact reviewed billing SQL rehearsal; NEVER production apply.

No CLI accepts a database URL, SQL command, container or profile from a runner.
The future installed preparation adapter must supply independently bound source
snapshot/ledger/image facts. This module only writes a new network-none clone.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import time
import uuid

# Integrity pins are mechanically checked against the source SQL in unit tests.
# A changed or additional file requires a separate review, not filename approval.
MIGRATIONS={
 '20261031090000_billing_stripe_topups.sql':'4fad25595e048b4405629c3c84ece4e3ba8b1bc7b97eb6430a22b62dbfcfc633',
 '20261031091000_billing_wechat_monthly.sql':'b1915a85f1fb8973e81eb47ed8aacba88fca67f20b610c150e204a1ba077d561',
 '20261031150000_billing_subscription_amount_snapshot.sql':'9f8bbc4b1e23a80eba6a5743d3a314c8f872077597636acfb0b17e5bb8a0d43c',
}


def need(value,code):
    if not value:raise ValueError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def save(path,value):
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as stream:
        stream.write(raw);stream.flush();os.fsync(stream.fileno())
    parent=os.open(Path(path).parent,os.O_RDONLY)
    try:os.fsync(parent)
    finally:os.close(parent)


def quote_ident(value):
    need(type(value) is str and 0<len(value)<=128 and not any(ord(c)<32 or ord(c)==127 for c in value),'CLONE_ROLE_INVALID')
    return '"'+value.replace('"','""')+'"'


def reviewed_sql(files):
    need(type(files) is dict and set(files)==set(MIGRATIONS),'REVIEWED_MIGRATION_SET_REQUIRED')
    for name,raw in files.items():
        need(type(raw) is bytes and sha(raw)==MIGRATIONS[name],'REVIEWED_SQL_CHECKSUM_DRIFT')
    return [(name,files[name].decode('utf8')) for name in sorted(files)]


def check_ledger(ledger):
    need(type(ledger) is dict and bool(ledger),'BASELINE_LEDGER_REQUIRED')
    need(not (set(ledger)&set(MIGRATIONS)),'MIGRATION_ALREADY_RECORDED')
    for name,checksum in ledger.items():
        need(type(name) is str and re.fullmatch(r'[A-Za-z0-9_./-]+\.sql',name) and
             type(checksum) is str and re.fullmatch('[a-f0-9]{64}',checksum),'LEDGER_INVALID')


def private_backup_files(archive,key):
    for path in (Path(archive),Path(key)):
        value=path.lstat()
        need(stat.S_ISREG(value.st_mode) and value.st_uid==os.geteuid() and value.st_nlink==1 and
             stat.S_IMODE(value.st_mode)==0o600,'PRIVATE_BACKUP_FILE_REQUIRED')
    need(1024<Path(archive).stat().st_size<=128*1024*1024,'BACKUP_SIZE_LIMIT')
    with open(key,'rb') as stream:raw=stream.read(65)
    need(re.fullmatch(b'[a-f0-9]{64}',raw),'BACKUP_KEY_INVALID')


def file_sha(path):
    value=hashlib.sha256()
    with open(path,'rb') as stream:
        for raw in iter(lambda:stream.read(1048576),b''):value.update(raw)
    return value.hexdigest()


def pipe(command,next_command,output=None,timeout=120):
    """Wait both producers; never accept a successful final stage alone."""
    first=None;second=None
    try:
        first=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                               env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8'})
        kwargs={'preexec_fn':lambda:resource.setrlimit(resource.RLIMIT_FSIZE,(128*1024*1024,128*1024*1024))} if output is not None else {}
        second=subprocess.Popen(next_command,stdin=first.stdout,stdout=output or subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                                env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8'},**kwargs)
        first.stdout.close();deadline=time.monotonic()+timeout
        need(second.wait(timeout=max(.01,deadline-time.monotonic()))==0,'RESTORE_PIPELINE_FAILED')
        need(first.wait(timeout=max(.01,deadline-time.monotonic()))==0,'RESTORE_PIPELINE_FAILED')
        if output:output.flush();os.fsync(output.fileno())
    except (OSError,subprocess.TimeoutExpired):raise ValueError('RESTORE_PIPELINE_FAILED') from None
    finally:
        for child in (second,first):
            if child is not None and child.poll() is None:child.kill();child.wait()


def encrypt_dump(command,directory,openssl='/usr/bin/openssl'):
    """Internal source adapter primitive, not a runner-selected command API."""
    directory=Path(directory);key=directory/'backup.key';archive=directory/'database.pgdump.enc'
    fd=os.open(key,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as stream:stream.write(os.urandom(32).hex().encode());stream.flush();os.fsync(stream.fileno())
    fd=os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as out:
        pipe(command,[openssl,'enc','-aes-256-cbc','-pbkdf2','-salt','-pass','file:'+str(key)],out)
    need(archive.stat().st_size>1024,'BACKUP_TOO_SMALL')
    return archive,key


def rehearse(docker,image,archive,key,ledger,roles,files,output,openssl='/usr/bin/openssl'):
    """All SQL here targets ONLY a freshly created owned clone over docker exec.

    A host adapter must independently bind source backup, source DB identity,
    actual source ledger, exact target image/SQL and root policy before calling.
    This result deliberately does not authorize activation or prove old API/Agent
    compatibility, application grants, production owner privileges or recovery.
    """
    sql=reviewed_sql(files);check_ledger(ledger);private_backup_files(archive,key)
    archive_hash=file_sha(archive)
    need(type(image) is str and re.fullmatch('sha256:[a-f0-9]{64}',image),'IMMUTABLE_CLONE_IMAGE_REQUIRED')
    need(type(roles) is list and len(roles)<=100 and len(set(roles))==len(roles),'CLONE_ROLES_INVALID')
    for role in roles:quote_ident(role)
    spec=importlib.util.spec_from_file_location('restore_engine',Path(__file__).with_name('minimal-docker-release.py'))
    engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
    d=engine.Docker(docker);out=Path(output);out.mkdir(mode=0o700,exist_ok=False)
    inspected=d.json(['image','inspect',image]);need(len(inspected)==1 and inspected[0]['Id']==image,'CLONE_IMAGE_BINDING')
    config=inspected[0].get('Config',{});env=dict(v.split('=',1) for v in config.get('Env',[]) if '=' in v)
    need(env.get('PGDATA')=='/var/lib/postgresql/data' and set(config.get('Volumes',{}) or {})<={'/var/lib/postgresql/data'},'CLONE_DATA_LAYOUT_UNSUPPORTED')
    token=uuid.uuid4().hex;name='wsx-schema-restore-'+token;label='wsx.schema-rehearsal='+token
    save(out/'intent.json',{'name':name,'ownerLabel':label,'imageId':image,'network':'none','sourceDatabaseAccessed':False})
    cid=None;result=None;failure=None;cleanup=False
    def command(query):
        need(cid is not None,'CLONE_ID_REQUIRED')
        return [docker,'exec','--user','postgres','-i',cid,'psql','-X','-w','-v','ON_ERROR_STOP=1','-At','--username=postgres','--dbname=workspacex','-c',query]
    def query(value):
        return d.run(command(value)[1:],timeout=60).decode().strip()
    def actual_ledger():
        return json.loads(query("SELECT COALESCE(json_object_agg(name,checksum),'{}'::json) FROM public._kernel_migrations"))
    try:
        cid=d.run(['create','--pull=never','--name',name,'--label',label,'--network','none',
            '--read-only','--security-opt=no-new-privileges','--memory=1g','--cpus=1','--pids-limit=128',
            '--tmpfs','/tmp:rw,nosuid,nodev,size=32m','--tmpfs','/var/run/postgresql:rw,nosuid,nodev,size=16m',
            '--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=512m',
            '--env','POSTGRES_DB=workspacex','--env','POSTGRES_HOST_AUTH_METHOD=trust',image]).decode().strip()
        need(re.fullmatch('[a-f0-9]{64}',cid),'CLONE_ID_INVALID')
        value=d.json(['container','inspect',cid])[0]
        need(value['Image']==image and value['Config']['Labels'].get('wsx.schema-rehearsal')==token and
             value['HostConfig']['NetworkMode']=='none' and not value['HostConfig'].get('PortBindings') and
             not value['HostConfig'].get('Privileged') and not value['HostConfig'].get('Binds') and
             all(v.get('Type')=='tmpfs' for v in value.get('Mounts',[])),'CLONE_ISOLATION_INVALID')
        d.run(['start',cid]);deadline=time.monotonic()+60
        while True:
            try:
                query('SELECT 1');break
            except Exception:
                need(time.monotonic()<deadline,'CLONE_NOT_READY');time.sleep(.2)
        for role in roles:
            if role!='postgres' and not role.startswith('pg_'):query('CREATE ROLE '+quote_ident(role)+' NOLOGIN')
        # Plain dump bytes travel only through a kernel pipe, never to host disk.
        pipe([openssl,'enc','-d','-aes-256-cbc','-pbkdf2','-pass','file:'+str(key),'-in',str(archive)],
             [docker,'exec','--user','postgres','-i',cid,'pg_restore','--exit-on-error','--no-owner','--no-acl','--username=postgres','--dbname=workspacex'])
        need(file_sha(archive)==archive_hash,'BACKUP_CHANGED')
        need(actual_ledger()==ledger,'RESTORED_LEDGER_MISMATCH')
        save(out/'restored.json',{'status':'RESTORED','archiveSha256':archive_hash,
                                  'ledgerSha256':sha(json.dumps(ledger,sort_keys=True).encode()),'ledgerCount':len(ledger),'cloneImageId':image})
        statements=['BEGIN; SET LOCAL lock_timeout=\'5s\'; SET LOCAL statement_timeout=\'30s\';']
        for migration_name,body in sql:
            statements += [body,"INSERT INTO public._kernel_migrations(name,checksum) VALUES('"+migration_name+"','"+MIGRATIONS[migration_name]+"');"]
        statements+=['COMMIT;'];query('\n'.join(statements))
        need(actual_ledger()=={**ledger,**MIGRATIONS},'REHEARSED_LEDGER_MISMATCH')
        result={'status':'ISOLATED_RESTORE_AND_SQL_REHEARSED','scope':'restore-and-reviewed-sql-only',
                'migrationNames':sorted(MIGRATIONS),'cloneImageId':image,'postgresVersion':query('SHOW server_version'),'sourceDatabaseAccessed':False,
                'activationAllowed':False,'oldApiAcceptance':'NOT_PERFORMED','migrationRoleAcceptance':'NOT_PERFORMED'}
    except Exception as error:
        failure=str(error) if isinstance(error,(ValueError,engine.Rejected)) else 'REHEARSAL_FAILED'
        result={'status':'REHEARSAL_FAILED','code':failure,'activationAllowed':False,'sourceDatabaseAccessed':False}
    finally:
        try:
            # Reconcile by unique name even after a lost create acknowledgement.
            ids=d.run(['ps','--all','--no-trunc','--filter','label='+label,'--format','{{.ID}}']).decode().split()
            need(len(ids)<=1 and (cid is None or not ids or ids==[cid]),'CLONE_CLEANUP_AMBIGUOUS')
            for owned in ids:
                row=d.json(['container','inspect',owned])[0]
                need(row['Image']==image and row['Name']=='/'+name and row['Config']['Labels'].get('wsx.schema-rehearsal')==token,'CLONE_CLEANUP_OWNER')
                d.run(['rm','--force','--volumes',owned])
            need(not d.run(['ps','--all','--no-trunc','--filter','label='+label,'--format','{{.ID}}']).strip(),'CLONE_CLEANUP_UNPROVEN')
            cleanup=True
        except Exception:failure=failure or 'CLONE_CLEANUP_UNPROVEN'
        save(out/'cleanup.json',{'name':name,'ownerLabel':label,'removed':cleanup})
        if not cleanup:result={'status':'REHEARSAL_FAILED','code':failure,'activationAllowed':False}
        save(out/'receipt.json',result)
    need(failure is None,failure or 'REHEARSAL_FAILED')
    return result
