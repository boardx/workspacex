#!/usr/bin/env python3
"""Fixed DevApp compatible-schema release: no reset, force or epoch activation.

A partial native batch is a reconciliation boundary, never an automatic retry.
Historical ledger checksums are pinned independently and are never rewritten.
After the first GHA success, a separate locked admission adoption must produce
a NEW 447-entry plan and update its pointer; this writer never edits live pins
or overwrites the old 439-entry admission artifact.
"""
import hashlib
import json
from pathlib import Path
SOURCE='b3e9977de08b056a564058ca0419d85d421fdd4a';TAG='41388409479-1'
MIGRATIONS={
'20261101220000_personal_credit_packages.sql':'20ddf64f76f72d2b5f3d63f1384b98949ff54b35f63ce5063c8c1db140ad3497',
'20261101230000_personal_credit_terms.sql':'e8fe3d2e6819b5bf9a5144deb224c11a396c256b87a333a6f9a993cd366b28b3',
'20261101233000_personal_credit_schedule.sql':'bd1b2890bf796a2f4f9f81252ad14785552adb63228b1cb131e23ff2f5d21dad',
'20261102000000_welcome_credit_periods.sql':'c94bf050a2fcd69047611b8aae2fb90760f385c4ef083d2fae095ea4cf71c58f',
'20261102010000_personal_checkout_intents.sql':'9acd9454aa05ea3cbbcdfe9d4dff817d031c16a3d9889cff321fb3bd3035be3c',
'20261102020000_personal_payment_receipts.sql':'2ad9aa796dbf67dbc4f22fec614f1bcb598b529a0384ad51f87490418c9c8790',
'20261102030000_personal_stripe_bindings.sql':'3f1c986cbe657aca0d3f8da66455bb7122eedc11cbefbbbaafa94cbde891c4c7',
'20261102040000_personal_payment_recovery.sql':'f906ede8379875e1454f735004f9c94d4e283eb42b533444125aa08a3c53f6cd'}
def need(v,code):
 if not v:raise ValueError(code)
def ledger_state(baseline,current):
 import re
 need(type(baseline) is dict and len(baseline)==439 and not set(baseline)&set(MIGRATIONS) and all(type(k) is str and type(v) is str and re.fullmatch('[a-f0-9]{64}',v) for k,v in baseline.items()),'HISTORICAL_LEDGER_REQUIRED')
 need(type(current) is dict and all(current.get(k)==v for k,v in baseline.items()) and set(current)<=set(baseline)|set(MIGRATIONS) and all(current[k]==MIGRATIONS[k] for k in set(current)&set(MIGRATIONS)),'LEDGER_DRIFT')
 names=set(current)&set(MIGRATIONS)
 return 'COMPLETE' if names==set(MIGRATIONS) else 'PARTIAL' if names else 'BASELINE'
def check_epoch(value,required=False):
 need(type(value) is dict and type(value.get('exists')) is bool,'EPOCH_PROOF')
 if required:need(value['exists'] is True,'COMPLETE_EPOCH_REQUIRED')
 if value['exists']:need(value.get('rows')==[{'generation':None,'activated_at':None}],'EPOCH_NOT_DORMANT')
def reviewed_sql(files):
 need(type(files) is dict and set(files)==set(MIGRATIONS) and all(type(v) is bytes and hashlib.sha256(v).hexdigest()==MIGRATIONS[k] for k,v in files.items()),'EXACT_EIGHT_SQL_REQUIRED')
 return [(k,files[k].decode('utf8')) for k in sorted(files)]
def apply_once(adapter,record):
 before=adapter.read();need(before['state'] in ('BASELINE','COMPLETE'),'PARTIAL_BATCH_RECONCILIATION_REQUIRED')
 if before['state']=='COMPLETE':return {'status':'COMPLETE','migrationExecuted':False,'sqlReplayed':False}
 record({'status':'NATIVE_BATCH_INTENT','source':SOURCE,'tag':TAG,'automaticRetryAllowed':False})
 unknown=False
 try:result=adapter.apply();record({'status':'NATIVE_BATCH_RETURN','result':result})
 except Exception:unknown=True;record({'status':'NATIVE_BATCH_ACK_UNKNOWN','automaticRetryAllowed':False})
 if unknown:adapter.drain()
 after=adapter.reconcile();record({'status':'POST_BATCH_RECONCILE','result':after})
 need(after['state']=='COMPLETE','BATCH_RECONCILIATION_REQUIRED')
 return {'status':'COMPLETE','migrationExecuted':True,'commitAcknowledgementLost':unknown,'sqlReplayed':False}

