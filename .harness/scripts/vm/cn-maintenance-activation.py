#!/usr/bin/env python3
"""Maintenance-only activation operations. No ordinary deploy, lock reacquisition,
container-only recovery, implicit pulls, or fabricated browser/canonical success.
"""
import hashlib,json,os,pathlib,re,stat,subprocess,sys,time
ROOT=pathlib.Path('/usr/local/lib/workspacex-cn')
FIXED='/etc/workspacex-cn/deployment.json'
NGINX='/etc/nginx/conf.d/workspacex-cn.conf'
SERVICES={'api','web','agent','sandbox','sandbox-sessions'}
def require(ok,code):
 if not ok:raise RuntimeError(code)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def private(path,expected=None):
 p=pathlib.Path(path);require(p.is_absolute() and '..' not in p.parts,'PRIVATE_PATH')
 for parent in p.parents:
  s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and s.st_gid==0 and not s.st_mode&0o022,'PRIVATE_PARENT')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());require(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=1024*1024,'PRIVATE_FILE')
  raw=f.read(1024*1024+1);after=os.fstat(f.fileno());require((s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(after.st_size,after.st_mtime_ns,after.st_ctime_ns),'INPUT_CHANGED')
 require(expected is None or digest(raw)==expected,'INPUT_HASH');return raw
def replace(path,expected,raw):
 """CAS under inherited canonical lock; retain candidate on unknown outcomes."""
 require(digest(private(path))==expected,'POINTER_CAS')
 p=pathlib.Path(path);tmp=p.with_name('.maintenance-'+os.urandom(16).hex())
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
 require(digest(private(path))==expected,'POINTER_CAS')
 os.replace(tmp,p);fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def invoke(plan,binary,args,input_raw=None):
 """Pin trusted host binary descriptor; never shell or ambient executable lookup."""
 value=plan['binaries'][binary];path={'docker':'/usr/bin/docker','nginx':'/usr/sbin/nginx','systemctl':'/usr/bin/systemctl','node':'/usr/bin/node'}[binary]
 require(value['path']==path and re.fullmatch('[a-f0-9]{64}',value['sha256']),'BINARY_BINDING')
 p=pathlib.Path(path)
 for parent in p.parents:
  s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'BINARY_PARENT')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd);require(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o755,'BINARY_TRUST')
  h=hashlib.sha256()
  while True:
   b=os.read(fd,1024*1024)
   if not b:break
   h.update(b)
  require(h.hexdigest()==value['sha256'],'BINARY_HASH')
  r=subprocess.run(['/proc/self/fd/'+str(fd),*args],input=input_raw,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,pass_fds=(9,fd),env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},timeout=120)
  require(r.returncode==0 and len(r.stdout)<=1024*1024,'FIXED_COMMAND_FAILED');return r.stdout
 finally:os.close(fd)
def baseline(plan):
 baseline_raw=private(plan['baseline']['path'],plan['baseline']['sha256']);b=json.loads(baseline_raw)
 require(set(b)=={'schemaVersion','composeFile','images','nginxSha256'} and b['schemaVersion']==1 and set(b['images'])=={'api','web','agent','sandbox'},'BASELINE_SCHEMA')
 current={}
 for service in b['images']:
  value=json.loads(invoke(plan,'docker',['inspect','workspacex-cn-'+service+'-1']))
  require(len(value)==1 and value[0]['State']['Running'],'BASELINE_RUNNING')
  current[service]=value[0]['Image']
 require(current==b['images'],'BASELINE_IMAGE_DRIFT')
 require(digest(private(NGINX))==b['nginxSha256'],'BASELINE_NGINX_DRIFT')
 nginx_raw=private(NGINX);h=hashlib.sha256()
 for raw in (baseline_raw,nginx_raw):h.update((str(len(raw))+':'+digest(raw)+'\n').encode())
 return h.hexdigest()
