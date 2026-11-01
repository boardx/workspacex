#!/usr/bin/env python3
"""ONE-SHOT US operator reconciliation. No SQL apply/prepare/service stop/start.
Root must review this exact file and constants before executing. No automatic retry.
"""
import fcntl,hashlib,importlib.util,json,os,re,signal,stat,time,uuid,sys
sys.dont_write_bytecode=True
# Do not consume a sibling __pycache__ either: /dev/null cannot hold cache files.
sys.pycache_prefix="/dev/null/wsx-reconcile-no-bytecode"
from pathlib import Path
ROOT=Path('/var/lib/workspacex-image-release/us/qualification-tools-dfb8d2c6a')
OLD=Path('/var/lib/workspacex-image-release/us/tag-maintenance-9ac1d2b679466ca8035b68c41bc3b3')
STATE=OLD.parent
CFG=Path('/etc/workspacex-image-release/us.json')
LOCK=Path('/run/workspacex-selfhost-deploy.lock')
MARKER=Path('/var/lib/workspacex-selfhost-state/business-probe-uncertain')
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
CODE_SOURCE_REVISION='dfb8d2c6a9a094f38d28b94457eea823c1632bfc'
CODE_MANIFEST={'schema-tag-prepare.py': '47d7ee000af66b62f247405d9d92cce7c5e0ef9a93137e5f5346c0121a0691cb', 'schema-tag-prepare-cn.py': '885acd283ece19ab4770d362b0358293229c88594315072b90d986336da76d67', 'minimal-docker-release.py': '27f28da8b9504428aaa1b6ca2995765e121a7b9284ecc2ca760c4d0fa695d7b6', 'schema-restore-rehearsal.py': 'c78ccf3a7f328d7cd4f51d6d9f584fe16eff0d99f0ec0b9802037466697aa089', 'schema-acl-rehearsal.py': '6b3222b6094cf9988260cdd231af4f07273254268e5a54c84e3cac395ca6be23', 'schema-acl-source-prepare.py': 'f9381b59e2e07c867075de6cda375b46a16a8de6b507cc515fd16fd7f891d4ae', 'schema-cn-acl-profile.py': '2dbc0516a143562b5cf51218357ec5a7c896eff5c40bdf7c07194d58aca8d5e4', 'cn-tag-migration-adapter.py': '83923a12ce0e52edc2fee6ffa31cf33f8ea68ced7adb8e5d8ddbc64c78ba04bd', 'us-tag-migration-adapter.py': '4d282c288d275b4aa6aba3f9e4af390ee498d0ea4196e62c3267f8afee5cd6b9', 'tag-reviewed-migration-driver.mjs': '7a4d765bb40b32cebce1424922b1183d3521df7dd227036e0f79b42990d5e38e', 'tag-maintenance-release.py': '866f94bc72b6e9c9f61c22c97f974af58288a122b8b234f95963664d09dd4729', 'tag-migrated-activation.py': '4e5d4b90e499aaeea84105071c9c289f35c3d5f5e8b078c461785790cb47fb94', 'schema-release-handoff.py': '0486a98adc6e3d9f5f01f6e33e09dabffbdd2cf2f9a7657f0dde4b628a27fb8f', 'tag-bootstrap-probe.py': '2c52b6ff7969e838635b455ea7dbc78fcb82fb5eef01ee26d3f35463416229e7', 'us-tag-maintenance-policy.py': 'cb5b598ecfeaf676e1aa880b4d200ef54112672dcf2d5b6a20d186d8d6a6ba35', 'us-tag-old-application-probe.py': '3b2cdf46221e7ae67ed9f169999f08b0c4f0562d67ded107226431aaecec00b2'}
WRAPPERS={'writer':'fixed-us-writer','verifier':'fixed-us-verifier'}
def need(v,c):
 if not v:raise RuntimeError(c)
