"""stdin {binding,secret}; root manifest admits real reviewed engine, never mock acceptance.
This adapter does not create resources. Engine entries must implement their own actual
SQL peer and identity checks, and root reviews their hashes/plan before any SQL run.
"""
import datetime,hashlib,ipaddress,json,os,re,signal,subprocess,sys,tempfile,time,uuid
from pathlib import Path
from isolated_conservation_plan import DBS,read_ref,private_bytes,validate_plan,verify_final_sql_inventory,reject

def verify_binding(b,s):
 target=b['targetInstanceId'];attempt=b['attemptId']
 if str(uuid.UUID(attempt))!=attempt or b.get('accountId')!='1177216024653153' or b.get('regionId')!='cn-shanghai':reject('ACCOUNT_ATTEMPT_BINDING')
 if ipaddress.ip_address(b['peer']).version!=4:reject('TARGET_PEER_BINDING')
 if target==b['sourceInstanceId'] or not re.fullmatch('pgm-[a-z0-9]+',target):reject('SOURCE_OR_INVALID_TARGET')
 if b['host']!=target+'.rwlb.rds.aliyuncs.com' or not re.fullmatch('[a-f0-9]{40}',b['candidateSha']):reject('TARGET_SOURCE_BINDING')
 if hashlib.sha256(b['peer'].encode()).hexdigest()!=b['peerSha256']:reject('TARGET_PEER_BINDING')
 if any(s.get(k)!=b[k] for k in ['accountId','regionId','targetInstanceId','attemptId','host','peer','peerSha256','providerCreatedUtc','tls']):reject('SECRET_TARGET_BINDING')
 if s.get('user')!='migration_admin' or s.get('port')!=5432 or not isinstance(s.get('password'),str) or len(s['password'])<16:reject('SECRET_SHAPE')
 if any(c in s['password'] for c in '\0\r\n'):reject('SECRET_SHAPE')
 if b.get('providerDescription')!='wsx-cn-isolated-round2-'+attempt:reject('PROVIDER_DESCRIPTION_BINDING')
 root=Path(b['privateRoot'])
 if str(root)!='/var/lib/workspacex-cn/rehearsal/isolated-rds/'+attempt:reject('PRIVATE_ROOT_BINDING')
 return root

def actual_engine(entry,payload,executor=None):
 # Read and hash actual executable bytes. Copying into a process adapter preserves
 # these exact module bytes; it never trusts a basename or sourceSha assertion alone.
 code=private_bytes(entry['path'],entry['sha256'])
 if entry.get('candidateSha')!=payload['binding']['candidateSha'] or entry.get('actualSqlPeerChecks') is not True:reject('ENGINE_SOURCE_PEER_CLOSURE')
 if entry.get('language') not in ['node','python'] or not entry.get('immutableRuntimeId','').startswith('sha256:'):reject('ENGINE_RUNTIME_REQUIRED')
 if not isinstance(entry.get('timeoutSeconds'),int) or not 1<=entry['timeoutSeconds']<=240:reject('ENGINE_TIMEOUT_BOUND')
 # Root-owned supervisor is itself hashed and receives credentials only over stdin.
 supervisor=entry.get('supervisor');raw=private_bytes(supervisor['path'],supervisor['sha256'])
 # Execute the verified bytes, never reopen mutable original path.
 temp=tempfile.TemporaryDirectory(prefix='wsx-conservation-supervisor-',dir='/run')
 staged=Path(temp.name)/'supervisor.py'
 fd=os.open(staged,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
 argv=['/usr/bin/python3.12','-I',str(staged)]
 invoke=executor or bounded
 # Supervisor validates immutable image, owned isolation/cleanup and receives code
 # bytes here. It must not resolve mutable remote source or image tags.
 try:
  result=invoke(argv,{'binding':payload['binding'],'secret':payload['secret'],'entry':entry,'engineBytes':code.decode('utf8'),'engineSha256':hashlib.sha256(code).hexdigest(),'request':payload.get('request'),'baseline':payload.get('baseline'),'before':payload.get('before'),'plan':payload.get('plan'),'canonicalPlan':payload.get('canonicalPlan'),'providerObservation':payload.get('providerObservation')},entry['timeoutSeconds'])
 finally:temp.cleanup()
 if not isinstance(result,dict) or result.get('engineSha256')!=entry['sha256'] or result.get('ownedCleanupVerified') is not True or result.get('actualSqlPeerVerified') is not True:reject('ENGINE_EXECUTION_PROOF_REQUIRED')
 return result

def bounded(argv,payload,timeout):
 p=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True,env={'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C','LC_ALL':'C'})
 try:
  raw,_=p.communicate(json.dumps(payload).encode(),timeout=timeout)
 except subprocess.TimeoutExpired:
  os.killpg(p.pid,signal.SIGTERM)
  try:p.communicate(timeout=15)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.communicate()
  reject('ENGINE_TIMEOUT')
 if p.returncode!=0 or len(raw)>16*1024*1024:reject('ENGINE_FAILED')
 return json.loads(raw)

