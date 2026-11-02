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
BASELINE_LEDGER_COUNT=439
CAPABILITY_KIND='devapp-exact-eight-release-v1'
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
 need(type(baseline) is dict and len(baseline)==BASELINE_LEDGER_COUNT and not set(baseline)&set(MIGRATIONS) and all(type(k) is str and type(v) is str and re.fullmatch('[a-f0-9]{64}',v) for k,v in baseline.items()),'HISTORICAL_LEDGER_REQUIRED')
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
def apply_once(adapter,record,expected_complete=False):
 before=adapter.read()
 if expected_complete:need(before['state']=='COMPLETE','RESUME_COMPLETE_SCHEMA_REQUIRED')
 need(before['state'] in ('BASELINE','COMPLETE'),'PARTIAL_BATCH_RECONCILIATION_REQUIRED')
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
 need('expectedSchemaState' not in policy or 'resumeOriginal' in policy and type(policy['expectedSchemaState']) is str and policy['expectedSchemaState']=='COMPLETE','RESUME_CAPABILITY_REQUIRED')
 need(policy.get('kind')==CAPABILITY_KIND and policy.get('source')==SOURCE and policy.get('tag')==TAG and policy.get('restoreNotPerformed') is True,'FIXED_CAPABILITY')
 need(type(policy.get('expiresAt')) is int and time.time()<policy['expiresAt']<=time.time()+3600,'POLICY_EXPIRED')
 pins=policy.get('closurePins');need(type(pins) is dict and set(pins)==set(CLOSURE)|({'devapp-diagnostic-browser-probe.py'} if policy.get('diagnosticBrowser') is True else set()),'EXACT_CLOSURE')
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
 need(type(policy.get('runtimeSeconds')) is int and 10<=policy['runtimeSeconds']<=120 and type(policy.get('rollbackSeconds')) is int and 60<=policy['rollbackSeconds']<=(240 if 'resumeOriginal' in policy else 180),'BOUNDED_BUDGETS')
 fd=int(os.environ.get('WSX_RELEASE_LOCK_FD','-1'));mods['us-tag-migration-adapter'].inherited_lock(fd,LOCK);s=os.fstat(fd);need(request['canonicalLock']=={'path':LOCK,'device':s.st_dev,'inode':s.st_ino},'LOCK_BINDING')
 pending=read(Path(cfg['stateDirectory'])/'pending.json');need(pending.get('attempt')==str(attempt) and pending.get('requestSha256')==file_sha(request_path),'PENDING_BINDING')
 for r in (*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[])):pinned(r,False)
 need(type(cfg.get('verificationCommand')) is list and bool(cfg['verificationCommand']) and any(r['path']==cfg['verificationCommand'][0] for r in cfg.get('verificationFiles',[])),'PINNED_BUSINESS_REQUIRED')
 d=mods['minimal-docker-release'].Docker('/usr/bin/docker')
 for image in manifest['images'].values():mods['minimal-docker-release'].image(d,image['imageId'],SOURCE);need(image['image'] in d.json(['image','inspect',image['imageId']])[0].get('RepoDigests',[]),'IMAGE_DIGEST_BINDING')
 command=['compose','--project-name',cfg['project'],'--env-file',cfg['envFile']['path']]
 for r in cfg['composeFiles']:command+=['--file',r['path']]
 return dict(p=policy,request=request,cfg=cfg,manifest=manifest,attempt=attempt,receipt=Path(receipt_path),fd=fd,mods=mods,d=d,command=command,requestRef=ref(request_path),policyRef=ref(POLICY))

def source_binding(api,postgres):
 """One observed DevApp loopback mapping; not a generic host-network waiver."""
 def env(row):
  values={}
  for line in row.get('Config',{}).get('Env',[]):
   need(type(line) is str and '=' in line,'DEVAPP_SOURCE_BINDING');key,value=line.split('=',1);need(key not in values,'DEVAPP_SOURCE_BINDING');values[key]=value
  return values
 a=env(api);p=env(postgres);mapping={'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55433'}]}
 need(postgres.get('Id')=='9d94859e93f065341b1acdb882f0c1ce57380d6c5040e76ac3e14c4dc9e2128b' and postgres.get('Image')=='sha256:ac24ce4f1fbd05eac05b966e3b7a4e189709c8bdff0bf822a4bcb73337449367' and postgres.get('State',{}).get('Running') is True,'DEVAPP_SOURCE_BINDING')
 need(api.get('HostConfig',{}).get('NetworkMode')=='host' and set(api.get('NetworkSettings',{}).get('Networks',{}))=={'host'} and all(a.get(k)==v for k,v in {'PGHOST':'127.0.0.1','PGPORT':'55433','PGDATABASE':'workspacex','APP_DB_USER':'app_rw'}.items()),'DEVAPP_SOURCE_BINDING')
 need(postgres.get('HostConfig',{}).get('NetworkMode')=='workspacex_default' and set(postgres.get('NetworkSettings',{}).get('Networks',{}))=={'workspacex_default'} and postgres.get('HostConfig',{}).get('PortBindings')==mapping and postgres.get('NetworkSettings',{}).get('Ports')==mapping and p.get('POSTGRES_USER','postgres')=='postgres','DEVAPP_SOURCE_BINDING')

