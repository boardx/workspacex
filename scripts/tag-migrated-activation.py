#!/usr/bin/env python3
"""Fixed-tag post-migration activation writer/verifier. Never executes DDL.

Root policy /etc/workspacex-image-release/<env>-tag-activation.json binds the
completed maintenance attempt and separately pinned candidate business probe.
"""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import time
HERE=Path(__file__).resolve().parent
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
def need(v,c):
 if not v:raise ValueError(c)
def trusted(path,private=False):
 p=Path(path);need(p.is_absolute(),'ROOT_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_PATH')
 need(p.is_file() and p.stat().st_nlink==1,'ROOT_FILE')
 if private:need(not p.stat().st_mode&0o077,'ROOT_PRIVATE_FILE')
 return p
def load(name):
 p=trusted(HERE/(name+'.py'));s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def budget(p,request,now=None):
 now=time.time() if now is None else now
 bootstrap=p.get('bootstrapProbe');need(type(bootstrap) is dict and type(bootstrap.get('timeoutSeconds')) is int and 5<=bootstrap['timeoutSeconds']<=60,'BOOTSTRAP_PROBE_REQUIRED')
 names=('activationSeconds','rollbackSeconds','verifierSeconds','outerVerificationSeconds')
 need(all(type(p.get(k)) is int and p[k]>=10 for k in names),'ACTIVATION_BUDGET_REQUIRED')
 need(sum(p[k] for k in names)+p['oldProbe']['timeoutSeconds']+40<=request['expiresAt']-now<=600,'ACTIVATION_BUDGET_INSUFFICIENT')
 need(p['candidateProbe']['timeoutSeconds']+2*p['runtimeSeconds']+bootstrap['timeoutSeconds']+45<=p['activationSeconds'],'CANDIDATE_BUDGET')
 need(p['oldProbe']['timeoutSeconds']+2*p['runtimeSeconds']+30<=p['rollbackSeconds'],'RECOVERY_BUDGET')

def exact_changes(plan,migrations):
 need(plan.get('complete') is True and plan.get('route')=='schema-preparation','COMPLETE_ADDITIVE_PLAN')
 changes=plan.get('changes',[])
 need(len(changes)==1 and changes[0]['role']=='api' and not changes[0]['removed'] and not changes[0]['changed'] and set(changes[0]['added'])==set(migrations),'EXACT_REVIEWED_CHANGE')

def runtime_rows(d,project,services,images):
 rows=[]
 for service in services:
  ids=d.run(['ps','--no-trunc','--quiet','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service='+service]).decode().split();need(len(ids)==1,'RUNNING_SERVICE_SET')
  rows_one=d.json(['inspect',ids[0]]);need(len(rows_one)==1,'CONTAINER_INSPECT_SET');x=rows_one[0];labels=x.get('Config',{}).get('Labels',{});need(labels.get('com.docker.compose.project')==project and labels.get('com.docker.compose.service')==service,'RUNNING_SERVICE_LABELS');need(x['Id']==ids[0] and x['Image']==images[service] and x['State']['Running'] is True and not x['State'].get('Restarting'),'RUNNING_IMAGE_BINDING');rows.append(x)
 need(len({x['Id'] for x in rows})==len(services),'DISTINCT_RUNNING_SERVICES');return rows

def live_config_cas(engine,d,original,project,rows,attempt):
 for row in rows:
  service=row['Config']['Labels']['com.docker.compose.service']
  expected=engine.resolved_config_hash(d,original,project,service,attempt)
  need(len(expected)==2 and expected[0]==service and row['Config']['Labels'].get('com.docker.compose.config-hash')==expected[1],'LIVE_CONFIG_DRIFT')

def require_current_backup(ctx):
 """Keep legacy proof strict; an explicit completed-schema proof is distinct."""
 fresh=ctx.get('complete_backup')
 if fresh is None:return ctx['adapter'].require_backup()
 return fresh['validate'](fresh['inputs'],fresh['image'],fresh['output'])

