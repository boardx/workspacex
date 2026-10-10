# BEGIN GENERATED RELEASE IDENTITIES
def admitted_release_identity(identity):
    return type(identity) is dict and ((identity.get('sourceRevision') == '9b25bfa65662b96c0826fe67506b562ea46aa6d0' and identity.get('baselineRevision') == 'ba6343199f3c834d6a198f83d0c771614292c82b') or (identity.get('sourceRevision') == '5285bef9a6c91bbb9857ede42779aafa64b98f32' and identity.get('baselineRevision') == 'a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0'))
# END GENERATED RELEASE IDENTITIES
"""Pure trusted-tool profile schema, shared by producer and installer.
Receives exact Git-bound rows; has no filesystem, network or action capability.
"""
import re
VERIFIER_SOURCE='.harness/scripts/vm/cn-maintenance-recovery-evidence-verifier.py'
VERIFIER_TARGET='/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py'
EXECUTOR_SOURCE='.harness/scripts/vm/cn-production-recovery-executor.py'
EXECUTOR_TARGET='/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py'
def _build_profile(tool,rows,runtime=None,extension=None,expected_extension=None,old_projection=False):
 if type(tool) is not str or re.fullmatch('[a-f0-9]{40}',tool) is None:raise ValueError('PROFILE_TOOL_REVISION')
 if type(rows) is not dict or not rows:raise ValueError('PROFILE_FILE_CLOSURE')
 hashes={};targets={}
 for source,row in rows.items():
  if type(source) is not str or type(row) is not dict or type(row.get('newSha256')) is not str or re.fullmatch('[a-f0-9]{64}',row['newSha256']) is None:raise ValueError('PROFILE_FILE_HASH')
  hashes[source]=row['newSha256'];target=row.get('target')
  if target is not None:
   if type(target) is not str or not target.startswith('/usr/local/') or '..' in target.split('/'):raise ValueError('PROFILE_INSTALLED_TARGET')
   if target in targets.values():raise ValueError('PROFILE_DUPLICATE_TARGET')
   targets[source]=target
 value={'toolRevision':tool,'filesSha256':hashes,'installedTargets':targets,'installedFilesSha256':{target:hashes[source] for source,target in targets.items()}}
 if VERIFIER_SOURCE in rows:
  if targets.get(VERIFIER_SOURCE)!=VERIFIER_TARGET:raise ValueError('PROFILE_VERIFIER_TARGET')
  value['maintenanceRecoveryVerifier']={'sourcePath':VERIFIER_SOURCE,'installedPath':VERIFIER_TARGET,'sha256':hashes[VERIFIER_SOURCE]}
 if EXECUTOR_SOURCE in rows:
  if targets.get(EXECUTOR_SOURCE)!=EXECUTOR_TARGET:raise ValueError('PROFILE_EXECUTOR_TARGET')
  value['maintenanceRecoveryExecutor']={'sourcePath':EXECUTOR_SOURCE,'path':EXECUTOR_TARGET,'sha256':hashes[EXECUTOR_SOURCE],'toolRevision':tool}
 controller='.harness/scripts/vm/cn-maintenance-host-controller.cjs'
 if controller in rows:
  target='/usr/local/lib/workspacex-cn/cn-maintenance-host-controller.cjs'
  if targets.get(controller)!=target:raise ValueError('PROFILE_CONTROLLER_TARGET')
  value['maintenanceHostController']={'sourcePath':controller,'path':target,'sha256':hashes[controller],'toolRevision':tool}
 if runtime is not None:
  if type(runtime) is not dict or set(runtime)!={'path','sha256','mode','uid','gid','links','regular','symlink'}:raise ValueError('PROFILE_NODE_RUNTIME_SCHEMA')
  if runtime['path']!='/usr/bin/node' or type(runtime['sha256']) is not str or re.fullmatch('[a-f0-9]{64}',runtime['sha256']) is None or runtime['mode']!='0755' or type(runtime['uid']) is not int or type(runtime['gid']) is not int or type(runtime['links']) is not int or (runtime['uid'],runtime['gid'],runtime['links'])!=(0,0,1) or runtime['regular'] is not True or runtime['symlink'] is not False:raise ValueError('PROFILE_NODE_RUNTIME_TRUST')
  value['maintenanceNodeRuntime']={'path':runtime['path'],'sha256':runtime['sha256']}
 verified=validate_compose_projection(extension,tool) if old_projection else validate_compose_extension(extension,expected_extension,tool)
 if verified is not None:
  if runtime is None or runtime['sha256']!=verified['candidateComposeEmitter']['nodeSha256']:raise ValueError('COMPOSE_EXTENSION_NODE_RUNTIME_BINDING')
  value['composeBaseFilesSha256']=dict(hashes)
  for source,digest in verified['hashes'].items():
   if source in hashes and hashes[source]!=digest:raise ValueError('COMPOSE_EXTENSION_BASE_CONFLICT')
   hashes[source]=digest
  value.update(composeExtensionV1=verified['projection'],originalWriterPlan=verified['originalWriterPlan'],candidateComposeEmitter=verified['candidateComposeEmitter'])
 import json
 if len((json.dumps(value,sort_keys=True)+'\n').encode())>1048576:raise ValueError('COMPOSE_PROFILE_CONSUMER_SIZE_LIMIT')
 return value