class Database:
 def __init__(self,ctx):
  self.ctx=ctx;self.d=ctx['d'];self.p=ctx['p'];self.prep=ctx['mods']['schema-tag-prepare'];self.pg=self.prep.inspect_one(self.d,self.p['postgres']['containerId'])
  need(self.pg['Id']=='9d94859e93f065341b1acdb882f0c1ce57380d6c5040e76ac3e14c4dc9e2128b' and self.pg['Image']=='sha256:ac24ce4f1fbd05eac05b966e3b7a4e189709c8bdff0bf822a4bcb73337449367' and self.pg['Image']==self.p['postgres']['imageId'] and self.pg['State']['Running'] is True and self.pg['Config']['Labels'].get('com.docker.compose.service')=='postgres','POSTGRES_BINDING')
  api=self.prep.live_service(self.d,ctx['cfg']['project'],'api');source_binding(api,self.pg)
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
  need('resumeOriginal' not in self.ctx['p'],'NATIVE_APPLY_FORBIDDEN_IN_RESUME')
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

def owned_business(ctx):return 'resumeOriginal' in ctx.get('p',{}) or ctx.get('p',{}).get('activeEpochThree') is True

def run(ctx,args,timeout=120,phase=None):
 if phase and owned_business(ctx):return run_resume_business(ctx,args,timeout,phase)
 child=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,pass_fds=(ctx['fd'],),env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8','WSX_RELEASE_LOCK_FD':str(ctx['fd'])})
 outcome={'phase':phase,'createdAt':time.time()};out=None
 try:
  out,_=child.communicate(timeout=remaining(ctx,timeout));outcome.update(exitCode=child.returncode,outputBytes=len(out),status='RETURN_NONZERO' if child.returncode else 'OUTPUT_BOUND' if len(out)>65536 else 'SUCCEEDED')
 except BaseException as error:
  outcome['status']='TIMEOUT' if isinstance(error,subprocess.TimeoutExpired) else 'INTERRUPTED'
  if child.poll() is None:
   child.terminate()
   try:child.communicate(timeout=15)
   except subprocess.TimeoutExpired:child.kill();child.communicate(timeout=5)
  raise
 finally:
  if phase:ctx['mods']['schema-restore-rehearsal'].save(ctx['attempt']/(phase+'-outcome.json'),outcome)
 need(child.returncode==0 and out is not None and len(out)<=65536,'BUSINESS_'+phase.upper().replace('-','_')+'_'+outcome['status'] if phase else 'HOST_COMMAND_FAILED');return out