def recovery_identity(receipt,environment,original_attempt,original_policy_ref,now):
 need(environment=='us' and receipt.get('kind')=='complete-schema-recovery-v1' and receipt.get('status')=='COMPLETE_SCHEMA_RECOVERY_VERIFIED' and receipt.get('environment')==environment and receipt.get('sourceRevision')==SOURCE and receipt.get('tag')==TAG,'COMPLETE_RECOVERY_IDENTITY')
 need(receipt.get('originalAttempt')==str(original_attempt) and receipt.get('originalPolicy')==original_policy_ref,'COMPLETE_RECOVERY_ORIGINAL_BINDING')
 need(type(receipt.get('createdAt')) in (int,float) and 0<=now-receipt['createdAt']<1800,'COMPLETE_RECOVERY_EXPIRED')

def load_complete_core(inputs,maint):
 # Do not execute the new consumer before independently hashing its exact tool
 # closure from the original protected binding bytes using installed primitives.
 binding_path=maint.pinned(inputs['binding'],private=True);binding=json.loads(binding_path.read_bytes());pins=binding.get('toolPins',{})
 required={'schema-complete-restore.py','schema-restore-rehearsal.py','schema-acl-rehearsal.py','minimal-docker-release.py'}
 need(type(pins) is dict and set(pins)==required,'COMPLETE_CORE_TOOL_SET')
 for name,checksum in pins.items():maint.pinned({'path':str(HERE/name),'sha256':checksum})
 return load('schema-complete-restore')

