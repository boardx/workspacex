#!/usr/bin/env python3
"""Read-only CN limited-release input builder. No restore/backup/apply acceptance.

Root caller supplies installed closure pins and the real old-business probe spec.
Does not read, repair or reuse an old failed stub. No production configuration is
written; only new private input evidence is created under the existing state root.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import time
HERE=Path(__file__).resolve().parent
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
CONFIG='/etc/workspacex-image-release/cn.json';LOCK='/var/lib/workspacex-cn/runtime/release.lock'
CLOSURE=('cn-reviewed-tag-prepare.py','cn-reviewed-tag-release.py','cn-reviewed-tag-writer.py','cn-reviewed-tag-verifier.py','cn-tag-migration-adapter.py','schema-tag-prepare-cn.py','schema-tag-prepare.py','schema-restore-rehearsal.py','us-tag-migration-adapter.py','minimal-docker-release.py','tag-reviewed-migration-driver.mjs','tag-maintenance-release.py','tag-migrated-activation.py','schema-release-handoff.py','tag-bootstrap-probe.py','registry-images.py','hosted-release.py','canonical_control.py','cn-tag-old-application-probe.py')
def need(v,c):
 if not v:raise ValueError(c)
def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def trusted(path,private=False,directory=False):
 p=Path(path);need(p.is_absolute(),'ROOT_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_PATH')
 s=p.stat();need(stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode) and s.st_nlink==1,'ROOT_INPUT')
 if private:need(not s.st_mode&0o077,'PRIVATE_INPUT')
 return p
def load(name,pins):
 path=trusted(HERE/(name+'.py'));need(sha(path)==pins[path.name],'CODE_DRIFT');spec=importlib.util.spec_from_file_location('cn_prepare_'+name.replace('-','_'),path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def baseline_ledger(current,core):
 need(type(current) is dict,'SOURCE_LEDGER')
 present=set(current)&set(core.MIGRATIONS)
 need(not present or present==set(core.MIGRATIONS) and all(current[n]==core.MIGRATIONS[n] for n in present),'PARTIAL_OR_CHANGED_MIGRATIONS')
 base={n:v for n,v in current.items() if n not in core.MIGRATIONS};core.check_ledger(base);need(len(base)==435,'BASELINE_COUNT');return base

def prepare(closure_pins,old_probe,output):
 need(os.geteuid()==0,'ROOT_REQUIRED');need(type(closure_pins) is dict and set(closure_pins)==set(CLOSURE),'PREPARE_CLOSURE')
 for name,pin in closure_pins.items():need(re.fullmatch('[a-f0-9]{64}',pin) and sha(trusted(HERE/name))==pin,'PREPARE_CODE_DRIFT')
 p=load('schema-tag-prepare',closure_pins);core=load('schema-restore-rehearsal',closure_pins);cn=load('schema-tag-prepare-cn',closure_pins);maint=load('tag-maintenance-release',closure_pins);engine=load('minimal-docker-release',closure_pins);bootstrap=load('tag-bootstrap-probe',closure_pins);registry=load('registry-images',closure_pins);us=load('us-tag-migration-adapter',closure_pins)
 cfgpath=trusted(CONFIG,True);need(cfgpath.stat().st_size<=1024*1024,'CONFIG_BOUND');cfg=json.loads(cfgpath.read_bytes());config_hash=sha(cfgpath)
 need(cfg['environment']=='cn' and cfg['lockFile']==LOCK and cfg['docker']=='/usr/bin/docker' and set(cfg['services'])==maint.SERVICES,'FIXED_CN_CONFIG')
 old_module=load('cn-tag-old-application-probe',closure_pins)
 if old_probe is None:
  def source_ref(path,checksum,private=False):
   actual=trusted(path,private);need(sha(actual)==checksum,'ORIGINAL_BROWSER_PIN');return {'path':str(actual),'sha256':checksum,**({'private':True} if private else {})}
  original_inputs=[source_ref(old_module.ROOT/name,checksum) for name,checksum in old_module.PINS.items()]+[source_ref(old_module.ENV,old_module.ENV_SHA,True)]
  old_probe={'executable':{'path':str(HERE/'cn-tag-old-application-probe.py'),'sha256':closure_pins['cn-tag-old-application-probe.py']},'inputs':[*cfg.get('verificationFiles',[]),*original_inputs],'timeoutSeconds':105}
 need(type(old_probe) is dict,'FIXED_OLD_PROBE_SPEC')
 need(old_probe.get('executable')=={'path':str(HERE/'cn-tag-old-application-probe.py'),'sha256':closure_pins['cn-tag-old-application-probe.py']},'EXACT_CURRENT_OLD_PROBE')
 need(type(old_probe) is dict and set(old_probe)=={'executable','inputs','timeoutSeconds'} and type(old_probe['inputs']) is list and len(old_probe['inputs'])<=64 and type(old_probe['timeoutSeconds']) is int and 10<=old_probe['timeoutSeconds']<=120,'FIXED_OLD_PROBE_SPEC')
 maint.pinned(old_probe['executable']);need(os.access(old_probe['executable']['path'],os.X_OK),'OLD_PROBE_EXECUTABLE')
 for r in old_probe['inputs']:maint.pinned(r,private=r.get('private',False))
 out=Path(output);need(out.parent==Path(cfg['stateDirectory']) and re.fullmatch('cn-limited-inputs-[a-f0-9]{32}',out.name) and not out.exists(),'NEW_PRIVATE_OUTPUT')
 trusted(out.parent,True,True);fd=os.open(trusted(LOCK,True),os.O_RDONLY|os.O_NOFOLLOW)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);us.inherited_lock(fd,LOCK);cn.bind_env(p);d=engine.Docker(cfg['docker'])
  rows=[p.live_service(d,cfg['project'],s) for s in sorted(maint.SERVICES)];baseline={r['Config']['Labels']['com.docker.compose.service']:{'containerId':r['Id'],'imageId':r['Image']} for r in rows};maint.runtime_set(rows,cfg['project'],baseline,True)
  api=next(r for r in rows if r['Config']['Labels']['com.docker.compose.service']=='api');env=p.env_map(api)
  need(env.get('PGHOST')==cn.HOST and env.get('PGDATABASE')==cn.DB and env.get('PGPORT')=='5432' and env.get('APP_DB_USER')=='app_rw','API_DATABASE_BINDING')
  metadata=cn.read_source(d);base=baseline_ledger(metadata['ledger'],core)
  images={role:registry.resolve('/usr/bin/docker',cfg['registryPrefix'],TAG,role,pull=False) for role in ('api','web','agent','sandbox','postgres')}
  need(all(r['sourceRevision']==SOURCE and r['tag']==TAG for r in images.values()),'FIXED_TARGET_SOURCE')
  p.exact_sql(d,images['api']['imageId'],core.MIGRATIONS,core)
  nginx=trusted('/etc/nginx/conf.d/workspacex-app.conf');maint.maintenance_bytes(nginx.read_bytes(),'cn')
  reference=lambda path:{'path':str(trusted(path)),'sha256':sha(path)}
  pins=[*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[]),{**reference(cn.ENV),'private':True},reference(cfgpath)]
  for r in pins:maint.pinned(r,private=r.get('private',False))
  closure=[reference(HERE/n) for n in CLOSURE]
  policy={'kind':'cn-limited-maintenance-inputs-v1','environment':'cn','source':SOURCE,'tag':TAG,'project':cfg['project'],'baseline':baseline,'preparedAt':time.time(),'lockFile':LOCK,'stateDirectory':cfg['stateDirectory'],'nginx':reference(nginx),'configurationPins':pins,'oldApplicationProbe':old_probe,'cnDatabase':{'baselineLedger':base,'baselineApiImageId':api['Image'],'targetApiImageId':images['api']['imageId']},'backupState':'NOT_CAPTURED','restoreNotPerformed':True,'productionMigrationExecuted':False,'activationAllowed':False}
  adapter={'executable':reference(HERE/'cn-tag-migration-adapter.py'),'inputs':closure,'timeoutSeconds':150};policy['databaseCommand']=adapter;policy['backupCommand']=adapter
  policy['bootstrapProbe']=bootstrap.policy_spec('cn',cfg,api,images['api'],policy,d,p,core,closure,cn);maint.require_bootstrap(policy);pins.extend(policy['bootstrapProbe']['inputs'])
  after=cn.read_source(d);need(all(after[k]==metadata[k] for k in ('database','role','ledger','roles')) and sha(cfgpath)==config_hash,'READONLY_SOURCE_DRIFT');maint.runtime_set([p.live_service(d,cfg['project'],s) for s in sorted(maint.SERVICES)],cfg['project'],baseline,True)
  for r in (*pins,policy['nginx']):maint.pinned(r,private=r.get('private',False))
  for name,checksum in closure_pins.items():need(sha(trusted(HERE/name))==checksum,'FINAL_CODE_DRIFT')
  out.mkdir(mode=0o700);core.save(out/'source-metadata.json',metadata);core.save(out/'candidate-images.json',images);core.save(out/'policy.json',policy)
  core.save(out/'receipt.json',{'status':'CN_LIMITED_READONLY_INPUTS_PREPARED','source':SOURCE,'tag':TAG,'environment':'cn','preparedAt':time.time(),'policy':reference(out/'policy.json'),'metadata':reference(out/'source-metadata.json'),'backupState':'NOT_CAPTURED','restoreNotPerformed':True,'productionMigrationExecuted':False,'activationAllowed':False})
  return {'maintenancePolicy':reference(out/'policy.json'),'candidateImages':images,'receipt':reference(out/'receipt.json')}
 finally:os.close(fd)
