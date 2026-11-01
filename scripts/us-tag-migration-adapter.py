#!/usr/bin/env python3
"""Fixed US local PostgreSQL adapter for root reviewed maintenance only."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import signal
import hashlib
HERE=Path(__file__).resolve().parent
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
def need(v,c):
 if not v:raise ValueError(c)
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def trusted_closure(path):
 p=Path(path);need(p.is_absolute(),'ROOT_CLOSURE_REQUIRED')
 for item in (*reversed(p.parents),p):
  v=item.lstat();need(v.st_uid==0 and not stat.S_ISLNK(v.st_mode) and not v.st_mode&0o022,'ROOT_CLOSURE_REQUIRED')
 need(p.is_file() and p.stat().st_nlink==1,'ROOT_CLOSURE_REQUIRED');return p

def validate_backup(attempt,expected,core,trusted,now=None):
 """Shared CN/US proof interface: fixed same-attempt original files, not status alone."""
 now=time.time() if now is None else now
 directory=Path(attempt)/'stopped-backup'
 proof=json.loads(trusted(directory/'qualification.json',private=True).read_bytes())
 need(proof.get('identity')==expected,'BACKUP_SOURCE_BINDING')
 need(type(proof.get('preparedAt')) in (int,float) and 0<=now-proof['preparedAt']<1800,'BACKUP_EXPIRED')
 required={'database.pgdump.enc','backup.key','isolated/intent.json','isolated/restored.json','isolated/receipt.json','isolated/cleanup.json'}
 need(set(proof.get('files',{}))==required,'BACKUP_PROOF_SET')
 for name,checksum in proof['files'].items():
  path=trusted(directory/name,private=True);need(core.file_sha(path)==checksum,'BACKUP_PROOF_HASH')
 core.private_backup_files(directory/'database.pgdump.enc',directory/'backup.key')
 read=lambda name:json.loads(trusted(directory/name,private=True).read_bytes())
 restored=read('isolated/restored.json');receipt=read('isolated/receipt.json');cleanup=read('isolated/cleanup.json');intent=read('isolated/intent.json')
 need(restored.get('status')=='RESTORED' and restored.get('archiveSha256')==proof['files']['database.pgdump.enc'] and restored.get('ledgerSha256')==expected['ledgerSha256'] and restored.get('cloneImageId')==expected['postgresImageId'],'RESTORED_SOURCE_BINDING')
 need(receipt.get('status')=='ISOLATED_RESTORE_AND_SQL_REHEARSED' and receipt.get('cloneImageId')==expected['postgresImageId'] and receipt.get('migrationNames')==sorted(core.MIGRATIONS),'RESTORE_SQL_UNQUALIFIED')
 need(intent.get('imageId')==expected['postgresImageId'] and intent.get('network')=='none' and cleanup.get('removed') is True and cleanup.get('name')==intent.get('name') and cleanup.get('ownerLabel')==intent.get('ownerLabel'),'RESTORE_CLEANUP_UNPROVEN')
 return proof

def inherited_lock(fd,canonical='/run/workspacex-selfhost-deploy.lock'):
 need(type(fd) is int and fd>=3,'INHERITED_LOCK_REQUIRED')
 opened=os.fstat(fd);named=os.lstat(canonical)
 need(stat.S_ISREG(named.st_mode) and named.st_uid==0 and stat.S_IMODE(named.st_mode)==0o600 and
      (opened.st_dev,opened.st_ino)==(named.st_dev,named.st_ino),'CANONICAL_LOCK_BINDING')
 need(re.search(r'^lock:.*FLOCK\s+ADVISORY\s+WRITE',Path('/proc/self/fdinfo/'+str(fd)).read_text(),re.MULTILINE),'INHERITED_LOCK_NOT_HELD')
 fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)

def lit(v):return "'"+str(v).replace("'","''")+"'"
def ledger_expr():return "(SELECT COALESCE(jsonb_object_agg(name,checksum),'{}'::jsonb) FROM public._kernel_migrations)"
def assert_sql(condition,code):return 'DO $wsx_assert$ BEGIN IF NOT ('+condition+") THEN RAISE EXCEPTION '"+code+"'; END IF; END $wsx_assert$;\n"
def baseline_check(base):return assert_sql(ledger_expr()+'='+lit(json.dumps(base,sort_keys=True))+'::jsonb','LEDGER_DRIFT')
def drain_sql():
 return assert_sql("NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend')",'OTHER_DATABASE_SESSIONS')+assert_sql('NOT EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database=current_database())','PREPARED_TRANSACTIONS')
def psql_args(container):
 need(re.fullmatch('[a-f0-9]{64}',container),'POSTGRES_CONTAINER_ID')
 return ['/usr/bin/docker','exec','--user','postgres','-i',container,'/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','psql','-X','-w','-qAt','--host=/var/run/postgresql','--port=5432','--username=postgres','--dbname=workspacex','-v','ON_ERROR_STOP=1']
def transaction_sql(base,files,core):
 core.reviewed_sql(files)
 target={**base,**core.MIGRATIONS}
 text="BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='120s';\n"
 text+=assert_sql("current_database()='workspacex' AND current_user='postgres'",'DATABASE_BINDING')
 text+=assert_sql('pg_try_advisory_xact_lock(8014530119003001)','MIGRATION_LOCK_BUSY')+drain_sql()+baseline_check(base)
 for name in sorted(core.MIGRATIONS):
  text+=files[name].decode()+'\nINSERT INTO public._kernel_migrations(name,checksum) VALUES('+lit(name)+','+lit(core.MIGRATIONS[name])+');\n'
 text+=baseline_check(target)+"COMMIT;\nSELECT 'WSX_COMMIT_ACKNOWLEDGED';\n"
 return text
class Adapter:
 def __init__(self,attempt,lock_fd):
  for name in ('us-tag-migration-adapter.py','schema-tag-prepare.py','schema-restore-rehearsal.py','minimal-docker-release.py'):trusted_closure(HERE/name)
  self.prep=load('us_source_prepare',HERE/'schema-tag-prepare.py')
  for name in ('schema-tag-prepare.py','schema-restore-rehearsal.py','minimal-docker-release.py','us-tag-migration-adapter.py'):self.prep.trusted(HERE/name)
  self.core=load('us_restore_core',HERE/'schema-restore-rehearsal.py');engine=load('us_engine',HERE/'minimal-docker-release.py')
  self.attempt=self.prep.trusted(attempt,private=True,directory=True)
  policy=self.prep.trusted(self.attempt/'policy.json',private=True);self.p=json.loads(policy.read_bytes())
  need(self.p['source']==SOURCE and self.p['tag']==TAG and self.p['environment']=='us','POLICY_IDENTITY')
  inherited_lock(lock_fd)
  self.d=engine.Docker('/usr/bin/docker');self.db=self.p['usDatabase'];self.base=self.db['baselineLedger']
  need(self.base and all(re.fullmatch('[a-f0-9]{64}',v) for v in self.base.values()) and not set(self.base)&set(self.core.MIGRATIONS),'BASELINE_LEDGER')
  actual=self.prep.inspect_one(self.d,self.db['containerId'])
  need(actual['Id']==self.db['containerId'] and actual['Image']==self.db['imageId'] and actual['State']['Running'] is True and actual['Config']['Labels'].get('com.docker.compose.project')==self.p['project'] and actual['Config']['Labels'].get('com.docker.compose.service')=='postgres','SOURCE_POSTGRES_BINDING')
  self.source=actual
 def execute(self,sql,timeout=120):
  return subprocess.run(psql_args(self.source['Id']),input=sql.encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,env={'PATH':'/usr/bin:/bin','HOME':'/root','LANG':'C.UTF-8'})
 def read(self,drain=False):
  sql="BEGIN READ ONLY; SET LOCAL statement_timeout='30s';\n"+assert_sql("current_database()='workspacex' AND current_user='postgres'",'DATABASE_BINDING')
  if drain:sql+=drain_sql()
  sql+='SELECT '+ledger_expr()+'; ROLLBACK;'
  r=self.execute(sql);need(r.returncode==0,'READ_ONLY_DATABASE_CHECK_FAILED');return json.loads(r.stdout)
 def stopped(self):
  need(set(self.p['baseline'])=={'api','web','agent','sandbox','sandbox-sessions'},'BUSINESS_SERVICE_SET')
  ids=[self.p['baseline'][s]['containerId'] for s in sorted(self.p['baseline'])]
  rows=self.d.json(['inspect',*ids]);need(len(rows)==len(set(ids))==5,'STOPPED_CONTAINER_SET')
  for row in rows:
   labels=row['Config']['Labels'];service=labels.get('com.docker.compose.service');need(service in self.p['baseline'],'STOPPED_SERVICE')
   need(row['Id']==self.p['baseline'][service]['containerId'] and row['Image']==self.p['baseline'][service]['imageId'] and labels.get('com.docker.compose.project')==self.p['project'] and row['State']['Running'] is False and not row['State'].get('Restarting'),'BUSINESS_WRITER_NOT_STOPPED')
 def sql_files(self):return self.prep.exact_sql(self.d,self.db['targetApiImageId'],self.core.MIGRATIONS,self.core)
 def backup_identity(self):
  return {'environment':'us','source':SOURCE,'tag':TAG,'database':'workspacex','role':'postgres','attempt':str(self.attempt),'postgresContainerId':self.source['Id'],'postgresImageId':self.source['Image'],'targetApiImageId':self.db['targetApiImageId'],'ledgerSha256':self.core.sha(json.dumps(self.base,sort_keys=True).encode())}
 def require_backup(self):return validate_backup(self.attempt,self.backup_identity(),self.core,self.prep.trusted)
 def run(self,mode):
  target={**self.base,**self.core.MIGRATIONS}
  if mode in ('preflight','reconcile','drain'):
   if mode=='drain':self.stopped()
   actual=self.read(drain=mode=='drain');status='BASELINE' if actual==self.base else 'COMPLETE' if actual==target else 'DRIFT'
   need(status!='DRIFT','LEDGER_DRIFT')
   return {'status':'DRAINED' if mode=='drain' else status,'readOnly':True}
  need(mode in ('apply','prepare'),'MODE')
  if mode=='apply':self.require_backup()
  self.stopped();need(self.read(drain=True)==self.base,'BASELINE_LEDGER_DRIFT');files=self.sql_files()
  if mode=='prepare':
   path=self.attempt/'stopped-backup';path.mkdir(mode=0o700)
   metadata=self.prep.read_source(self.d,self.source,'workspacex');need(metadata['ledger']==self.base,'BACKUP_SOURCE_LEDGER')
   args=psql_args(self.source['Id']);dump=args[:args.index('psql')]+['pg_dump','--host=/var/run/postgresql','--port=5432','--no-password','--username=postgres','--dbname=workspacex','--format=custom','--no-owner','--no-acl']
   archive,key=self.core.encrypt_dump(dump,path)
   self.core.rehearse('/usr/bin/docker',self.source['Image'],archive,key,self.base,metadata['roles'],files,path/'isolated')
   self.stopped();need(self.read(drain=True)==self.base,'POST_RESTORE_SOURCE_DRIFT')
   names=['database.pgdump.enc','backup.key','isolated/intent.json','isolated/restored.json','isolated/receipt.json','isolated/cleanup.json']
   self.core.save(path/'qualification.json',{'identity':self.backup_identity(),'preparedAt':time.time(),'files':{name:self.core.file_sha(path/name) for name in names}})
   self.require_backup()
   return {'status':'BACKUP_RESTORE_VERIFIED','writersStopped':True,'encryptedArchiveSha256':self.core.file_sha(archive),'baselineLedgerSha256':self.core.sha(json.dumps(self.base,sort_keys=True).encode())}
  # O_EXCL durable intent bars any automatic replay, even if COMMIT ACK is lost.
  self.core.save(self.attempt/'database-transaction-intent.json',{'source':SOURCE,'tag':TAG,'environment':'us','status':'TRANSACTION_INTENT'})
  try:r=self.execute(transaction_sql(self.base,files,self.core))
  except Exception:return {'status':'COMMIT_UNKNOWN_RECONCILE_REQUIRED'}
  if r.returncode!=0 or r.stdout.strip()!=b'WSX_COMMIT_ACKNOWLEDGED':return {'status':'COMMIT_UNKNOWN_RECONCILE_REQUIRED'}
  need(self.read(drain=True)==target,'POST_COMMIT_LEDGER_UNCERTAIN')
  return {'status':'COMMITTED','commitAcknowledged':True,'ledgerCount':len(target)}
def main():
 need(os.geteuid()==0 and len(sys.argv)==3,'ROOT_FIXED_MODE_REQUIRED')
 def interrupted(*_):raise InterruptedError('ADAPTER_INTERRUPTED')
 signal.signal(signal.SIGTERM,interrupted)
 mode,attempt=sys.argv[1:];fd=int(os.environ.get('WSX_RELEASE_LOCK_FD','-1'))
 result=Adapter(attempt,fd).run(mode);result.update(source=SOURCE,tag=TAG,environment='us');print(json.dumps(result));return 0 if result['status']!='COMMIT_UNKNOWN_RECONCILE_REQUIRED' else 1
if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as e:
  code=str(e) if isinstance(e,ValueError) and re.fullmatch('[A-Z0-9_]{1,100}',str(e)) else 'US_MIGRATION_ADAPTER_FAILED'
  print(json.dumps({'status':'FAILED','code':code,'source':SOURCE,'tag':TAG,'environment':'us'}));raise SystemExit(1)