def complete_recovery(p,request,config,original_policy,original_attempt,adapter,engine,maint,core,us,read,now=None):
 now=time.time() if now is None else now;ref=p.get('completeRecovery')
 need(type(ref) is dict and set(ref)=={'path','sha256'},'COMPLETE_RECOVERY_REFERENCE')
 receipt=read(ref);recovery_identity(receipt,request['environment'],original_attempt,p['maintenancePolicy'],now)
 history=receipt.get('originalHistory',{}).get('files',{})
 minimum={'policy.json','databaseCommand-apply.json','databaseCommand-reconcile.json','stopped-backup/qualification.json','stopped-backup/database.pgdump.enc','stopped-backup/backup.key','stopped-backup/isolated/intent.json','stopped-backup/isolated/restored.json','stopped-backup/isolated/receipt.json','stopped-backup/isolated/cleanup.json'}
 need(type(history) is dict and minimum<=set(history),'ORIGINAL_HISTORY_INCOMPLETE')
 actual={str(path.relative_to(original_attempt)) for path in original_attempt.rglob('*') if path.is_file() or path.is_symlink()}
 need(actual==set(history),'ORIGINAL_HISTORY_FILE_SET')
 for name,checksum in history.items():
  relative=Path(name);need(not relative.is_absolute() and '..' not in relative.parts,'ORIGINAL_HISTORY_PATH');maint.pinned({'path':str(original_attempt/relative),'sha256':checksum},private=True)
 ack_ref=receipt['originalAck'];need(ack_ref=={'path':str(original_attempt/'databaseCommand-apply.json'),'sha256':history['databaseCommand-apply.json']},'ORIGINAL_ACK_BINDING');ack=read(ack_ref)
 need(ack.get('status')=='COMMITTED' and ack.get('commitAcknowledged') is True and ack.get('ledgerCount')==438 and ack.get('environment')==request['environment'] and ack.get('source')==SOURCE and ack.get('tag')==TAG,'ORIGINAL_ACK_NOT_COMMITTED')
 old_reconcile=read({'path':str(original_attempt/'databaseCommand-reconcile.json'),'sha256':history['databaseCommand-reconcile.json']})
 need(old_reconcile.get('status')=='COMPLETE' and old_reconcile.get('source')==SOURCE and old_reconcile.get('tag')==TAG and old_reconcile.get('environment')==request['environment'],'ORIGINAL_RECONCILE_BINDING')
 backup=receipt['originalBackup'];need(backup.get('qualification')=={'path':str(original_attempt/'stopped-backup/qualification.json'),'sha256':history['stopped-backup/qualification.json']},'ORIGINAL_BACKUP_BINDING')
 ack_time=maint.pinned(ack_ref,private=True).stat().st_mtime
 need(type(backup.get('validAt')) in (int,float) and backup['validAt']==ack_time,'ORIGINAL_BACKUP_ACK_TIME')
 us.validate_backup(original_attempt,adapter.backup_identity(),core,trusted,now=ack_time)
 original_input=receipt.get('originalInputPolicy');need(type(original_input) is dict and set(original_input)=={'path','sha256'},'ORIGINAL_INPUT_POLICY_REQUIRED');need(read(original_input)==original_policy,'ORIGINAL_INPUT_POLICY_SEMANTICS')
 archive=receipt['pendingArchive'];archive_path=maint.pinned(archive,private=True)
 need(archive_path.parent==Path(config['stateDirectory']) and archive_path.name!='pending.json' and archive_path.name.startswith('pending'),'ORIGINAL_PENDING_ARCHIVE_PATH')
 archived=json.loads(archive_path.read_bytes());need(archived.get('attempt')==str(original_attempt) and archived.get('policySha256')==original_input['sha256'] and archived.get('source')==SOURCE and archived.get('tag')==TAG,'ORIGINAL_PENDING_ARCHIVE_BINDING')
 fresh_policy=read(receipt['freshPolicy']);recovery_attempt=Path(receipt['recoveryAttempt'])
 need(recovery_attempt.parent==Path(config['stateDirectory']) and re.fullmatch('tag-maintenance-[a-f0-9]{32}',recovery_attempt.name) and recovery_attempt!=original_attempt,'FRESH_RECOVERY_ATTEMPT')
 need(json.loads(trusted(recovery_attempt/'policy.json',True).read_bytes())==fresh_policy,'FRESH_POLICY_DRIFT')
 need(fresh_policy.get('kind')=='complete-schema-recovery' and fresh_policy.get('environment')==request['environment'] and fresh_policy.get('source')==SOURCE and fresh_policy.get('tag')==TAG and fresh_policy.get('project')==original_policy['project'] and fresh_policy.get('baseline')==original_policy['baseline'] and fresh_policy.get('usDatabase')==original_policy['usDatabase'],'FRESH_POLICY_ORIGINAL_RUNTIME_BINDING')
 need(type(fresh_policy.get('preparedAt')) in (int,float) and 0<=now-fresh_policy['preparedAt']<1800,'FRESH_POLICY_EXPIRED');maint.require_bootstrap(fresh_policy);maint.require_bootstrap(p);need(p['bootstrapProbe']==fresh_policy['bootstrapProbe'],'FRESH_BOOTSTRAP_PROFILE_DRIFT')
 fresh=receipt['freshBackup'];fresh_core=load_complete_core(fresh['inputs'],maint)
 qualification=maint.pinned(fresh['qualification'],private=True);need(qualification==Path(fresh['output'])/'qualification.json','FRESH_QUALIFICATION_PATH')
 result=fresh_core.validate_qualification(fresh['inputs'],fresh['image'],fresh['output'],now)
 need(result['qualificationSha256']==fresh['qualification']['sha256'],'FRESH_QUALIFICATION_HASH_DRIFT')
 need(read(fresh['inputs']['baselineLedger'])==original_policy['usDatabase']['baselineLedger'] and read(fresh['inputs']['completeLedger'])=={**original_policy['usDatabase']['baselineLedger'],**core.MIGRATIONS},'FRESH_LEDGER_ORIGINAL_BINDING')
 binding=result['sourceBinding'];need(binding.get('environment')==request['environment'] and binding.get('sourceRevision')==SOURCE and binding.get('tag')==TAG and binding.get('postgresImageId')==original_policy['usDatabase']['imageId'] and binding.get('sourceContainerId')==original_policy['usDatabase']['containerId'] and binding.get('targetApiImageId')==original_policy['usDatabase']['targetApiImageId'],'FRESH_SOURCE_BINDING')
 bootstrap=receipt['bootstrap'];raw_path=maint.pinned(bootstrap['raw'],private=True);bootstrap_receipt=read(bootstrap['receipt'])
 need(raw_path.parent==recovery_attempt and re.fullmatch('bootstrap-raw-[a-f0-9]{32}[.]txt',raw_path.name) and Path(bootstrap['receipt']['path']).parent==recovery_attempt and re.fullmatch('bootstrap-receipt-[a-f0-9]{32}[.]json',Path(bootstrap['receipt']['path']).name) and 0<=now-raw_path.stat().st_mtime<1800,'FRESH_BOOTSTRAP_RAW_PATH_TTL')
 manifest=read(request['manifest']);api=manifest['images']['api'];need(binding.get('targetApiRepoDigest')==api['image'],'FRESH_TARGET_DIGEST_BINDING');digest=api['image'].split('@')[-1]
 for name in ('tag-bootstrap-probe.py','schema-tag-prepare.py'):need(any(r.get('path')==str(HERE/name) for r in p['closure']),'BOOTSTRAP_VERIFIER_CLOSURE')
 probe_module=load('tag-bootstrap-probe');probe_module.validate_output(raw_path.read_bytes(),SOURCE,digest)
 need(bootstrap_receipt.get('status')=='CANDIDATE_BOOTSTRAP_COMPATIBLE' and bootstrap_receipt.get('source')==SOURCE and bootstrap_receipt.get('tag')==TAG and bootstrap_receipt.get('environment')==request['environment'] and bootstrap_receipt.get('imageId')==api['imageId'] and bootstrap_receipt.get('imageDigest')==digest and bootstrap_receipt.get('rawOutput')==bootstrap['raw'] and bootstrap_receipt.get('attempt')==str(recovery_attempt) and type(bootstrap_receipt.get('createdAt')) in (int,float) and 0<=now-bootstrap_receipt['createdAt']<1800,'FRESH_BOOTSTRAP_RECEIPT_BINDING')
 boot_binding=fresh_policy['bootstrapProbe']['binding'];need(bootstrap_receipt.get('baselineEnvSha256')==boot_binding['baselineEnvSha256'] and bootstrap_receipt.get('adminEnvSha256')==boot_binding['adminEnv']['sha256'] and bootstrap_receipt.get('network')==boot_binding['network'] and bootstrap_receipt.get('canonicalLock')==request['canonicalLock'],'FRESH_BOOTSTRAP_INPUT_BINDING')
 business_path=maint.pinned(receipt['business'],private=True);business=read(receipt['business']);need(business_path.parent==recovery_attempt and 0<=now-business_path.stat().st_mtime<1800 and business.get('status')=='OLD_APPLICATION_VERIFIED' and business.get('source')==SOURCE and business.get('tag')==TAG and business.get('environment')==request['environment'],'FRESH_BUSINESS_NOT_VERIFIED')
 return {'policy':fresh_policy,'attempt':recovery_attempt,'receipt':ref,'backup':{'validate':fresh_core.validate_qualification,'inputs':fresh['inputs'],'image':fresh['image'],'output':fresh['output'],'qualification':fresh['qualification']}}

