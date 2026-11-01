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
 old_policy=read(p['maintenancePolicy']);maint.require_bootstrap(old_policy);maint.require_bootstrap(p);need(p['bootstrapProbe']==old_policy['bootstrapProbe'],'BOOTSTRAP_PROFILE_DRIFT');old_attempt=Path(p['maintenanceAttempt'])
 need(old_attempt.is_absolute() and re.fullmatch('tag-maintenance-[a-f0-9]{32}',old_attempt.name),'MAINTENANCE_ATTEMPT')
 need(json.loads(trusted(old_attempt/'policy.json',True).read_bytes())==old_policy,'ORIGINAL_POLICY_DRIFT')
 completed=json.loads(trusted(old_attempt/'receipt.json',True).read_bytes())
 need(completed.get('status')=='SCHEMA_COMPLETE_OLD_APPLICATION_AVAILABLE' and completed.get('source')==SOURCE and completed.get('tag')==TAG and completed.get('environment')==env,'MAINTENANCE_NOT_COMPLETE')
 need(old_policy['project']==config['project'] and set(config['services'])==maint.SERVICES,'PROJECT_SERVICE_BINDING')
 for ref in [*config['composeFiles'],config['envFile'],*old_policy['configurationPins']]:maint.pinned(ref)
 adapter=load(env+'-tag-migration-adapter').Adapter(old_attempt,lock_fd);adapter.require_backup()
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
 return dict(request=request,p=p,config=config,manifest=manifest,plan=plan,maint=maint,engine=engine,core=core,handoff=handoff,adapter=adapter,d=d,images=images,base=base,old_policy=old_policy,old_attempt=old_attempt,attempt=request_path.parent,fd=lock_fd)

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
  contents={'backup-restore':{'originalAttempt':str(ctx['old_attempt']),'qualification':{'path':str(ctx['old_attempt']/'stopped-backup/qualification.json'),'sha256':engine.sha_file(ctx['old_attempt']/'stopped-backup/qualification.json')}},'baseline-compatibility':{'originalMaintenanceReceipt':{'path':str(ctx['old_attempt']/'receipt.json'),'sha256':engine.sha_file(ctx['old_attempt']/'receipt.json')},'oldImages':old},'migration-ledger':{'status':'COMPLETE','originalAttempt':str(ctx['old_attempt']),'databaseMigrationExecuted':False},'candidate-acceptance':{'images':images,'health':health,'business':accepted,'bootstrap':bootstrap_proof}}
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
 ctx['adapter'].require_backup();need(ctx['adapter'].run('reconcile')['status']=='COMPLETE','VERIFIER_LEDGER_DRIFT')
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