def business(ctx,phase):
 core=ctx['mods']['schema-restore-rehearsal'];core.save(ctx['attempt']/(phase+'-once.json'),{'source':SOURCE,'tag':TAG,'automaticRetryAllowed':False})
 command=ctx['cfg']['verificationCommand'];raw=run(ctx,command,ctx['p'].get('businessSeconds',ctx['p']['runtimeSeconds']),phase=phase);path=ctx['attempt']/(phase+'-business.json');core.save(path,{'source':SOURCE,'tag':TAG,'createdAt':time.time(),'command':command,'exitCode':0,'stdoutHex':raw.hex(),'scope':'actual-configured-business-probe',**({'outcome':ref(ctx['attempt']/(phase+'-outcome.json'))} if owned_business(ctx) else {})});return ref(path)
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
 need('expectedSchemaState' not in p or 'resumeOriginal' in p and type(p['expectedSchemaState']) is str and p['expectedSchemaState']=='COMPLETE','RESUME_CAPABILITY_REQUIRED')
 resume=validate_resume(ctx) if 'resumeOriginal' in p else None
 barrier=Path(cfg['stateDirectory'])/(('devapp-'+TAG+'-activation-'+p['activationNonce']+'-once.json') if resume and 'resumePrevious' in p else ('devapp-'+TAG+'-resume-23ecfeea853840acb7638e629c8f50d5.json') if resume else ('devapp-'+TAG+'-once.json'));need(not barrier.exists() and not barrier.is_symlink(),'CAPABILITY_ALREADY_SPENT')
 old={s:p['baseline'][s]['imageId'] for s in cfg['services']};images={s:ctx['manifest']['images'][r]['imageId'] for s,r in cfg['services'].items()};rows=act.runtime_rows(d,cfg['project'],cfg['services'],old);need(all(x['Id']==p['baseline'][x['Config']['Labels']['com.docker.compose.service']]['containerId'] for x in rows),'BASELINE_CID')
 original=d.json(ctx['command']+['config','--format','json']);act.live_config_cas(engine,d,original,cfg['project'],rows,attempt)
 overlay=attempt/'candidate-images.json';rollback=attempt/'baseline-images.json';core.save(overlay,{'services':{s:{'image':v} for s,v in images.items()}});core.save(rollback,{'services':{s:{'image':v} for s,v in old.items()}})
 command=ctx['command']+['--file',str(overlay)];old_command=ctx['command']+['--file',str(rollback)];expected=copy.deepcopy(original)
 for s,v in images.items():expected['services'][s]['image']=v
 need(d.json(command+['config','--format','json'])==expected,'NON_IMAGE_CONFIG_CHANGE')
 before=database.read();need(before['state'] in ('BASELINE','COMPLETE'),'PARTIAL_BATCH_RECONCILIATION_REQUIRED')
 if resume:need(before['state']=='COMPLETE','RESUME_COMPLETE_SCHEMA_REQUIRED')
 core.save(barrier,{'source':SOURCE,'tag':TAG,'request':ctx['requestRef'],'policy':ctx['policyRef'],'automaticRetryAllowed':False,'createdAt':time.time()});mutated=False;events=[]
 def record(v):events.append(v);core.save(attempt/('migration-event-'+str(len(events))+'.json'),v)
 try:
  d.run(old_command+['stop','--timeout','30',*cfg['services']],timeout=90);database.stopped();need(database.read()==before,'STOPPED_DATABASE_DRIFT')
  backup=attempt/'backup';backup.mkdir(mode=0o700);archive,key=database.dump(backup);backup_files(archive,key);need(database.read()==before,'BACKUP_DATABASE_DRIFT');core.save(backup/'source.json',before)
  transaction=apply_once(database,record,expected_complete=bool(resume));need(database.read()['state']=='COMPLETE','POST_BATCH_COMPLETE_REQUIRED')
  # Original application must run on the resulting forward schema before switch.
  d.run(old_command+['start',*cfg['services']],timeout=p['runtimeSeconds']);health(ctx,old_command,old);baseline_business=business(ctx,'baseline-forward')
  for r in (*cfg['composeFiles'],cfg['envFile'],*cfg.get('verificationFiles',[])):pinned(r,False)
  need(d.json(command+['config','--format','json'])==expected,'FINAL_CONFIG_DRIFT');act.live_config_cas(engine,d,original,cfg['project'],act.runtime_rows(d,cfg['project'],cfg['services'],old),attempt);need(database.read()['state']=='COMPLETE','PRE_UP_LEDGER_DRIFT')
  if resume:need(validate_resume(ctx)==resume,'RESUME_ORIGINAL_HISTORY_DRIFT')
  mutated=True;d.run(command+['up','--detach','--no-deps','--pull','never','--no-build',*cfg['services']],timeout=p['runtimeSeconds']);candidate_health=health(ctx,command,images)
  public_business=business(ctx,'candidate');health(ctx,command,images);after=database.read();need(after['state']=='COMPLETE','FINAL_LEDGER_DRIFT');check_epoch(after['epoch'])
  if resume:need(validate_resume(ctx)==resume,'RESUME_ORIGINAL_HISTORY_DRIFT')
  contents={'backup-restore':{'archive':ref(archive),'key':ref(key),'source':ref(backup/'source.json'),'restoreNotPerformed':True},'baseline-compatibility':{'oldImages':old,'actualForwardSchemaHealth':True,'business':baseline_business,'resetPerformed':False},'migration-ledger':{**transaction,'baselineLedger':p['baselineLedger'],'completeLedger':after['ledger'],'epoch':after['epoch'],'force':False,'resetPerformed':False,**ctx.get('additionalMigrationProof',{})},'candidate-acceptance':{'images':images,'health':candidate_health,'business':public_business,'epochActivated':False}}
  proofs={}
  for name,v in contents.items():path=attempt/(name+'.json');core.save(path,{**v,'sourceRevision':SOURCE,'tag':TAG,'createdAt':time.time()});proofs[name]=ref(path)
  result={k:ctx['request'][k] for k in ctx['mods']['schema-release-handoff'].IDENTITY};result.update(kind='schema-release-result-v1',status='SUCCEEDED',proofs=proofs,restoreNotPerformed=True,postSuccessAdmissionAdoptionRequired=True,historicalAdmission=p['historicalAdmission'],activationOnly=bool(resume),originalResumeEvidence=resume);core.save(ctx['receipt'],result)
 except BaseException as error:
  signal.setitimer(signal.ITIMER_REAL,p['rollbackSeconds']);ctx['operationDeadline']=time.monotonic()+p['rollbackSeconds'];failure={'failureCode':str(error) if re.fullmatch('[A-Z0-9_]+',str(error)) else 'UNEXPECTED_PROCESS_FAILURE','status':'RECONCILIATION_REQUIRED','automaticRetryAllowed':False,'sqlRollbackAttempted':False,'restoreNotPerformed':True}
  try:
   d.run(command+['stop','--timeout','30',*cfg['services']],timeout=90)
   database.drain_sessions()
   observed=database.reconcile();need(observed['state'] in ('BASELINE','COMPLETE'),'UNKNOWN_SCHEMA_STATE')
   for r in (*cfg['composeFiles'],cfg['envFile']):pinned(r,False)
   need(d.json(old_command+['config','--format','json'])==original,'ROLLBACK_CONFIG_DRIFT');d.run(old_command+['up','--detach','--no-deps','--pull','never','--no-build',*cfg['services']],timeout=p['runtimeSeconds']);health(ctx,old_command,old)
   # Release traffic only after actual old configured business probe succeeds.
   if owned_business(ctx) and not resume_business_cleanup(ctx):failure.update(recovery='OPERATOR_REQUIRED',businessRecoverySkipped=True,oldImagesRestored=True,readonlyHealthVerified=True)
   else:business(ctx,'recovery');failure.update(status='OLD_APPLICATION_RESTORED_ON_OBSERVED_SCHEMA',schemaState=observed['state'])
  except BaseException:failure['recovery']='OPERATOR_REQUIRED'
  if failure['status']=='OLD_APPLICATION_RESTORED_ON_OBSERVED_SCHEMA':failure['trafficControl']='verified-old-application-running'
  else:
   # An unverified recovery must not leave applications accepting public writes.
   failure['trafficControl']='UNKNOWN';failure['applicationsStoppedVerified']=False
   try:
    d.run(old_command+['stop','--timeout','30',*cfg['services']],timeout=90);database.stopped();failure.update(trafficControl='stopped-five-applications',applicationsStoppedVerified=True)
   except BaseException:failure['stopOutcome']='UNKNOWN_OPERATOR_REQUIRED'
  core.save(attempt/'failure.json',failure);raise