def bind_context(request_path):
 need(os.geteuid()==0,'ROOT_REQUIRED')
 for name in ('tag-migrated-activation','schema-release-handoff','tag-maintenance-release','minimal-docker-release','schema-restore-rehearsal','us-tag-migration-adapter'):trusted(HERE/(name+'.py'))
 maint=load('tag-maintenance-release');handoff=load('schema-release-handoff');engine=load('minimal-docker-release');core=load('schema-restore-rehearsal');us=load('us-tag-migration-adapter')
 request_path=trusted(request_path,True);request=json.loads(request_path.read_bytes());env=request.get('environment')
 need(env in ('cn','us') and request.get('sourceRevision')==SOURCE and request.get('tag')==TAG and request.get('kind')=='schema-release-request-v1','REQUEST_IDENTITY')
 p=json.loads(trusted('/etc/workspacex-image-release/'+env+'-tag-activation.json',True).read_bytes())
 need(p['source']==SOURCE and p['tag']==TAG and p['environment']==env,'ACTIVATION_POLICY_IDENTITY')
 for ref in p['closure']:maint.pinned(ref)
 read=lambda ref:json.loads(maint.pinned(ref,private=True).read_bytes())
 config=read(request['config']);manifest=read(request['manifest']);plan=read(request['schemaPlan'])
 need(request_path.parent.parent==Path(config['stateDirectory']) and re.fullmatch('attempt-[a-f0-9]{32}',request_path.parent.name),'CONSUMER_ATTEMPT_BINDING')
 pending=json.loads(trusted(Path(config['stateDirectory'])/'pending.json',True).read_bytes())
 need(pending.get('attempt')==str(request_path.parent) and pending.get('requestSha256')==engine.sha_file(request_path),'PENDING_REQUEST_BINDING')
 need(type(request.get('expiresAt')) is int and time.time()<request['expiresAt'],'REQUEST_EXPIRED')
 need(request['manifest']['sha256']==request['manifestSha256'] and plan['planSha256']==request['planSha256'],'REQUEST_PIN_BINDING');exact_changes(plan,core.MIGRATIONS)
 need(p['outerVerificationSeconds']>=config.get('readinessTimeoutSeconds',120),'OUTER_VERIFY_BUDGET')
 need(manifest['sourceRevision']==SOURCE and manifest['tag']==TAG and set(manifest['images'])=={'api','web','agent','sandbox','postgres'},'MANIFEST_IDENTITY')
 lock_fd=int(os.environ.get('WSX_RELEASE_LOCK_FD','-1'));us.inherited_lock(lock_fd,maint.canonical_lock({'environment':env,'lockFile':config['lockFile']}))
 lock=os.fstat(lock_fd);need(request['canonicalLock']=={'path':config['lockFile'],'device':lock.st_dev,'inode':lock.st_ino},'REQUEST_LOCK_BINDING')
 old_policy=read(p['maintenancePolicy']);old_attempt=Path(p['maintenanceAttempt'])
 need(old_attempt.is_absolute() and re.fullmatch('tag-maintenance-[a-f0-9]{32}',old_attempt.name),'MAINTENANCE_ATTEMPT')
 need(json.loads(trusted(old_attempt/'policy.json',True).read_bytes())==old_policy,'ORIGINAL_POLICY_DRIFT')
 original_attempt=old_attempt;adapter=load(env+'-tag-migration-adapter').Adapter(original_attempt,lock_fd);recovery=None
 if 'completeRecovery' in p:
  recovery=complete_recovery(p,request,config,old_policy,original_attempt,adapter,engine,maint,core,us,read)
  old_policy=recovery['policy'];old_attempt=recovery['attempt']
 else:
  maint.require_bootstrap(old_policy);maint.require_bootstrap(p);need(p['bootstrapProbe']==old_policy['bootstrapProbe'],'BOOTSTRAP_PROFILE_DRIFT')
  completed=json.loads(trusted(old_attempt/'receipt.json',True).read_bytes())
  need(completed.get('status')=='SCHEMA_COMPLETE_OLD_APPLICATION_AVAILABLE' and completed.get('source')==SOURCE and completed.get('tag')==TAG and completed.get('environment')==env,'MAINTENANCE_NOT_COMPLETE')
  adapter.require_backup()
 need(old_policy['project']==config['project'] and set(config['services'])==maint.SERVICES,'PROJECT_SERVICE_BINDING')
 for ref in [*config['composeFiles'],config['envFile'],*old_policy['configurationPins']]:maint.pinned(ref)
 need(adapter.run('reconcile')['status']=='COMPLETE','LIVE_MIGRATION_NOT_COMPLETE')
 # No caller can feed a successful status: both old and candidate probes are
 # hash-pinned executables under the separately protected activation policy.
 for probe in (p['candidateProbe'],p['oldProbe'],p['bootstrapProbe']):
  maint.pinned(probe['executable'])
  for ref in probe.get('inputs',[]):maint.pinned(ref,private=ref.get('private',False))
 d=engine.Docker(config['docker']);images={s:manifest['images'][r]['imageId'] for s,r in config['services'].items()}
 for role,row in manifest['images'].items():
  engine.image(d,row['imageId'],SOURCE);ins=d.json(['image','inspect',row['imageId']]);need(len(ins)==1 and row['image'] in ins[0].get('RepoDigests',[]),'REGISTRY_DIGEST_IDENTITY')
 base=['compose','--project-name',config['project'],'--env-file',config['envFile']['path']]
 for ref in config['composeFiles']:base+=['--file',ref['path']]
 return dict(request=request,p=p,config=config,manifest=manifest,plan=plan,maint=maint,engine=engine,core=core,handoff=handoff,adapter=adapter,d=d,images=images,base=base,old_policy=old_policy,old_attempt=old_attempt,attempt=request_path.parent,fd=lock_fd,complete_backup=recovery['backup'] if recovery else None,complete_recovery=recovery['receipt'] if recovery else None,history_attempt=original_attempt)