def verify_result(proof,b,stage,database=None):
 if any(proof.get(k)!=b[k] for k in ['targetInstanceId','attemptId','candidateSha']):reject('ENGINE_RESULT_IDENTITY')
 if stage in ['before','after']:
  if proof.get('readOnly') is not True or proof.get('rollbackComplete') is not True or proof.get('mode')!=stage:reject('CONSERVATION_NOT_EXECUTED')
  if proof.get('database')!=database:reject('CONSERVATION_DATABASE_BINDING')
  if stage=='after' and proof.get('allBaselineTablesTransformationCovered') is not True:reject('CONSERVATION_INCOMPLETE')
 elif stage=='canonical-setup':
  if proof.get('allCanonicalSetupsAccepted') is not True or proof.get('memoryPreparedTwice') is not True or proof.get('checkpointSetupTwice') is not True or proof.get('force') is not False or proof.get('seed') is not False:reject('CANONICAL_SETUP_NOT_EXECUTED')
  if not isinstance(proof.get('connectionPeerIdentityChecks'),int) or proof['connectionPeerIdentityChecks']<4:reject('CANONICAL_PEER_PROOF')
 return proof

def verify_outer(outer,b,stage):
 if outer.get('accepted') is not True or outer.get('stage')!=stage or any(outer.get(k)!=b[k] for k in ['targetInstanceId','attemptId','candidateSha']):reject('PRIOR_STAGE_BINDING')
 return outer

def write_proof(root,name,proof):
 # Only a strictly verified engine proof is persisted; request/secret are never included.
 for key in proof:
  if any(part in key.lower() for part in ['password','secret','credential']):reject('SECRET_BEARING_PROOF')
 raw=json.dumps(proof,sort_keys=True,separators=(',',':')).encode()
 out=root/(name+'.proof.json');fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
 dfd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(dfd)
 finally:os.close(dfd)
 return {'path':str(out),'sha256':hashlib.sha256(raw).hexdigest()}

def bind_request(template,b,stage,db,baseline,canonical=None):
 # The policy template cannot pin a retired target; all actual identities come from
 # the reattested binding and the just-restored COPY fidelity evidence.
 epoch=int(datetime.datetime.fromisoformat(b['providerCreatedUtc'].replace('Z','+00:00')).timestamp()*1000)
 actual={'schemaVersion':1,'approval':'APPROVED_NEW_ISOLATED_RDS_MAX_2H','candidateSha':b['candidateSha'],'targetInstanceId':b['targetInstanceId'],'attemptId':b['attemptId'],'database':db,'mode':stage,'seed':False,'force':False,'requireEncryptedPostSnapshotBeforeDelete':True,'authorizedAtMs':epoch,'expiresAtMs':epoch+7200000,'targetPeerAddressSha256':b['peerSha256'],'targetPeerPort':5432,'baselineBackupReceiptSha256':baseline['backupReceiptSha256'],'baselineCiphertextSha256':baseline['ciphertextSha256']}
 if any(not re.fullmatch('[a-f0-9]{64}',actual[k]) for k in ['baselineBackupReceiptSha256','baselineCiphertextSha256']):reject('RESTORE_ARCHIVE_HASH_SHAPE')
 for key,value in template.items():
  if key in actual and value!=actual[key]:reject('REQUEST_TEMPLATE_DRIFT')
 if set(template)-set(actual)-{'canonicalSchemaPlanSha256','pythonRuntimeManifestSha256','canonicalSetupSourceSha256'}:reject('REQUEST_TEMPLATE_EXTRA_FIELDS')
 if canonical:
  raw=json.dumps(canonical,separators=(',',':'),ensure_ascii=False).encode()
  actual.update(canonicalSchemaPlanSha256=hashlib.sha256(raw).hexdigest(),pythonRuntimeManifestSha256=canonical['runtimeManifestSha256'],canonicalSetupSourceSha256=canonical['canonicalSetupSourceSha256'])
 for key in ['canonicalSchemaPlanSha256','pythonRuntimeManifestSha256','canonicalSetupSourceSha256']:
  if key in template and template[key]!=actual.get(key):reject('CANONICAL_REQUEST_TEMPLATE_DRIFT')
 return actual