def verify_compose(plan,key):
 item=plan[key];raw=private(item['path'],item['sha256']);compose=json.loads(raw)
 services=compose['services'];require(set(services)==SERVICES,'CONTROLLED_SERVICE_SCOPE')
 for name,value in services.items():
  require(value.get('image')==item['images'][name] and re.fullmatch(r'[-A-Za-z0-9._/:]+@sha256:[a-f0-9]{64}',value['image']) and 'build' not in value,'COMPOSE_IMMUTABLE_IMAGE')
  found=json.loads(invoke(plan,'docker',['image','inspect',value['image']]))
  require(len(found)==1 and found[0]['Os']=='linux' and found[0]['Architecture']=='amd64','LOCAL_IMAGE_IDENTITY')
 return item['path']
def installed_code(name):
 profile=json.loads(private('/etc/workspacex-cn/trusted-tool-binding.json'))
 p=ROOT/name;fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  st=os.fstat(f.fileno());require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_gid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o700 and st.st_size<=1024*1024,'INSTALLED_MODULE_TRUST');raw=f.read(1024*1024+1)
 require(digest(raw)==profile['filesSha256']['.harness/scripts/vm/'+name],'INSTALLED_MODULE_HASH');return raw

def actual_api(plan,side):
 item=plan['baselineCompose' if side=='baseline' else 'compose'];verify_compose(plan,'baselineCompose' if side=='baseline' else 'compose')
 expected=json.loads(invoke(plan,'docker',['image','inspect',item['images']['api']]))[0]['Id']
 actual=json.loads(invoke(plan,'docker',['inspect','workspacex-cn-api-1']))
 require(len(actual)==1 and actual[0]['Image']==expected and actual[0]['State']['Running'] and not actual[0]['State']['Paused'],'ACTUAL_API_IMAGE_RUNNING')
 return actual[0]

def live_drain(plan):
 # Held drain is consumed through the sealed diagnostic session in the parent
 # writer server. Never unpause API or establish a container/new DB connection.
 raise RuntimeError('SEALED_DIAGNOSTIC_DRAIN_REQUIRED')

def api_job(plan,script):
 require(script in ('scripts/data-readiness.ts','scripts/cloud-service-readiness.ts'),'FIXED_CANONICAL_SCRIPT')
 # Existing sealed API code and existing probe env; no migration/bootstrap job.
 actual_api(plan,'candidate');ref=plan['probeEnvironment'];private(ref['path'],ref['sha256'])
 image=plan['compose']['images']['api'];runtime=f"/var/lib/workspacex-cn/runtime/{plan['identity']['sourceRevision']}"
 args=['run','--rm','--pull=never','--network','workspacex-cn-runtime','--env-file',ref['path'],'--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=256','--memory=2g','--cpus=2','--mount',f'type=bind,src={runtime}/certs,dst=/run/certs,readonly','--mount',f'type=bind,src={runtime}/agent-certs,dst=/run/agent-certs,readonly','--mount',f'type=bind,src={runtime}/sandbox,dst=/run/sandbox','--mount',f'type=bind,src={runtime}/sessions,dst=/run/sessions','--entrypoint','node',image,'--import','tsx',script]
 return json.loads(invoke(plan,'docker',args))

