#!/usr/bin/env python3
"""Target-bound isolated rehearsal. No implicit purchase, source credentials or activation."""
import ast,datetime,hashlib,ipaddress,json,os,re,secrets,stat,subprocess,sys,uuid,signal,time,tempfile,shutil
from pathlib import Path
PRODUCTION='pgm-uf6rg214cp381l49'
DBS=('workspacex','workspacex_agent','workspacex_memory')
STAGES=('restore','before','migrate','canonical-setup','canvas-audit','after','snapshot','recovery-verify')
SAFE_PROVIDER_CODES=frozenset(('Forbidden','User.NoPermission','InvalidAccountPassword.Format','Account.AddError','InvalidDBInstanceId.NotFound','InvalidDBInstanceName.NotFound'))
class UnknownOutcome(RuntimeError):pass
def report_provider_error(error):
 marker=str(error) if isinstance(error,UnknownOutcome) else ''
 code=marker.removeprefix('PROVIDER_REJECTED:')
 if marker.startswith('PROVIDER_REJECTED:') and code in SAFE_PROVIDER_CODES:print(json.dumps({'providerErrorCode':code,'mutationOutcome':'unknown','readbackRequired':True}),file=sys.stderr)

def private_json(path):
 st=path.lstat()
 if not stat.S_ISREG(st.st_mode) or st.st_mode&0o077 or st.st_uid!=os.geteuid():raise ValueError('PRIVATE_INPUT_REQUIRED')
 return json.loads(path.read_text())