def probe(ctx,which,attempt):
 p=ctx['p'][which];host=ctx['maint'].Host(ctx['old_policy'],attempt,ctx['fd'])
 for ref in p.get('inputs',[]):ctx['maint'].pinned(ref,private=ref.get('private',False))
 raw=host.run([str(ctx['maint'].pinned(p['executable'])),'verify',str(attempt)],p['timeoutSeconds'])
 need(len(raw)<=65536,'PROBE_BOUND');value=json.loads(raw)
 need(value.get('status') in ('OLD_APPLICATION_VERIFIED','CANDIDATE_APPLICATION_VERIFIED') and value.get('source')==SOURCE and value.get('tag')==TAG and value.get('environment')==ctx['request']['environment'],'ACTUAL_BUSINESS_PROBE_FAILED');return value

def loopback_health(environment,config,timeout,run):
 host={'us':'appv1.boardx.us','cn':'app.boardx.com.cn'}.get(environment)
 need(host and config.get('url')=='https://'+host+'/api/healthz','LOOPBACK_HEALTH_URL_BINDING')
 expected=config.get('expected');need(type(expected) is dict and bool(expected),'LOOPBACK_HEALTH_EXPECTED')
 need(type(timeout) in (int,float) and 0<timeout<=10,'LOOPBACK_HEALTH_TIMEOUT')
 # --resolve changes routing only. HTTPS hostname/SNI and system certificate
 # verification remain mandatory; no redirects, proxy, alternate CA or -k.
 args=['/usr/bin/curl','--disable','--silent','--show-error','--fail','--noproxy','*',
       '--proto','=https','--tlsv1.2','--max-redirs','0','--connect-timeout',str(min(timeout,3)),
       '--max-time',str(timeout),'--max-filesize','65536','--resolve',host+':443:127.0.0.1',
       '--write-out','\\n%{http_code}',config['url']]
 raw=run(args,timeout=timeout)
 need(len(raw)<=65540,'LOOPBACK_HEALTH_SIZE')
 body,status=raw.rsplit(b'\n',1);need(status==b'200','LOOPBACK_HEALTH_HTTP')
 value=json.loads(body);need(type(value) is dict and all(value.get(k)==v for k,v in expected.items()),'LOOPBACK_HEALTH_BODY')
 return {'httpStatus':200,'expectedFieldsMatched':True,'routing':'loopback-tls','tlsVerification':True}

