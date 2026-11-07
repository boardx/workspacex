#!/usr/bin/env python3
"""Construct private CN maintenance inputs from original restore and live identity.

Never executes migration or invents old-application acceptance. The separately
reviewed old-business probe must exist; its exact executable and inputs are pins.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import uuid
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
 p=trusted(HERE/(name+'.py'));s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def evidence(directory,core,now=None):
 now=time.time() if now is None else now
 read=lambda name:json.loads(trusted(directory/name,True).read_bytes())
 intent=read('intent.json');metadata=read('source-snapshot.json');receipt=read('receipt.json')
 need(intent.get('environment')=='cn' and intent.get('tag')==TAG,'SOURCE_INTENT')
 target=intent.get('target',{});need(target.get('sourceRevision')==SOURCE,'TARGET_SOURCE')
 need(receipt.get('environment')=='cn' and receipt.get('tag')==TAG and receipt.get('status')=='ISOLATED_RESTORE_AND_SQL_REHEARSED','SOURCE_REHEARSAL')
 need(metadata.get('database')=='workspacex_a1cb_20261006' and metadata.get('role')=='migration_admin','DATABASE_IDENTITY')
 core.check_ledger(metadata['ledger'])
 archive=trusted(directory/'database.pgdump.enc',True);key=trusted(directory/'backup.key',True);core.private_backup_files(archive,key)
 restored=read('isolated/restored.json');isolated=read('isolated/receipt.json');clone=read('isolated/intent.json');cleanup=read('isolated/cleanup.json')
 need(restored.get('status')=='RESTORED' and restored.get('archiveSha256')==core.file_sha(archive) and restored.get('ledgerSha256')==core.sha(json.dumps(metadata['ledger'],sort_keys=True).encode()),'RESTORED_SOURCE')
 need(isolated.get('status')=='ISOLATED_RESTORE_AND_SQL_REHEARSED' and isolated.get('migrationNames')==sorted(core.MIGRATIONS) and isolated.get('cloneImageId')==restored.get('cloneImageId')==clone.get('imageId'),'SQL_RESTORE_IDENTITY')
 need(clone.get('network')=='none' and cleanup.get('removed') is True and cleanup.get('name')==clone.get('name') and cleanup.get('ownerLabel')==clone.get('ownerLabel'),'CLONE_CLEANUP')
 # All original proof files must be fresh. No caller-provided successful flag.
 names=['intent.json','source-snapshot.json','receipt.json','database.pgdump.enc','backup.key','isolated/intent.json','isolated/restored.json','isolated/receipt.json','isolated/cleanup.json']
 need(all(0<=now-trusted(directory/name,True).stat().st_mtime<1800 for name in names),'SOURCE_PROOF_EXPIRED')
 return intent,metadata,{name:core.file_sha(directory/name) for name in names}

def lock_identity(fd,path):
 opened=os.fstat(fd);named=path.lstat()
 need(stat.S_ISREG(named.st_mode) and named.st_uid==0 and stat.S_IMODE(named.st_mode)==0o600 and (opened.st_dev,opened.st_ino)==(named.st_dev,named.st_ino),'CANONICAL_LOCK_DRIFT')

def baseline_identity(baseline,intent):
 need(baseline['api']['imageId']==intent['baselineApiImageId'],'BASELINE_API_DRIFT')

def main():
 need(os.geteuid()==0 and len(sys.argv)==4,'ROOT_FIXED_INPUTS_REQUIRED')
 source_dir=Path(sys.argv[1]);probe=trusted(sys.argv[2]);out=Path(sys.argv[3]);need(not out.exists(),'OUTPUT_EXISTS')
 for name in ('schema-tag-prepare.py','schema-restore-rehearsal.py','minimal-docker-release.py','cn-tag-migration-adapter.py','schema-tag-prepare-cn.py','us-tag-migration-adapter.py','tag-reviewed-migration-driver.mjs','tag-maintenance-release.py','tag-bootstrap-probe.py'):trusted(HERE/name)
 p=load('schema-tag-prepare');p.trusted(source_dir,private=True,directory=True);p.trusted(out.parent,directory=True);core=load('schema-restore-rehearsal');engine=load('minimal-docker-release');cn=load('schema-tag-prepare-cn');maintenance=load('tag-maintenance-release');bootstrap=load('tag-bootstrap-probe')
 cfgpath=trusted('/etc/workspacex-image-release/cn.json',True);cfg=json.loads(cfgpath.read_bytes());need(cfg['environment']=='cn','CONFIG_ENVIRONMENT')
 lockpath=trusted('/var/lib/workspacex-cn/runtime/release.lock',True);fd=os.open(lockpath,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);lock_identity(fd,lockpath);cn.bind_env(p)
  intent,metadata,proofs=evidence(source_dir,core)
  d=engine.Docker('/usr/bin/docker');rows=[p.live_service(d,cfg['project'],s) for s in sorted(maintenance.SERVICES)]
  baseline={r['Config']['Labels']['com.docker.compose.service']:{'containerId':r['Id'],'imageId':r['Image']} for r in rows}
  baseline_identity(baseline,intent);maintenance.runtime_set(rows,cfg['project'],baseline,True)
  need(cn.read_source(d)['ledger']==metadata['ledger'],'LIVE_LEDGER_DRIFT')
  nginx=trusted('/etc/nginx/conf.d/workspacex-app.conf');maintenance.maintenance_bytes(nginx.read_bytes(),'cn')
  ref=lambda path:{'path':str(trusted(path)),'sha256':core.file_sha(path)}
  pins=[*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[]),{**ref(cn.ENV),'private':True},ref(cfgpath)]
  for pin in pins:maintenance.pinned(pin,private=pin.get('private',False))
  out.mkdir(mode=0o700);attempt='tag-maintenance-'+uuid.uuid4().hex
  closure=[ref(HERE/name) for name in ('schema-tag-prepare.py','schema-restore-rehearsal.py','minimal-docker-release.py','cn-tag-migration-adapter.py','schema-tag-prepare-cn.py','us-tag-migration-adapter.py','tag-reviewed-migration-driver.mjs','tag-bootstrap-probe.py')]
  adapter={'executable':ref(HERE/'cn-tag-migration-adapter.py'),'inputs':closure,'timeoutSeconds':600}
  need(os.access(probe,os.X_OK) and os.access(HERE/'cn-tag-migration-adapter.py',os.X_OK),'EXECUTABLE_ADAPTER_REQUIRED')
  prepared={'status':'PREPARED_FOR_MAINTENANCE','environment':'cn','source':SOURCE,'tag':TAG,'sourceEvidenceDirectory':str(source_dir),'originalProofHashes':proofs,'preparedAt':time.time(),'productionMigrationExecuted':False}
  core.save(out/'prepared.json',prepared)
  policy={'environment':'cn','source':SOURCE,'tag':TAG,'project':cfg['project'],'baseline':baseline,'preparedAt':prepared['preparedAt'],'preparationReceipt':ref(out/'prepared.json'),'lockFile':str(lockpath),'stateDirectory':cfg['stateDirectory'],'attempt':attempt,'nginx':ref(nginx),'configurationPins':pins,'databaseCommand':adapter,'backupCommand':adapter,'oldApplicationProbe':{'executable':ref(probe),'inputs':cfg.get('verificationFiles',[]),'timeoutSeconds':300},'cnDatabase':{'baselineLedger':metadata['ledger'],'baselineApiImageId':intent['baselineApiImageId'],'targetApiImageId':intent['target']['imageId']}}
  api=next(row for row in rows if row['Config']['Labels']['com.docker.compose.service']=='api')
  consumer=p.installed_consumer();target=consumer.registry.resolve('/usr/bin/docker',cfg['registryPrefix'],TAG,'api',pull=False)
  policy['bootstrapProbe']=bootstrap.policy_spec('cn',cfg,api,target,policy,d,p,core,closure,cn)
  maintenance.require_bootstrap(policy)
  pins.extend(policy['bootstrapProbe']['inputs'])
  core.save(out/'policy.json',policy);print(json.dumps({'status':'POLICY_CONSTRUCTED','policy':str(out/'policy.json'),'productionMigrationExecuted':False}))
 finally:os.close(fd)
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'status':'POLICY_REJECTED','code':str(e) if isinstance(e,ValueError) and re.fullmatch('[A-Z0-9_]+',str(e)) else 'INPUT_UNQUALIFIED'}));sys.exit(1)