def canonical_checks(plan):
 # Eight maintenance acceptance proofs, not a re-execution of provision stages.
 compose=verify_compose(plan,'compose');actual_api(plan,'candidate')
 require(digest(private(FIXED))==plan['candidateConfig']['sha256'],'CONFIG_ACCEPTANCE')
 require(digest(private(NGINX))==plan['candidateNginx']['sha256'],'NGINX_ACCEPTANCE')
 for service in SERVICES:
  found=json.loads(invoke(plan,'docker',['inspect','workspacex-cn-'+service+'-1']));expected=json.loads(invoke(plan,'docker',['image','inspect',plan['compose']['images'][service]]))[0]['Id']
  require(len(found)==1 and found[0]['Image']==expected and found[0]['State']['Running'] and not found[0]['State']['Paused'] and found[0]['Config']['Labels'].get('org.opencontainers.image.revision')==plan['identity']['sourceRevision'],'RUNNING_RELEASE_IDENTITY')
 data=api_job(plan,'scripts/data-readiness.ts');require(data.get('ok') is True and data.get('database') is True and data.get('migrations') is True and data.get('redis') is True,'LIVE_DATA_READINESS')
 services=api_job(plan,'scripts/cloud-service-readiness.ts');require(services.get('ok') is True and all(services.get(k) is True for k in ('web','api','agentGraphs')),'LIVE_SERVICE_READINESS')
 request=json.loads(private(plan['browserPlan']['path'],plan['browserPlan']['sha256']))
 code=installed_code('cn-maintenance-canonical.cjs').decode()+"\nlet raw='';process.stdin.on('data',b=>{raw+=b;if(Buffer.byteLength(raw)>1048576)process.exit(1)});process.stdin.on('end',()=>module.exports.publicReadiness(JSON.parse(raw)).then(v=>process.stdout.write(JSON.stringify(v))).catch(()=>process.exit(1)));"
 public=json.loads(invoke(plan,'node',['-e',code],json.dumps({'publicUrl':request['publicUrl'],'deploymentMarker':request['deploymentMarker']}).encode()))
 require(public.get('publicReadOnlyVerified') is True,'ACTUAL_PUBLIC_READINESS')
 return {'status':'passed','lockRetained':True,'passedStages':8}
def browser_acceptance(plan):
 profile=json.loads(private('/etc/workspacex-cn/trusted-tool-binding.json'))
 runtime=profile.get('maintenanceBrowserRuntime');require(type(runtime) is dict and set(runtime)=={'playwrightRoot','filesSha256','chromiumPath','chromiumSha256','nodeSha256'},'TRUSTED_BROWSER_RUNTIME_CLOSURE_MISSING')
 require(plan['binaries']['node']['sha256']==runtime['nodeSha256'],'NODE_PROFILE_BINDING')
 ref=plan['browserPlan'];raw=private(ref['path'],ref['sha256']);request=json.loads(raw)
 require(request['playwrightModule']==runtime['playwrightRoot'] and request['browserExecutable']==runtime['chromiumPath'],'BROWSER_PROFILE_BINDING')
 private(request['audioPath'],request['audioSha256'])
 require(request['audioPath'].startswith(str(pathlib.Path(ref['path']).parent)+'/') and '..' not in pathlib.Path(request['audioPath']).parts,'AUDIO_ATTEMPT_SCOPE')
 root=pathlib.Path(runtime['playwrightRoot']);require(str(root).startswith('/opt/workspacex-cn/release-tools/'+profile['toolRevision']+'/'),'PLAYWRIGHT_TOOL_SCOPE')
 # Exact installed dependency closure, never ambient npm/system NODE_PATH.
 actual={}
 for p in root.rglob('*'):
  st=p.lstat();require(not p.is_symlink() and st.st_uid==0 and st.st_gid==0 and not st.st_mode&0o022,'PLAYWRIGHT_NODE_CLOSURE_TRUST')
  if p.is_file():actual[str(p.relative_to(root))]=digest(p.read_bytes())
 require(actual and actual==runtime['filesSha256'],'PLAYWRIGHT_NODE_CLOSURE_HASH')
 chrome=pathlib.Path(runtime['chromiumPath']);require(str(chrome) in ('/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'),'CHROMIUM_PATH')
 st=chrome.lstat();require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022 and digest(chrome.read_bytes())==runtime['chromiumSha256'],'CHROMIUM_PROFILE')
 # Input metadata/credentials remain stdin. Helper is loaded from exact verified bytes.
 code=installed_code('cn-maintenance-browser.cjs').decode()+"\nlet raw='';process.stdin.on('data',b=>{raw+=b;if(Buffer.byteLength(raw)>1048576)process.exit(1)});process.stdin.on('end',()=>{const p=JSON.parse(raw);module.exports.run(p,require(p.playwrightModule).chromium).then(v=>process.stdout.write(JSON.stringify(v))).catch(()=>process.exit(1));});"
 result=json.loads(invoke(plan,'node',['-e',code],raw));require(set(result)=={'login','hello','asr','githubFeedbackRead','skillTool','pdfDownload'} and all(v is True for v in result.values()),'ACTUAL_BROWSER_ACCEPTANCE');return result
