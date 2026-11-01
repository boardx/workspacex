#!/usr/bin/env python3
"""Isolated owner/ACL restoration and exact billing SQL; NEVER production apply.

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
_spec=importlib.util.spec_from_file_location('reviewed_schema_core',Path(__file__).with_name('schema-restore-rehearsal.py'))
_core=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_core)
MIGRATIONS=_core.MIGRATIONS


# Reuse audited pipe, encryption and file boundaries from the existing core.
need=_core.need
sha=_core.sha
save=_core.save
quote_ident=_core.quote_ident
reviewed_sql=_core.reviewed_sql
check_ledger=_core.check_ledger
private_backup_files=_core.private_backup_files
file_sha=_core.file_sha
pipe=_core.pipe
encrypt_dump=_core.encrypt_dump
clone_psql=_core.clone_psql

def role_sql(snapshot):
    need(type(snapshot) is dict and set(snapshot)>={'roles','memberships'} and set(snapshot)<={'roles','memberships','catalog','migrationRole'},'ROLE_SNAPSHOT_FIELDS')
    roles=snapshot['roles'];members=snapshot['memberships']
    need(type(roles) is list and len(roles)<=100 and type(members) is list and len(members)<=200,'ROLE_SNAPSHOT_BOUND')
    names=set();sql=[]
    for role in roles:
        need(type(role) is dict and set(role)=={'name','login','inherit','superuser','bypassrls','createrole','createdb','replication'},'ROLE_FIELDS')
        name=role['name'];quote_ident(name)
        need(name not in names and name!='postgres' and not name.startswith('pg_'),'SYSTEM_ROLE_COPY_FORBIDDEN');names.add(name)
        need(all(type(role[k]) is bool for k in role if k!='name'),'ROLE_BOOLEAN')
        need(not any(role[k] for k in ('superuser','bypassrls','createrole','createdb','replication')),'PRIVILEGED_ROLE_COPY_FORBIDDEN')
        sql.append('CREATE ROLE '+quote_ident(name)+(' LOGIN' if role['login'] else ' NOLOGIN')+(' INHERIT' if role['inherit'] else ' NOINHERIT')+' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;')
    for member in members:
        need(set(member)=={'role','member','admin','inherit','set'} and all(type(member[k]) is bool for k in ('admin','inherit','set')) and member['role'] in names and member['member'] in names,'MEMBERSHIP_AUTHORITY')
        sql.append('GRANT '+quote_ident(member['role'])+' TO '+quote_ident(member['member'])+' WITH ADMIN '+str(member['admin']).upper()+', INHERIT '+str(member['inherit']).upper()+', SET '+str(member['set']).upper()+';')
    return '\n'.join(sql)

# Names and ACL text, never catalog OIDs, are compared against source readback.
CATALOG_SQL="""SELECT COALESCE(json_object_agg(k,v),'{}'::json) FROM (
 SELECT 'relation:'||n.nspname||'.'||c.relname k,json_build_object('owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text) v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'column:'||c.relname||'.'||a.attname,json_build_object('acl',a.attacl::text) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',json_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 UNION ALL SELECT 'schema:public',json_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text) FROM pg_namespace WHERE nspname='public'
 UNION ALL SELECT 'default:'||pg_get_userbyid(d.defaclrole)||':'||COALESCE(n.nspname,'')||':'||d.defaclobjtype::text,json_build_object('acl',d.defaclacl::text) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
) x"""

def app_transaction():
    return """BEGIN;
