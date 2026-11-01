#!/usr/bin/env python3
"""Fixed CN RDS transaction adapter, only under inherited maintenance lock."""
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import uuid
import time
HERE=Path(__file__).resolve().parent
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
def need(v,c):
 if not v:raise ValueError(c)
def trusted(path):
 import stat
 path=Path(path)
 for p in (*reversed(path.parents),path):
  s=p.lstat();need(not stat.S_ISLNK(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'CODE_TRUST')
 need(path.is_file(),'CODE_FILE');return path

def load(name):
 p=trusted(HERE/(name+'.py'));s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def drained(value):
 need(value['status'] in ('BASELINE','COMPLETE'),'DRAIN_LEDGER_DRIFT')
 return {**value,'status':'DRAINED','ledgerStatus':value['status']}

class Adapter:
 def __init__(self,attempt,fd):
  for name in ('schema-tag-prepare-cn.py','schema-tag-prepare.py','schema-restore-rehearsal.py','minimal-docker-release.py','us-tag-migration-adapter.py','tag-reviewed-migration-driver.mjs'):trusted(HERE/name)
  self.cn=load('schema-tag-prepare-cn');self.p=load('schema-tag-prepare');self.core=load('schema-restore-rehearsal');self.us=load('us-tag-migration-adapter');engine=load('minimal-docker-release')
  self.us.inherited_lock(fd,'/var/lib/workspacex-cn/runtime/release.lock');self.cn.bind_env(self.p)
  self.attempt=self.p.trusted(attempt,private=True,directory=True);self.policy=json.loads(self.p.trusted(self.attempt/'policy.json',private=True).read_bytes())
  need(self.policy['source']==SOURCE and self.policy['tag']==TAG and self.policy['environment']=='cn','POLICY_IDENTITY')
  self.db=self.policy['cnDatabase'];self.base=self.db['baselineLedger'];self.core.check_ledger(self.base)
  self.d=engine.Docker('/usr/bin/docker');self.image=self.db['baselineApiImageId']
  need(re.fullmatch('sha256:[a-f0-9]{64}',self.image),'BASELINE_API_ID')
  need(self.policy['baseline']['api']['imageId']==self.image,'BASELINE_API_BINDING')
 def stopped(self):
  proxy=object.__new__(self.us.Adapter);proxy.p=self.policy;proxy.d=self.d;proxy.stopped()
 def files(self):return self.p.exact_sql(self.d,self.db['targetApiImageId'],self.core.MIGRATIONS,self.core)
 def execute(self,mode):
  need(mode in ('preflight','reconcile','apply','drain'),'MODE');files=self.files();self.cn.bind_env(self.p)
  engine=trusted(HERE/'tag-reviewed-migration-driver.mjs').read_text().replace('export const ','const ').replace('export function ','function ').replace('export async function ','async function ')
  script="import pg from 'pg';import fs from 'node:fs';import {migrationConfig} from './src/infrastructure/db/pg-config.ts';\n"+engine+"\nconst x=JSON.parse(fs.readFileSync(0,'utf8'));const cfg=migrationConfig();if(cfg.host!=="+json.dumps(self.cn.HOST)+"||cfg.database!=="+json.dumps(self.cn.DB)+"||cfg.user!=='migration_admin'||cfg.port!==5432)throw new Error('DB_BINDING');const c=new pg.Client({...cfg,connectionTimeoutMillis:10000});try{await c.connect();if(x.drain){await c.query('BEGIN READ ONLY');const n=(await c.query(\"SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'\")).rows[0].n;const t=(await c.query('SELECT count(*)::int n FROM pg_prepared_xacts WHERE database=current_database()')).rows[0].n;await c.query('ROLLBACK');if(n!==0||t!==0)throw new Error('DRAIN');}const r=await executeReviewedMigration({client:c,mode:x.mode,plan:x.plan,files:x.files});console.log(JSON.stringify(r));}finally{await c.end();}"
  payload={'mode':'preflight' if mode=='drain' else mode,'drain':mode=='drain','plan':{'environment':'cn','source':SOURCE,'tag':TAG,'baselineLedger':self.base,'database':self.cn.DB,'role':'migration_admin'},'files':{k:v.decode() for k,v in files.items()}}
  token=uuid.uuid4().hex;name='wsx-cn-tag-db-'+token;label='wsx.cn.tagdb='+token
  args=['/usr/bin/docker','run','--rm','--pull=never','--name',name,'--label',label,'--network',self.cn.NETWORK,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--pids-limit=128','--tmpfs','/tmp:rw,nosuid,nodev,size=32m','--env-file',self.cn.ENV,'--entrypoint','node','-i',self.image,'--import','tsx','--input-type=module','-e',script]
  try:
   r=subprocess.run(args,input=json.dumps(payload).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=150)
   need(r.returncode==0,'CN_DATABASE_PROCESS_UNCERTAIN');v=json.loads(r.stdout)
   if mode=='drain':v=drained(v)
   return v
  finally:
   ids=self.d.run(['ps','--all','--no-trunc','--filter','label='+label,'--format','{{.ID}}']).decode().split();need(len(ids)<=1,'HELPER_AMBIGUOUS')
   for cid in ids:
    x=self.p.inspect_one(self.d,cid);need(x['Id']==cid and x['Name']=='/'+name and x['Image']==self.image and x['Config']['Labels'].get('wsx.cn.tagdb')==token and x['HostConfig']['NetworkMode']==self.cn.NETWORK,'HELPER_OWNER');self.d.run(['rm','--force',cid])
   need(not self.d.run(['ps','--all','--no-trunc','--filter','label='+label,'--format','{{.ID}}']).strip(),'HELPER_CLEANUP_UNPROVEN')
 def backup_identity(self):
  return {'environment':'cn','source':SOURCE,'tag':TAG,'database':self.cn.DB,'role':'migration_admin','attempt':str(self.attempt),'managedDatabaseHost':self.cn.HOST,'postgresImageId':self.cn.TOOL,'baselineApiImageId':self.image,'targetApiImageId':self.db['targetApiImageId'],'ledgerSha256':self.core.sha(json.dumps(self.base,sort_keys=True).encode())}
 def require_backup(self):return self.us.validate_backup(self.attempt,self.backup_identity(),self.core,self.p.trusted)
 def run(self,mode):
  if mode=='apply':self.require_backup()
  if mode in ('drain','apply','prepare'):self.stopped()
  if mode=='prepare':
   need(self.execute('drain').get('ledgerStatus')=='BASELINE','SOURCE_DRAIN_BASELINE')
   path=self.attempt/'stopped-backup';path.mkdir(mode=0o700);metadata=self.cn.read_source(self.d);need(metadata['ledger']==self.base,'BACKUP_LEDGER')
   archive,key=self.cn.helper(self.d,'dump',lambda args:self.core.encrypt_dump(args,path))
   self.core.rehearse('/usr/bin/docker',self.cn.TOOL,archive,key,self.base,metadata['roles'],self.files(),path/'isolated')
   self.stopped();need(self.execute('drain').get('ledgerStatus')=='BASELINE','POST_BACKUP_BASELINE')
   names=['database.pgdump.enc','backup.key','isolated/intent.json','isolated/restored.json','isolated/receipt.json','isolated/cleanup.json']
   self.core.save(path/'qualification.json',{'identity':self.backup_identity(),'preparedAt':time.time(),'files':{name:self.core.file_sha(path/name) for name in names}})
   self.require_backup()
   return {'status':'BACKUP_RESTORE_VERIFIED','writersStopped':True,'encryptedArchiveSha256':self.core.file_sha(archive)}
  if mode=='apply':
   need(self.execute('preflight')['status']=='BASELINE','PRE_APPLY_BASELINE')
   self.core.save(self.attempt/'database-transaction-intent.json',{'source':SOURCE,'tag':TAG,'environment':'cn','status':'TRANSACTION_INTENT'})
   try:return self.execute(mode)
   except Exception:return {'status':'COMMIT_UNKNOWN_RECONCILE_REQUIRED'}
  return self.execute(mode)
def main():
 need(os.geteuid()==0 and len(sys.argv)==3,'ROOT_MODE_REQUIRED');mode,attempt=sys.argv[1:]
 def interrupted(*_):raise RuntimeError('CN_ADAPTER_INTERRUPTED')
 signal.signal(signal.SIGTERM,interrupted)
 result=Adapter(attempt,int(os.environ.get('WSX_RELEASE_LOCK_FD','-1'))).run(mode);result.update(source=SOURCE,tag=TAG,environment='cn');print(json.dumps(result));return 0 if result['status'] in ('BASELINE','COMPLETE','DRAINED','COMMITTED','BACKUP_RESTORE_VERIFIED') else 1
if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception:print(json.dumps({'status':'FAILED','code':'CN_ADAPTER_FAILED'}));raise SystemExit(1)
