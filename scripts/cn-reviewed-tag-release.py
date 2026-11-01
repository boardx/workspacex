#!/usr/bin/env python3
"""One CN release only. Backup retained; restore rehearsal explicitly NOT performed.

Separate root-pinned writer/verifier wrappers bind this library. Existing generic
restore guards are unchanged. No other source/tag, partial ledger or SQL accepted.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import time
import uuid
HERE=Path(__file__).resolve().parent
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
POLICY='/etc/workspacex-image-release/cn-reviewed-tag-release.json';LOCK='/var/lib/workspacex-cn/runtime/release.lock'
CLOSURE=('cn-reviewed-tag-release.py','cn-reviewed-tag-writer.py','cn-reviewed-tag-verifier.py','cn-tag-migration-adapter.py','schema-tag-prepare-cn.py','schema-tag-prepare.py','schema-restore-rehearsal.py','us-tag-migration-adapter.py','minimal-docker-release.py','tag-reviewed-migration-driver.mjs','tag-maintenance-release.py','tag-migrated-activation.py','schema-release-handoff.py','tag-bootstrap-probe.py','cn-tag-old-application-probe.py')
def need(v,c):
 if not v:raise ValueError(c)
def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def trusted(path,private=False):
 p=Path(path);need(p.is_absolute(),'ABSOLUTE_ROOT_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_PATH')
 s=p.stat();need(stat.S_ISREG(s.st_mode) and s.st_nlink==1,'ROOT_FILE')
 if private:need(not s.st_mode&0o077,'PRIVATE_FILE')
 return p
def read(path,private=True):
 p=trusted(path,private);need(p.stat().st_size<=8*1024*1024,'INPUT_BOUND');return json.loads(p.read_bytes())
def ref(path):return {'path':str(path),'sha256':sha(path)}
def pinned(value,private=True):
 need(type(value) is dict and set(value)=={'path','sha256'},'PIN_FORMAT');p=trusted(value['path'],private);need(sha(p)==value['sha256'],'PIN_DRIFT');return p
def load(name,pins):
 p=trusted(HERE/(name+'.py'));need(sha(p)==pins[p.name],'CODE_DRIFT');s=importlib.util.spec_from_file_location('cn_once_'+name.replace('-','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def migrate_once(adapter,record):
 """All or none fixed migration set. Uncertain apply is never replayed."""
 state=adapter.execute('preflight').get('status');need(state in ('BASELINE','COMPLETE'),'SOURCE_LEDGER_DRIFT')
 if state=='COMPLETE':return {'status':'COMPLETE','migrationExecuted':False,'commitAcknowledgementLost':False}
 adapter.stopped();need(adapter.execute('drain').get('ledgerStatus')=='BASELINE','SOURCE_NOT_DRAINED');record({'status':'TRANSACTION_INTENT','source':SOURCE,'tag':TAG,'environment':'cn'})
 unknown=False
 try:
  ack=adapter.execute('apply');record({'status':'APPLY_RESULT','value':ack});unknown=not (ack.get('status')=='COMMITTED' and ack.get('commitAcknowledged') is True)
 except Exception:unknown=True;record({'status':'COMMIT_ACK_UNKNOWN','automaticRetryAllowed':False})
 if unknown:need(adapter.execute('drain').get('ledgerStatus') in ('BASELINE','COMPLETE'),'UNKNOWN_DATABASE_TERMINALITY')
 terminal=adapter.execute('reconcile');record({'status':'RECONCILE_RESULT','value':terminal})
 need(terminal.get('status')=='COMPLETE','APPLY_NOT_COMPLETE_NO_RETRY')
 return {'status':'COMPLETE','migrationExecuted':True,'commitAcknowledgementLost':unknown}
def release_budget(policy,expires,mode,now=None):
 now=time.time() if now is None else now
 needed=policy['verifierSeconds']+policy['outerVerificationSeconds']+10
 if mode=='writer':needed+=policy['writerSeconds']+policy['rollbackSeconds']
 need(mode in ('writer','verifier') and needed<=expires-now<=600,'RELEASE_TOTAL_BUDGET')
def bind(request_path,receipt_path,mode):
 need(os.geteuid()==0,'ROOT_REQUIRED');policy_path=trusted(POLICY,True);policy=read(policy_path)
 need(policy.get('kind')=='cn-reviewed-tag-once-v1' and policy.get('source')==SOURCE and policy.get('tag')==TAG and policy.get('environment')=='cn' and policy.get('restoreNotPerformed') is True,'FIXED_CAPABILITY')
 need(all(type(policy.get(k)) is int and lo<=policy[k]<=hi for k,lo,hi in [('runtimeSeconds',10,120),('businessSeconds',10,120),('writerSeconds',120,400),('rollbackSeconds',30,180),('verifierSeconds',10,120),('outerVerificationSeconds',10,120)]),'BOUNDED_BUDGETS')
 need(policy['rollbackSeconds']>=policy['businessSeconds']+2*policy['runtimeSeconds']+15,'ROLLBACK_BUDGET')
 need(type(policy.get('expiresAt')) is int and time.time()<policy['expiresAt']<=time.time()+3600,'CAPABILITY_EXPIRED')
 pins=policy.get('closurePins');need(type(pins) is dict and set(pins)==set(CLOSURE),'EXACT_CLOSURE')
 for name,checksum in pins.items():need(re.fullmatch('[a-f0-9]{64}',checksum) and sha(trusted(HERE/name))==checksum,'CLOSURE_DRIFT')
 mods={n:load(n,pins) for n in ('schema-restore-rehearsal','tag-maintenance-release','tag-migrated-activation','minimal-docker-release','schema-release-handoff','cn-tag-migration-adapter','us-tag-migration-adapter','schema-tag-prepare')}
 core=mods['schema-restore-rehearsal'];maint=mods['tag-maintenance-release'];act=mods['tag-migrated-activation'];engine=mods['minimal-docker-release'];request=read(request_path)
 release_budget(policy,request.get('expiresAt',0),mode)
 need(request.get('kind')=='schema-release-request-v1' and request.get('environment')=='cn' and request.get('sourceRevision')==SOURCE and request.get('tag')==TAG and time.time()<request['expiresAt'],'REQUEST_IDENTITY')
 cfg=read(pinned(request['config']));manifest=read(pinned(request['manifest'],private=False),private=False);plan=read(pinned(request['schemaPlan']));attempt=Path(request_path).parent
 need(attempt.parent==Path(cfg['stateDirectory']) and re.fullmatch('attempt-[a-f0-9]{32}',attempt.name) and Path(receipt_path).parent==attempt,'ATTEMPT_BINDING')
 need(policy['outerVerificationSeconds']>=cfg.get('readinessTimeoutSeconds',120),'OUTER_BUDGET')
 need(cfg['environment']=='cn' and cfg['lockFile']==LOCK and cfg['docker']=='/usr/bin/docker' and set(cfg['services'])==maint.SERVICES,'CN_CONFIG')
 need(request['manifestSha256']==request['manifest']['sha256'] and request['planSha256']==plan['planSha256'],'REQUEST_HASH')
 act.exact_changes(plan,core.MIGRATIONS)
 need(manifest['sourceRevision']==SOURCE and manifest['tag']==TAG and manifest['images']==policy['candidateImages'],'FIXED_CANDIDATE_IMAGES')
 fd=int(os.environ.get('WSX_RELEASE_LOCK_FD','-1'));mods['us-tag-migration-adapter'].inherited_lock(fd,LOCK);st=os.fstat(fd);need(request['canonicalLock']=={'path':LOCK,'device':st.st_dev,'inode':st.st_ino},'LOCK_BINDING')
 pending=read(Path(cfg['stateDirectory'])/'pending.json');need(pending.get('attempt')==str(attempt) and pending.get('requestSha256')==sha(request_path),'PENDING_BINDING')
 base=read(pinned(policy['maintenancePolicy']));need(base['environment']=='cn' and base['source']==SOURCE and base['tag']==TAG and base['project']==cfg['project'] and base['lockFile']==LOCK and len(base['cnDatabase']['baselineLedger'])==435,'BASE_POLICY')
 core.check_ledger(base['cnDatabase']['baselineLedger']);need(base['cnDatabase']['targetApiImageId']==manifest['images']['api']['imageId'],'TARGET_API_BINDING')
 maint.require_bootstrap(base);need(policy['businessSeconds']>=base['oldApplicationProbe']['timeoutSeconds'],'BUSINESS_BUDGET')
 for r in (*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[]),*base['configurationPins']):maint.pinned(r,private=r.get('private',False))
 need(type(cfg.get('verificationCommand')) is list and len(cfg['verificationCommand'])==1 and any(r['path']==cfg['verificationCommand'][0] for r in cfg.get('verificationFiles',[])),'PUBLIC_BROWSER_REQUIRED')
 d=engine.Docker(cfg['docker'])
 for image in manifest['images'].values():engine.image(d,image['imageId'],SOURCE);need(image['image'] in d.json(['image','inspect',image['imageId']])[0].get('RepoDigests',[]),'IMAGE_DIGEST')
 command=['compose','--project-name',cfg['project'],'--env-file',cfg['envFile']['path']]
 for r in cfg['composeFiles']:command+=['--file',r['path']]
 return dict(policy=policy,policyRef=ref(policy_path),mods=mods,request=request,config=cfg,manifest=manifest,attempt=attempt,receipt=Path(receipt_path),base=base,fd=fd,d=d,command=command,originalPending=ref(Path(cfg['stateDirectory'])/'pending.json'))
def writer(ctx):
 p=ctx['policy'];m=ctx['mods'];core=m['schema-restore-rehearsal'];maint=m['tag-maintenance-release'];act=m['tag-migrated-activation'];engine=m['minimal-docker-release'];attempt=ctx['attempt'];cfg=ctx['config'];d=ctx['d'];base=copy.deepcopy(ctx['base']);base['attempt']=attempt.name
 # One root capability may be spent only once, regardless of request nonce/ACK.
 barrier=Path(cfg['stateDirectory'])/('cn-reviewed-'+TAG+'-once.json');need(not barrier.exists() and not barrier.is_symlink(),'CAPABILITY_ALREADY_SPENT')
 core.save(barrier,{'request':ref(attempt/'schema-request.json'),'policy':ctx['policyRef'],'source':SOURCE,'tag':TAG,'automaticRetryAllowed':False,'time':time.time()})
 core.save(attempt/'policy.json',base);host=maint.Host(base,attempt,ctx['fd']);adapter=m['cn-tag-migration-adapter'].Adapter(attempt,ctx['fd'])
 original_nginx=maint.pinned(base['nginx']).read_bytes();held=maint.maintenance_bytes(original_nginx,'cn');old={s:base['baseline'][s]['imageId'] for s in cfg['services']};images={s:ctx['manifest']['images'][r]['imageId'] for s,r in cfg['services'].items()}
 live=act.runtime_rows(d,cfg['project'],cfg['services'],old);maint.runtime_set(live,cfg['project'],base['baseline'],True)
  # Bind the application being stopped to this exact RDS before any DDL.
 api=next(r for r in live if r['Config']['Labels'].get('com.docker.compose.service')=='api');api_env=m['schema-tag-prepare'].env_map(api)
 need(api_env.get('PGHOST')==adapter.cn.HOST and api_env.get('PGDATABASE')==adapter.cn.DB and api_env.get('PGPORT')=='5432' and api_env.get('APP_DB_USER')=='app_rw' and core.sha(json.dumps(api_env,sort_keys=True).encode())==base['bootstrapProbe']['binding']['baselineEnvSha256'],'API_SOURCE_DATABASE_ENV_DRIFT')
 original=d.json(ctx['command']+['config','--format','json']);act.live_config_cas(engine,d,original,cfg['project'],live,attempt)
 overlay=attempt/'candidate-images.json';rollback=attempt/'old-images.json';core.save(overlay,{'services':{s:{'image':i} for s,i in images.items()}});core.save(rollback,{'services':{s:{'image':i} for s,i in old.items()}})
 expected=copy.deepcopy(original)
 for s,i in images.items():expected['services'][s]['image']=i
 command=ctx['command']+['--file',str(overlay)];old_command=ctx['command']+['--file',str(rollback)];need(d.json(command+['config','--format','json'])==expected,'NON_IMAGE_CONFIG_CHANGE')
 hold=False;mutation=False;intent=False;events=[]
 def record(value):events.append(value);core.save(attempt/('database-event-'+str(len(events))+'.json'),value)
 def health(command,expected_images):
  hctx={'engine':engine,'maint':maint,'old_policy':base,'attempt':attempt,'fd':ctx['fd'],'request':ctx['request'],'p':{'runtimeSeconds':p['runtimeSeconds']},'d':d,'config':cfg}
  return act.verify_held_runtime(hctx,command,expected_images)
 def public_business(name):
  core.save(attempt/(name+'-once.json'),{'source':SOURCE,'tag':TAG,'time':time.time(),'automaticRetryAllowed':False})
  raw=host.run(cfg['verificationCommand'],timeout=p['businessSeconds']);need(len(raw)<=65536 and b'CN_PUBLIC_BROWSER_PASSED' in raw,'PUBLIC_BROWSER_FAILED');path=attempt/(name+'-raw.json');core.save(path,{'stdoutHex':raw.hex(),'createdAt':time.time(),'source':SOURCE,'tag':TAG,'scope':'actual-public-browser'});return ref(path)
 try:
  need(adapter.execute('preflight').get('status') in ('BASELINE','COMPLETE'),'INITIAL_LEDGER')
  host.nginx(original_nginx,held);hold=True;host.stop();maint.runtime_set(host.runtime(),cfg['project'],base['baseline'],False);adapter.stopped();need(adapter.execute('drain').get('status')=='DRAINED','SOURCE_NOT_DRAINED')
  backup=attempt/'stopped-backup';backup.mkdir(mode=0o700);metadata=adapter.cn.read_source(d)
  observed=metadata['ledger'];need(observed in (adapter.base,{**adapter.base,**core.MIGRATIONS}),'BACKUP_LEDGER')
  def dump(args):
   args[-1]=adapter.cn.SHELL+'exec pg_dump --no-password --format=custom';return core.encrypt_dump(args,backup)
  archive,key=adapter.cn.helper(d,'dump',dump);core.private_backup_files(archive,key);adapter.stopped();need(adapter.cn.read_source(d)['ledger']==observed,'POST_BACKUP_LEDGER_DRIFT')
  core.save(backup/'source-metadata.json',metadata)
  backup_proof={'metadata':ref(backup/'source-metadata.json'),'archive':ref(archive),'key':ref(key),'sourceLedgerSha256':core.sha(json.dumps(observed,sort_keys=True).encode()),'sourceHost':adapter.cn.HOST,'database':adapter.cn.DB,'role':'migration_admin','restoreNotPerformed':True,'restoreAcceptance':'NOT_PERFORMED','createdAt':time.time()}
  intent=True;transaction=migrate_once(adapter,record)
  # Bootstrap is real and read-only, after independently verified COMPLETE.
  bootstrap=host.adapter('bootstrapProbe','preactivate');need(bootstrap.get('status')=='CANDIDATE_BOOTSTRAP_COMPATIBLE','POST_SQL_BOOTSTRAP_FAILED')
  host.start();health(old_command,old)
  # Existing CN old business wrapper preserves TLS while routing through hold.
  old_attempt=attempt/('tag-maintenance-'+uuid.uuid4().hex);old_attempt.mkdir(mode=0o700);core.save(old_attempt/'policy.json',base);old_host=maint.Host(base,old_attempt,ctx['fd'])
  old_business=old_host.adapter('oldApplicationProbe','verify');need(old_business.get('status')=='OLD_APPLICATION_VERIFIED','OLD_FORWARD_SCHEMA_BUSINESS_FAILED')
  need(adapter.execute('reconcile').get('status')=='COMPLETE','PRE_ACTIVATION_LEDGER')
  for r in (*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[]),*base['configurationPins']):maint.pinned(r,private=r.get('private',False))
  need(d.json(command+['config','--format','json'])==expected,'PRE_UP_NON_IMAGE_CONFIG_DRIFT')
  act.live_config_cas(engine,d,original,cfg['project'],act.runtime_rows(d,cfg['project'],cfg['services'],old),attempt)
  mutation=True;d.run(command+['up','--detach','--no-deps','--pull','never','--no-build',*cfg['services']],timeout=p['runtimeSeconds']);candidate_health=health(command,images)
  host.nginx(held,original_nginx);hold=False;business=public_business('candidate-public-business')
  need(adapter.execute('reconcile').get('status')=='COMPLETE','FINAL_LEDGER')
  act.runtime_rows(d,cfg['project'],cfg['services'],images)
  for r in (*cfg['composeFiles'],cfg['envFile'],*base['configurationPins']):maint.pinned(r,private=r.get('private',False))
  contents={'backup-restore':backup_proof,'baseline-compatibility':{'oldImages':old,'actualForwardSchemaHealth':True,'business':old_business,'fullRestoreCompatibility':'NOT_PERFORMED'},'migration-ledger':transaction,'candidate-acceptance':{'images':images,'health':candidate_health,'publicBusiness':business,'bootstrap':bootstrap,'restoreNotPerformed':True}}
  proofs={}
  for name,value in contents.items():
   path=attempt/(name+'.json');core.save(path,{**value,'source':SOURCE,'tag':TAG,'environment':'cn','createdAt':time.time()});proofs[name]=ref(path)
  result={k:ctx['request'][k] for k in m['schema-release-handoff'].IDENTITY};result.update(kind='schema-release-result-v1',status='SUCCEEDED',proofs=proofs,restoreNotPerformed=True,scope='cn-fixed-tag-backup-exact-three-sql-and-actual-runtime')
  core.save(ctx['receipt'],result)
 except BaseException:
  signal.setitimer(signal.ITIMER_REAL,p['rollbackSeconds'])
  failure={'status':'RECONCILIATION_REQUIRED','restoreNotPerformed':True,'automaticRetryAllowed':False,'sqlRollbackAttempted':False,'migrationMayHaveCommitted':intent,'maintenanceHeld':hold}
  try:
   if not hold:host.nginx(original_nginx,held);hold=True
   if intent:
    d.run(command+['stop','--timeout','30',*cfg['services']],timeout=p['runtimeSeconds'])
    need(adapter.execute('drain').get('status')=='DRAINED','UNKNOWN_WRITER_NOT_DRAINED')
   terminal=adapter.execute('reconcile').get('status');need(terminal in ('BASELINE','COMPLETE'),'RECOVERY_LEDGER_UNKNOWN')
   if mutation:
    for r in (*cfg['composeFiles'],cfg['envFile'],*base['configurationPins']):maint.pinned(r,private=r.get('private',False))
    need(d.json(old_command+['config','--format','json'])==original,'ROLLBACK_NON_IMAGE_CONFIG_DRIFT')
    d.run(old_command+['up','--detach','--no-deps','--pull','never','--no-build',*cfg['services']],timeout=p['runtimeSeconds'])
   else:host.start()
   health(old_command,old)
   # Rebind recreated baseline CIDs for the actual recovery business probe.
   rp=copy.deepcopy(base);rows=act.runtime_rows(d,cfg['project'],cfg['services'],old);rp['baseline']={r['Config']['Labels']['com.docker.compose.service']:{'containerId':r['Id'],'imageId':r['Image']} for r in rows};recovery=attempt/('tag-maintenance-'+uuid.uuid4().hex);recovery.mkdir(mode=0o700);core.save(recovery/'policy.json',rp);rh=maint.Host(rp,recovery,ctx['fd']);need(rh.adapter('oldApplicationProbe','verify').get('status')=='OLD_APPLICATION_VERIFIED','RECOVERY_BUSINESS_FAILED')
   host.nginx(held,original_nginx);hold=False;failure.update(status='OLD_APPLICATION_RESTORED',databaseState=terminal)
  except BaseException:failure['recovery']='OPERATOR_RECONCILIATION_REQUIRED'
  failure['maintenanceHeld']=hold;core.save(attempt/'cn-once-failure.json',failure);raise
def verifier(ctx):
 m=ctx['mods'];core=m['schema-restore-rehearsal'];maint=m['tag-maintenance-release'];engine=m['minimal-docker-release'];act=m['tag-migrated-activation'];handoff=m['schema-release-handoff'];cfg=ctx['config'];attempt=ctx['attempt'];d=ctx['d']
 result=handoff.read_receipt(trusted(ctx['receipt'],True));handoff.verify_receipt(ctx['request'],result);need(result.get('restoreNotPerformed') is True,'HONEST_RESTORE_SCOPE')
 proofs={}
 for name,r in result['proofs'].items():
  path=pinned(r);need(path.parent==attempt,'PROOF_ATTEMPT');v=read(path);need(v.get('source')==SOURCE and v.get('tag')==TAG and v.get('environment')=='cn' and 0<=time.time()-v['createdAt']<600,'PROOF_IDENTITY_TTL');proofs[name]=v
 need(proofs['migration-ledger'].get('status')=='COMPLETE' and type(proofs['migration-ledger'].get('migrationExecuted')) is bool,'TRANSACTION_PROOF_REQUIRED')
 baseline_proof=proofs['baseline-compatibility'];need(baseline_proof.get('oldImages')=={s:ctx['base']['baseline'][s]['imageId'] for s in cfg['services']} and baseline_proof.get('actualForwardSchemaHealth') is True and baseline_proof.get('business',{}).get('status')=='OLD_APPLICATION_VERIFIED' and baseline_proof.get('fullRestoreCompatibility')=='NOT_PERFORMED','BASELINE_FORWARD_PROOF_REQUIRED')
 b=proofs['backup-restore'];need(b.get('restoreNotPerformed') is True and b.get('restoreAcceptance')=='NOT_PERFORMED','FALSE_RESTORE_CLAIM');archive=pinned(b['archive']);key=pinned(b['key']);need(archive.parent==attempt/'stopped-backup' and key.parent==archive.parent,'BACKUP_ATTEMPT');core.private_backup_files(archive,key)
 adapter=m['cn-tag-migration-adapter'].Adapter(attempt,ctx['fd']);metadata=read(pinned(b['metadata']));need(metadata.get('database')==adapter.cn.DB and metadata.get('role')=='migration_admin' and metadata.get('ledger') in (adapter.base,{**adapter.base,**core.MIGRATIONS}) and core.sha(json.dumps(metadata['ledger'],sort_keys=True).encode())==b['sourceLedgerSha256'],'BACKUP_METADATA_BINDING');need(b['sourceHost']==adapter.cn.HOST and b['database']==adapter.cn.DB and b['role']=='migration_admin','BACKUP_DATABASE_IDENTITY');need(adapter.execute('reconcile').get('status')=='COMPLETE','VERIFIER_LEDGER_DRIFT')
 images={s:ctx['manifest']['images'][r]['imageId'] for s,r in cfg['services'].items()};act.runtime_rows(d,cfg['project'],cfg['services'],images)
 accept=proofs['candidate-acceptance'];need(accept['images']==images and accept.get('restoreNotPerformed') is True,'CANDIDATE_PROOF_BINDING')
 bootstrap=accept['bootstrap'];raw=pinned(bootstrap['rawOutput']);need(raw.parent==attempt and re.fullmatch('bootstrap-raw-[a-f0-9]{32}[.]txt',raw.name),'BOOTSTRAP_RAW_PATH');load('tag-bootstrap-probe',ctx['policy']['closurePins']).validate_output(raw.read_bytes(),SOURCE,ctx['manifest']['images']['api']['image'].split('@')[-1])
 need(bootstrap.get('imageId')==ctx['manifest']['images']['api']['imageId'] and bootstrap.get('status')=='CANDIDATE_BOOTSTRAP_COMPATIBLE','BOOTSTRAP_CANDIDATE_IDENTITY')
 business_path=pinned(accept['publicBusiness']);need(business_path.parent==attempt,'BUSINESS_PROOF_PATH');business=read(business_path);need(business.get('scope')=='actual-public-browser' and 0<=time.time()-business['createdAt']<600 and b'CN_PUBLIC_BROWSER_PASSED' in bytes.fromhex(business['stdoutHex']),'ACTUAL_PUBLIC_BROWSER_PROOF')
 need(maint.pinned(ctx['base']['nginx']).read_bytes(),'NGINX_RESTORED')
 # Independent current public health + actual image/config check. The GHA outer
 # verifier additionally executes its unchanged pinned public-browser command.
 command=ctx['command']+['--file',str(attempt/'candidate-images.json')]
 health=engine.verify_runtime(d,command,cfg['services'],images,{**cfg,'verificationCommand':None,'readinessTimeoutSeconds':ctx['policy']['verifierSeconds']})
 act.live_config_cas(engine,d,d.json(command+['config','--format','json']),cfg['project'],act.runtime_rows(d,cfg['project'],cfg['services'],images),attempt)
 core.save(attempt/'independent-cn-verifier.json',{'status':'ACTUAL_COMPLETE_SCHEMA_AND_CANDIDATE_VERIFIED','source':SOURCE,'tag':TAG,'environment':'cn','restoreNotPerformed':True,'publicHealth':health,'createdAt':time.time(),'scope':'actual-ledger-runtime-health-and-original-public-browser-evidence'})
def main(mode):
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--request',required=True);parser.add_argument('--receipt',required=True);a=parser.parse_args();ctx=bind(a.request,a.receipt,mode);p=ctx['policy']
 previous={}
 def interrupted(*_):raise RuntimeError('CN_ONCE_INTERRUPTED')
 for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT,signal.SIGALRM):previous[sig]=signal.signal(sig,interrupted)
 try:
  signal.setitimer(signal.ITIMER_REAL,p['writerSeconds'] if mode=='writer' else p['verifierSeconds'])
  if mode=='writer':writer(ctx)
  else:verifier(ctx)
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for sig,handler in previous.items():signal.signal(sig,handler)