def verify_business_proof(ctx,value,phase,now=None):
 now=time.time() if now is None else now
 path=pinned(value);need(path.parent==ctx['attempt'] and path.name==phase+'-business.json','BUSINESS_ATTEMPT')
 v=read(path);need(v.get('command')==ctx['cfg']['verificationCommand'] and type(v.get('exitCode')) is int and v['exitCode']==0 and v.get('source')==SOURCE and v.get('tag')==TAG and type(v.get('createdAt')) in (int,float) and 0<=now-v['createdAt']<600,'VERIFIER_BUSINESS')
 if owned_business(ctx):
  need(type(v.get('outcome')) is dict,'BUSINESS_OUTCOME_REQUIRED');outcome=pinned(v['outcome']);need(outcome.parent==ctx['attempt'] and outcome.name==phase+'-outcome.json','BUSINESS_OUTCOME_ATTEMPT');proof=read(outcome)
  need(proof.get('phase')==phase and proof.get('source')==SOURCE and proof.get('tag')==TAG and proof.get('command')==ctx['cfg']['verificationCommand'] and proof.get('status')=='SUCCEEDED' and type(proof.get('exitCode')) is int and proof['exitCode']==0 and proof.get('processGroupOwned') is True and proof.get('ownedProcessGroupGone') is True and type(proof.get('createdAt')) in (int,float) and 0<=now-proof['createdAt']<600,'BUSINESS_OUTCOME_NOT_TERMINAL')