SELECT 1/((current_user=session_user AND current_user='app_rw')::int);
SELECT count(*) FROM public.billing_orders;
SELECT count(*) FROM public.billing_monthly_orders;
INSERT INTO public.billing_orders(order_no,owner_type,owner_id,created_by,package_id,amount_fen,base_credits,bonus_credits,currency,provider,status,qr_code_url,expired_at)
SELECT 'bg20261101000000ABC123','user','wsx-acl-rehearsal-synthetic','wsx-acl-rehearsal-synthetic',package_id,18000,1,0,'CNY','stripe','PENDING','https://example.invalid/pay',now()+interval '1 hour' FROM public.credit_packages ORDER BY package_id LIMIT 1;
SELECT 1/(count(*)::int) FROM public.billing_orders WHERE order_no='bg20261101000000ABC123';
UPDATE public.billing_orders SET stripe_session_ref='cs_acl_rehearsal',qr_code_url='https://example.invalid/new' WHERE order_no='bg20261101000000ABC123';
INSERT INTO public.billing_monthly_orders(order_id,user_id,provider,session_ref,checkout_url,amount_minor,currency)
VALUES('00000000-0000-4000-8000-000000000607','wsx-acl-rehearsal-synthetic','wechat','bm20261101000000ABC123','https://example.invalid/checkout',18000,'CNY');
UPDATE public.billing_monthly_orders SET checkout_url='https://example.invalid/updated',amount_minor=18000,currency='CNY' WHERE order_id='00000000-0000-4000-8000-000000000607';
ROLLBACK;"""


def rehearse(docker,image,archive,key,ledger,snapshot,files,output,openssl='/usr/bin/openssl'):
    """All SQL here targets ONLY a freshly created owned clone over docker exec.

    A host adapter must independently bind source backup, source DB identity,
    actual source ledger, exact target image/SQL and root policy before calling.
    This result deliberately does not authorize activation or prove old API/Agent
    compatibility, application grants, production owner privileges or recovery.
    """
    sql=reviewed_sql(files);check_ledger(ledger);private_backup_files(archive,key)
    archive_hash=file_sha(archive)
    need(type(image) is str and re.fullmatch('sha256:[a-f0-9]{64}',image),'IMMUTABLE_CLONE_IMAGE_REQUIRED')
    roles_sql=role_sql(snapshot)
    need(type(snapshot.get('catalog')) is dict and snapshot['catalog'],'SOURCE_CATALOG_REQUIRED')
    need('app_rw' in {r['name'] for r in snapshot['roles']},'APP_ROLE_REQUIRED')
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
        return clone_psql(docker,cid,query)
    def query(value):
        return d.run(command(value)[1:],timeout=60).decode().strip()
    def role_query(value,role):
        need(role in {r['name'] for r in snapshot['roles'] if r['login']},'LOGIN_ROLE_REQUIRED')
        args=command(value);args=[('--username='+role) if item=='--username=postgres' else item for item in args]
        return d.run(args[1:],timeout=60).decode().strip()
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
        query(roles_sql)
        # Plain dump bytes travel only through a kernel pipe, never to host disk.
        pipe([openssl,'enc','-d','-aes-256-cbc','-pbkdf2','-pass','file:'+str(key),'-in',str(archive)],
             [docker,'exec','--user','postgres','-i',cid,'pg_restore','--exit-on-error','--username=postgres','--dbname=workspacex'])
        need(file_sha(archive)==archive_hash,'BACKUP_CHANGED')
        need(actual_ledger()==ledger,'RESTORED_LEDGER_MISMATCH')
        need(json.loads(query(CATALOG_SQL))==snapshot['catalog'],'SOURCE_OWNER_ACL_DRIFT')
        save(out/'restored.json',{'status':'RESTORED','archiveSha256':archive_hash,
                                  'ledgerSha256':sha(json.dumps(ledger,sort_keys=True).encode()),'ledgerCount':len(ledger),'cloneImageId':image})
        need(type(snapshot.get('migrationRole')) is str and snapshot['migrationRole'] in {r['name'] for r in snapshot['roles']},'MIGRATION_ROLE_REQUIRED')
        statements=['BEGIN; SET LOCAL lock_timeout=\'5s\'; SET LOCAL statement_timeout=\'30s\';']
        for migration_name,body in sql:
            statements += [body,"INSERT INTO public._kernel_migrations(name,checksum) VALUES('"+migration_name+"','"+MIGRATIONS[migration_name]+"');"]
        statements+=['COMMIT;'];role_query('\n'.join(statements),snapshot['migrationRole'])
        need(actual_ledger()=={**ledger,**MIGRATIONS},'REHEARSED_LEDGER_MISMATCH')
        role_query(app_transaction(),'app_rw')
        need(query("SELECT count(*) FROM billing_monthly_orders WHERE order_id='00000000-0000-4000-8000-000000000607'")=='0','APP_TRANSACTION_ROLLBACK_UNPROVEN')
        result={'status':'OWNER_ACL_SQL_REHEARSED','scope':'owner-acl-and-sql-only','appRoleTransactionRollback':True,'sourceOwnerAclRestored':True,'apiBootstrap':'NOT_PERFORMED',
                'migrationNames':sorted(MIGRATIONS),'cloneImageId':image,'postgresVersion':query('SHOW server_version'),'sourceDatabaseAccessed':False,
                'activationAllowed':False,'oldApiAcceptance':'NOT_PERFORMED','migrationRoleAcceptance':'EXACT_REVIEWED_SQL_LOGIN_ONLY','roleSettingsAcceptance':'NOT_PERFORMED'}
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