def run_stage(payload,reader=private_bytes,invoke=actual_engine):
 b=payload['binding'];secret=payload['secret'];root=verify_binding(b,secret)
 frozen=read_ref({'path':b['frozenManifestPath'],'sha256':b['frozenManifestSha256']},reader)
 if frozen.get('candidateSha')!=b['candidateSha'] or frozen.get('frozen') is not True:reject('FROZEN_SOURCE_REQUIRED')
 manifest=read_ref({'path':b['stageManifestPath'],'sha256':b['stageManifestSha256']},reader)
 if manifest.get('attemptId')!=b['attemptId'] or manifest.get('targetInstanceId')!=b['targetInstanceId']:reject('STAGE_MANIFEST_TARGET')
 plan=validate_plan(manifest['conservationPlan'],b)
 inventory=read_ref(manifest['sourceSqlInventory'],reader)
 if inventory.get('sourceSha')!=b['candidateSha']:reject('FINAL_SQL_SOURCE_BINDING')
 verify_final_sql_inventory(plan,inventory)
 stage=payload.get('operation')
 if stage!=b.get('stageConfig',{}).get('stage',stage):reject('STAGE_OPERATION_BINDING')
 if stage not in ['before','after','canonical-setup']:reject('STAGE_NOT_OWNED')
 entries=manifest['stages'][stage]
 results={}
 if stage=='canonical-setup':
  # Actual independent owner credentials are mandatory. Never use migration_admin
  # as a substitute for the runtime owner/setup readiness path.
  roles=secret.get('roles',{})
  if set(roles)!={'app_diag_ro','app_rw','graph_owner','memory_owner','memory_rw','migration_owner'}:reject('CANONICAL_ROLE_CREDENTIALS_REQUIRED')
  for name,role in roles.items():
   if not isinstance(role,dict) or role.get('user')!=name or role.get('port')!=5432 or any(role.get(k)!=b[k] for k in ['accountId','regionId','targetInstanceId','attemptId','host','peer','peerSha256','providerCreatedUtc','tls']):reject('CANONICAL_ROLE_BINDING')
   password=role.get('password')
   if not isinstance(password,str) or len(password)<16 or any(c in password for c in '\0\r\n'):reject('CANONICAL_ROLE_SHAPE')
  result=invoke(entries,{**payload,'plan':plan});verify_result(result,b,stage)
  results={'canonical':result}
 else:
  if set(entries)!=set(DBS):reject('THREE_DATABASE_ENTRIES_REQUIRED')
  for db in DBS:
   cfg=entries[db]
   restore=read_ref(payload['previousReceipts']['restore'],reader)
   verify_outer(restore,b,'restore')
   baseline=read_ref(restore['baselineProofRefs'][db],reader)
   if baseline.get('database')!=db or baseline.get('targetRdsInstanceId')!=b['targetInstanceId'] or baseline.get('dataFidelityVerified') is not True:reject('BASELINE_PROOF_BINDING')
   canonical_plan=read_ref(cfg['canonicalPlan'],reader) if 'canonicalPlan' in cfg else None
   request=bind_request(cfg.get('request',{}),b,stage,db,baseline,canonical_plan)
   before=None
   if stage=='after':
    outer=read_ref(payload['previousReceipts']['before'],reader)
    verify_outer(outer,b,'before')
    before=read_ref(outer['proofRefs'][db],reader)
   if before:verify_result(before,b,'before',db)
   result=invoke(cfg['engine'],{**payload,'request':request,'baseline':baseline,'before':before,'plan':plan,'canonicalPlan':canonical_plan});verify_result(result,b,stage,db);results[db]=result
  if stage=='after':
   outer=read_ref(payload['previousReceipts']['canonical-setup'],reader);verify_outer(outer,b,'canonical-setup')
   canonical=read_ref(outer['proofRefs']['canonical'],reader);verify_result(canonical,b,'canonical-setup')
   canvas=read_ref(payload['previousReceipts']['canvas-audit'],reader)
   if any(canvas.get(k)!=b[k] for k in ['targetInstanceId','attemptId','candidateSha']) or canvas.get('accepted') is not True:reject('CANVAS_AUDIT_NOT_ACCEPTED')
 # Only hashes/bound identity leave the stage; never secret-bearing engine requests.
 out={'accepted':True,**{k:b[k] for k in ['targetInstanceId','attemptId','candidateSha']},'stage':stage,'proofSha256':hashlib.sha256(json.dumps(results,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'stageManifestSha256':b['stageManifestSha256'],'fullReady':False}
 out['proofRefs']={name:write_proof(root,stage+'-'+name,result) for name,result in results.items()}
 if stage in ['before','after']:out['databases']=list(DBS)
 return out
if __name__=='__main__':
 try:
  if os.geteuid()!=0:reject('ROOT_REQUIRED')
  raw=sys.stdin.buffer.read(16*1024*1024+1)
  if len(raw)>16*1024*1024:reject('INPUT_SIZE_LIMIT')
  print(json.dumps(run_stage(json.loads(raw)),sort_keys=True))
 except BaseException:
  print('ISOLATED_CONSERVATION_STAGE_NOT_READY',file=sys.stderr);sys.exit(1)