def verifier(ctx):
 handoff=ctx['mods']['schema-release-handoff'];result=read(ctx['receipt']);handoff.verify_receipt(ctx['request'],result);need(result.get('restoreNotPerformed') is True,'RESTORE_SCOPE')
 proofs={}
 for name,r in result['proofs'].items():
  path=pinned(r);need(path.parent==ctx['attempt'],'PROOF_ATTEMPT');v=read(path);need(v['sourceRevision']==SOURCE and v['tag']==TAG and 0<=time.time()-v['createdAt']<600,'PROOF_IDENTITY');proofs[name]=v
 resume=validate_resume(ctx) if 'resumeOriginal' in ctx['p'] else None
 if resume:need(result.get('activationOnly') is True and result.get('originalResumeEvidence')==resume and proofs['migration-ledger'].get('migrationExecuted') is False and proofs['migration-ledger'].get('sqlReplayed') is False and not list(ctx['attempt'].glob('migration-event-*.json')),'VERIFIER_ACTIVATION_ONLY')
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
 if 'resumeOriginal' in policy:need(type(policy.get('businessSeconds')) is int and 105<=policy['businessSeconds']<=150 and policy['rollbackSeconds']>=policy['businessSeconds']+policy['runtimeSeconds']+10,'RESUME_BUSINESS_BUDGET')
 if mode=='writer':remaining+=policy['writerSeconds']+policy['rollbackSeconds']
 need(mode in ('writer','verifier') and remaining<=request['expiresAt']-now<=600,'RELEASE_TOTAL_BUDGET')

def exact_plan(plan):
 changes=plan.get('changes',[])
 need(len(changes)==1 and changes[0].get('role')=='api' and changes[0].get('removed')==[] and changes[0].get('changed')==[] and set(changes[0].get('added',[]))==set(MIGRATIONS),'EXACT_EIGHT_IMAGE_CHANGES')

