#!/usr/bin/env python3
"""Root-only fixed CN/US owner/ACL-preserving source capture; no production DDL.

Captures original archive and password-free roles/catalog under the existing
release lock. CAPTURED is not restore/API/role compatibility acceptance.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import tempfile
import time
HERE=Path(__file__).resolve().parent
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
def need(v,c):
 if not v:raise ValueError(c)
def trusted(path,private=False):
 p=Path(path);need(p.is_absolute(),'ABSOLUTE_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_INPUT')
 need(p.is_file() and p.stat().st_nlink==1,'REGULAR_INPUT')
 if private:need(not p.stat().st_mode&0o077,'PRIVATE_INPUT')
 return p
def load(name):
 spec=importlib.util.spec_from_file_location(name,trusted(HERE/(name+'.py')));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def query_sql(catalog,migration_role):
 need(migration_role in ('migration_admin','postgres'),'FIXED_ROLE')
 # Capture postgres plus non-pg roles rather than silently dropping privileged or
 # provider roles. Rehearsal independently rejects unsupported authority.
 return """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object('database',current_database(),'role',current_user,
'bytes',pg_database_size(current_database()),'ledger',(SELECT COALESCE(json_object_agg(name,checksum),'{}'::json) FROM public._kernel_migrations),
'roles',(SELECT COALESCE(json_agg(json_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'superuser',rolsuper,'bypassrls',rolbypassrls,'createrole',rolcreaterole,'createdb',rolcreatedb,'replication',rolreplication) ORDER BY rolname),'[]'::json) FROM pg_roles WHERE left(rolname,3)<>'pg_'),
'memberships',(SELECT COALESCE(json_agg(json_build_object('role',r.rolname,'member',u.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option) ORDER BY r.rolname,u.rolname),'[]'::json) FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles u ON u.oid=a.member),
'roleSettings',(SELECT COALESCE(json_agg(json_build_object('role',COALESCE(r.rolname,''),'database',COALESCE(d.datname,''),'settings',s.setconfig)),'[]'::json) FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase WHERE s.setdatabase=0 OR d.datname=current_database()),
'catalog',("""+catalog+"""));
ROLLBACK;"""

def validate_capture(value,environment):
 identity={'cn':('workspacex_a1cb_20261006','migration_admin',192*1024*1024),'us':('workspacex','postgres',128*1024*1024)}[environment]
 need(set(value)=={'database','role','bytes','ledger','roles','memberships','roleSettings','catalog'},'CAPTURE_FIELDS')
 need((value['database'],value['role'])==identity[:2],'CAPTURE_DATABASE')
 need(type(value['bytes']) is int and 0<value['bytes']<=identity[2],'SOURCE_SIZE_UNQUALIFIED')
 need(type(value['roles']) is list and len(value['roles'])<=100 and type(value['memberships']) is list and len(value['memberships'])<=200,'ROLE_BOUND')
 fields={'name','login','inherit','superuser','bypassrls','createrole','createdb','replication'}
 need(all(type(r) is dict and set(r)==fields and type(r['name']) is str and all(type(r[k]) is bool for k in fields-{'name'}) for r in value['roles']),'ROLE_FIELDS')
 need(all(type(r) is dict and set(r)=={'role','member','admin','inherit','set'} and type(r['role']) is str and type(r['member']) is str and all(type(r[k]) is bool for k in ('admin','inherit','set')) for r in value['memberships']),'MEMBERSHIP_FIELDS')
 need(type(value['catalog']) is dict and 0<len(value['catalog'])<=50000 and type(value['roleSettings']) is list and len(value['roleSettings'])<=200,'CATALOG_BOUND')
 need(len(json.dumps(value).encode())<=8*1024*1024,'CAPTURE_SIZE_BOUND')
 return value

def cn_api_binding(env,host,database):
 need(env.get('PGHOST')==host and env.get('PGDATABASE')==database and env.get('PGPORT')=='5432' and env.get('APP_DB_USER')=='app_rw','CN_APP_BINDING')

def main():
 need(os.geteuid()==0 and len(sys.argv)==2 and sys.argv[1] in ('cn','us'),'ROOT_FIXED_ENVIRONMENT')
 environment=sys.argv[1]
 for name in ('schema-tag-prepare.py','schema-tag-prepare-cn.py','schema-restore-rehearsal.py','schema-acl-rehearsal.py','minimal-docker-release.py'):trusted(HERE/name)
 p=load('schema-tag-prepare');cn=load('schema-tag-prepare-cn');core=load('schema-restore-rehearsal');acl=load('schema-acl-rehearsal');engine=load('minimal-docker-release')
 config_path=trusted('/etc/workspacex-image-release/'+environment+'.json',True);cfg=json.loads(config_path.read_bytes())
 need(cfg['environment']==environment and cfg['lockFile']=={'cn':'/var/lib/workspacex-cn/runtime/release.lock','us':'/run/workspacex-selfhost-deploy.lock'}[environment],'CONFIG_BINDING')
 lockpath=p.trusted(cfg['lockFile'],private=True);fd=os.open(lockpath,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);a=os.fstat(fd);b=lockpath.stat();need((a.st_dev,a.st_ino)==(b.st_dev,b.st_ino) and stat.S_IMODE(a.st_mode)==0o600,'LOCK_DRIFT')
  state=p.trusted(cfg['stateDirectory'],private=True,directory=True);need(not (state/'pending.json').exists(),'RECONCILIATION_REQUIRED')
  for ref in (*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[])):engine.trusted_file(str(trusted(ref['path'])),ref['sha256'])
  d=engine.Docker(str(trusted(cfg['docker'])));api=p.live_service(d,cfg['project'],'api')
  if environment=='cn':
   cn.bind_env(p);env=p.env_map(api);cn_api_binding(env,cn.HOST,cn.DB)
   need(d.json(['image','inspect',cn.TOOL])[0]['Id']==cn.TOOL,'CN_TOOL_BINDING')
   sql=query_sql(acl.CATALOG_SQL,'migration_admin')
   def read():
    def execute(args):
     args[-1]=cn.SHELL+"exec psql --no-password -X -qAt -v ON_ERROR_STOP=1 -c '"+sql.replace("'","'\\''")+"'";return d.run(args[1:],timeout=45)
    return validate_capture(json.loads(cn.helper(d,'metadata',execute)),'cn')
   def dump(path):
    def execute(args):
     args[-1]=cn.SHELL+'exec pg_dump --no-password --format=custom';return core.encrypt_dump(args,path)
    return cn.helper(d,'dump',execute)
  else:
   pg=p.live_service(d,cfg['project'],'postgres');p.source_binding(api,pg);sql=query_sql(acl.CATALOG_SQL,'postgres')
   prefix=[cfg['docker'],'exec','--user','postgres',pg['Id'],'/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','PGOPTIONS=-c default_transaction_read_only=on']
   def read():return validate_capture(json.loads(d.run(prefix[1:]+['psql','--host=/var/run/postgresql','--port=5432','-X','-w','-qAt','--username=postgres','--dbname=workspacex','-v','ON_ERROR_STOP=1','-c',sql],timeout=45)),'us')
   def dump(path):return core.encrypt_dump(prefix+['pg_dump','--host=/var/run/postgresql','--port=5432','--no-password','--username=postgres','--dbname=workspacex','--format=custom'],path)
  before=read();core.check_ledger(before['ledger'])
  out=Path(tempfile.mkdtemp(prefix='acl-source-',dir=state));out.chmod(0o700)
  core.save(out/'intent.json',{'environment':environment,'source':SOURCE,'tag':TAG,'baselineApiContainerId':api['Id'],'baselineApiImageId':api['Image'],'createdAt':time.time(),'sourceDatabaseWriteAttempted':False})
  core.save(out/'source-capture.json',before)
  archive,key=dump(out);after=read()
  need(before['ledger']==after['ledger'] and before['catalog']==after['catalog'] and before['roles']==after['roles'] and before['memberships']==after['memberships'] and before['roleSettings']==after['roleSettings'] and p.live_service(d,cfg['project'],'api')['Id']==api['Id'],'SOURCE_DRIFT')
  if environment=='cn':cn.bind_env(p)
  else:need(p.live_service(d,cfg['project'],'postgres')['Id']==pg['Id'],'POSTGRES_SOURCE_DRIFT')
  for ref in (*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[])):engine.trusted_file(str(trusted(ref['path'])),ref['sha256'])
  snapshot={k:before[k] for k in ('roles','memberships','catalog')};snapshot['migrationRole']=before['role'];core.save(out/'snapshot.json',snapshot)
  core.save(out/'receipt.json',{'status':'OWNER_ACL_SOURCE_CAPTURED','scope':'readonly-preserved-owner-acl-source-only','environment':environment,'archiveSha256':core.file_sha(archive),'snapshotSha256':core.file_sha(out/'snapshot.json'),'sourceDatabaseWriteAttempted':False,'apiBootstrap':'NOT_PERFORMED','roleSettingsAcceptance':'NOT_PERFORMED','restoreAcceptance':'NOT_PERFORMED','activationAllowed':False})
  print(json.dumps({'status':'OWNER_ACL_SOURCE_CAPTURED','environment':environment,'evidenceDirectory':str(out),'activationAllowed':False}))
 finally:os.close(fd)
if __name__=='__main__':
 def interrupted(*_):raise RuntimeError('ACL_CAPTURE_INTERRUPTED')
 signal.signal(signal.SIGTERM,interrupted)
 try:main()
 except Exception as e:print(json.dumps({'status':'CAPTURE_FAILED','code':str(e) if isinstance(e,ValueError) and re.fullmatch('[A-Z0-9_]+',str(e)) else 'SOURCE_CAPTURE_FAILED','activationAllowed':False}));sys.exit(1)