def verify_held_runtime(ctx,command,images):
 engine=ctx['engine'];host=ctx['maint'].Host(ctx['old_policy'],ctx['attempt'],ctx['fd'])
 original_health=engine.health
 # The existing verifier still checks exact images, states and health. Only its
 # transport is scoped to this synchronous held-traffic invocation.
 engine.health=lambda config,timeout:loopback_health(ctx['request']['environment'],config,timeout,host.run)
 try:
  return engine.verify_runtime(ctx['d'],command,ctx['config']['services'],images,
      {**ctx['config'],'verificationCommand':None,'readinessTimeoutSeconds':ctx['p']['runtimeSeconds']})
 finally:engine.health=original_health

def activate(ctx,receipt_path):
 p=ctx['p'];request=ctx['request'];maint=ctx['maint'];engine=ctx['engine'];attempt=ctx['attempt'];d=ctx['d'];config=ctx['config'];base=ctx['base'];images=ctx['images']
 budget(p,request)
 old={s:ctx['old_policy']['baseline'][s]['imageId'] for s in config['services']}
 rows=runtime_rows(d,config['project'],config['services'],old)
 need(all(x['Id']==ctx['old_policy']['baseline'][x['Config']['Labels']['com.docker.compose.service']]['containerId'] for x in rows),'BASELINE_CONTAINER_CAS')
 # Recompute actual inventories from stopped images, not only saved plan bytes.
 for role in ('api','agent'):
  service=next(s for s,r in config['services'].items() if r==role)
  need(engine.schema(d,old[service],role,attempt)==ctx['plan']['baselineInventories'][role] and engine.schema(d,images[service],role,attempt)==ctx['plan']['candidateInventories'][role],'INVENTORY_DRIFT')
 original=d.json(base+['config','--format','json']);live_config_cas(engine,d,original,config['project'],rows,attempt);overlay=attempt/'activation-images.json';rollback=attempt/'activation-old-images.json'
 engine.save(overlay,{'services':{s:{'image':i} for s,i in images.items()}});engine.save(rollback,{'services':{s:{'image':i} for s,i in old.items()}})
 expected=copy.deepcopy(original)
 for s,i in images.items():expected['services'][s]['image']=i
 command=base+['--file',str(overlay)];need(d.json(command+['config','--format','json'])==expected,'NON_IMAGE_CONFIG_CHANGE')
 probe(ctx,'oldProbe',ctx['old_attempt'])
 nginx=maint.pinned(p['nginx']);original_nginx=nginx.read_bytes();held=maint.maintenance_bytes(original_nginx,request['environment']);hold=False;mutated=False
 maint.save(attempt/'activation-intent.json',{'source':SOURCE,'tag':TAG,'databaseMigrationExecuted':False,'automaticRetry':False})
 host=maint.Host(ctx['old_policy'],attempt,ctx['fd'])
 previous_alarm=signal.getsignal(signal.SIGALRM)
 def deadline(*_):raise RuntimeError('ACTIVATION_STAGE_DEADLINE')
 signal.signal(signal.SIGALRM,deadline);signal.setitimer(signal.ITIMER_REAL,p['activationSeconds'])
 try:
  host.nginx(original_nginx,held);hold=True
  for ref in [*config['composeFiles'],config['envFile']]:maint.pinned(ref)
  need(ctx['adapter'].run('reconcile')['status']=='COMPLETE','FINAL_LEDGER_DRIFT')
  require_current_backup(ctx)
  bootstrap_host=maint.Host(ctx['old_policy'],ctx['old_attempt'],ctx['fd'])
  bootstrap_proof=bootstrap_host.adapter('bootstrapProbe','preactivate');need(bootstrap_proof['status']=='CANDIDATE_BOOTSTRAP_COMPATIBLE','PREACTIVATION_BOOTSTRAP_UNPROVEN')
  live_config_cas(engine,d,original,config['project'],runtime_rows(d,config['project'],config['services'],old),attempt)
  mutated=True;d.run(command+['up','--detach','--no-deps','--pull','never','--no-build',*config['services']],timeout=p['runtimeSeconds'])
  health=verify_held_runtime(ctx,command,images)
  # Candidate probe gets private expected actual image/container identities.
  candidate=attempt/('tag-maintenance-'+os.urandom(16).hex());candidate.mkdir(mode=0o700)
  candidate_policy=copy.deepcopy(ctx['old_policy']);live=runtime_rows(d,config['project'],config['services'],images)
  candidate_policy['baseline']={x['Config']['Labels']['com.docker.compose.service']:{'containerId':x['Id'],'imageId':x['Image']} for x in live};maint.save(candidate/'policy.json',candidate_policy)
  accepted=probe(ctx,'candidateProbe',candidate)
  need(ctx['adapter'].run('reconcile')['status']=='COMPLETE','POST_ACTIVATION_LEDGER_DRIFT')
  host.nginx(held,original_nginx);hold=False
  proofs={}
  fresh=ctx.get('complete_backup')
  backup_evidence={'schemaState':'COMPLETE','sqlNotReplayed':True,'qualification':fresh['qualification'],'recoveryReceipt':ctx['complete_recovery']} if fresh else {'originalAttempt':str(ctx['old_attempt']),'qualification':{'path':str(ctx['old_attempt']/'stopped-backup/qualification.json'),'sha256':engine.sha_file(ctx['old_attempt']/'stopped-backup/qualification.json')}}
  baseline_evidence={'completeRecoveryReceipt':ctx['complete_recovery'],'originalAttempt':str(ctx['history_attempt']),'oldImages':old} if fresh else {'originalMaintenanceReceipt':{'path':str(ctx['old_attempt']/'receipt.json'),'sha256':engine.sha_file(ctx['old_attempt']/'receipt.json')},'oldImages':old}
  contents={'backup-restore':backup_evidence,'baseline-compatibility':baseline_evidence,'migration-ledger':{'status':'COMPLETE','originalAttempt':str(ctx['old_attempt']),'databaseMigrationExecuted':False},'candidate-acceptance':{'images':images,'health':health,'business':accepted,'bootstrap':bootstrap_proof}}
  for name,value in contents.items():
   path=attempt/(name+'.json');maint.save(path,{**value,'source':SOURCE,'tag':TAG,'environment':request['environment'],'createdAt':time.time()});proofs[name]={'path':str(path),'sha256':engine.sha_file(path)}
  result={k:request[k] for k in ctx['handoff'].IDENTITY};result.update(kind='schema-release-result-v1',status='SUCCEEDED',proofs=proofs);maint.save(receipt_path,result)
 except Exception:
  signal.setitimer(signal.ITIMER_REAL,p['rollbackSeconds'])
  failure={'status':'ACTIVATION_RECONCILIATION_REQUIRED','source':SOURCE,'tag':TAG,'databaseMigrationExecuted':False,'sqlRollbackAttempted':False}
  try:
   if not hold:host.nginx(original_nginx,held);hold=True
   need(ctx['adapter'].run('reconcile')['status']=='COMPLETE','RECOVERY_DATABASE_DRIFT')
   if mutated:d.run(base+['--file',str(rollback),'up','--detach','--no-deps','--pull','never','--no-build',*config['services']],timeout=p['runtimeSeconds'])
   verify_held_runtime(ctx,base+['--file',str(rollback)],old)
   # Original old policy checks old immutable CIDs; compose may recreate them.
   # Dedicated recovery probe must independently bind image IDs after recreation.
   recovery=attempt/('tag-maintenance-'+os.urandom(16).hex());recovery.mkdir(mode=0o700);rp=copy.deepcopy(ctx['old_policy']);live=runtime_rows(d,config['project'],config['services'],old);rp['baseline']={x['Config']['Labels']['com.docker.compose.service']:{'containerId':x['Id'],'imageId':x['Image']} for x in live};maint.save(recovery/'policy.json',rp);probe(ctx,'oldProbe',recovery)
   host.nginx(held,original_nginx);hold=False;failure['status']='OLD_APPLICATION_RESTORED_ON_FORWARD_SCHEMA'
  except Exception:failure['recovery']='OPERATOR_RECONCILIATION_REQUIRED'
  failure['maintenanceHeld']=hold;maint.save(attempt/'activation-failure.json',failure);raise
 finally:
  signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,previous_alarm)

