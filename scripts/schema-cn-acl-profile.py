"""Explicit temporary CN clone-only source permission reproduction.

Not a production permission grant, approval object, or API compatibility verdict.
Default rehearsal remains conservative; only exact private original capture binds
this optional capability to one network-none clone and its immutable image.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
FILES={'intent.json','source-capture.json','snapshot.json','database.pgdump.enc','backup.key','receipt.json'}
def need(v,c):
 if not v:raise ValueError(c)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def trusted(path):
 p=Path(path);need(p.is_absolute(),'PROFILE_ABSOLUTE_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'PROFILE_ROOT_PATH')
 s=p.stat();need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and not s.st_mode&0o077,'PROFILE_PRIVATE_FILE');return p

def validate(path,archive,key,ledger,snapshot,image,now=None):
 now=time.time() if now is None else now
 profile=json.loads(trusted(path).read_bytes())
 need(set(profile)=={'kind','environment','source','tag','captureDirectory','files','imageId','createdAt'},'CN_PROFILE_FIELDS')
 need(profile['kind']=='cn-source-faithful-isolated-clone-v1' and profile['environment']=='cn' and profile['source']==SOURCE and profile['tag']==TAG,'CN_PROFILE_SCOPE')
 need(type(profile['createdAt']) in (int,float) and 0<=now-profile['createdAt']<1800,'CN_PROFILE_EXPIRED')
 need(profile['imageId']==image and re.fullmatch('sha256:[a-f0-9]{64}',image),'CN_PROFILE_IMAGE')
 directory=Path(profile['captureDirectory']);need(directory.is_absolute() and str(directory)==str(Path(archive).parent) and Path(key)==directory/'backup.key' and Path(archive)==directory/'database.pgdump.enc','CN_PROFILE_CAPTURE_PATH')
 need(set(profile['files'])==FILES,'CN_PROFILE_PROOF_SET')
 for name,digest in profile['files'].items():
  file=trusted(directory/name);need(type(digest) is str and re.fullmatch('[a-f0-9]{64}',digest) and sha(file.read_bytes())==digest,'CN_PROFILE_PROOF_DRIFT')
  need(0<=now-file.stat().st_mtime<1800,'CN_CAPTURE_EXPIRED')
 read=lambda name:json.loads(trusted(directory/name).read_bytes())
 intent=read('intent.json');capture=read('source-capture.json');receipt=read('receipt.json')
 need(intent.get('environment')=='cn' and intent.get('source')==SOURCE and intent.get('tag')==TAG,'CN_CAPTURE_INTENT')
 need(capture.get('database')=='workspacex_a1cb_20261006' and capture.get('role')=='migration_admin' and capture.get('ledger')==ledger,'CN_CAPTURE_IDENTITY')
 need(read('snapshot.json')==snapshot and snapshot['roles']==capture['roles'] and snapshot['memberships']==capture['memberships'] and snapshot['catalog']==capture['catalog'] and snapshot['migrationRole']=='migration_admin','CN_CAPTURE_SNAPSHOT')
 need(receipt.get('status')=='OWNER_ACL_SOURCE_CAPTURED' and receipt.get('environment')=='cn' and receipt.get('archiveSha256')==profile['files']['database.pgdump.enc'] and receipt.get('snapshotSha256')==profile['files']['snapshot.json'],'CN_CAPTURE_RECEIPT')
 return profile

def role_sql(snapshot,quote):
 fields={'name','login','inherit','superuser','bypassrls','createrole','createdb','replication'}
 need(type(snapshot['roles']) is list and len(snapshot['roles'])<=100,'CN_ROLE_BOUND')
 names=set();sql=[]
 for role in snapshot['roles']:
  need(set(role)==fields and all(type(role[k]) is bool for k in fields-{'name'}),'CN_ROLE_FIELDS')
  name=role['name'];quote(name);need(name not in names and not name.startswith('pg_'),'CN_ROLE_NAME');names.add(name)
  if name=='postgres':continue  # Never alter the clone's builtin identity.
  options=[('LOGIN','NOLOGIN','login'),('INHERIT','NOINHERIT','inherit'),('SUPERUSER','NOSUPERUSER','superuser'),('BYPASSRLS','NOBYPASSRLS','bypassrls'),('CREATEROLE','NOCREATEROLE','createrole'),('CREATEDB','NOCREATEDB','createdb'),('REPLICATION','NOREPLICATION','replication')]
  sql.append('CREATE ROLE '+quote(name)+' '+' '.join(yes if role[key] else no for yes,no,key in options)+';')
 need(len(snapshot['memberships'])<=200,'CN_MEMBER_BOUND')
 for edge in snapshot['memberships']:
  need(set(edge)=={'role','member','admin','inherit','set'} and all(type(edge[k]) is bool for k in ('admin','inherit','set')),'CN_MEMBER_FIELDS')
  a=edge['role'];b=edge['member'];quote(a);quote(b)
  if all(n=='postgres' or n.startswith('pg_') for n in (a,b)):continue
  need(all(n in names or n.startswith('pg_') for n in (a,b)) and b!='postgres','CN_MEMBER_AUTHORITY')
  sql.append('GRANT '+quote(a)+' TO '+quote(b)+' WITH ADMIN '+str(edge['admin']).upper()+', INHERIT '+str(edge['inherit']).upper()+', SET '+str(edge['set']).upper()+';')
 return '\n'.join(sql)

def isolation(row,cid,image,name,token,image_env):
 h=row.get('HostConfig',{});need(row.get('Id')==cid and row.get('Image')==image and row.get('Name')=='/'+name and row.get('Config',{}).get('Labels',{}).get('wsx.schema-rehearsal')==token,'CN_CLONE_OWNERSHIP')
 need(h.get('NetworkMode')=='none' and not h.get('PortBindings') and not h.get('Privileged') and not h.get('Binds') and not h.get('CapAdd') and h.get('ReadonlyRootfs') is True and 'ALL' in h.get('CapDrop',[]) and 'no-new-privileges' in h.get('SecurityOpt',[]) and row.get('Config',{}).get('User')=='postgres','CN_CLONE_ISOLATION')
 need(h.get('Memory')==1073741824 and h.get('PidsLimit')==128 and h.get('NanoCpus')==1000000000,'CN_CLONE_RESOURCE_LIMIT')
 need(all(m.get('Type')=='tmpfs' for m in row.get('Mounts',[])) and set(h.get('Tmpfs',{}))=={'/tmp','/var/run/postgresql','/var/lib/postgresql/data'},'CN_CLONE_MOUNTS')
 expected=dict(v.split('=',1) for v in image_env);expected.update(POSTGRES_HOST_AUTH_METHOD='trust',POSTGRES_DB='workspacex',PGDATA='/var/lib/postgresql/data/pgdata')
 actual=row['Config'].get('Env',[]);need(all('=' in v for v in actual) and len(actual)==len(dict(v.split('=',1) for v in actual)) and dict(v.split('=',1) for v in actual)==expected,'CN_CLONE_ENV')
 need(h.get('PidMode','') in ('','private') and h.get('IpcMode','') in ('','private') and not h.get('Devices') and not h.get('DeviceRequests'),'CN_CLONE_HOST_ACCESS')

def running_nonroot(raw):
 fields=dict(line.split(':',1) for line in raw.splitlines() if ':' in line)
 need('Uid' in fields and all(int(v)>0 for v in fields['Uid'].split()) and int(fields.get('CapEff','-1').strip(),16)==0 and fields.get('NoNewPrivs','').strip()=='1','CN_POSTGRES_OS_IDENTITY')

def readback(snapshot,actual_roles,actual_memberships,builtin_postgres=None):
 expected={r['name']:r for r in snapshot['roles']};actual={r['name']:r for r in actual_roles}
 need(len(expected)==len(snapshot['roles']) and len(actual)==len(actual_roles),'CN_ROLE_DUPLICATE')
 if 'postgres' not in expected:
  need(type(builtin_postgres) is dict and builtin_postgres.get('name')=='postgres' and actual.get('postgres')==builtin_postgres,'CN_SCAFFOLD_POSTGRES_DRIFT')
  actual.pop('postgres')  # Exactly one unchanged initial clone scaffolding role, never other extras.
 need(expected==actual,'CN_ROLE_READBACK_DRIFT')
 key=lambda x:(x['role'],x['member'])
 need(sorted(snapshot['memberships'],key=key)==sorted(actual_memberships,key=key),'CN_MEMBERSHIP_READBACK_DRIFT')