def operations(plan,action):
 if action=='read-baseline-fingerprint':return {'baselineSha256':baseline(plan)}
 if action=='read-run-drain':return live_drain(plan)
 if action=='promote-prepared-pointer':
  private(plan['compose']['path'],plan['compose']['sha256']);verify_compose(plan,'compose')
  value=private(plan['candidateConfig']['path'],plan['candidateConfig']['sha256']);replace(FIXED,plan['baselineConfig']['sha256'],value)
  return {'pointerPromoted':True}
 if action=='activate-traffic':
  require(digest(private(FIXED))==plan['candidateConfig']['sha256'],'PROMOTED_POINTER_REQUIRED')
  compose=verify_compose(plan,'compose')
  invoke(plan,'docker',['compose','-p','workspacex-cn','-f',compose,'up','-d','--no-build','--pull','never',*sorted(SERVICES)])
  value=private(plan['candidateNginx']['path'],plan['candidateNginx']['sha256']);replace(NGINX,plan['baselineNginx']['sha256'],value)
  invoke(plan,'nginx',['-t']);invoke(plan,'systemctl',['reload','nginx']);return {'trafficActivated':True}
 if action=='verify-canonical':return canonical_checks(plan)
 if action=='browser-acceptance':return browser_acceptance(plan)
 if action=='verify-recovery-plan':
  private(plan['recoveryPlan']['path'],plan['recoveryPlan']['sha256']);return {'recoveryPlanSha256':plan['recoveryPlan']['sha256']}
 if action=='restore-baseline-runtime':
  # Independent protected result readback prevents container-only fallback.
  result_raw=private(plan['recoveryResult']['path']);result=json.loads(result_raw)
  require(result['identity']==plan['identity'] and result['productionInstanceId']=='pgm-uf6rg214cp381l49' and result['writesHeld'] is True and set(result['databases'])=={'workspacex','workspacex_agent','workspacex_memory'},'THREE_DB_RECOVERY_REQUIRED')
  for db,fact in result['databases'].items():require(result.get('kind')=='retained-session-production-recovery' and fact['database']==db and fact['targetRdsInstanceId']=='pgm-uf6rg214cp381l49' and fact['existingSession'] is True and fact['precommitFidelityVerified'] is True and fact['restoreCommitted'] is True and fact['decoderJoined'] is True and fact['dataFidelityVerified'] is True,'ACTUAL_DB_FIDELITY_REQUIRED')
  # Data recovery is not permission to restart a writer. This legacy operation
  # must remain closed until the separately approved runtime/resume ordering is
  # implemented; its compose up cannot run under the all-writer held barrier.
  raise RuntimeError('BASELINE_WRITER_RESUME_APPROVAL_REQUIRED')
 if action=='restore-baseline-pointer':
  replace(FIXED,plan['candidateConfig']['sha256'],private(plan['baselineConfig']['path'],plan['baselineConfig']['sha256']));return {'baselinePointerRestored':True}
 raise RuntimeError('UNKNOWN_ACTIVATION_ACTION')