# This verifier is deliberately in the existing Git-pinned profile schema. Both
# package producer and installer execute these same bytes, never caller imports.
def _validate_compose_evidence(container,expected,tool,app=None,git_blob=None,projection=False):
 import base64,hashlib,json,posixpath
 def need(ok,code):
  if not ok:raise ValueError('COMPOSE_EXTENSION_'+code)
 def digest(raw):return hashlib.sha256(raw).hexdigest()
 def exact(value,keys):need(type(value) is dict and set(value)==set(keys),'SCHEMA')
 def hexvalue(value,n):return type(value) is str and re.fullmatch('[a-f0-9]{'+str(n)+'}',value) is not None
 def pairs(values):
  result={}
  for key,value in values:need(key not in result,'DUPLICATE_KEY');result[key]=value
  return result
 def decode(raw):return json.loads(raw,object_pairs_hook=pairs)
 def rawvalue(value):
  try:raw=base64.b64decode(value,validate=True)
  except Exception:raise ValueError('COMPOSE_EXTENSION_BASE64')
  need(type(value) is str and base64.b64encode(raw).decode()==value,'BASE64');return raw
 def path(value,protected=False):
  need(type(value) is str and value and '\\' not in value and '\x00' not in value and posixpath.normpath(value)==value and '..' not in value.split('/') and not value.endswith('/'),'PATH')
  need(value.startswith('/etc/workspacex-cn/') if protected else not value.startswith('/'),'PATH');return value
 def ref(value):
  exact(value,('path','sha256'));path(value['path'],True);need(hexvalue(value['sha256'],64),'HASH');return value
 if projection:
  exact(container,('schemaVersion','kind','extensionSha256','evidence'))
  need(type(container['schemaVersion']) is int and container['schemaVersion']==1 and container['kind']=='cn-compose-profile-projection-v1' and hexvalue(container['extensionSha256'],64),'PROJECTION_SCHEMA')
  x=container['evidence'];extension_sha=container['extensionSha256']
 else:
  if container is None:need(expected is None,'UNSOLICITED_PIN');return None
  exact(container,('sha256','rawBase64'));need(hexvalue(expected,64) and container['sha256']==expected,'INDEPENDENT_PIN')
  raw=rawvalue(container['rawBase64']);need(len(raw)<=5000000 and digest(raw)==expected,'RAW_PIN')
  x=decode(raw);need(raw==(json.dumps(x,sort_keys=True)+'\n').encode(),'CANONICAL');extension_sha=expected
 exact(x,('schemaVersion','kind','toolRevision','originalWriterPlan','candidateComposeEmitter','documents','inputs'))
 need(type(x['schemaVersion']) is int and x['schemaVersion']==1 and x['kind']=='cn-compose-profile-extension-v1' and x['toolRevision']==tool and hexvalue(tool,40),'IDENTITY')
 ref(x['originalWriterPlan']);e=x['candidateComposeEmitter']
 exact(e,('schemaVersion','path','sha256','nodePath','nodeSha256','sourceClosureRef','configRef','optionsRef','originalEntryPlanRef','dockerPath','dockerSha256','dockerSocket'))
 need(type(e['schemaVersion']) is int and e['schemaVersion']==2,'EMITTER_SCHEMA');path(e['path'],True)
 need(e['nodePath']=='/usr/bin/node' and e['dockerPath']=='/usr/bin/docker' and e['dockerSocket']=='/var/run/docker.sock' and all(hexvalue(e[k],64) for k in ('sha256','nodeSha256','dockerSha256')),'EXECUTABLE_REFS')
 for key in ('sourceClosureRef','configRef','optionsRef','originalEntryPlanRef'):ref(e[key])
 docs=x['documents'];exact(docs,('closure','writerPlan','entryPlan','manifest','config','options','emitter'));values={};document_raw={}
 for name,item in docs.items():
  exact(item,('path','sha256') if projection and name=='emitter' else ('path','sha256','rawBase64'))
  ref({k:item[k] for k in ('path','sha256')})
  if projection and name=='emitter':continue
  data=rawvalue(item['rawBase64']);need(digest(data)==item['sha256'],'DOCUMENT_HASH');document_raw[name]=data
  if name!='emitter':values[name]=decode(data)
 need(len({v['path'] for v in docs.values()})==len(docs),'DOCUMENT_PATH_COLLISION')
 def same(name,r):need({k:docs[name][k] for k in ('path','sha256')}==r,'DOCUMENT_REF')
 same('writerPlan',x['originalWriterPlan']);same('emitter',{'path':e['path'],'sha256':e['sha256']})
 for name,key in [('closure','sourceClosureRef'),('config','configRef'),('options','optionsRef'),('entryPlan','originalEntryPlanRef')]:same(name,e[key])
 p=values['writerPlan'];identity=p.get('identity');exact(identity,('attemptId','baselineRevision','migrationPlanSha256','sourceRevision'))
 need(type(identity['attemptId']) is str and re.fullmatch('[A-Za-z0-9-]{1,128}',identity['attemptId']) is not None and hexvalue(identity['migrationPlanSha256'],64),'RELEASE_IDENTITY')
 need(admitted_release_identity(identity) and (app is None or identity['sourceRevision']==app),'RELEASE_IDENTITY')
 need(p.get('schemaVersion')==1 and p.get('mode')=='maintenance-all-writer-fence' and p.get('productionActionsAuthorized') is True and p.get('runtimeSessionBootstrapAuthorized') is True and p.get('toolRevision')==tool and not any(k in p for k in ('runtimeSourcePlanSha256','runtimePlan','controlSessions','diagnosticSessions')),'ORIGINAL_PLAN')
 entry=values['entryPlan'];host=entry.get('host',{})
 need(entry.get('schemaVersion')==1 and entry.get('productionActionsAuthorized') is True and entry.get('identity')==identity==host.get('identity') and host.get('writerPlanPath')==x['originalWriterPlan']['path'] and host.get('writerPlanSha256')==x['originalWriterPlan']['sha256'] and entry.get('production',{}).get('toolRevision')==tool,'ENTRY_PLAN')
 c=values['closure'];exact(c,('schemaVersion','sourceRevision','identity','toolRevision','originalPlanSha256','emitterSourceRevision','release','compiler','sources','dependencies','lockfileSha256','bundleSha256','bundledInputs'))
 need(type(c['schemaVersion']) is int and c['schemaVersion']==2 and c['identity']==identity and c['sourceRevision']==identity['sourceRevision'] and c['toolRevision']==tool==c['emitterSourceRevision'] and c['originalPlanSha256']==x['originalWriterPlan']['sha256'] and c['bundleSha256']==e['sha256'],'CLOSURE_IDENTITY')
 need(c['compiler']=={'name':'esbuild','version':'0.24.2'},'COMPILER')
 need(type(c['sources']) is dict and c['sources'] and type(c['dependencies']) is dict and c['dependencies'],'CLOSURE_INPUTS')
 native={'packages/cloud-deploy/src/'+name for name in ('compose.ts','config.ts','storage-config.ts','release.ts','image-reference.ts','runtime-bundle.ts')}
 required=native|{'packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority.ts','packages/cloud-deploy/src/cn-candidate-compose-source.ts','packages/cloud-deploy/src/cn-candidate-compose-source-cli.ts','.harness/scripts/vm/build-cn-candidate-compose-source.mjs'}
 need(required<=set(c['sources']) and not set(c['sources'])&set(c['dependencies']),'SOURCE_CLOSURE')
 inputs=x['inputs'];need(type(inputs) is dict and set(inputs)==set(c['sources'])|set(c['dependencies'])|{'pnpm-lock.yaml'},'INPUT_SET')
 need(type(c['bundledInputs']) is list and all(type(s) is str for s in c['bundledInputs']) and c['bundledInputs']==sorted(set(c['bundledInputs'])) and set(c['bundledInputs'])<=set(c['sources'])|set(c['dependencies']),'BUNDLE_INPUTS')
 hashes={}
 for source,item in inputs.items():
  path(source);exact(item,('sha256',) if projection else ('sha256','rawBase64'))
  need(hexvalue(item['sha256'],64),'INPUT_HASH');hashes[source]=item['sha256']
  data=None if projection else rawvalue(item['rawBase64'])
  if not projection:need(digest(data)==item['sha256'],'INPUT_HASH')
  if source in c['sources']:
   record=c['sources'][source];exact(record,('gitBlob','sha256'))
   need(not source.startswith('node_modules/') and record['sha256']==item['sha256'] and hexvalue(record['gitBlob'],40),'SOURCE_BLOB')
   if git_blob is not None:
    actual=git_blob(tool,source)
    need(digest(actual)==item['sha256'] and (projection or actual==data),'TOOL_GIT_SOURCE');data=actual
    if source in native:need(git_blob(identity['sourceRevision'],source)==data,'APP_GIT_SOURCE')
   if data is not None:need(record['gitBlob']==hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),'SOURCE_BLOB')
  elif source in c['dependencies']:need(source.startswith('node_modules/') and c['dependencies'][source]==item['sha256'],'DEPENDENCY_HASH')
  else:
   need(c['lockfileSha256']==item['sha256'],'LOCKFILE')
   if git_blob is not None:need(digest(git_blob(tool,source))==item['sha256'],'TOOL_GIT_LOCKFILE')
 options=values['options'];exact(options,('projectName','runtimeDirectory','runtimeFiles','manifestRef','composeRef','networkRef'))
 for key in ('manifestRef','composeRef','networkRef'):ref(options[key])
 same('manifest',options['manifestRef']);path(options['runtimeDirectory'],True)
 need(type(options['projectName']) is str and re.fullmatch('[a-z0-9][a-z0-9_-]*',options['projectName']) is not None and type(options['runtimeFiles']) is dict,'OPTIONS')
 for name,r in options['runtimeFiles'].items():ref(r);need(name==r['path'] and name.startswith(options['runtimeDirectory']+'/'),'RUNTIME_REF')
 m=values['manifest'];exact(m,('schemaVersion','release','sourceRevision','platform','images'))
 need(type(m['schemaVersion']) is int and m['schemaVersion']==1 and m['sourceRevision']==identity['sourceRevision'] and m['platform']=='linux/amd64' and m['release']==c['release']==values['config'].get('provision',{}).get('release') and type(m['release']) is str and re.fullmatch(r'v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?',m['release']) is not None,'MANIFEST_IDENTITY')
 exact(m['images'],('web','api','agent','sandbox','postgres','redis'))
 for item in m['images'].values():
  exact(item,('image',));need(type(item['image']) is str and len(item['image'])<=512 and re.fullmatch(r'[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}',item['image']) is not None and '..' not in item['image'],'IMAGE_DIGEST')
 import copy
 evidence=copy.deepcopy(x)
 for item in evidence['inputs'].values():item.pop('rawBase64',None)
 evidence['documents']['emitter'].pop('rawBase64',None)
 compact={'schemaVersion':1,'kind':'cn-compose-profile-projection-v1','extensionSha256':extension_sha,'evidence':evidence}
 if projection:need(compact==container,'PROJECTION_CANONICAL')
 return {'projection':compact,'hashes':hashes,'documents':docs,'sourceRevision':identity['sourceRevision'],'originalWriterPlan':x['originalWriterPlan'],'candidateComposeEmitter':e}

def validate_compose_extension(container,expected,tool,app=None,git_blob=None):
 """New admission: full bytes plus independently supplied root approval hash."""
 return _validate_compose_evidence(container,expected,tool,app,git_blob)

def validate_compose_projection(projection,tool,app=None,git_blob=None):
 """Old state only: caller must authenticate protected inventory/provider bytes.
 Dependency pins retain prior installed approval; this is not a fresh build proof.
 This distinct schema is NEVER accepted by validate_compose_extension.
 """
 return _validate_compose_evidence(projection,None,tool,app,git_blob,True)

def build_profile(tool,rows,runtime=None,extension=None,expected_extension=None):
 return _build_profile(tool,rows,runtime,extension,expected_extension)

def rebuild_profile(tool,rows,runtime,projection):
 return _build_profile(tool,rows,runtime,projection,None,True)