import copy,importlib.util,os,re,signal,stat,subprocess,time,uuid
HERE=Path(__file__).resolve().parent
POLICY='/etc/workspacex-image-release/devapp-reviewed-tag-release.json';LOCK='/run/workspacex-devapp-deploy.lock'
CLOSURE=('devapp-reviewed-tag-release.py','devapp-reviewed-tag-writer.py','devapp-reviewed-tag-verifier.py','minimal-docker-release.py','schema-restore-rehearsal.py','schema-tag-prepare.py','schema-release-handoff.py','us-tag-migration-adapter.py','tag-migrated-activation.py')
def trusted(path,private=False):
 p=Path(path);need(p.is_absolute(),'ROOT_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_PATH')
 need(p.is_file() and p.stat().st_nlink==1,'ROOT_FILE')
 if private:need(not p.stat().st_mode&0o077,'PRIVATE_FILE')
 return p
def file_sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def ref(path):return {'path':str(path),'sha256':file_sha(path)}
def pinned(value,private=True):
 need(type(value) is dict and set(value)=={'path','sha256'},'PIN_FORMAT');p=trusted(value['path'],private);need(file_sha(p)==value['sha256'],'PIN_DRIFT');return p
def read(path,private=True):
 p=trusted(path,private);need(p.stat().st_size<=8*1024*1024,'INPUT_BOUND');return json.loads(p.read_bytes())
def load(name,pins):
 p=trusted(HERE/(name+'.py'));need(file_sha(p)==pins[p.name],'CODE_DRIFT');s=importlib.util.spec_from_file_location('devapp_'+name.replace('-','_'),p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def bind(request_path,receipt_path,mode):
 need(os.geteuid()==0,'ROOT_REQUIRED');policy=read(POLICY)
 need(policy.get('kind')=='devapp-exact-eight-release-v1' and policy.get('source')==SOURCE and policy.get('tag')==TAG and policy.get('restoreNotPerformed') is True,'FIXED_CAPABILITY')
 need(type(policy.get('expiresAt')) is int and time.time()<policy['expiresAt']<=time.time()+3600,'POLICY_EXPIRED')
 pins=policy.get('closurePins');need(type(pins) is dict and set(pins)==set(CLOSURE),'EXACT_CLOSURE')
 for name,checksum in pins.items():need(file_sha(trusted(HERE/name))==checksum,'CLOSURE_DRIFT')
 mods={n:load(n,pins) for n in ('minimal-docker-release','schema-restore-rehearsal','schema-tag-prepare','schema-release-handoff','us-tag-migration-adapter')}
 request=read(request_path);need(request.get('kind')=='schema-release-request-v1' and request.get('environment')=='devapp' and request.get('tag')==TAG and request.get('sourceRevision')==SOURCE and time.time()<request['expiresAt'],'REQUEST_IDENTITY')
 cfg=read(pinned(request['config']));manifest=read(pinned(request['manifest'],False),False);plan=read(pinned(request['schemaPlan']));attempt=Path(request_path).parent
 need(cfg['environment']=='devapp' and cfg['lockFile']==LOCK and cfg['project']=='workspacex-image' and cfg['docker']=='/usr/bin/docker','DEVAPP_BINDING')
 need(attempt.parent==Path(cfg['stateDirectory']) and re.fullmatch('attempt-[a-f0-9]{32}',attempt.name) and Path(receipt_path).parent==attempt,'ATTEMPT_BINDING')
 release_budget(policy,request,mode,cfg)
 need(request['manifestSha256']==request['manifest']['sha256'] and request['planSha256']==plan['planSha256'] and plan.get('complete') is True and plan.get('route')=='schema-preparation','PLAN_BINDING')
 need(plan==read(pinned(policy['reviewedPlan'])),'EXACT_REVIEWED_PLAN');exact_plan(plan)
 need(manifest.get('tag')==TAG and manifest.get('sourceRevision')==SOURCE and manifest['images']==policy['candidateImages'],'CANDIDATE_BINDING')
 base=policy['baselineLedger'];admission=read(pinned(policy['historicalAdmission']));need(base==admission.get('expectedLedger'),'HISTORICAL_LEDGER_BINDING');ledger_state(base,base)
 need(policy.get('trafficControl')=='stopped-five-applications','EXPLICIT_SHORT_STOP_REQUIRED')
 need(set(cfg['services'])=={'api','web','agent','sandbox','sandbox-sessions'} and set(policy['baseline'])==set(cfg['services']),'FIVE_APPLICATIONS_REQUIRED')
 need(type(policy.get('runtimeSeconds')) is int and 10<=policy['runtimeSeconds']<=120 and type(policy.get('rollbackSeconds')) is int and 60<=policy['rollbackSeconds']<=180,'BOUNDED_BUDGETS')
 fd=int(os.environ.get('WSX_RELEASE_LOCK_FD','-1'));mods['us-tag-migration-adapter'].inherited_lock(fd,LOCK);s=os.fstat(fd);need(request['canonicalLock']=={'path':LOCK,'device':s.st_dev,'inode':s.st_ino},'LOCK_BINDING')
 pending=read(Path(cfg['stateDirectory'])/'pending.json');need(pending.get('attempt')==str(attempt) and pending.get('requestSha256')==file_sha(request_path),'PENDING_BINDING')
 for r in (*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[])):pinned(r,False)
 need(type(cfg.get('verificationCommand')) is list and bool(cfg['verificationCommand']) and any(r['path']==cfg['verificationCommand'][0] for r in cfg.get('verificationFiles',[])),'PINNED_BUSINESS_REQUIRED')
 d=mods['minimal-docker-release'].Docker('/usr/bin/docker')
 for image in manifest['images'].values():mods['minimal-docker-release'].image(d,image['imageId'],SOURCE);need(image['image'] in d.json(['image','inspect',image['imageId']])[0].get('RepoDigests',[]),'IMAGE_DIGEST_BINDING')
 command=['compose','--project-name',cfg['project'],'--env-file',cfg['envFile']['path']]
 for r in cfg['composeFiles']:command+=['--file',r['path']]
 return dict(p=policy,request=request,cfg=cfg,manifest=manifest,attempt=attempt,receipt=Path(receipt_path),fd=fd,mods=mods,d=d,command=command,requestRef=ref(request_path),policyRef=ref(POLICY))