def validate_plan(plan,identity):
 expected={'schemaVersion','identity','toolRevision','baseline','compose','baselineCompose','candidateConfig','baselineConfig','candidateNginx','baselineNginx','recoveryPlan','recoveryResult','binaries','probeEnvironment','browserPlan'}
 require(type(plan) is dict and set(plan)==expected and plan['schemaVersion']==1,'ACTIVATION_PLAN_SCHEMA')
 app=identity['sourceRevision'];base=identity['baselineRevision'];attempt=identity['attemptId']
 paths={'baseline':f'/var/lib/workspacex-cn/runtime/{app}/baseline.json','compose':f'/var/lib/workspacex-cn/runtime/{app}/compose.json','baselineCompose':f'/var/lib/workspacex-cn/runtime/{base}/compose.json','candidateConfig':f'/etc/workspacex-cn/candidate-configs/{app}/{attempt}/deployment.json','baselineConfig':f'/etc/workspacex-cn/candidate-configs/{app}/{attempt}/baseline.json','candidateNginx':f'/var/lib/workspacex-cn/runtime/{app}/nginx.conf','baselineNginx':f'/var/lib/workspacex-cn/runtime/{app}/baseline-nginx.conf','recoveryPlan':f'/etc/workspacex-cn/maintenance-recovery/{app}/{attempt}/recovery-plan.json','recoveryResult':f'/etc/workspacex-cn/maintenance-recovery/{app}/{attempt}/production-recovery-result.json','probeEnvironment':f'/etc/workspacex-cn/maintenance-activation/{app}/{attempt}/probe.env','browserPlan':f'/etc/workspacex-cn/maintenance-activation/{app}/{attempt}/browser-plan.json'}
 for name,path in paths.items():
  ref=plan[name];fields={'path'} if name=='recoveryResult' else {'path','sha256','images'} if name in ('compose','baselineCompose') else {'path','sha256'}
  require(type(ref) is dict and set(ref)==fields and ref['path']==path,'ACTIVATION_PLAN_REFERENCE')
  if name!='recoveryResult':require(type(ref['sha256']) is str and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'ACTIVATION_PLAN_HASH')
  if name in ('compose','baselineCompose'):require(type(ref['images']) is dict and set(ref['images'])==SERVICES,'COMPOSE_IMAGE_SCOPE')
 require(type(plan['binaries']) is dict and set(plan['binaries'])=={'docker','nginx','systemctl','node'},'BINARY_SCOPE')
def main(args):
 require(os.geteuid()==0 and os.getegid()==0 and sys.platform=='linux','ROOT_LINUX_REQUIRED')
 require(len(args)==4 and args[0]=='--maintenance-activation-operation','USAGE')
 # Import only after rootprivate exact tool closure independently validates bytes.
 profile=json.loads(private('/etc/workspacex-cn/trusted-tool-binding.json'))
 for name in ('cn-maintenance-activation.py','cn_maintenance_hold.py'):
  p=ROOT/name;s=p.lstat();require(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o700,'INSTALLED_SOURCE_TRUST')
  require(digest(p.read_bytes())==profile['filesSha256']['.harness/scripts/vm/'+name],'INSTALLED_SOURCE_BINDING')
 sys.path.insert(0,str(ROOT));from cn_maintenance_hold import require_canonical_lock,HoldStore,CANONICAL_DIRECTORY
 require_canonical_lock();held=HoldStore(CANONICAL_DIRECTORY).read();require(held is not None and held['state']=='held','HELD_REQUIRED')
 plan=json.loads(private(args[1],args[2]));identity=held['identity'];validate_plan(plan,identity);require(plan['identity']==identity and plan['toolRevision']==profile['toolRevision'],'ACTIVATION_IDENTITY')
 require(args[1]==f"/etc/workspacex-cn/maintenance-activation/{identity['sourceRevision']}/{identity['attemptId']}/activation-plan.json",'FIXED_PLAN_PATH')
 # The existing all-writer NOLOGIN barrier and acceptance writes conflict.
 # A supplied boolean cannot authorize a new scoped writer role or early resume.
 # Pre-promotion reject until a human-approved lane has a real implementation.
 if args[3] not in ('read-baseline-fingerprint','read-run-drain','verify-canonical','verify-recovery-plan','restore-baseline-runtime','restore-baseline-pointer'):
  raise RuntimeError('MAINTENANCE_ACCEPTANCE_WRITER_LANE_NOT_IMPLEMENTED')
 result=operations(plan,args[3]);require_canonical_lock();require(HoldStore(CANONICAL_DIRECTORY).read()==held,'HOLD_CHANGED')
 return {'schemaVersion':1,'kind':'maintenance-activation-operation','identity':identity,'toolRevision':profile['toolRevision'],'planSha256':args[2],'action':args[3],'writesHeld':True,'result':result}
if __name__=='__main__':
 try:print(json.dumps(main(sys.argv[1:]),sort_keys=True))
 except BaseException:print('CN_MAINTENANCE_ACTIVATION_REJECTED',file=sys.stderr);sys.exit(1)