def sha(b):return hashlib.sha256(b).hexdigest()
def trusted(p,private=False,directory=False):
 p=Path(p);need(p.is_absolute(),'ABSOLUTE_PATH')
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_TRUST')
 s=p.stat();need(stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode) and s.st_nlink==1,'FILE_TYPE')
 if private:need(not s.st_mode&0o077,'PRIVATE_REQUIRED')
 return p
def raw(p):return trusted(p,True).read_bytes()
def read(p):return json.loads(raw(p))
def load(name):
 need(name+'.py' in CODE_MANIFEST,'MODULE_NOT_WHITELISTED');p=trusted(ROOT/(name+'.py'));need(sha(p.read_bytes())==CODE_MANIFEST[name+'.py'],'MODULE_HASH_DRIFT');s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
FROZEN={}
def freeze(p):
 p=trusted(p,True);b=p.read_bytes();FROZEN[str(p)]=sha(b);return json.loads(b)
def unchanged():
 for p,h in FROZEN.items():need(sha(raw(p))==h,'ORIGINAL_EVIDENCE_CHANGED')
def identity(v):need(v.get('source')==SOURCE and v.get('tag')==TAG and v.get('environment')=='us','IDENTITY')
def fsyncdir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def main():
 need(os.geteuid()==0 and len(__import__('sys').argv)==1,'ROOT_NO_ARGUMENTS')
 trusted(ROOT,directory=True);files=[p for p in ROOT.iterdir() if p.is_file()]
 need({p.name for p in files}==set(CODE_MANIFEST)|set(WRAPPERS.values()),'EXACT_KNOWN_CLOSURE_SET')
 for name,h in CODE_MANIFEST.items():
  code=trusted(ROOT/name);need(sha(code.read_bytes())==h,'GIT_BLOB_CLOSURE_MISMATCH')
 initial_cfg=read(CFG);schema_policy=initial_cfg.get('schemaRelease',{})
 need(schema_policy.get('kind')=='installed-schema-release-adapter-v1' and schema_policy.get('environment')=='us' and schema_policy.get('timeoutSeconds')==600,'INSTALLED_HANDOFF_POLICY')
 closure={str(ROOT/name):h for name,h in CODE_MANIFEST.items()}
 for role,name in WRAPPERS.items():
  ref=schema_policy.get(role,{});need(ref.get('path')==str(ROOT/name) and type(ref.get('sha256')) is str and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'WRAPPER_CONFIG_BINDING')
  wrapper=trusted(ref['path']);need(sha(wrapper.read_bytes())==ref['sha256'],'WRAPPER_PIN_DRIFT');closure[str(wrapper)]=ref['sha256']
 initial_cfg_hash=sha(raw(CFG))
 maint=load('tag-maintenance-release');us=load('us-tag-migration-adapter');boot=load('tag-bootstrap-probe');core=load('schema-restore-rehearsal')
 trusted(STATE,True,True);trusted(OLD,True,True)
 fd=os.open(trusted(LOCK,True),os.O_RDONLY|os.O_NOFOLLOW)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);us.inherited_lock(fd);os.environ['WSX_RELEASE_LOCK_FD']=str(fd)
  pending=STATE/'pending.json';pending_raw=raw(pending);pending_hash=sha(pending_raw);pending_v=json.loads(pending_raw)
  need(pending_v.get('attempt')==str(OLD),'PENDING_ATTEMPT')
  need(not (OLD/'receipt.json').exists() and not (OLD/'receipt.json').is_symlink(),'ORIGINAL_RECEIPT_EXISTS')
  need(not MARKER.exists() and not MARKER.is_symlink(),'EXISTING_BUSINESS_MARKER_REQUIRES_SEPARATE_RECONCILIATION')
  p=freeze(OLD/'policy.json');identity(p);need(p.get('attempt')==OLD.name,'POLICY_ATTEMPT');need(p['stateDirectory']==str(STATE) and p['lockFile']==str(LOCK),'ORIGINAL_POLICY_LOCATION')
  need(pending_v.get('policySha256')==FROZEN[str(OLD/'policy.json')],'PENDING_POLICY_HASH')
  need(0<=time.time()-p['preparedAt']<3600,'POLICY_EXPIRED')
  cfg=freeze(CFG);need(FROZEN[str(CFG)]==initial_cfg_hash,'CONFIG_CHANGED_DURING_LOAD');need(cfg['environment']=='us' and cfg['lockFile']==str(LOCK) and cfg['stateDirectory']==str(STATE),'CONFIG_BINDING')
  need(any(r['path']==str(CFG) and r['sha256']==FROZEN[str(CFG)] for r in p['configurationPins']),'CONFIG_NOT_ORIGINALLY_PINNED')
  prep=freeze(Path(p['preparationReceipt']['path']));maint.pinned(p['preparationReceipt'],private=True);identity(prep);need(prep['status']=='PREPARED_FOR_MAINTENANCE','ORIGINAL_PREPARATION')
  marker_archives={str(q):sha(trusted(q,True).read_bytes()) for q in MARKER.parent.glob(MARKER.name+'.reconciled-'+OLD.name+'*')}
  FROZEN.update(marker_archives)
  failure=freeze(OLD/'failure.json');need(failure.get('source')==SOURCE and failure.get('tag')==TAG,'FAILURE_IDENTITY')
  freeze(OLD/'state.json');intent=freeze(OLD/'database-transaction-intent.json');identity(intent);need(intent['status']=='TRANSACTION_INTENT','ORIGINAL_SQL_INTENT')
  ack=freeze(OLD/'databaseCommand-apply.json');identity(ack);need(ack['status']=='COMMITTED' and ack.get('commitAcknowledged') is True and ack.get('ledgerCount')==438,'ORIGINAL_ACK')
  rec=freeze(OLD/'databaseCommand-reconcile.json');identity(rec);need(rec['status']=='COMPLETE','ORIGINAL_COMPLETE')
  original_boot=freeze(OLD/'bootstrapProbe-preactivate.json');identity(original_boot);need(original_boot['status']=='CANDIDATE_BOOTSTRAP_COMPATIBLE','ORIGINAL_BOOTSTRAP')
  original_raw=trusted(original_boot['rawOutput']['path'],True);need(original_raw.parent==OLD and sha(original_raw.read_bytes())==original_boot['rawOutput']['sha256'],'ORIGINAL_BOOTSTRAP_RAW_HASH')
  FROZEN[str(original_raw)]=sha(original_raw.read_bytes());boot.validate_output(original_raw.read_bytes(),SOURCE,original_boot['imageDigest'])
  for key in ('databaseCommand','backupCommand','oldApplicationProbe','bootstrapProbe'):
   maint.pinned(p[key]['executable'])
   for ref in p[key].get('inputs',[]):maint.pinned(ref,private=ref.get('private',False))
  def pins():
   for ref in p['configurationPins']:maint.pinned(ref,private=ref.get('private',False))
   maint.pinned(p['nginx']);unchanged()
   for path,h in closure.items():need(sha(trusted(path).read_bytes())==h,'CLOSURE_CHANGED')
   need(raw(pending)==pending_raw,'PENDING_CAS')
  pins();adapter=us.Adapter(OLD,fd);qualification=adapter.require_backup()
  freeze(OLD/'stopped-backup/qualification.json')
  for name,h in qualification['files'].items():
   q=trusted(OLD/'stopped-backup'/name,True);need(sha(q.read_bytes())==h,'BACKUP_PROOF_HASH');FROZEN[str(q)]=h
  compose_files=list(cfg['composeFiles'])
  if (STATE/'current.json').exists():
   current=freeze(STATE/'current.json');need(set(current)=={'tag','sourceRevision','path','sha256'} and type(current['tag']) is str and bool(current['tag']) and re.fullmatch('[a-f0-9]{40}',current['sourceRevision']) and re.fullmatch('[a-f0-9]{64}',current['sha256']),'CURRENT_POINTER_FORMAT');override=Path(current['path']);need(override.is_relative_to(STATE),'CURRENT_OVERRIDE_PATH');maint.pinned(current);freeze(override);compose_files.append({'path':str(override),'sha256':current['sha256']})
  need(adapter.run('reconcile')['status']=='COMPLETE','LIVE_COMPLETE_REQUIRED')
  fresh=STATE/('tag-maintenance-'+uuid.uuid4().hex);fresh.mkdir(mode=0o700);core.save(fresh/'policy.json',p)
  host=maint.Host(p,fresh,fd)
  def runtime():
   rows=host.runtime();maint.runtime_set(rows,p['project'],p['baseline'],True)
   original=adapter.d.json(['compose','--project-name',p['project'],'--env-file',cfg['envFile']['path'],*[x for r in compose_files for x in ('--file',r['path'])],'config','--format','json'])
   for row in rows:
    service=row['Config']['Labels']['com.docker.compose.service'];h=adapter.d
    from_engine=load('minimal-docker-release').resolved_config_hash(h,original,p['project'],service,fresh)
    need(from_engine==[service,row['Config']['Labels'].get('com.docker.compose.config-hash')],'LIVE_CONFIG_CAS')
   return rows
  def quiet():
   sql="BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT json_build_object('database',current_database(),'role',current_user,'activeRuns',(SELECT count(*) FROM public.agent_runs WHERE status IS NULL OR status NOT IN ('succeeded','failed','cancelled')),'preparedTransactions',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database())); ROLLBACK;"
   r=adapter.execute(sql,timeout=15);need(r.returncode==0,'QUIESCENCE_QUERY_FAILED');v=json.loads(r.stdout)
   need(v=={'database':'workspacex','role':'postgres','activeRuns':0,'preparedTransactions':0},'QUIESCENCE_NOT_PROVEN')
   for label in ('wsx.us-maintenance-probe','wsx.bootstrap-probe'):
    need(not adapter.d.run(['ps','--all','--quiet','--filter','label='+label]).strip(),'OWNED_PROBE_EXISTS')
   core.save(fresh/('quiescence-'+uuid.uuid4().hex+'.json'),v)
  def readiness():
   rows=runtime();markers=[]
   for svc in ('api','web'):
    row=next(r for r in rows if r['Config']['Labels']['com.docker.compose.service']==svc)
    found=[v.split('=',1)[1] for v in row['Config']['Env'] if v.startswith('WORKSPACEX_DEPLOYMENT_MARKER=')]
    need(len(found)==1 and re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',found[0]),'MARKER_BINDING');markers.append(found[0])
   need(markers[0]==markers[1],'MARKER_DISAGREEMENT')
   for endpoint in ('/api/healthz','/.well-known/workspacex-deployment'):
    args=['/usr/bin/curl','--disable','--silent','--show-error','--fail','--noproxy','*','--proto','=https','--max-redirs','0','--max-time','10','--max-filesize','65536','--resolve','appv1.boardx.us:443:127.0.0.1','--write-out','\\n%{http_code}','https://appv1.boardx.us'+endpoint]
    body,code=host.run(args,timeout=12).rsplit(b'\n',1);need(code==b'200','LOOPBACK_HTTP');v=json.loads(body)
    need(v.get('deploymentMarker')==markers[0] and (endpoint!='/api/healthz' or v.get('trustworthy') is True),'LOOPBACK_MARKER_HEALTH')
   return markers[0]
  expected_marker=readiness();quiet();pins()
  core.save(fresh/'reconciliation-intent.json',{'source':SOURCE,'tag':TAG,'environment':'us','originalAttempt':str(OLD),'originalEvidenceHashes':dict(FROZEN),'pendingSha256':pending_hash,'applyAllowed':False,'businessProbeMaximumAttempts':1,'closureHashes':closure,'codeSourceRevision':CODE_SOURCE_REVISION})
  b=host.adapter('bootstrapProbe','preactivate');need(b['status']=='CANDIDATE_BOOTSTRAP_COMPATIBLE','FRESH_BOOTSTRAP_FAILED')
  br=trusted(b['rawOutput']['path'],True);need(br.parent==fresh and sha(br.read_bytes())==b['rawOutput']['sha256'],'FRESH_BOOTSTRAP_RAW_HASH');boot.validate_output(br.read_bytes(),SOURCE,b['imageDigest'])
  pins();quiet();core.save(fresh/'business-once-intent.json',{'source':SOURCE,'tag':TAG,'maximumAttempts':1,'startedAt':time.time()})
  business=host.adapter('oldApplicationProbe','verify');identity(business);need(business['status']=='OLD_APPLICATION_VERIFIED','FRESH_BUSINESS_FAILED')
  need(not MARKER.exists() and not MARKER.is_symlink(),'BUSINESS_UNCERTAIN')
  quiet();rows=runtime();need(readiness()==expected_marker,'FINAL_MARKER_DRIFT');pins();adapter.require_backup();need(adapter.run('reconcile')['status']=='COMPLETE','FINAL_LEDGER_DRIFT')
  final_ledger=adapter.read();need(final_ledger=={**adapter.base,**core.MIGRATIONS} and len(final_ledger)==438,'FINAL_LEDGER_COUNT');core.save(fresh/'final-ledger.json',{'ledger':final_ledger,'sha256':sha(json.dumps(final_ledger,sort_keys=True).encode())})
  public={}
  for endpoint in ('/api/healthz','/.well-known/workspacex-deployment'):
   args=['/usr/bin/curl','--disable','--silent','--show-error','--fail','--noproxy','*','--proto','=https','--max-redirs','0','--max-time','10','--max-filesize','65536','--write-out','\\n%{http_code}','https://appv1.boardx.us'+endpoint]
   body,code=host.run(args,timeout=12).rsplit(b'\n',1);need(code==b'200','PUBLIC_HTTP');v=json.loads(body)
   need(v.get('deploymentMarker')==expected_marker and (endpoint!='/api/healthz' or v.get('trustworthy') is True),'PUBLIC_MARKER_HEALTH');public[endpoint]={'httpStatus':200,'markerMatched':True}
  pins();need(not (OLD/'receipt.json').exists(),'RECEIPT_CAS')
  proofs={str(q):sha(q.read_bytes()) for q in fresh.iterdir() if q.is_file()}
  receipt={'status':'SCHEMA_COMPLETE_OLD_APPLICATION_AVAILABLE','source':SOURCE,'tag':TAG,'environment':'us','time':time.time(),'reconciliationOnly':True,'operatorReconciliation':True,'productionMigrationExecuted':False,'targetImagesActivated':False,'maintenanceHeld':False,'originalAttempt':str(OLD),'reconciliationAttempt':str(fresh),'originalEvidenceHashes':dict(FROZEN),'pendingSha256':pending_hash,'freshEvidenceHashes':proofs,'publicReadback':public,'ledgerCount':438,'canonicalLock':{'path':str(LOCK),'device':os.fstat(fd).st_dev,'inode':os.fstat(fd).st_ino}}
  core.save(fresh/'receipt.json',receipt);pins();core.save(OLD/'receipt.json',receipt)
  need(raw(pending)==pending_raw,'FINAL_PENDING_CAS');archive=STATE/('pending.reconciled-'+fresh.name+'.json');need(not archive.exists(),'PENDING_ARCHIVE_EXISTS')
  os.rename(pending,archive);fsyncdir(STATE)
  core.save(fresh/'pending-archive.json',{'path':str(archive),'sha256':pending_hash,'originalPath':str(pending)})
  print(json.dumps({'status':'RECONCILED','receipt':str(OLD/'receipt.json'),'evidenceDirectory':str(fresh),'pendingArchive':str(archive)}))
 finally:os.close(fd)
if __name__=='__main__':
 for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(sig,lambda *_:(_ for _ in ()).throw(RuntimeError('RECONCILIATION_INTERRUPTED')))
 try:main()
 except Exception as e:
  print(json.dumps({'status':'RECONCILIATION_REFUSED','code':str(e) if re.fullmatch('[A-Z0-9_]{1,100}',str(e)) else 'UNQUALIFIED'}));raise SystemExit(1)