class Database:
 def __init__(self,ctx):
  self.ctx=ctx;self.d=ctx['d'];self.p=ctx['p'];self.prep=ctx['mods']['schema-tag-prepare'];self.pg=self.prep.inspect_one(self.d,self.p['postgres']['containerId'])
  need(self.pg['Id']=='9d94859e93f065341b1acdb882f0c1ce57380d6c5040e76ac3e14c4dc9e2128b' and self.pg['Image']=='sha256:ac24ce4f1fbd05eac05b966e3b7a4e189709c8bdff0bf822a4bcb73337449367' and self.pg['Image']==self.p['postgres']['imageId'] and self.pg['State']['Running'] is True and self.pg['Config']['Labels'].get('com.docker.compose.service')=='postgres','POSTGRES_BINDING')
  api=self.prep.live_service(self.d,ctx['cfg']['project'],'api');self.prep.source_binding(api,self.pg)
  self.prefix=['/usr/bin/docker','exec','--user','postgres',self.pg['Id'],'/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','PGOPTIONS=-c statement_timeout=30000 -c default_transaction_read_only=on']
 def query(self,sql):
  return self.d.run(self.prefix[1:]+['psql','--host=/var/run/postgresql','--port=5432','-X','-w','-qAt','--username=postgres','--dbname=workspacex','-v','ON_ERROR_STOP=1','-c',sql],limit=8*1024*1024,timeout=remaining(self.ctx,40)).decode().strip()
 def read(self):
  sql="BEGIN READ ONLY; SELECT json_build_object('database',current_database(),'role',current_user,'ledger',(SELECT json_object_agg(name,checksum) FROM public._kernel_migrations),'epochExists',to_regclass('public.billing_pricing_epoch') IS NOT NULL); ROLLBACK;"
  value=json.loads(self.query(sql));need(value['database']=='workspacex' and value['role']=='postgres','DATABASE_IDENTITY')
  epoch={'exists':False}
  if value['epochExists']:epoch={'exists':True,'rows':json.loads(self.query("BEGIN READ ONLY; SELECT COALESCE(json_agg(json_build_object('generation',generation,'activated_at',activated_at)),'[]'::json) FROM public.billing_pricing_epoch; ROLLBACK;"))}
  state=ledger_state(self.p['baselineLedger'],value['ledger']);check_epoch(epoch,required=state=='COMPLETE');return {'state':state,'ledger':value['ledger'],'epoch':epoch}
 def reconcile(self):return self.read()
 def stopped(self):
  for service,item in self.p['baseline'].items():
   row=self.prep.inspect_one(self.d,item['containerId']);labels=row.get('Config',{}).get('Labels',{});need(row['Id']==item['containerId'] and row['Image']==item['imageId'] and labels.get('com.docker.compose.project')==self.ctx['cfg']['project'] and labels.get('com.docker.compose.service')==service and row['State']['Running'] is False and not row['State'].get('Restarting'),'WRITERS_NOT_STOPPED')
  need(self.query("BEGIN READ ONLY; SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend')+(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()); ROLLBACK;")=='0','DATABASE_NOT_DRAINED')
 def drain_sessions(self):
  for label in ('wsx.devapp.eight','wsx.devapp.backup'):need(not self.d.run(['ps','--all','--quiet','--filter','label='+label]).strip(),'DATABASE_HELPER_STILL_PRESENT')
  need(self.query("BEGIN READ ONLY; SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend')+(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()); ROLLBACK;")=='0','DATABASE_NOT_DRAINED')
 def drain(self):self.stopped();self.drain_sessions()
 def dump(self,path):
  self.stopped();return encrypted_source_dump(self,path)
 def apply(self):
  self.stopped();need(self.read()['state']=='BASELINE','BASELINE_BEFORE_NATIVE_RUNNER')
  files=self.prep.exact_sql(self.d,self.p['candidateImages']['api']['imageId'],MIGRATIONS,type('Reviewed',(),{'reviewed_sql':staticmethod(reviewed_sql)})());reviewed_sql(files)
  sourceenv=self.prep.env_map(self.pg);need(sourceenv.get('POSTGRES_USER','postgres')=='postgres' and bool(sourceenv.get('POSTGRES_PASSWORD')),'SOURCE_OWNER_CREDENTIAL_REQUIRED')
  values={'PGHOST':'127.0.0.1','PGPORT':'5432','PGDATABASE':'workspacex','PGSSLMODE':'disable','MIGRATION_DB_USER':'postgres','MIGRATION_DB_PASSWORD':sourceenv['POSTGRES_PASSWORD']}
  need(all(not any(c in v for c in '\r\n\0') for v in values.values()),'OWNER_ENV_SERIALIZATION')
  token=uuid.uuid4().hex;envfile=self.ctx['attempt']/('migration-env-'+token);fd=os.open(envfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w') as stream:stream.write('\n'.join(k+'='+v for k,v in values.items())+'\n');stream.flush();os.fsync(stream.fileno())
  name='wsx-devapp-eight-'+token;label='wsx.devapp.eight='+token;image=self.p['candidateImages']['api']['imageId']
  js="""import fs from 'node:fs';import{createHash}from'node:crypto';import{migrationConfig}from'./src/infrastructure/db/pg-config.ts';import{migrate}from'./src/infrastructure/db/migrator.ts';try{const x=JSON.parse(fs.readFileSync(0,'utf8'));const dir=fs.mkdtempSync('/tmp/exact-eight-');for(const[n,v]of Object.entries(x.files)){if(createHash('sha256').update(v).digest('hex')!==x.hashes[n])throw Error('HASH');fs.writeFileSync(dir+'/'+n,v);}const r=await migrate(migrationConfig(),{force:false,dir});console.log(JSON.stringify({status:'NATIVE_BATCH_COMPLETE',applied:r.applied,skipped:r.skipped}));}catch{console.log(JSON.stringify({status:'NATIVE_BATCH_FAILED'}));process.exitCode=1;}"""
  args=['/usr/bin/docker','run','--rm','--pull=never','--name',name,'--label',label,'--network','container:'+self.pg['Id'],'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--pids-limit=128','--tmpfs','/tmp:rw,nosuid,nodev,size=32m','--env-file',str(envfile),'--workdir','/opt/workspacex/apps/api','--entrypoint','node','-i',image,'--import','tsx','--input-type=module','-e',js]
  try:
   r=subprocess.run(args,input=json.dumps({'files':{k:v.decode() for k,v in files.items()},'hashes':MIGRATIONS}).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=remaining(self.ctx,180),env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8'});need(r.returncode==0 and len(r.stdout)<=65536,'NATIVE_BATCH_UNCERTAIN');v=json.loads(r.stdout);need(v.get('status')=='NATIVE_BATCH_COMPLETE' and set(v.get('applied',[]))==set(MIGRATIONS) and v.get('skipped')==[],'NATIVE_BATCH_RESULT');return v
  finally:
   envfile.unlink(missing_ok=True)
   ids=self.d.run(['ps','--all','--quiet','--no-trunc','--filter','label='+label]).decode().split();need(len(ids)<=1,'HELPER_AMBIGUOUS')
   for cid in ids:
    x=self.prep.inspect_one(self.d,cid);need(x['Name']=='/'+name and x['Image']==image and x['Config']['Labels'].get('wsx.devapp.eight')==token and x['HostConfig']['NetworkMode']=='container:'+self.pg['Id'],'HELPER_OWNER');self.d.run(['rm','--force',cid])
   need(not self.d.run(['ps','--all','--quiet','--filter','label='+label]).strip(),'HELPER_CLEANUP_UNPROVEN')

def remaining(ctx,limit):
 deadline=ctx.get('operationDeadline')
 if deadline is None:return limit
 value=deadline-time.monotonic();need(value>0,'OPERATION_DEADLINE');return min(limit,value)

def run(ctx,args,timeout=120):
 child=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,pass_fds=(ctx['fd'],),env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8','WSX_RELEASE_LOCK_FD':str(ctx['fd'])})
 try:out,_=child.communicate(timeout=remaining(ctx,timeout))
 except BaseException:
  if child.poll() is None:
   child.terminate()
   try:child.communicate(timeout=15)
   except subprocess.TimeoutExpired:child.kill();child.communicate(timeout=5)
  raise
 need(child.returncode==0 and len(out)<=65536,'HOST_COMMAND_FAILED');return out

def business(ctx,phase):
 core=ctx['mods']['schema-restore-rehearsal'];core.save(ctx['attempt']/(phase+'-once.json'),{'source':SOURCE,'tag':TAG,'automaticRetryAllowed':False})
 command=ctx['cfg']['verificationCommand'];raw=run(ctx,command,ctx['p']['runtimeSeconds']);path=ctx['attempt']/(phase+'-business.json');core.save(path,{'source':SOURCE,'tag':TAG,'createdAt':time.time(),'command':command,'exitCode':0,'stdoutHex':raw.hex(),'scope':'actual-configured-business-probe'});return ref(path)
def health(ctx,command,images,held=False):
 engine=ctx['mods']['minimal-docker-release'];original=engine.health
 def loopback(config,timeout):
  need(config['url']=='https://devapp.boardx.us/api/healthz','HEALTH_IDENTITY')
  raw=run(ctx,['/usr/bin/curl','--disable','--silent','--show-error','--fail','--noproxy','*','--proto','=https','--tlsv1.2','--max-redirs','0','--max-time',str(timeout),'--resolve','devapp.boardx.us:443:127.0.0.1','--max-filesize','65536',config['url']],timeout+1);v=json.loads(raw);need(all(v.get(k)==x for k,x in config['expected'].items()),'HEALTH_BODY');return {'expectedFieldsMatched':True,'tlsVerification':True,'routing':'loopback'}
 if held:engine.health=loopback
 try:return engine.verify_runtime(ctx['d'],command,ctx['cfg']['services'],images,{**ctx['cfg'],'verificationCommand':None,'readinessTimeoutSeconds':ctx['p']['runtimeSeconds']})
 finally:engine.health=original

def writer(ctx):
 core=ctx['mods']['schema-restore-rehearsal'];prep=ctx['mods']['schema-tag-prepare'];engine=ctx['mods']['minimal-docker-release'];act=load('tag-migrated-activation',ctx['p']['closurePins']);d=ctx['d'];p=ctx['p'];cfg=ctx['cfg'];attempt=ctx['attempt'];database=Database(ctx)
 barrier=Path(cfg['stateDirectory'])/('devapp-'+TAG+'-once.json');need(not barrier.exists() and not barrier.is_symlink(),'CAPABILITY_ALREADY_SPENT')
 old={s:p['baseline'][s]['imageId'] for s in cfg['services']};images={s:ctx['manifest']['images'][r]['imageId'] for s,r in cfg['services'].items()};rows=act.runtime_rows(d,cfg['project'],cfg['services'],old);need(all(x['Id']==p['baseline'][x['Config']['Labels']['com.docker.compose.service']]['containerId'] for x in rows),'BASELINE_CID')
 original=d.json(ctx['command']+['config','--format','json']);act.live_config_cas(engine,d,original,cfg['project'],rows,attempt)
 overlay=attempt/'candidate-images.json';rollback=attempt/'baseline-images.json';core.save(overlay,{'services':{s:{'image':v} for s,v in images.items()}});core.save(rollback,{'services':{s:{'image':v} for s,v in old.items()}})
 command=ctx['command']+['--file',str(overlay)];old_command=ctx['command']+['--file',str(rollback)];expected=copy.deepcopy(original)
 for s,v in images.items():expected['services'][s]['image']=v
 need(d.json(command+['config','--format','json'])==expected,'NON_IMAGE_CONFIG_CHANGE')
 before=database.read();need(before['state'] in ('BASELINE','COMPLETE'),'PARTIAL_BATCH_RECONCILIATION_REQUIRED')
 core.save(barrier,{'source':SOURCE,'tag':TAG,'request':ctx['requestRef'],'policy':ctx['policyRef'],'automaticRetryAllowed':False,'createdAt':time.time()});mutated=False;events=[]
 def record(v):events.append(v);core.save(attempt/('migration-event-'+str(len(events))+'.json'),v)
 try:
  d.run(old_command+['stop','--timeout','30',*cfg['services']],timeout=90);database.stopped();need(database.read()==before,'STOPPED_DATABASE_DRIFT')
  backup=attempt/'backup';backup.mkdir(mode=0o700);archive,key=database.dump(backup);backup_files(archive,key);need(database.read()==before,'BACKUP_DATABASE_DRIFT');core.save(backup/'source.json',before)
  transaction=apply_once(database,record);need(database.read()['state']=='COMPLETE','POST_BATCH_COMPLETE_REQUIRED')
  # Original application must run on the resulting forward schema before switch.
  d.run(old_command+['start',*cfg['services']],timeout=p['runtimeSeconds']);health(ctx,old_command,old);baseline_business=business(ctx,'baseline-forward')
  for r in (*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[])):pinned(r,False)
  need(d.json(command+['config','--format','json'])==expected,'FINAL_CONFIG_DRIFT');act.live_config_cas(engine,d,original,cfg['project'],act.runtime_rows(d,cfg['project'],cfg['services'],old),attempt);need(database.read()['state']=='COMPLETE','PRE_UP_LEDGER_DRIFT')
  mutated=True;d.run(command+['up','--detach','--no-deps','--pull','never','--no-build',*cfg['services']],timeout=p['runtimeSeconds']);candidate_health=health(ctx,command,images)
  public_business=business(ctx,'candidate');health(ctx,command,images);after=database.read();need(after['state']=='COMPLETE','FINAL_LEDGER_DRIFT');check_epoch(after['epoch'])
  contents={'backup-restore':{'archive':ref(archive),'key':ref(key),'source':ref(backup/'source.json'),'restoreNotPerformed':True},'baseline-compatibility':{'oldImages':old,'actualForwardSchemaHealth':True,'business':baseline_business,'resetPerformed':False},'migration-ledger':{**transaction,'baselineLedger':p['baselineLedger'],'completeLedger':after['ledger'],'epoch':after['epoch'],'force':False,'resetPerformed':False},'candidate-acceptance':{'images':images,'health':candidate_health,'business':public_business,'epochActivated':False}}
  proofs={}
  for name,v in contents.items():path=attempt/(name+'.json');core.save(path,{**v,'sourceRevision':SOURCE,'tag':TAG,'createdAt':time.time()});proofs[name]=ref(path)
  result={k:ctx['request'][k] for k in ctx['mods']['schema-release-handoff'].IDENTITY};result.update(kind='schema-release-result-v1',status='SUCCEEDED',proofs=proofs,restoreNotPerformed=True,postSuccessAdmissionAdoptionRequired=True,historicalAdmission=p['historicalAdmission']);core.save(ctx['receipt'],result)
 except BaseException:
  signal.setitimer(signal.ITIMER_REAL,p['rollbackSeconds']);ctx['operationDeadline']=time.monotonic()+p['rollbackSeconds'];failure={'status':'RECONCILIATION_REQUIRED','automaticRetryAllowed':False,'sqlRollbackAttempted':False,'restoreNotPerformed':True}
  try:
   d.run(command+['stop','--timeout','30',*cfg['services']],timeout=90)
   database.drain_sessions();observed=database.reconcile();need(observed['state'] in ('BASELINE','COMPLETE'),'UNKNOWN_SCHEMA_STATE')
   for r in (*cfg['composeFiles'],cfg['envFile']):pinned(r,False)
   need(d.json(old_command+['config','--format','json'])==original,'ROLLBACK_CONFIG_DRIFT');d.run(old_command+['up','--detach','--no-deps','--pull','never','--no-build',*cfg['services']],timeout=p['runtimeSeconds']);health(ctx,old_command,old)
   # Release traffic only after actual old configured business probe succeeds.
   business(ctx,'recovery');failure.update(status='OLD_APPLICATION_RESTORED_ON_OBSERVED_SCHEMA',schemaState=observed['state'])
  except BaseException:failure['recovery']='OPERATOR_REQUIRED'
  failure['trafficControl']='stopped-five-applications';core.save(attempt/'failure.json',failure);raise

def verify_business_proof(ctx,value,phase):
 path=pinned(value);need(path.parent==ctx['attempt'] and path.name==phase+'-business.json','BUSINESS_ATTEMPT')
 v=read(path);need(v.get('command')==ctx['cfg']['verificationCommand'] and type(v.get('exitCode')) is int and v['exitCode']==0 and v.get('source')==SOURCE and v.get('tag')==TAG and type(v.get('createdAt')) in (int,float) and 0<=time.time()-v['createdAt']<600,'VERIFIER_BUSINESS')

def verifier(ctx):
 handoff=ctx['mods']['schema-release-handoff'];result=read(ctx['receipt']);handoff.verify_receipt(ctx['request'],result);need(result.get('restoreNotPerformed') is True,'RESTORE_SCOPE')
 proofs={}
 for name,r in result['proofs'].items():
  path=pinned(r);need(path.parent==ctx['attempt'],'PROOF_ATTEMPT');v=read(path);need(v['sourceRevision']==SOURCE and v['tag']==TAG and 0<=time.time()-v['createdAt']<600,'PROOF_IDENTITY');proofs[name]=v
 baseline=proofs['baseline-compatibility'];need(baseline.get('oldImages')=={s:ctx['p']['baseline'][s]['imageId'] for s in ctx['cfg']['services']} and baseline.get('actualForwardSchemaHealth') is True and baseline.get('resetPerformed') is False and type(baseline.get('business')) is dict,'VERIFIER_BASELINE_COMPATIBILITY');verify_business_proof(ctx,baseline['business'],'baseline-forward')
 core=ctx['mods']['schema-restore-rehearsal'];b=proofs['backup-restore'];need(b.get('restoreNotPerformed') is True,'RESTORE_NOT_PERFORMED_REQUIRED');backup_files(pinned(b['archive']),pinned(b['key']));source=read(pinned(b['source']));ledger_state(ctx['p']['baselineLedger'],source['ledger']);check_epoch(source['epoch'])
 database=Database(ctx);current=database.read();need(current['state']=='COMPLETE','VERIFIER_LEDGER');proof=proofs['migration-ledger'];need(proof['baselineLedger']==ctx['p']['baselineLedger'] and proof['completeLedger']==current['ledger'] and proof.get('force') is False and proof.get('resetPerformed') is False and proof.get('epoch')==current['epoch'],'VERIFIER_HISTORY')
 images={s:ctx['manifest']['images'][r]['imageId'] for s,r in ctx['cfg']['services'].items()};need(proofs['candidate-acceptance']['images']==images,'VERIFIER_IMAGES');verify_business_proof(ctx,proofs['candidate-acceptance']['business'],'candidate')
 command=ctx['command']+['--file',str(ctx['attempt']/'candidate-images.json')];health(ctx,command,images)
 act=load('tag-migrated-activation',ctx['p']['closurePins']);rows=act.runtime_rows(ctx['d'],ctx['cfg']['project'],ctx['cfg']['services'],images);act.live_config_cas(ctx['mods']['minimal-docker-release'],ctx['d'],ctx['d'].json(command+['config','--format','json']),ctx['cfg']['project'],rows,ctx['attempt'])

def main(mode):
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--request',required=True);parser.add_argument('--receipt',required=True);args=parser.parse_args();ctx=bind(args.request,args.receipt,mode);previous={}
 def interrupted(*_):raise RuntimeError('DEVAPP_RELEASE_INTERRUPTED')
 for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT,signal.SIGALRM):previous[sig]=signal.signal(sig,interrupted)
 try:
  seconds=ctx['p']['writerSeconds'] if mode=='writer' else ctx['p']['verifierSeconds'];need(seconds>10,'RELEASE_BUDGET');signal.setitimer(signal.ITIMER_REAL,seconds);ctx['operationDeadline']=time.monotonic()+seconds
  (writer if mode=='writer' else verifier)(ctx)
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for sig,handler in previous.items():signal.signal(sig,handler)