ORIGINAL_RESUME='attempt-23ecfeea853840acb7638e629c8f50d5'
def validate_resume(ctx):
 p=ctx['p'];spec=p.get('resumeOriginal');need(p.get('expectedSchemaState')=='COMPLETE' and type(spec) is dict and set(spec)=={'attempt','files','once','pendingArchive'},'RESUME_CAPABILITY_REQUIRED')
 old=Path(spec['attempt']);need(old==Path(ctx['cfg']['stateDirectory'])/ORIGINAL_RESUME and old!=ctx['attempt'] and old.is_dir() and not old.is_symlink() and old.stat().st_uid==os.geteuid() and not old.stat().st_mode&0o077,'RESUME_ORIGINAL_ATTEMPT')
 files=spec['files'];need(type(files) is dict and 0<len(files)<=256,'RESUME_HISTORY_BOUND')
 actual={str(path.relative_to(old)) for path in old.rglob('*') if path.is_file() or path.is_symlink()};need(actual==set(files),'RESUME_HISTORY_FILESET')
 for name,checksum in files.items():
  relative=Path(name);need(not relative.is_absolute() and '..' not in relative.parts,'RESUME_HISTORY_PATH');need(file_sha(trusted(old/relative))==checksum,'RESUME_HISTORY_DRIFT')
 required={'schema-request.json','schema-config.json','failure.json','candidate-once.json','baseline-forward-business.json','recovery-business.json','migration-event-1.json','migration-event-2.json','migration-event-3.json','backup/source.json','backup/database.pgdump.enc','backup/backup.key'};need(required<=set(files),'RESUME_HISTORY_INCOMPLETE')
 archive=pinned(spec['pendingArchive']);need(archive.parent==Path(ctx['cfg']['stateDirectory']) and archive.name.startswith('pending-') and archive.name!='pending.json','RESUME_PENDING_ARCHIVE_PATH');pending=read(archive);need(pending.get('tag')==TAG and pending.get('attempt')==str(old) and pending.get('requestSha256')==files['schema-request.json'] and pending.get('automaticRetry') is False,'RESUME_PENDING_ARCHIVE_BINDING')
 original_once=pinned(spec['once']);need(original_once==Path(ctx['cfg']['stateDirectory'])/('devapp-'+TAG+'-once.json'),'RESUME_ONCE_PATH')
 once=read(original_once);need(once.get('source')==SOURCE and once.get('tag')==TAG and once.get('request')=={'path':str(old/'schema-request.json'),'sha256':files['schema-request.json']},'RESUME_SPENT_ONCE_BINDING')
 request=read(old/'schema-request.json');need(request.get('environment')=='devapp' and request.get('sourceRevision')==SOURCE and request.get('tag')==TAG,'RESUME_ORIGINAL_REQUEST')
 failure=read(old/'failure.json');need(failure.get('status')=='OLD_APPLICATION_RESTORED_ON_OBSERVED_SCHEMA' and failure.get('schemaState')=='COMPLETE' and failure.get('sqlRollbackAttempted') is False and failure.get('automaticRetryAllowed') is False,'RESUME_ORIGINAL_RECOVERY')
 intent=read(old/'migration-event-1.json');need(intent.get('status')=='NATIVE_BATCH_INTENT' and intent.get('source')==SOURCE and intent.get('tag')==TAG,'RESUME_ORIGINAL_INTENT')
 ack=read(old/'migration-event-2.json');native=ack.get('result',{});need(ack.get('status')=='NATIVE_BATCH_RETURN' and native.get('status')=='NATIVE_BATCH_COMPLETE' and set(native.get('applied',[]))==set(MIGRATIONS) and native.get('skipped')==[],'RESUME_ORIGINAL_ACK')
 source=read(old/'backup/source.json');need(source.get('state')=='BASELINE' and source.get('ledger')==p['baselineLedger'],'RESUME_ORIGINAL_BACKUP');check_epoch(source.get('epoch'))
 terminal=read(old/'migration-event-3.json');result=terminal.get('result',{});need(terminal.get('status')=='POST_BATCH_RECONCILE' and result.get('state')=='COMPLETE' and result.get('ledger')=={**p['baselineLedger'],**MIGRATIONS},'RESUME_ORIGINAL_LEDGER');check_epoch(result.get('epoch'),required=True)
 original_config=request.get('config');need(original_config=={'path':str(old/'schema-config.json'),'sha256':files['schema-config.json']},'RESUME_ORIGINAL_CONFIG');original_command=read(pinned(original_config)).get('verificationCommand')
 for phase in ('baseline-forward','recovery'):
  value=read(old/(phase+'-business.json'));need(value.get('source')==SOURCE and value.get('tag')==TAG and value.get('command')==original_command and type(value.get('exitCode')) is int and value['exitCode']==0,'RESUME_ORIGINAL_BUSINESS')
 backup_files(pinned({'path':str(old/'backup/database.pgdump.enc'),'sha256':files['backup/database.pgdump.enc']}),pinned({'path':str(old/'backup/backup.key'),'sha256':files['backup/backup.key']}))
 proof={'attempt':str(old),'files':files,'once':spec['once'],'pendingArchive':spec['pendingArchive'],'scope':'explicit-complete-only-new-activation-attempt','originalFilesModified':False}
 if 'resumePrevious' in p:proof['previous']=validate_previous_resume(ctx)
 return proof

BROWSER_DIAG_PHASES={'start','launch','login','authenticated','chat','agent','file','artifact','sandbox','complete','done','startup','ready','navigation','conversation','task','result','logout','cleanup','login_fields','login_submit','authenticated_redirect','authenticated_notifications','application-pages','billing-contract'}
BROWSER_DIAG_CODES={'TIMEOUT','BROWSER_TIMEOUT','NAVIGATION_TIMEOUT','LOGIN_FAILED','AUTH_FAILED','CHAT_FAILED','AGENT_FAILED','FILE_FAILED','ARTIFACT_FAILED','SANDBOX_FAILED','ASSERTION_FAILED','MODEL_CALL_FAILED','BROWSER_SMOKE_FAILED','BROWSER_SMOKE_PASSED','PASSED','FAILED'}
def browser_diagnostics(raw):
 result=[]
 for line in raw.decode('utf8','replace').splitlines():
  if not line.startswith('BROWSER_DIAG'):continue
  match=re.fullmatch(r'BROWSER_DIAG phase=([A-Za-z_-]+) errorType=(TimeoutError|Error) netCode=([A-Z_]+|none)',line)
  if match:
   phase,error_type,net_code=match.groups()
   if phase in BROWSER_DIAG_PHASES:
    safe={'phase':phase,'errorType':error_type}
    if net_code in {'none','ERR_TIMED_OUT','ERR_CONNECTION_REFUSED','ERR_CONNECTION_RESET','ERR_CONNECTION_CLOSED','ERR_ABORTED','ERR_CERT_DATE_INVALID','ERR_CERT_AUTHORITY_INVALID','ERR_CERT_COMMON_NAME_INVALID','ERR_NAME_NOT_RESOLVED','ERR_NETWORK_CHANGED','ERR_EMPTY_RESPONSE','ERR_SSL_PROTOCOL_ERROR'}:safe['netCode']=net_code
    result.append(safe)
   continue
  try:value=json.loads(line[len('BROWSER_DIAG'):].lstrip(' :=\t'))
  except (ValueError,TypeError):continue
  if type(value) is dict:
   safe={k:v for k,v in value.items() if (k=='phase' and v in BROWSER_DIAG_PHASES) or (k=='code' and v in BROWSER_DIAG_CODES)}
   if safe:result.append(safe)
 return result[-32:]
