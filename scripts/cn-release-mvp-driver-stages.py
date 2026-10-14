"""Root-only MVP stage hooks; original approval/window and durable no-retry intent.

Schema/content execute after the fixed switch migration, while writers are held.
HTTP session writes execute only through the existing post-clear writer gate.
No caller-selected executable, environment, route or input path is accepted.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import stat

ROOT=Path(__file__).resolve().parents[1]
INPUTS=Path('/var/lib/workspacex-cn/release-inputs')
OUTPUTS=Path('/var/lib/workspacex-cn/release-generated')
APPROVALS=Path('/etc/workspacex-cn/release-approvals')
CONTROL=Path('/usr/local/lib/workspacex-cn/release-control')

def load(name):
 p=ROOT/'scripts'/('cn-release-'+name+'.py');s=importlib.util.spec_from_file_location(name,p)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
e=load('fixed-driver').e

FILES={'profile':'profile','schemaRequest':'schema-request','contentRequest':'content-request',
       'contentBackup':'content-backup','nonmodelFixtures':'nonmodel-fixtures','nonmodelCredentials':'nonmodel-credentials'}
CODE={'scripts/cn-release-mvp-driver-stages.py','scripts/cn-release-mvp-contract.py','scripts/cn-release-mvp-content-stage.py',
 'scripts/cn-release-mvp-nonmodel.py','scripts/cn-release-business-state.py',
 'apps/api/scripts/platform-content-release.ts','apps/api/scripts/platform-content-release-core.ts',
 'apps/api/scripts/platform-schema-readback.ts','apps/api/scripts/platform-schema-readback-core.ts'}

def enabled(a):return a.get('mvp',{}).get('acceptanceScope')=='mvp-non-model'

def installed(path,limit=33554432):
 # Existing system binaries and root-owned source checkout can be 0755/0644.
 # Private approval inputs still use the original stricter e.read.
 e.directory(path.parent)
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd);e.need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022 and st.st_size<=limit,'MVP_INSTALLED_FILE')
  raw=b''
  while len(raw)<=limit:
   part=os.read(fd,min(65536,limit+1-len(raw)))
   if not part:break
   raw+=part
  after=os.fstat(fd)
  e.need(len(raw)==st.st_size and (st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'MVP_INSTALLED_FILE_CHANGED')
  return raw
 finally:os.close(fd)

def inputs(a,release):
 e.need(enabled(a),'MVP_AUTHORITY_REQUIRED');load('mvp-contract').validate_metadata(a['mvp']);pins=a['mvp']['stageInputs']
 e.need(set(pins)=={k+'Sha256' for k in FILES},'MVP_INPUT_FIELDS')
 result={}
 for k,name in FILES.items():
  raw=e.read(INPUTS/release/('mvp-'+name+'.json'));e.need(e.digest(raw)==pins[k+'Sha256'],'MVP_INPUT_PIN')
  result[k]=raw
 return result

def preflight(a,release):
 x=inputs(a,release);p=e.decode(x['profile'])
 e.need(set(p)=={'sourceCheckout','nodeSha256','environmentSha256','pythonPath','pythonSha256',
 'dockerSha256','holdHelperSha256','deploymentMarker','productionCorrelation','identity','sourceFiles','gitSha256','runtimeManifestSha256'},'MVP_PROFILE_FIELDS')
 e.need(p['identity']['sourceRevision']==a['identity']['sourceRevision'] and p['identity']['controlRevision']==a['identity']['controlRevision'],'MVP_PROFILE_IDENTITY')
 checkout=Path(p['sourceCheckout'])
 e.need(checkout==Path('/usr/local/lib/workspacex-cn/release-source')/a['identity']['sourceRevision'],'MVP_SOURCE_PATH')
 for name in CODE:
  e.need(name in a['codeFiles'],'MVP_CODE_CLOSURE')
  e.need(e.digest(e.read(ROOT/name,1048576))==a['codeFiles'][name],'MVP_CODE_PIN')
 e.need(type(p['sourceFiles'])is dict and p['sourceFiles'],'MVP_SOURCE_CLOSURE')
 for name,pin in p['sourceFiles'].items():
  rel=Path(name);e.need(not rel.is_absolute() and '..'not in rel.parts,'MVP_SOURCE_FILE')
  e.need(e.digest(installed(checkout/rel))==pin,'MVP_SOURCE_CODE_PIN')
  # Content/migration source is independently pinned to the application checkout.
  # Tool adapter code remains the separately approved control revision.
  e.need(e.digest(installed(CONTROL/rel))==pin,'MVP_TOOL_SOURCE_DATA_MISMATCH')
 e.need(p['pythonPath'].startswith('/usr/bin/python3.') and Path(p['pythonPath']).name==p['pythonPath'].split('/')[-1],'MVP_PYTHON')
 for path,key in [('/usr/bin/node','nodeSha256'),(p['pythonPath'],'pythonSha256'),('/usr/bin/docker','dockerSha256'),('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py','holdHelperSha256')]:
  e.need(e.digest(installed(Path(path),268435456))==p[key],'MVP_EXECUTABLE_PIN')
 e.need(e.digest(installed(Path('/usr/bin/git'),268435456))==p['gitSha256'],'MVP_GIT_PIN')
 git=subprocess.run(['/usr/bin/git','-C',str(CONTROL),'rev-parse','HEAD'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15,env=e.ENV,check=False)
 e.need(git.returncode==0 and git.stdout.strip().decode()==a['identity']['controlRevision'],'MVP_CONTROL_CHECKOUT_REVISION')
 manifest_raw=e.read(INPUTS/release/'mvp-runtime-manifest.json',33554432)
 e.need(e.digest(manifest_raw)==p['runtimeManifestSha256'],'MVP_RUNTIME_MANIFEST_PIN')
 manifest=e.decode(manifest_raw);e.need(type(manifest)is dict and manifest,'MVP_RUNTIME_CLOSURE')
 actual=set()
 for path in CONTROL.rglob('*'):
  rel=path.relative_to(CONTROL)
  if '.git' in rel.parts:continue
  if path.is_symlink():
   e.need(path.lstat().st_uid==0 and path.resolve().is_relative_to(CONTROL),'MVP_RUNTIME_LINK')
  if path.is_file():actual.add(str(rel))
  elif path.is_dir():e.directory(path.resolve())
 e.need(set(manifest)==actual,'MVP_RUNTIME_CLOSURE_INCOMPLETE')
 for name,pin in manifest.items():
  rel=Path(name);e.need(not rel.is_absolute() and '..'not in rel.parts,'MVP_RUNTIME_FILE')
  path=CONTROL/rel
  if path.is_symlink():
   e.need(path.lstat().st_uid==0 and path.resolve().is_relative_to(CONTROL),'MVP_RUNTIME_LINK')
   path=path.resolve()
  e.need(e.digest(installed(path))==pin,'MVP_RUNTIME_FILE_PIN')
 for name in ('apps/api/scripts/platform-content-release.ts','apps/api/scripts/platform-content-release-core.ts','apps/api/scripts/platform-schema-readback.ts','apps/api/scripts/platform-schema-readback-core.ts'):
  e.need(manifest.get(name)==a['codeFiles'][name],'MVP_CONTROL_ADAPTER_PIN')
 # Read-only import proves actual tsx/pg/transitive module loading before hold.
 probe="await import('./apps/api/scripts/platform-content-release-core.ts');await import('./apps/api/scripts/platform-schema-readback-core.ts');await import('./apps/api/src/infrastructure/db/pg-database.ts');console.log('MVP_IMPORT_OK')"
 result=subprocess.run(['/usr/bin/node','--import','tsx','--input-type=module','-e',probe],cwd=str(CONTROL),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=60,env=e.ENV,check=False)
 e.need(result.returncode==0 and result.stdout==b'MVP_IMPORT_OK\n','MVP_RUNTIME_IMPORT_UNAVAILABLE')
 environment=e.read(INPUTS/release/'mvp-existing-environment.json');e.need(e.digest(environment)==p['environmentSha256'],'MVP_ENVIRONMENT_PIN')
 env=e.decode(environment)
 allowed={'WORKSPACEX_DEPLOY_PROFILE','WORKSPACEX_RDS_TLS_EXCEPTION','PGHOST','PGPORT','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT_MS','PGSTATEMENT_TIMEOUT_MS','MIGRATION_DB_USER','MIGRATION_DB_PASSWORD'}
 e.need(type(env)is dict and set(env)<=allowed and all(type(v)is str for v in env.values()),'MVP_EXISTING_ENVIRONMENT_ONLY')
 e.need(env.get('WORKSPACEX_DEPLOY_PROFILE')=='production' and env.get('PGDATABASE')=='workspacex_a1cb_20261006' and env.get('PGHOST') and env.get('MIGRATION_DB_USER') and env.get('MIGRATION_DB_PASSWORD'),'MVP_EXISTING_MIGRATION_ENV_REQUIRED')
 schema=e.decode(x['schemaRequest']);content=e.decode(x['contentRequest'])
 backup=e.decode(x['contentBackup'])
 e.need(set(backup)=={'sourceRevision','requestSha256','beforeStateSha256','dbInstanceId','database'} and backup['requestSha256']==e.digest(x['contentRequest']) and backup['sourceRevision']==a['identity']['sourceRevision'] and backup['beforeStateSha256']==content['beforeStateSha256'] and backup['dbInstanceId']=='pgm-uf6rg214cp381l49' and backup['database']=='workspacex_a1cb_20261006','MVP_BACKUP_TEMPLATE')
 migrations=checkout/'apps/api/migrations';e.directory(migrations)
 ledger=[]
 for file in sorted(migrations.iterdir()):
  if file.name.endswith('.sql'):
   name='apps/api/migrations/'+file.name
   e.need(name in p['sourceFiles'],'MVP_MIGRATION_SOURCE_PIN')
   ledger.append({'name':file.name,'checksum':p['sourceFiles'][name]})
 e.need(ledger and e.digest(json.dumps(ledger,sort_keys=True,separators=(',',':')).encode())==schema['expectedLedgerSha256'],'MVP_APPLICATION_LEDGER')
 for ref in content['packRefs']:
  e.need(p['sourceFiles'].get(ref['path'])==ref['rawSha256'],'MVP_APP_PACK_PIN')
 load('mvp-chain').identity(p['identity'])
 e.need(p['identity']['contentManifestSha256']==a['mvp']['contentManifestSha256'],'MVP_CONTENT_MANIFEST_IDENTITY')
 e.need(a['business']['testDataScopeSha256']==a['mvp']['stageInputs']['nonmodelFixturesSha256'],'MVP_WRITER_FIXTURE_SCOPE')
 e.need(p['productionCorrelation']=='cn-mvp-'+p['identity']['releaseId']+'-production','MVP_CORRELATION')
 e.need(schema['identity']==p['identity'] and 'productionRunId'not in schema and content['sourceRevision']==a['identity']['sourceRevision'],'MVP_REQUEST_IDENTITY')
 fixtures=e.decode(x['nonmodelFixtures']);e.need(fixtures['deploymentMarker']==p['deploymentMarker'],'MVP_MARKER')
 return x,p,env

def prefix(a,release):return OUTPUTS/release/'mvp-stages'

def production_run(a,release,p):
 name='scripts/cn-release-mvp-trusted-collector.py'
 e.need(e.digest(e.read(ROOT/name,1048576))==a['codeFiles'][name],'MVP_PROVIDER_CODE_PIN')
 context=load('mvp-trusted-collector').ensure_production_context(a,release,p)
 run=context['productionRunId'];e.need(type(run)is int and run>0,'MVP_AUTHENTICATED_RUN')
 return run

def public(a,release,p,readonly=False):
 # Same live root receipt/provenance/runtime/writer checks as the legacy lane,
 # without its Chromium/model fixtures preflight.
 state=load('business-state')
 live,envelope=state.read_public(a,release,{'profile':p,'plan':{'deploymentMarker':p['deploymentMarker']}},read_only=readonly)
 e.need(live['boundary']['writesHeld'] is False and live['runtimeHealthy'] is True,'MVP_PUBLIC_BOUNDARY')
 return live

def held(a,p):
 root=Path(a['runtimeStage']['remoteRoot'])
 e.need(root.parent==Path('/var/lib/workspacex-cn/runtime'),'MVP_RUNTIME_ROOT')
 binding=e.decode(e.read(root/'binding.json'))
 for key in ('sourceRevision','controlRevision','attemptId','requestedAt','deadlineAt'):
  e.need(binding[key]==a['identity'][key],'MVP_HELD_RUNTIME_IDENTITY')
 result=subprocess.run([p['pythonPath'],'-I','-S','-B','/usr/local/lib/workspacex-cn/cn_maintenance_hold.py','read',str(root)],
   stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30,env=e.ENV,pass_fds=(9,),check=False)
 e.need(result.returncode==0 and e.decode(result.stdout)==binding['hold'] and binding['hold']['state']=='held','MVP_WRITERS_NOT_HELD')

def after_switch(a,release,previous,mode,*,runner=None):
 if not enabled(a):return None
 import fcntl
 lock=Path('/var/lib/workspacex-cn/runtime/release.lock');e.read(lock)
 fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if fd!=9:os.dup2(fd,9);os.close(fd)
  os.set_inheritable(9,True)
  return held_content(a,release,previous,mode,runner=runner)
 finally:os.close(9)

def held_content(a,release,previous,mode,*,runner=None):
 if not enabled(a):return None
 x,p,env=preflight(a,release);folder=prefix(a,release)
 e.need(previous is not None and e.HEX.fullmatch(previous),'MVP_SWITCH_RECEIPT')
 receipt=folder/'held-content.json'
 if receipt.exists():
  value=e.decode(e.read(receipt));e.need(value['releaseSha256']==release and value['switchReceiptSha256']==previous,'MVP_HOOK_IDENTITY')
  for name,h in value['originals'].items():e.need(e.digest(e.read(folder/name))==h,'MVP_HOOK_ORIGINAL')
  return value
 if mode!='run':return {'status':'NOT_STARTED','stage':'mvp-held-content'}
 e.need(e.now()<e.instant(a['expiresAt']),'RELEASE_DEADLINE')
 held(a,p)
 folder.mkdir(mode=0o700);e.fsync_dir(folder.parent)
 e.create(folder/'intent.json',e.encode({'releaseSha256':release,'switchReceiptSha256':previous,'automaticRetry':False}))
 # Require the original switch entry's retained receipt before any content write.
 switch=e.decode(e.read(e.STATE/a['identity']['attemptId']/'13-switch.receipt.json'))
 e.need(e.digest(e.read(e.STATE/a['identity']['attemptId']/'13-switch.receipt.json'))==previous and switch['stage']=='switch','MVP_ACTUAL_SWITCH')
 run=production_run(a,release,p)
 schema_request={**e.decode(x['schemaRequest']),'productionRunId':run}
 request=folder/'schema-request.json';raw_request=e.encode(schema_request);e.create(request,raw_request);pin=e.digest(raw_request)
 invoke=runner or (lambda argv:subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
   cwd=str(CONTROL),env={**e.ENV,**env},timeout=max(1,min(300,int((e.instant(a['expiresAt'])-e.now()).total_seconds()))),check=False))
 result=invoke(['/usr/bin/node','--import','tsx',str(CONTROL/'apps/api/scripts/platform-schema-readback.ts'),str(request),pin,a['identity']['sourceRevision']])
 e.create(folder/'schema.json',result.stdout);schema=e.decode(result.stdout)
 e.need(result.returncode==0 and schema['requestSha256']==pin and schema['identity']==p['identity'] and schema['productionRunId']==run and schema['schemaReadbackPassed']is True and schema['productionWrites']is False,'MVP_SCHEMA_READBACK')
 e.need(e.instant(a['identity']['requestedAt'])<=e.instant(schema['observedAt'])<=e.instant(a['expiresAt']),'MVP_SCHEMA_OBSERVATION_WINDOW')
 e.need(e.now()<e.instant(a['expiresAt']),'RELEASE_DEADLINE')
 held(a,p)
 content=folder/'content';content.mkdir(mode=0o700);e.fsync_dir(folder)
 backup=load('mvp-trusted-collector').materialize_content_backup(a,release,e.decode(x['contentBackup']))
 e.need(type(backup)is bytes,'MVP_AUTHENTICATED_BACKUP_BYTES')
 value=load('mvp-content-stage').execute(x['contentRequest'],backup,a['identity']['sourceRevision'],str(CONTROL),'/usr/bin/node',content,runner=invoke)
 held(a,p)
 e.need(e.now()<=e.instant(a['expiresAt']),'RELEASE_DEADLINE')
 originals={'schema.json':e.digest(result.stdout),'schema-request.json':pin,'content/request.json':e.digest(x['contentRequest']),'content/backup.json':e.digest(backup)}
 for name in ('preflight','apply','readback'):originals['content/'+name+'.json']=value['originals'][name]
 for name in ('preflight','apply','readback'):
  observed=e.decode(e.read(content/(name+'.json')))['observedAt']
  e.need(e.instant(a['identity']['requestedAt'])<=e.instant(observed)<=e.instant(a['expiresAt']),'MVP_CONTENT_OBSERVATION_WINDOW')
 value={'kind':'cn-mvp-held-content-hook-v1','releaseSha256':release,'switchReceiptSha256':previous,'originals':originals,'schemaReadbackPassed':True,'contentReadbackPassed':True,'fullBusinessAcceptance':False}
 e.create(receipt,e.encode(value));return value

def nonmodel(a,release,mode):
 x,p,_=preflight(a,release);folder=prefix(a,release);receipt=folder/'nonmodel.json'
 run=production_run(a,release,p)
 if mode=='observe':
  e.need(not receipt.exists() and not (folder/'nonmodel-intent.json').exists(),'MVP_NONMODEL_NO_RETRY')
  public(a,release,p)
  e.create(folder/'nonmodel-intent.json',e.encode({'releaseSha256':release,'automaticRetry':False}))
  # Legacy admission invokes docker/helper with fd9 retained under this lock.
  value=load('mvp-nonmodel').execute(p['identity'],e.decode(x['nonmodelFixtures']),e.decode(x['nonmodelCredentials']),
   'https://app.boardx.com.cn',run,lambda identity,origin:public(a,release,p))
  e.create(receipt,e.encode(value))
 else:
  e.need(mode=='readback','MVP_MODE');public(a,release,p,readonly=True)
 raw=e.read(receipt);v=e.decode(raw)
 e.need(v['identity']==p['identity'] and v['productionRunId']==run and v['checks']=={k:'PASSED' for k in ('tenant_protection','login','permissions','fixed_api_behavior')} and v['modelQuality']=='SKIPPED' and v['fullBusinessAcceptance']is False,'MVP_NONMODEL_RECEIPT')
 return raw

if __name__=='__main__':
 try:
  e.need(os.geteuid()==0 and len(sys.argv)==3,'ROOT_FIXED_MVP_ONLY');mode,release=sys.argv[1:]
  raw=e.read(APPROVALS/(release+'.json'));a=load('fixed-driver').validate(release,raw,e.now())
  # Same runtime lock semantics as the legacy public observer.
  import fcntl
  lock=Path('/var/lib/workspacex-cn/runtime/release.lock');e.read(lock)
  fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
  try:
   fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   if fd!=9:os.dup2(fd,9);os.close(fd)
   os.set_inheritable(9,True);sys.stdout.buffer.write(nonmodel(a,release,mode))
  finally:os.close(9)
 except Exception:
  print('{"status":"BLOCKED_OR_UNKNOWN","automaticRetry":false}',file=sys.stderr);sys.exit(1)