def verify(ctx,receipt_path):
 need(time.time()<ctx['request']['expiresAt'],'VERIFIER_REQUEST_EXPIRED')
 result=ctx['handoff'].read_receipt(trusted(receipt_path,True));ctx['handoff'].verify_receipt(ctx['request'],result)
 for ref in result['proofs'].values():
  path=ctx['maint'].pinned(ref,private=True);need(path.parent==ctx['attempt'],'PROOF_ATTEMPT_BINDING');value=json.loads(path.read_bytes());need(value['source']==SOURCE and value['tag']==TAG and value['environment']==ctx['request']['environment'] and 0<=time.time()-value['createdAt']<600,'PROOF_IDENTITY_TTL')
 require_current_backup(ctx);need(ctx['adapter'].run('reconcile')['status']=='COMPLETE','VERIFIER_LEDGER_DRIFT')
 runtime_rows(ctx['d'],ctx['config']['project'],ctx['config']['services'],ctx['images'])
 # Outer consumer performs fresh actual health and pinned public business probe
 # before committing current.json; this verifier never claims browser acceptance.
 need(ctx['maint'].pinned(ctx['p']['nginx']).read_bytes(),'NGINX_RESTORATION_PIN')

def main():
 parser=argparse.ArgumentParser();parser.add_argument('mode',choices=('writer','verifier'));parser.add_argument('--request',required=True);parser.add_argument('--receipt',required=True);a=parser.parse_args()
 ctx=bind_context(a.request);receipt=Path(a.receipt);need(receipt.parent==ctx['attempt'],'RESULT_ATTEMPT_BINDING')
 if a.mode=='writer':activate(ctx,receipt)
 else:
  previous=signal.getsignal(signal.SIGALRM)
  def verifier_deadline(*_):raise RuntimeError('VERIFIER_DEADLINE')
  signal.signal(signal.SIGALRM,verifier_deadline);signal.setitimer(signal.ITIMER_REAL,ctx['p']['verifierSeconds'])
  try:verify(ctx,receipt)
  finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,previous)
if __name__=='__main__':
 def interrupted(*_):raise RuntimeError('ACTIVATION_INTERRUPTED')
 for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(sig,interrupted)
 try:main()
 except Exception:sys.exit(1)