def run_resume_business(ctx,args,timeout,phase):
 import tempfile
 outcome={'phase':phase,'source':SOURCE,'tag':TAG,'command':args,'createdAt':time.time(),'processGroupOwned':True};child=None
 with tempfile.TemporaryFile() as stdout,tempfile.TemporaryFile() as stderr:
  try:
   child=subprocess.Popen(args,stdout=stdout,stderr=stderr,pass_fds=(ctx['fd'],),start_new_session=True,env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8','WSX_RELEASE_LOCK_FD':str(ctx['fd'])})
   deadline=time.monotonic()+remaining(ctx,timeout)
   while child.poll() is None:
    need(max(os.fstat(stdout.fileno()).st_size,os.fstat(stderr.fileno()).st_size)<=65536,'OUTPUT_BOUND')
    if time.monotonic()>=deadline:raise subprocess.TimeoutExpired('fixed-business-probe',timeout)
    time.sleep(.025)
   stdout.seek(0);raw=stdout.read(65537);need(len(raw)<=65536,'OUTPUT_BOUND');outcome.update(exitCode=child.returncode,outputBytes=len(raw),status='SUCCEEDED' if child.returncode==0 else 'RETURN_NONZERO')
  except BaseException as error:
   outcome['status']='TIMEOUT' if isinstance(error,subprocess.TimeoutExpired) else 'OUTPUT_BOUND' if isinstance(error,ValueError) and str(error)=='OUTPUT_BOUND' else 'INTERRUPTED'
   raise
  finally:
   if child is not None:
    # The group was created for this invocation only; never target unrelated Node.
    try:os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    try:child.wait(timeout=5)
    except subprocess.TimeoutExpired:pass
    try:os.killpg(child.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    child.wait(timeout=5)
    deadline=time.monotonic()+5;gone=False
    while time.monotonic()<deadline:
     try:os.killpg(child.pid,0)
     except ProcessLookupError:gone=True;break
     time.sleep(.025)
    outcome['ownedProcessGroupGone']=gone
    if not gone:outcome['initialStatus']=outcome['status'];outcome['status']='GROUP_CLEANUP_FAILED'
   stderr.seek(0);outcome['browserDiagnostics']=browser_diagnostics(stderr.read(65536));ctx['mods']['schema-restore-rehearsal'].save(ctx['attempt']/(phase+'-outcome.json'),outcome)
   need(outcome.get('ownedProcessGroupGone') is True,'OWNED_PROCESS_GROUP_NOT_REAPED')
  need(outcome['status']=='SUCCEEDED','BUSINESS_'+phase.upper().replace('-','_')+'_'+outcome['status']);return raw

def resume_business_cleanup(ctx):
 for phase in ('baseline-forward','candidate'):
  if not (ctx['attempt']/(phase+'-once.json')).exists():continue
  try:
   proof=read(ctx['attempt']/(phase+'-outcome.json'))
   if not (proof.get('phase')==phase and proof.get('source')==SOURCE and proof.get('tag')==TAG and proof.get('command')==ctx['cfg']['verificationCommand'] and proof.get('processGroupOwned') is True and proof.get('ownedProcessGroupGone') is True):return False
  except Exception:return False
 return True

PREVIOUS_RESUME='attempt-8a00689f16f441dc814144c59ea60897'
def validate_previous_resume(ctx):
 p=ctx['p'];spec=p.get('resumePrevious');need(p.get('diagnosticBrowser') is True and type(p.get('activationNonce')) is str and re.fullmatch('[a-f0-9]{32}',p['activationNonce']) and type(spec) is dict and set(spec)=={'attempt','files','once'},'DIAGNOSTIC_RESUME_CAPABILITY')
 old=Path(spec['attempt']);need(old==Path(ctx['cfg']['stateDirectory'])/PREVIOUS_RESUME and old!=ctx['attempt'] and old.is_dir() and not old.is_symlink() and old.stat().st_uid==os.geteuid() and not old.stat().st_mode&0o077,'PREVIOUS_RESUME_ATTEMPT')
 files=spec['files'];need(type(files) is dict and 0<len(files)<=256,'PREVIOUS_RESUME_HISTORY_BOUND');actual={str(path.relative_to(old)) for path in old.rglob('*') if path.is_file() or path.is_symlink()};need(actual==set(files) and not any(name.startswith('migration-event-') for name in files) and 'candidate-business.json' not in files,'PREVIOUS_RESUME_FILESET')
 for name,checksum in files.items():
  relative=Path(name);need(not relative.is_absolute() and '..' not in relative.parts and file_sha(trusted(old/relative))==checksum,'PREVIOUS_RESUME_HISTORY_DRIFT')
 required={'schema-request.json','schema-config.json','failure.json','candidate-once.json','candidate-outcome.json','baseline-forward-business.json','baseline-forward-outcome.json','recovery-business.json','recovery-outcome.json','backup/source.json','backup/database.pgdump.enc','backup/backup.key'};need(required<=set(files),'PREVIOUS_RESUME_HISTORY_INCOMPLETE')
 oncepath=pinned(spec['once']);need(oncepath==Path(ctx['cfg']['stateDirectory'])/('devapp-'+TAG+'-resume-23ecfeea853840acb7638e629c8f50d5.json'),'PREVIOUS_RESUME_ONCE_PATH');once=read(oncepath);need(once.get('source')==SOURCE and once.get('tag')==TAG and once.get('request')=={'path':str(old/'schema-request.json'),'sha256':files['schema-request.json']},'PREVIOUS_RESUME_ONCE_BINDING')
 request=read(old/'schema-request.json');need(request.get('environment')=='devapp' and request.get('sourceRevision')==SOURCE and request.get('tag')==TAG and request.get('config')=={'path':str(old/'schema-config.json'),'sha256':files['schema-config.json']},'PREVIOUS_RESUME_REQUEST')
 previous_cfg=read(old/'schema-config.json');failure=read(old/'failure.json');need(failure.get('status')=='OLD_APPLICATION_RESTORED_ON_OBSERVED_SCHEMA' and failure.get('schemaState')=='COMPLETE' and failure.get('sqlRollbackAttempted') is False,'PREVIOUS_RESUME_NOT_RECOVERED')
 pseudo={'attempt':old,'cfg':previous_cfg,'p':{'resumeOriginal':{}}}
 for phase in ('baseline-forward','recovery'):verify_business_proof(pseudo,{'path':str(old/(phase+'-business.json')),'sha256':files[phase+'-business.json']},phase,now=(old/(phase+'-business.json')).stat().st_mtime)
 candidate=read(old/'candidate-outcome.json');need(candidate.get('phase')=='candidate' and candidate.get('source')==SOURCE and candidate.get('tag')==TAG and candidate.get('command')==previous_cfg['verificationCommand'] and candidate.get('status')=='RETURN_NONZERO' and type(candidate.get('exitCode')) is int and candidate['exitCode']==1 and candidate.get('processGroupOwned') is True and candidate.get('ownedProcessGroupGone') is True,'PREVIOUS_CANDIDATE_NOT_TERMINAL_NONZERO')
 source=read(old/'backup/source.json');need(source.get('state')=='COMPLETE' and source.get('ledger')=={**p['baselineLedger'],**MIGRATIONS},'PREVIOUS_RESUME_LEDGER');check_epoch(source.get('epoch'),required=True);backup_files(pinned({'path':str(old/'backup/database.pgdump.enc'),'sha256':files['backup/database.pgdump.enc']}),pinned({'path':str(old/'backup/backup.key'),'sha256':files['backup/backup.key']}))
 return {'attempt':str(old),'files':files,'once':spec['once'],'activationNonce':p['activationNonce'],'originalFilesModified':False}