BACKUP_LIMIT=2*1024*1024*1024
def backup_files(archive,key):
 for path in (Path(archive),Path(key)):
  s=path.lstat();need(stat.S_ISREG(s.st_mode) and s.st_uid==os.geteuid() and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'PRIVATE_BACKUP')
 need(1024<Path(archive).stat().st_size<=BACKUP_LIMIT,'BACKUP_SIZE_BOUND');need(re.fullmatch(b'[a-f0-9]{64}',Path(key).read_bytes()),'BACKUP_KEY')
def encrypted_source_dump(database,directory):
 import resource
 directory=Path(directory);space=os.statvfs(directory);need(space.f_bavail*space.f_frsize>=BACKUP_LIMIT+512*1024*1024,'BACKUP_DISK_RESERVE')
 token=uuid.uuid4().hex;name='wsx-devapp-backup-'+token;label='wsx.devapp.backup='+token;image=database.pg['Image'];sourceenv=database.prep.env_map(database.pg);password=sourceenv.get('POSTGRES_PASSWORD');need(type(password) is str and password and not any(c in password for c in '\r\n\0'),'SOURCE_OWNER_CREDENTIAL_REQUIRED')
 env=directory/'dump.env';fd=os.open(env,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f:f.write('PGUSER=postgres\nPGPASSWORD='+password+'\nPGSSLMODE=disable\nPGCONNECT_TIMEOUT=10\nPGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=180000\n');f.flush();os.fsync(f.fileno())
 key=directory/'backup.key';fd=os.open(key,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(os.urandom(32).hex().encode());f.flush();os.fsync(f.fileno())
 archive=directory/'database.pgdump.enc';fd=os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);producer=None;cipher=None
 command=['/usr/bin/docker','run','--rm','--pull=never','--name',name,'--label',label,'--network','container:'+database.pg['Id'],'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--pids-limit=128','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=1m','--env-file',str(env),'--entrypoint','pg_dump',image,'--host=127.0.0.1','--port=5432','--no-password','--username=postgres','--dbname=workspacex','--format=custom']
 try:
  with os.fdopen(fd,'wb') as out:
   producer=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin'})
   cipher=subprocess.Popen(['/usr/bin/openssl','enc','-aes-256-cbc','-pbkdf2','-salt','-pass','file:'+str(key)],stdin=producer.stdout,stdout=out,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin'},preexec_fn=lambda:resource.setrlimit(resource.RLIMIT_FSIZE,(BACKUP_LIMIT,BACKUP_LIMIT)));producer.stdout.close();deadline=time.monotonic()+remaining(database.ctx,300)
   need(cipher.wait(timeout=max(.1,deadline-time.monotonic()))==0 and producer.wait(timeout=max(.1,deadline-time.monotonic()))==0,'BACKUP_PIPELINE_FAILED');out.flush();os.fsync(out.fileno())
  backup_files(archive,key);return archive,key
 finally:
  for child in (cipher,producer):
   if child is not None and child.poll() is None:child.kill();child.wait()
  env.unlink(missing_ok=True)
  ids=database.d.run(['ps','--all','--quiet','--no-trunc','--filter','label='+label]).decode().split();need(len(ids)<=1,'BACKUP_HELPER_AMBIGUOUS')
  for cid in ids:
   item=database.prep.inspect_one(database.d,cid);need(item['Name']=='/'+name and item['Image']==image and item['Config']['Labels'].get('wsx.devapp.backup')==token and item['HostConfig']['NetworkMode']=='container:'+database.pg['Id'],'BACKUP_HELPER_OWNER');database.d.run(['rm','--force',cid])
  need(not database.d.run(['ps','--all','--quiet','--filter','label='+label]).strip(),'BACKUP_HELPER_CLEANUP')

def release_budget(policy,request,mode,cfg,now=None):
 now=time.time() if now is None else now
 for name,lo,hi in [('writerSeconds',60,400),('verifierSeconds',10,120),('outerVerificationSeconds',10,120)]:need(type(policy.get(name)) is int and lo<=policy[name]<=hi,'RELEASE_BUDGET_FIELD')
 need(policy['outerVerificationSeconds']>=cfg.get('readinessTimeoutSeconds',120),'OUTER_BUDGET')
 remaining=policy['verifierSeconds']+policy['outerVerificationSeconds']+15
 if mode=='writer':remaining+=policy['writerSeconds']+policy['rollbackSeconds']
 need(mode in ('writer','verifier') and remaining<=request['expiresAt']-now<=600,'RELEASE_TOTAL_BUDGET')

def exact_plan(plan):
 changes=plan.get('changes',[])
 need(len(changes)==1 and changes[0].get('role')=='api' and changes[0].get('removed')==[] and changes[0].get('changed')==[] and set(changes[0].get('added',[]))==set(MIGRATIONS),'EXACT_EIGHT_IMAGE_CHANGES')