def exclusive(path,value):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f:json.dump(value,f);f.flush();os.fsync(f.fileno())
 fd=os.open(path.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def created(binding):return datetime.datetime.fromisoformat(binding['providerCreatedUtc'].replace('Z','+00:00')).timestamp()
def validate_binding(b):
 uuid.UUID(b['attemptId'])
 if b.get('accountId')!='1177216024653153' or b.get('regionId')!='cn-shanghai':raise ValueError('ACCOUNT_REGION_BINDING')
 target=b['targetInstanceId']
 if not re.fullmatch(r'pgm-[a-z0-9]+',target) or target in (PRODUCTION,b['sourceInstanceId']):raise ValueError('PRODUCTION_TARGET_FORBIDDEN')
 if not b.get('providerDescription','').startswith('wsx-cn-isolated-') or not b['providerDescription'].endswith(b['attemptId']):raise ValueError('PROVIDER_ATTEMPT_DESCRIPTION')
 if b['sourceInstanceId']!=PRODUCTION or b['host']!=target+'.rwlb.rds.aliyuncs.com':raise ValueError('TARGET_HOST_BINDING')
 if not re.fullmatch(r'[0-9a-f]{40}',b['candidateSha']):raise ValueError('FROZEN_SOURCE_REQUIRED')
 peer=str(ipaddress.IPv4Address(b['peer']))
 if hashlib.sha256(peer.encode()).hexdigest()!=b['peerSha256']:raise ValueError('PEER_BINDING')
 if datetime.datetime.fromisoformat(b['providerCreatedUtc'].replace('Z','+00:00')).tzinfo is None:raise ValueError('CREATION_TIMEZONE')
 tls=b['tls']
 if tls['sslmode']!='verify-full':
  proof=tls.get('providerSslEvidence',{})
  if tls['sslmode']!='disable' or tls.get('approvedException')!='aliyun-postgresql-serverless-no-tls' or proof.get('targetInstanceId')!=target or proof.get('sslEnabled') is not False or proof.get('providerCreatedUtc')!=b['providerCreatedUtc']:raise ValueError('FRESH_TLS_EVIDENCE_REQUIRED')
 return b
class Journal:
 def __init__(self,root):self.root=root
 def once(self,name,run):
  done=self.root/(name+'.receipt.json');intent=self.root/(name+'.intent.json')
  if done.exists():return private_json(done)
  if intent.exists():raise UnknownOutcome('READBACK_REQUIRED:'+name)
  exclusive(intent,{'stage':name,'startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
  result=run();exclusive(done,result);return result
 def reconcile(self,name,result):
  if not (self.root/(name+'.intent.json')).exists():raise ValueError('NO_MUTATION_INTENT')
  exclusive(self.root/(name+'.receipt.json'),result)
def credentials(root,b):
 p=root/'target-secret.json'
 if p.exists():s=private_json(p)
 else:
  s={k:b[k] for k in ('accountId','regionId','attemptId','targetInstanceId','host','peer','peerSha256','providerCreatedUtc')}
  s.update(user='migration_admin',password='Aa1!'+secrets.token_urlsafe(21),port=5432,tls=b['tls'])
  s['roles']={role:dict(s,user=role,password='Aa1!'+secrets.token_urlsafe(21)) for role in ('app_diag_ro','app_rw','graph_owner','memory_owner','memory_rw','migration_owner')}
  exclusive(p,s)
 if any(s[k]!=b[k] for k in ('accountId','regionId','attemptId','targetInstanceId','host','peer','peerSha256','providerCreatedUtc')) or s.get('user')!='migration_admin' or s.get('port')!=5432 or s.get('tls')!=b['tls'] or not re.fullmatch(r'Aa1![A-Za-z0-9_-]{28}',s.get('password','')):raise ValueError('SECRET_TARGET_MISMATCH')
 for role in ('app_diag_ro','app_rw','graph_owner','memory_owner','memory_rw','migration_owner'):
  r=s.get('roles',{}).get(role,{})
  if r.get('user')!=role or r.get('port')!=5432 or r.get('tls')!=b['tls'] or any(r.get(k)!=b[k] for k in ('targetInstanceId','attemptId','host','peer','peerSha256','providerCreatedUtc')) or not re.fullmatch(r'Aa1![A-Za-z0-9_-]{28}',r.get('password','')):raise ValueError('ROLE_SECRET_BINDING')
 return s
def trusted_bytes(path,digest):
 path=Path(path)
 for ancestor in (path.parent,*path.parent.parents):
  st=ancestor.lstat()
  # Sticky system temp root may contain our private owner-only test directory.
  if not stat.S_ISDIR(st.st_mode) or st.st_uid not in (0,os.geteuid()) or (st.st_mode&0o022 and not st.st_mode&stat.S_ISVTX):raise ValueError('UNTRUSTED_ANCESTOR')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  st=os.fstat(f.fileno())
  if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.geteuid() or st.st_mode&0o022:raise ValueError('UNTRUSTED_SCRIPT')
  data=f.read()
 if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('ADAPTER_HASH_MISMATCH')
 return data
class ProcessAdapter:
 def __init__(self,path,digest,timeout,modules=None):self.path=Path(path);self.digest=digest;self.timeout=timeout;self.modules=modules or {}
 def __call__(self,operation,payload):
  # Execute the verified bytes, not an original path that may change after hashing.
  script=trusted_bytes(self.path,self.digest)
  copies={}
  for name,spec in self.modules.items():
   if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]*',name) or '..' in name or name==self.path.name:raise ValueError('MODULE_NAME')
   copies[name]=trusted_bytes(spec['path'],spec['sha256'])
  directory=Path(tempfile.mkdtemp(prefix='wsx-verified-process-',dir=Path('/tmp').resolve()))
  try:
   path=directory/self.path.name
   for name,data in {self.path.name:script,**copies}.items():
    fd=os.open(directory/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
   environment={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}
   process=subprocess.Popen([sys.executable,'-I','-c',"import runpy,sys;sys.path.insert(0,sys.argv[1]);sys.argv=sys.argv[2:];runpy.run_path(sys.argv[0],run_name='__main__')",str(directory),str(path)]+([] if operation is None else [operation]),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True,env=environment)
   try:
    output,_=process.communicate(json.dumps(payload).encode(),timeout=self.timeout(operation) if callable(self.timeout) else self.timeout)
    if process.returncode!=0:
     # A safe provider rejection is diagnostic only; the mutation outcome still requires readback.
     try:failure=json.loads(output) if len(output)<=256 else None
     except ValueError:failure=None
     if isinstance(failure,dict) and set(failure)=={'providerErrorCode'} and isinstance(failure['providerErrorCode'],str) and failure['providerErrorCode'] in SAFE_PROVIDER_CODES:raise UnknownOutcome('PROVIDER_REJECTED:'+failure['providerErrorCode'])
     raise UnknownOutcome('ADAPTER_PROCESS_FAILED')
   except subprocess.TimeoutExpired:
    os.killpg(process.pid,signal.SIGTERM)
    try:process.communicate(timeout=180)
    except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.communicate()
    raise UnknownOutcome('ADAPTER_PROCESS_TIMEOUT') from None
   if len(output)>1048576:raise ValueError('RECEIPT_LIMIT')
   try:return json.loads(output)
   except ValueError:raise ValueError('INVALID_ADAPTER_RECEIPT') from None
  finally:shutil.rmtree(directory)
def bounded_readback(read,ready,b,cleanup=False):
 if cleanup:limit=time.monotonic()+b.get('deleteReadbackBudgetSeconds',300)
 else:limit=min(time.monotonic()+b.get('readbackBudgetSeconds',120),time.monotonic()+max(0,created(b)+6900-datetime.datetime.now(datetime.timezone.utc).timestamp()-330))
 while True:
  result=read()
  if ready(result):return result
  if time.monotonic()>=limit:raise UnknownOutcome('READBACK_NOT_READY')
  time.sleep(min(2,max(0,limit-time.monotonic())))

def rehearse(b,root,invoke):
 validate_binding(b)
 now=lambda:datetime.datetime.now(datetime.timezone.utc).timestamp()
 deadline=created(b)+7200
 expired=now()>=deadline
 if created(b)>now()+120:raise ValueError('FUTURE_CREATION')
 journal=Journal(root);secret=None if expired else credentials(root,b);payload={'binding':b,'secret':secret}
 def observed():
  o=invoke('observe',payload)
  if any(o.get(k)!=b[k] for k in ('targetInstanceId','peer','providerCreatedUtc')):raise ValueError('ACTUAL_PROVIDER_BINDING_FAILED')
  return o
 try:
  if expired:raise ValueError('EXPIRED_ISOLATION')
  observed()
  # Reconcile unknown registration/account outcomes only by reads, never resubmit.
  for name,op,read in [('oos','cleanup-register','cleanup-readback'),('account','account-create','account-readback')]:
   try:journal.once(name,lambda:invoke(op,payload))
   except UnknownOutcome as error:
    report_provider_error(error)
    result=bounded_readback(lambda:invoke(read,payload),lambda r:r.get('registered' if name=='oos' else 'exists'),b)
    journal.reconcile(name,result)
   result=bounded_readback(lambda:invoke(read,payload),lambda r:r.get('registered' if name=='oos' else 'exists'),b)
   if name=='oos':
    if not result.get('registered') or result.get('targetInstanceId')!=b['targetInstanceId'] or result.get('deleteBeginEpoch')!=created(b)+6900:raise ValueError('OOS_READBACK_REQUIRED')
   elif not result.get('exists') or result.get('user')!=secret['user']:raise ValueError('ACCOUNT_READBACK_REQUIRED')
  for stage in STAGES:
   if deadline-now()<330:raise ValueError('CLEANUP_RESERVE_REQUIRED')
   observation=observed()  # Reattest actual provider/peer before every SQL-bearing stage.
   refs={}
   for previous in STAGES:
    path=root/(previous+'.receipt.json')
    if path.exists():refs[previous]={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
   stage_payload=dict(payload,operation=stage,previousReceipts=refs,providerObservation=observation)
   result=journal.once(stage,lambda:invoke(stage,stage_payload))
   if result.get('targetInstanceId')!=b['targetInstanceId'] or result.get('attemptId')!=b['attemptId'] or result.get('candidateSha')!=b['candidateSha'] or result.get('accepted') is not True:raise ValueError('STAGE_RECEIPT_BINDING:'+stage)
   if stage in ('restore','before','after','snapshot','recovery-verify'):
    databases=result.get('databases')
    if type(databases) is not list or len(databases)!=len(DBS) or not all(type(db) is str for db in databases) or len(set(databases))!=len(DBS) or set(databases)!=set(DBS):raise ValueError('THREE_DATABASE_CLOSURE:'+stage)
 finally:
  # Cleanup mutations are not retried implicitly. Provider OOS is the deadline backstop.
  try:journal.once('delete',lambda:invoke('cleanup',payload))
  except UnknownOutcome:
   result=bounded_readback(lambda:invoke('cleanup-readback-deleted',payload),lambda r:r.get('notFound') is True,b,cleanup=True)
   journal.reconcile('delete',result)
  bounded_readback(lambda:invoke('cleanup-readback-deleted',payload),lambda r:r.get('notFound') is True,b,cleanup=True)
  try:journal.once('oos-cancel',lambda:invoke('cleanup-registration-remove',payload))
  except UnknownOutcome:
   result=bounded_readback(lambda:invoke('cleanup-readback',payload),lambda r:r.get('terminal') is True,b,cleanup=True)
   journal.reconcile('oos-cancel',result)
  bounded_readback(lambda:invoke('cleanup-readback',payload),lambda r:r.get('terminal') is True,b,cleanup=True)
  try:journal.once('cleanup-iam',lambda:invoke('cleanup-iam-remove',payload))
  except UnknownOutcome:
   result=bounded_readback(lambda:invoke('cleanup-registration-readback-removed',payload),lambda r:r.get('removed') is True,b,cleanup=True)
   journal.reconcile('cleanup-iam',result)
  bounded_readback(lambda:invoke('cleanup-registration-readback-removed',payload),lambda r:r.get('removed') is True,b,cleanup=True)
 return {'accepted':True,'targetInstanceId':b['targetInstanceId'],'candidateSha':b['candidateSha'],'attemptId':b['attemptId'],'deleted':True}
def input_ref(ref,private=False):
 if not isinstance(ref,dict) or not {'path','sha256'}<=set(ref):raise ValueError('HASH_BOUND_INPUT_REQUIRED')
 if private:
  st=Path(ref['path']).lstat()
  if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.geteuid() or stat.S_IMODE(st.st_mode)!=0o600:raise ValueError('PRIVATE_INPUT_MODE')
 return trusted_bytes(ref['path'],ref['sha256'])
def executable_closure(entry):
 raw=input_ref(entry);modules=entry.get('modules',{})
 copies={Path(entry['path']).name:raw}
 for name,ref in modules.items():
  if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]*',name) or '..' in name or name in copies:raise ValueError('MODULE_NAME')
  copies[name]=input_ref(ref)
 for name,data in copies.items():
  if not name.endswith('.py'):continue
  for node in ast.walk(ast.parse(data)):
   imports=([node.module] if isinstance(node,ast.ImportFrom) else [x.name for x in node.names] if isinstance(node,ast.Import) else [])
   for module in imports:
    if module and module.startswith('isolated_') and module.split('.')[0]+'.py' not in copies:raise ValueError('TRANSITIVE_MODULE_MISSING:'+module)
 return copies

def offline_node(code,payload):
 node=shutil.which('node',path='/usr/local/bin:/usr/bin:/bin:'+str(Path(sys.executable).parent)) or shutil.which('node')
 if not node:raise ValueError('NODE_OFFLINE_VALIDATOR_REQUIRED')
 node=Path(node).resolve(strict=True);st=node.lstat()
 if not stat.S_ISREG(st.st_mode) or st.st_uid not in (0,os.geteuid()) or st.st_mode&0o022:raise ValueError('TRUSTED_NODE_REQUIRED')
 for parent in node.parents:
  st=parent.lstat()
  if not stat.S_ISDIR(st.st_mode) or st.st_uid not in (0,os.geteuid()) or (st.st_mode&0o022 and not st.st_mode&stat.S_ISVTX):raise ValueError('TRUSTED_NODE_ANCESTOR')
 result=subprocess.run([node,'-e',code],input=json.dumps(payload).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10,env={'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C'})
 if result.returncode or len(result.stdout)>1048576:raise ValueError('OFFLINE_SEMANTIC_VALIDATOR_REJECTED')
 return json.loads(result.stdout)

def stage_input_closure(b):
 def required(value,names):
  if not isinstance(value,dict) or not set(names)<=set(value):raise ValueError('RUNTIME_REQUIRED_FIELDS:'+','.join(names))
 spec=json.loads(input_ref({'path':b['stageManifestPath'],'sha256':b['stageManifestSha256']},True))
 if spec.get('prepared') is not True or any(spec.get(k)!=b[k] for k in ('candidateSha','targetInstanceId','attemptId')):raise ValueError('STAGE_MANIFEST_BINDING')
 required_stages=set(STAGES)-{'restore'}|{'restore-fidelity'}
 if not required_stages<=set(spec.get('stages',{})):raise ValueError('ALL_STAGE_INPUTS_REQUIRED')
 # Every nested executable/proof/source ref must exist before account creation.
 # Receipts from this run are deliberately absent; they come from previousReceipts.
 def walk(value,key=''):
  if isinstance(value,dict):
   if 'path' in value and 'sha256' in value:input_ref(value,True)
   for name,child in value.items():walk(child,name)
  elif isinstance(value,list):
   for child in value:walk(child,key)
 walk(spec)
 from isolated_conservation_inputs import validate_canonical_inputs
 from isolated_conservation_plan import validate_plan
 plan=validate_plan(spec['conservationPlan'],b);inventory=json.loads(input_ref(spec['sourceSqlInventory'],True))
 sql=plan.get('fullSqlChecksums',{});laws=plan.get('migrationLawBindings',{})
 actual={x['path'].split('/')[-1]:x['sha256'] for x in inventory.get('files',[])}
 if plan.get('prepared') is not True or plan.get('frozen') is not True or plan.get('candidateSha')!=b['candidateSha'] or plan.get('sourceInstanceId')!=b['sourceInstanceId'] or plan.get('force') is not False or plan.get('seed') is not False or not sql or set(sql)!=set(laws) or actual!=sql or inventory.get('sourceSha')!=b['candidateSha'] or len(actual)!=len(inventory['files']):raise ValueError('FROZEN_COMPLETE_SQL_PLAN')
 offline_node("const p=JSON.parse(require('fs').readFileSync(0,'utf8'));const hash=v=>require('crypto').createHash('sha256').update(JSON.stringify(v)).digest('hex');for(const law of Object.values(p.migrationLawBindings)){if(!law.body||hash(law.body)!==law.lawSha256)throw Error('LAW_BODY_HASH');}console.log(JSON.stringify({verified:true}));",plan)
 for name,digest in sql.items():
  law=laws[name]
  if law.get('reviewed') is not True or law.get('sqlSha256')!=digest or not re.fullmatch('[a-f0-9]{64}',law.get('lawSha256','')):raise ValueError('COMPLETE_REVIEWED_LAWS_REQUIRED')
 for stage in ('before','after'):
  if set(spec['stages'][stage])!=set(DBS):raise ValueError('THREE_DATABASE_STAGE_INPUTS')
  for db in DBS:
   cfg=spec['stages'][stage][db]
   if 'engine' not in cfg or (db!='workspacex' and 'canonicalPlan' not in cfg):raise ValueError('CANONICAL_STAGE_INPUT_REQUIRED')
 def engine(entry,language=None):
  if entry.get('candidateSha')!=b['candidateSha'] or entry.get('actualSqlPeerChecks') is not True or entry.get('language') not in ('node','python') or (language and entry['language']!=language) or not re.fullmatch('sha256:[a-f0-9]{64}',entry.get('immutableRuntimeId','')) or not isinstance(entry.get('timeoutSeconds'),int) or not 1<=entry['timeoutSeconds']<=240 or 'supervisor' not in entry or not re.fullmatch('[a-f0-9]{40}',entry.get('runtimeSourceSha','')):raise ValueError('ACTUAL_ENGINE_CLOSURE')
 for stage in ('before','after'):
  for cfg in spec['stages'][stage].values():engine(cfg['engine'],'node')
 canonical=spec['stages']['canonical-setup'];engine(canonical,'python')
 if not re.fullmatch('[a-f0-9]{40}',canonical.get('runtimeSourceSha','')) or not {'exact','probe'}<=set(canonical.get('resources',{})) or set(canonical['resources']['probe'])!={'canonical-source-manifest.json','canonical-extractor.json','python-runtime-manifest.json'} or not canonical.get('canonicalMigrationExtractorInvokeId'):raise ValueError('CANONICAL_PRODUCER_INPUT_CLOSURE')
 validate_canonical_inputs(spec,b,input_ref)
 for stage in ('migrate','canvas-audit'):
  required(spec['stages'][stage],('plan','engine','immutableRuntimeId','timeoutSeconds'))
  entry=spec['stages'][stage];migration=json.loads(input_ref(entry['plan'],True))
  expected={x['name']:x['sha256'] for x in migration.get('sourceSqlInventory',[])}
  if expected!=sql or migration.get('candidateSha')!=b['candidateSha'] or migration.get('prepared') is not True or not re.fullmatch('[a-f0-9]{64}',migration.get('canonicalMigratorSha256','')):raise ValueError('MIGRATION_PLAN_CLOSURE')
  if not re.fullmatch('sha256:[a-f0-9]{64}',entry.get('immutableRuntimeId','')) or not isinstance(entry.get('timeoutSeconds'),int) or not 1<=entry['timeoutSeconds']<=1200:raise ValueError('IMMUTABLE_API_REQUIRED')
  if stage=='canvas-audit':
   canvas=input_ref(entry['sql']).decode();migration=input_ref(entry['migration']).decode()
   if sql.get('20261001160000_canvas_template_audit.sql')!=hashlib.sha256(migration.encode()).hexdigest() or '-- Migration replay injected by the hash-bound stage supervisor.' not in canvas or not all(x in canvas for x in ('ROLLBACK;','SET LOCAL ROLE app_rw')):raise ValueError('CANVAS_OFFLINE_CLOSURE')
 for stage in ('snapshot','recovery-verify','restore-fidelity'):
  e=spec['stages'][stage];required(e,('clientImage','clientVersion','apiImage','apiSourceSha','certificate','privateKey','verifier'))
  for name in ('certificate','privateKey','verifier'):input_ref(e[name],name=='privateKey')
  if not re.fullmatch(r'[0-9]+\.[0-9]+(?:\.[0-9]+)?',e.get('clientVersion','')):raise ValueError('CLIENT_VERSION_REQUIRED')
  if e.get('apiSourceSha')!=b['candidateSha'] or not all(re.fullmatch('sha256:[a-f0-9]{64}',e.get(k,'')) for k in ('apiImage','clientImage')):raise ValueError('SNAPSHOT_IMAGE_BINDING')
 restore=b['restore'];required(restore,('clientImage','apiClientImage','apiClientSourceSha','isolatedNetwork','recipientCertificatePath','recipientCertificateSha256','recipientKeyPath','databasePreparationPath','databasePreparationSha256','databases'))
 if not all(re.fullmatch('sha256:[a-f0-9]{64}',restore.get(k,'')) for k in ('clientImage','apiClientImage')) or not re.fullmatch('[a-f0-9]{64}',restore.get('isolatedNetwork','')):raise ValueError('RESTORE_IMAGES_NETWORK_REQUIRED')
 source=b['sourceDatabaseSpec'];required(source,('rdsInstanceId','readOnly','rollbackConfirmed','observedUtc','databases'))
 if source.get('rdsInstanceId')!=b['sourceInstanceId'] or source.get('readOnly') is not True or source.get('rollbackConfirmed') is not True or set(x.get('name') for x in source.get('databases',[]))!=set(DBS) or len(source['databases'])!=3:raise ValueError('SOURCE_DATABASE_SPEC_REQUIRED')
 for database in source['databases']:
  if not {'owner','encoding','collate','ctype','acl'}<=set(database):raise ValueError('SOURCE_DATABASE_SPEC_SHAPE')
 age=datetime.datetime.now(datetime.timezone.utc).timestamp()-datetime.datetime.fromisoformat(source['observedUtc'].replace('Z','+00:00')).timestamp()
 if not 0<=age<=3600:raise ValueError('FRESH_SOURCE_DATABASE_SPEC')
 if restore.get('apiClientSourceSha')!=b['candidateSha'] or set(restore.get('databases',{}))!=set(DBS):raise ValueError('RESTORE_CLOSURE')
 helper=input_ref({'path':restore['databasePreparationPath'],'sha256':restore['databasePreparationSha256']}).decode()
 request={'binding':b,'secret':dict(targetInstanceId=b['targetInstanceId'],attemptId=b['attemptId'],host=b['host'],peer=b['peer'],port=5432,user='migration_admin')}
 offline_node("process.argv[1]='offline-validator';\n"+helper+"\nconst input=JSON.parse(require('fs').readFileSync(0,'utf8'));module.exports.validate(input);console.log(JSON.stringify({verified:true}));",request)
 input_ref({'path':restore['recipientCertificatePath'],'sha256':restore['recipientCertificateSha256']},True)
 key=Path(restore['recipientKeyPath']);st=key.lstat()
 if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.geteuid() or stat.S_IMODE(st.st_mode)!=0o600:raise ValueError('RESTORE_PRIVATE_KEY')
 # The key is also independently hash-bound by every snapshot/fidelity entry.
 if any(spec['stages'][stage]['privateKey']['path']!=str(key) or spec['stages'][stage]['certificate']['path']!=restore['recipientCertificatePath'] or spec['stages'][stage]['certificate']['sha256']!=restore['recipientCertificateSha256'] for stage in ('snapshot','recovery-verify','restore-fidelity')):raise ValueError('RECIPIENT_KEY_CLOSURE')
 public=subprocess.run(['/usr/bin/openssl','pkey','-in',str(key),'-pubout'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10)
 certificate=subprocess.run(['/usr/bin/openssl','x509','-in',restore['recipientCertificatePath'],'-pubkey','-noout'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10)
 if public.returncode or certificate.returncode or public.stdout!=certificate.stdout:raise ValueError('CMS_RECIPIENT_PAIR_REQUIRED')
 for db,backup in restore['databases'].items():
  required(backup,('receiptPath','receiptSha256','ciphertextPath'))
  receipt=json.loads(input_ref({'path':backup['receiptPath'],'sha256':backup['receiptSha256']},True))
  if receipt.get('database')!=db or receipt.get('sourceRdsInstanceId')!=b['sourceInstanceId'] or receipt.get('cleanupVerified') is not True or receipt.get('dumpExit')!=0 or receipt.get('encryptionExit')!=0 or receipt.get('recipientCertificateSha256')!=restore['recipientCertificateSha256']:raise ValueError('BACKUP_SOURCE_CLOSURE')
  cipher=Path(backup['ciphertextPath']);st=cipher.lstat();h=hashlib.sha256()
  if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.geteuid() or stat.S_IMODE(st.st_mode)!=0o600:raise ValueError('PRIVATE_CIPHERTEXT')
  with cipher.open('rb') as f:
   for block in iter(lambda:f.read(131072),b''):h.update(block)
  if h.hexdigest()!=receipt['ciphertextSha256'] or st.st_size!=receipt['bytes']:raise ValueError('BACKUP_CIPHERTEXT_CLOSURE')
 if b['tls']['sslmode']=='verify-full':input_ref(b['tls']['ca'])
 return spec

def preflight(b):
 validate_binding(b)
 if b.get('privateRoot')!='/var/lib/workspacex-cn/rehearsal/isolated-rds/'+b['attemptId'] or b['providerDescription']!='wsx-cn-isolated-round2-'+b['attemptId']:raise ValueError('STAGE_PRIVATE_ROOT_DESCRIPTION')
 if not all(isinstance(b.get(k),str) and b[k] for k in ('ecsRole','cleanupRole')):raise ValueError('ROLE_INPUT_REQUIRED')
 iam=b['cleanupIam']
 if iam.get('role')!=b['cleanupRole'] or not isinstance(iam.get('policy'),str) or not all(re.fullmatch('[a-f0-9]{64}',iam.get(k,'')) for k in ('roleTrustCanonicalSha256','policyCanonicalSha256')):raise ValueError('CLEANUP_IAM_INPUT_REQUIRED')
 frozen=json.loads(input_ref({'path':b['frozenManifestPath'],'sha256':b['frozenManifestSha256']},True))
 if frozen.get('candidateSha')!=b['candidateSha'] or frozen.get('frozen') is not True:raise ValueError('FROZEN_MANIFEST_BINDING')
 executable_closure({'path':b['adapterPath'],'sha256':b['adapterSha256'],'modules':b['adapterModules']})
 for name in STAGES:
  stage=b['stages'][name];executable_closure(stage)
  if not 1<=stage['timeoutSeconds']<=1200:raise ValueError('STAGE_TIMEOUT')
 stage_input_closure(b)
 return {'preparedInputClosure':True,'liveAccepted':False,'candidateSha':b['candidateSha']}
def main():
 if os.geteuid()!=0 or len(sys.argv) not in (3,4):raise ValueError('ROOT_MANIFEST_AND_HASH_REQUIRED')
 manifest=Path(sys.argv[1]);raw=manifest.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=sys.argv[2]:raise ValueError('MANIFEST_HASH')
 b=private_json(manifest);preflight(b)
 if len(sys.argv)==4:
  if sys.argv[3]!='--preflight':raise ValueError('UNKNOWN_OPTION')
  print(json.dumps(preflight(b)));return
 root=Path(b['privateRoot'])
 if root!=Path('/var/lib/workspacex-cn/rehearsal/isolated-rds')/b['attemptId']:raise ValueError('PRIVATE_ROOT_BINDING')
 root.mkdir(mode=0o700,parents=False,exist_ok=True)
 st=root.lstat()
 if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_mode&0o077:raise ValueError('PRIVATE_ROOT')
 lock=os.open(root/'execution.lock',os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
 try:
  def budget(operation):
   if operation in ('cleanup','cleanup-readback-deleted','cleanup-registration-remove','cleanup-iam-remove','cleanup-registration-readback-removed'):return 300
   return min(1200,max(1,int(created(b)+6900-datetime.datetime.now(datetime.timezone.utc).timestamp())))
  adapter=ProcessAdapter(b['adapterPath'],b['adapterSha256'],budget,b['adapterModules'])
  print(json.dumps(rehearse(b,root,adapter)))
 finally:os.close(lock);(root/'execution.lock').unlink()
if __name__=='__main__':
 try:main()
 except BaseException as error:
  report_provider_error(error)
  print('ISOLATED_REHEARSAL_REJECTED',file=sys.stderr);sys.exit(1)
