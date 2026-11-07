#!/usr/bin/env python3
"""One fixed CN maintenance attempt; never installed in runner sudoers.

Schema and reviewed CN initialization have independent database transactions and
component receipts. The manual initialization option is an explicit operator
choice; ordinary image deployment has no implicit seed mode. Restore rehearsal
was waived by the operator and is not reported as tested.
"""
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import stat
import subprocess
import sys
import time

SOURCE='9eaedc66c6f9d83220ba702ecc62205a0bdaaa4b'
BASELINE='f0eb9d07398a66fdd5646a9e6b855fa1b940e571'
PLAN_SHA='0f839db64112c279cead6a9e203c04c240155be6e3737ed0a7cb4c3730fd2477'
RUNTIME=Path('/var/lib/workspacex-cn/runtime/a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0-newdb-20261006')
ATTEMPT=Path('/var/lib/workspacex-cn/runtime/cn-schema-5917-40097204900-r3')
FILES=[RUNTIME/'compose.json',RUNTIME.parent/'maintenance-compose-5285-20261011-v1/candidate-images.json',RUNTIME.parent/'upgrade-f0eb-20261013-2134/switch-images.json']
NGINX=Path('/etc/nginx/conf.d/workspacex-app.conf')
SERVICES=['api','web','agent','sandbox']
OLD_IMAGES={
 'api':'sha256:704062fdac846f4fdff20d23cbe30a58aa8761277074d32c98452f5f82efb562',
 'web':'sha256:db213bd0e73bb8fd6d41d2be14ecab23a427f4fbd216920cfc097cd784729bcc',
 'agent':'sha256:317edd68d8eb6c7842186fbfeb096423231f48d78db9ee30fc01d7f28dbfcef9',
 'sandbox':'sha256:ec72e210bf33e64c28af4c4a5dcb54cb1dc2e07a53d229ce9f24a9a69bcb56e9',
}
class Rejected(Exception):pass
def need(v,code):
 if not v:raise Rejected(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def private(p):
 p=Path(p);s=p.lstat();need(stat.S_ISREG(s.st_mode) and not p.is_symlink() and s.st_uid==0 and not s.st_mode&0o077,'PRIVATE_FILE');return p

def save(p,v):
 b=json.dumps(v,ensure_ascii=False,separators=(',',':')).encode();tmp=p.with_name(p.name+'.tmp-'+secrets.token_hex(5));fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 os.replace(tmp,p);fd=os.open(p.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)

def run(args,timeout=60,input=None):
 r=subprocess.run(args,input=input,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout)
 need(r.returncode==0,'COMMAND_FAILED');return r.stdout

def docker(*args,**kw):return run(['/usr/bin/docker',*args],**kw)
def djson(*args,**kw):return json.loads(docker(*args,**kw))
def config_env(p):return dict(l.split('=',1) for l in private(p).read_text().splitlines() if l and not l.startswith('#') and '=' in l)
def compose(files):
 args=['compose','--project-name','workspacex-cn','--project-directory',str(RUNTIME),'--env-file',str(RUNTIME/'bootstrap.env')]
 for p in files:args+=['--file',str(p)]
 return args

def live(running=True,images=None):
 rows=djson('inspect',*['workspacex-cn-'+s+'-1' for s in SERVICES]);need(len(rows)==4 and len({r['Id'] for r in rows})==4,'RUNTIME_SET')
 result={}
 for x in rows:
  labels=x['Config']['Labels'];s=labels.get('com.docker.compose.service');need(s in SERVICES and s not in result and labels.get('com.docker.compose.project')=='workspacex-cn','RUNTIME_BINDING')
  need(x['State']['Running']==running and not x['State'].get('Restarting'),'RUNTIME_STATE')
  if images:need(x['Image']==images[s],'RUNTIME_IMAGE')
  result[s]=x
 return result

def signature(x):
 c=x['Config'];h=x['HostConfig']
 intrinsic={'PATH','NODE_VERSION','YARN_VERSION','PYTHON_VERSION','PYTHON_SHA256','LANG','GPG_KEY'}
 return {'environment':sorted(e for e in c['Env'] if e.split('=',1)[0] not in intrinsic),'cmd':c['Cmd'],'entrypoint':c['Entrypoint'],'workingDir':c['WorkingDir'],'user':c['User'],
 'mounts':sorted((m['Source'],m['Destination'],m['RW']) for m in x['Mounts']),
 'host':{k:h[k] for k in ['Binds','PortBindings','NetworkMode','RestartPolicy','ReadonlyRootfs','CapAdd','CapDrop','SecurityOpt','Privileged']},
 'networks':sorted(x['NetworkSettings']['Networks'])}

def image(plan,role):
 ref=plan['manifest']['images'][role]['image'];need('@sha256:' in ref and ref.startswith('workspacex-cn-prod-registry.cn-shanghai.cr.aliyuncs.com/workspacex-prod/'),'REGISTRY_BINDING')
 v=djson('image','inspect',ref)[0];need(ref in v.get('RepoDigests',[]) and v['Config']['Labels'].get('org.opencontainers.image.revision')==SOURCE and v['Os']=='linux' and v['Architecture']=='amd64','IMAGE_BINDING');return v['Id']

def probe_db(plan,driver,mode):
 name='wsx-cn-5917-db-'+mode
 args=['run','--rm','--pull=never','--name',name,'--label','wsx.cn.owned=5917','--network','workspacex-cn-runtime','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--pids-limit=128','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m','--env-file',str(RUNTIME/'migration.env'),'--entrypoint','node','-i',image(plan,'api'),'--import','tsx','--input-type=module','-e',driver]
 raw=json.dumps({'plan':plan,'planChecksum':PLAN_SHA,'mode':mode},ensure_ascii=False).encode()
 r=subprocess.run(['/usr/bin/docker',*args],input=raw,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=240)
 try:v=json.loads(r.stdout)
 except Exception:raise Rejected('DB_RESULT_UNKNOWN')
 save(ATTEMPT/('database-'+mode+'.json'),v);print('CN_DATABASE',json.dumps(v),flush=True)
 need(r.returncode==0 and v.get('status') in ['BASELINE','COMPLETE','SCHEMA_COMPLETE_DATA_DEFERRED','SCHEMA_COMMITTED_DATA_DEFERRED','MANUAL_CN_INITIALIZATION_COMMITTED'],'DB_PHASE_FAILED_OR_UNKNOWN');return v

def browser(loopback=False,candidate=False):
 src=private('/root/wsx-cn-baseline-browser-diag.mjs').read_bytes();need(sha(src)=='426519c180c18f141f8de9a850bc110b4f6a265b42e0f60a10ed2f579ba9db79','BROWSER_CLOSURE')
 # Only Chromium host routing changes; TLS hostname/certificate verification stays on.
 if loopback:
  original=b'browser = await chromium.launch(await browserLaunchOptions());'
  replacement=b'browser = await chromium.launch({...await browserLaunchOptions(), args:[...(await browserLaunchOptions()).args, "--host-resolver-rules=MAP app.boardx.com.cn 127.0.0.1"]});'
  need(src.count(original)==2,'BROWSER_ROUTING_ANCHOR');src=src.replace(original,replacement)
 if candidate:
  anchor=b'else process.stdout.write("CN_BROWSER_SMOKE_PASSED\\n");'
  extra=r'''else {
    const verified = await page.evaluate(async ({tokenKey}) => {
      const token=window.localStorage.getItem(tokenKey);
      const headers={Authorization:`Bearer ${token}`};
      const paths=["/api/billing/config","/api/billing/packages?ownerType=user","/api/billing/consumption/settings"];
      const values=[];
      for(const path of paths){const r=await fetch(path,{headers,credentials:"include"});if(r.status!==200)return false;values.push(await r.json());}
      return Array.isArray(values[0].enabledProviders)&&Array.isArray(values[1].items)&&values[1].items.length===6&&new Set(values[1].items.map(x=>x.packageId)).size===6&&values[2].creditPreflightEnabled===false;
    },{tokenKey:SESSION_TOKEN_KEY});
    if(!verified)throw new Error("CN_NEW_SCHEMA_READ_CONTRACT_FAILED");
    for(const path of ["/home","/chat","/projects","/billing"]){
      const response=await page.goto(new URL(path,origin).href,{waitUntil:"domcontentloaded",timeout:30000});
      if(!response||response.status()>=400)throw new Error("CN_PAGE_FAILED");
      await page.waitForFunction(()=>document.body.innerText.length>100,{timeout:20000});
      if(new URL(page.url()).pathname==="/login")throw new Error("CN_SESSION_LOST");
      if(await page.getByText("Application error:",{exact:false}).count())throw new Error("CN_PAGE_RENDER_FAILED");
    }
    process.stdout.write("CN_BROWSER_SMOKE_PASSED\n");
  }'''
  need(src.count(anchor)==1,'BROWSER_CONTRACT_ANCHOR');src=src.replace(anchor,extra.encode())
 p=ATTEMPT/(('candidate-' if candidate else 'baseline-')+('browser-local.mjs' if loopback else 'browser-public.mjs'))
 if not p.exists():
  fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.write(fd,src);os.close(fd)
 env={'PATH':'/usr/bin:/bin','HOME':'/root','CN_BROWSER_EXECUTABLE_PATH':'/usr/bin/chromium-browser'}
 r=subprocess.run(['/usr/bin/node',str(p),'https://app.boardx.com.cn','/etc/workspacex-image-release/cn-browser.env'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env,timeout=100)
 need(r.returncode==0 and b'CN_BROWSER_SMOKE_PASSED' in r.stdout,'BROWSER_ACCEPTANCE_FAILED')
 return {'realChromium':True,'authenticatedLogin':True,'notificationsContract':True,'routing':'loopback-tls' if loopback else 'public-dns','newBillingContracts':candidate,'pages':['home','chat','projects','billing'] if candidate else ['login'],'passed':True}

def wait_old_application(held):
 deadline=time.monotonic()+90
 while True:
  try:live(images=OLD_IMAGES);browser(loopback=held);return
  except Exception:
   if time.monotonic()>deadline:raise
   time.sleep(3)

def nginx_write(b):
 tmp=NGINX.with_name('.wsx-5917.tmp');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 os.replace(tmp,NGINX);run(['/usr/sbin/nginx','-t']);run(['/usr/bin/systemctl','reload','nginx'])

def verify_backup_archive(key,out,image_id):
 # Full decryption must finish before the TOC reader. pg_restore --list may
 # close a stream after its header, causing a valid decryptor to get SIGPIPE.
 with os.fdopen(os.memfd_create('wsx-backup-verification',flags=os.MFD_CLOEXEC),'w+b') as archive:
  r=subprocess.run(['/usr/bin/openssl','enc','-d','-aes-256-cbc','-pbkdf2','-pass','file:'+str(key),'-in',str(out)],stdout=archive,stderr=subprocess.DEVNULL,timeout=120)
  need(r.returncode==0,'BACKUP_DECRYPTION_FAILED');archive.seek(0)
  r=subprocess.run(['/usr/bin/docker','run','--rm','--pull=never','--network','none','--read-only','--entrypoint','pg_restore','-i',image_id,'--list'],stdin=archive,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=90)
  need(r.returncode==0 and b'_kernel_migrations' in r.stdout,'BACKUP_ARCHIVE_INVALID')

def backup(plan):
 private(RUNTIME/'migration.env')
 key=ATTEMPT/'backup.key';fd=os.open(key,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.write(fd,secrets.token_hex(32).encode());os.close(fd)
 out=ATTEMPT/'before-migration.pgdump.enc';fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 dump=['/usr/bin/docker','run','--rm','--pull=never','--name','wsx-cn-5917-backup','--label','wsx.cn.owned=5917','--network','workspacex-cn-runtime','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m','--env-file',str(RUNTIME/'migration.env'),'--entrypoint','/bin/sh',image(plan,'postgres'),'-c','export PGUSER="$MIGRATION_DB_USER" PGPASSWORD="$MIGRATION_DB_PASSWORD"; exec pg_dump --format=custom --no-owner --no-acl']
 a=subprocess.Popen(dump,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 with os.fdopen(fd,'wb') as target:
  b=subprocess.Popen(['/usr/bin/openssl','enc','-aes-256-cbc','-pbkdf2','-salt','-pass','file:'+str(key)],stdin=a.stdout,stdout=target,stderr=subprocess.DEVNULL);a.stdout.close()
  br=b.wait(timeout=240);ar=a.wait(timeout=10);target.flush();os.fsync(target.fileno())
 need(ar==br==0 and out.stat().st_size>1024,'BACKUP_FAILED')
 verify_backup_archive(key,out,image(plan,'postgres'))
 return {'encrypted':True,'bytes':out.stat().st_size,'sha256':sha(out.read_bytes()),'archiveTocVerified':True,'restoreTest':'USER_WAIVED_UNTESTED','writersStopped':True}

def completed_schema_proof():
 previous=Path('/var/lib/workspacex-cn/runtime/cn-schema-5917-40097204900-r2')
 failure=json.loads(private(previous/'failure.json').read_bytes())
 need(failure.get('status')=='FAILED_OLD_IMAGES_VERIFIED_ON_FORWARD_SCHEMA' and failure.get('databaseStatus')=='COMPLETE' and failure.get('maintenanceHeld') is False,'PREVIOUS_ATTEMPT_NOT_TERMINAL')
 for name,status,rows in [('database-schema.json','SCHEMA_COMMITTED_DATA_DEFERRED',427),('database-manual-initialize-cn.json','MANUAL_CN_INITIALIZATION_COMMITTED',431)]:
  v=json.loads(private(previous/name).read_bytes())
  need(v.get('status')==status and v.get('commitAcknowledged') is True and v.get('ledgerCount')==rows and v.get('identity')=={'database':'workspacex_a1cb_20261006','role':'migration_admin'},'PREVIOUS_SCHEMA_RECEIPT')
 need(sha(private('/root/wsx-cn-5917-schema-plan.json').read_bytes())==PLAN_SHA,'PREVIOUS_PLAN_DRIFT')

def main():
 need(os.geteuid()==0 and socket.gethostname()=='workspacex-cn-prod','ROOT_CN_REQUIRED')
 args=sys.argv[1:];need(args in [['prepare'],['apply','--manual-cn-initialization'],['prepare-activation'],['activate-complete-schema']],'EXPLICIT_MODE_REQUIRED')
 activation_only=args in [['prepare-activation'],['activate-complete-schema']]
 if activation_only:completed_schema_proof()
 plan_raw=private('/root/wsx-cn-5917-schema-plan.json').read_bytes();need(sha(plan_raw)==PLAN_SHA,'PLAN_HASH');plan=json.loads(plan_raw)
 driver=private('/root/wsx-cn-5917-migration-driver.mjs').read_text()
 need(plan['source']==SOURCE and plan['baseline']==BASELINE,'SOURCE_IDENTITY')
 lock=os.open('/var/lib/workspacex-cn/runtime/release.lock',os.O_RDONLY|os.O_NOFOLLOW);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 base=compose(FILES)
 for f in [*FILES,RUNTIME/'bootstrap.env',RUNTIME/'migration.env']:private(f)
 original=djson(*base,'config','--format','json');need(set(original['services'])==set(SERVICES+['sandbox-sessions']),'COMPOSE_SERVICE_SET')
 before=live(images=OLD_IMAGES)
 migration=config_env(RUNTIME/'migration.env');app=dict(e.split('=',1) for e in before['api']['Config']['Env'])
 need(all(migration[k]==app[k] for k in ['PGHOST','PGPORT','PGDATABASE']) and migration['PGDATABASE']=='workspacex_a1cb_20261006','APP_MIGRATION_TARGET_DIFFERENT')
 ids={s:image(plan,s) for s in ['api','web','agent','sandbox','postgres']}
 old_nginx=NGINX.read_bytes();need(old_nginx.count(b'server_name app.boardx.com.cn;')==2 and b'www.boardx.com.cn' not in old_nginx,'APP_NGINX_SCOPE')
 held=old_nginx.replace(b'server_name app.boardx.com.cn;',b'server_name app.boardx.com.cn;\n    if ($remote_addr !~ "^(127[.]0[.]0[.]1|101[.]132[.]151[.]28)$") { return 503; }')
 if args in [['prepare'],['prepare-activation']]:
  ATTEMPT.mkdir(mode=0o700)
  save(ATTEMPT/'input-hashes.json',{str(f):sha(f.read_bytes()) for f in [*FILES,RUNTIME/'bootstrap.env',RUNTIME/'migration.env',NGINX,Path('/root/wsx-cn-5917-migration-driver.mjs')]})
  save(ATTEMPT/'baseline.json',{s:{'containerId':x['Id'],'imageId':x['Image'],'signatureSha256':sha(json.dumps(signature(x),sort_keys=True).encode())} for s,x in before.items()})
  save(ATTEMPT/'images.json',ids)
  save(ATTEMPT/'nginx-original.json',{'sha256':sha(old_nginx),'text':old_nginx.decode()})
  save(ATTEMPT/'candidate-images.json',{'services':{s:{'image':ids[s]} for s in SERVICES}})
  save(ATTEMPT/'rollback-images.json',{'services':{s:{'image':OLD_IMAGES[s]} for s in SERVICES}})
  candidate=djson(*compose(FILES+[ATTEMPT/'candidate-images.json']),'config','--format','json');expected=copy.deepcopy(original)
  for s in SERVICES:expected['services'][s]['image']=ids[s]
  need(candidate==expected,'NON_IMAGE_COMPOSE_CHANGE')
  v=probe_db(plan,driver,'status');need(v['status']==('COMPLETE' if activation_only else 'BASELINE'),'BASELINE_LEDGER')
  save(ATTEMPT/'baseline-browser.json',browser())
  save(ATTEMPT/'state.json',{'stage':'PREPARED','source':SOURCE,'baseline':BASELINE,'preparedAt':time.time(),'activationOnly':activation_only})
  print('CN_RELEASE_PREPARED',flush=True);return
 state=json.loads(private(ATTEMPT/'state.json').read_bytes());need(state['stage']=='PREPARED' and bool(state.get('activationOnly'))==activation_only and time.time()-state['preparedAt']<3600,'ATTEMPT_EXPIRED_OR_ALREADY_STARTED')
 expected=json.loads(private(ATTEMPT/'input-hashes.json').read_bytes());need(all(sha(private(k).read_bytes())==v for k,v in expected.items()),'INPUT_DRIFT')
 old=json.loads(private(ATTEMPT/'baseline.json').read_bytes());need(all(x['Id']==old[s]['containerId'] and sha(json.dumps(signature(x),sort_keys=True).encode())==old[s]['signatureSha256'] for s,x in before.items()),'BASELINE_CAS')
 save(ATTEMPT/'state.json',{'stage':'MAINTENANCE_INTENT','source':SOURCE,'startedAt':time.time(),'databaseRestoreTest':'USER_WAIVED_UNTESTED'})
 nginx_held=False;stopped=False;schema_started=activation_only;activation=activation_only
 try:
  nginx_held=True;nginx_write(held)
  stopped=True;docker(*base,'stop','--timeout','30',*SERVICES,timeout=150);stopped=True;live(running=False,images=OLD_IMAGES)
  if not activation_only:
   save(ATTEMPT/'backup.json',backup(plan))
   save(ATTEMPT/'state.json',{'stage':'SCHEMA_TRANSACTION_INTENT','source':SOURCE,'time':time.time()});schema_started=True
   probe_db(plan,driver,'schema')
   save(ATTEMPT/'state.json',{'stage':'MANUAL_CN_INITIALIZATION_INTENT','source':SOURCE,'time':time.time()})
   probe_db(plan,driver,'manual-initialize-cn')
   need(probe_db(plan,driver,'status')['status']=='COMPLETE','POST_MIGRATION_LEDGER')
  else:
   need(probe_db(plan,driver,'status')['status']=='COMPLETE','POST_MIGRATION_LEDGER')
  save(ATTEMPT/'state.json',{'stage':'ACTIVATION_INTENT','source':SOURCE,'time':time.time()});activation=True
  docker(*compose(FILES+[ATTEMPT/'candidate-images.json']),'up','--detach','--no-deps','--pull','never','--no-build',*SERVICES,timeout=150)
  deadline=time.monotonic()+100
  while True:
   try:
    after=live(images=ids)
    need(all(signature(after[s])==signature(before[s]) for s in SERVICES),'RUNTIME_CONFIG_CHANGED')
    for s in SERVICES:
     actual_env=dict(v.split('=',1) for v in after[s]['Config']['Env'])
     need(all(actual_env.get(k)==dict(x.split('=',1) for x in before[s]['Config']['Env']).get(k) for k in original['services'][s].get('environment',{})),'EXPLICIT_RUNTIME_ENVIRONMENT_CHANGED')
    local_browser=browser(loopback=True,candidate=True);break
   except Exception:
    if time.monotonic()>deadline:raise
    time.sleep(3)
  save(ATTEMPT/'candidate-browser-local.json',local_browser)
  nginx_write(old_nginx);nginx_held=False
  public_browser=browser(candidate=True)
  after=live(images=ids);need(all(x['RestartCount']==0 for x in after.values()),'RUNTIME_RESTARTED')
  receipt={'status':'PRODUCTION_AVAILABLE','source':SOURCE,'baseline':BASELINE,'tag':plan['manifest']['tag'],'availableAt':time.time(),'images':ids,'services':{s:{'containerId':x['Id'],'imageId':x['Image'],'running':True,'restartCount':x['RestartCount']} for s,x in after.items()},'schemaLedgerRows':431,'dataInitialization':'separate-reviewed-CN-only-transaction','browser':public_browser,'composeFiles':[str(p) for p in FILES+[ATTEMPT/'candidate-images.json']],'restoreTest':'USER_WAIVED_UNTESTED'}
  save(ATTEMPT/'receipt.json',receipt);save(ATTEMPT/'state.json',receipt);save(Path('/etc/workspacex-image-release/cn-active-release.json'),receipt);print('CN_PRODUCTION_AVAILABLE',json.dumps(receipt),flush=True)
 except Exception as e:
  status={'status':'FAILED_OR_UNKNOWN','stage':json.loads((ATTEMPT/'state.json').read_bytes())['stage'],'code':str(e) if isinstance(e,Rejected) else type(e).__name__,'maintenanceHeld':nginx_held,'schemaMayHaveChanged':schema_started,'automaticSqlRollback':False}
  # Confirm database terminality independently before any rollback. Never repeat DDL.
  try:
   # Hold before any recovery query: failed probes must never leave a failed candidate public.
   nginx_held=True;nginx_write(held);status['maintenanceHeld']=True
   db=probe_db(plan,driver,'status');status['databaseStatus']=db['status']
   if not schema_started or db['status']=='BASELINE':
    if stopped:docker(*compose(FILES+[ATTEMPT/'rollback-images.json']),'up','--detach','--no-deps','--pull','never','--no-build',*SERVICES,timeout=150)
    wait_old_application(nginx_held)
    if nginx_held:nginx_write(old_nginx);nginx_held=False
    browser();status['status']='FAILED_OLD_APPLICATION_RESTORED';status['maintenanceHeld']=False
   elif activation and db['status']=='COMPLETE':
    # Expanded checks + nullable columns preserve old-row/old-writer semantics;
    # new-domain tables are not referenced by the baseline application.
    if not nginx_held:nginx_write(held);nginx_held=True
    docker(*compose(FILES+[ATTEMPT/'rollback-images.json']),'up','--detach','--no-deps','--pull','never','--no-build',*SERVICES,timeout=150)
    wait_old_application(True);nginx_write(old_nginx);nginx_held=False;browser()
    status['status']='FAILED_OLD_IMAGES_VERIFIED_ON_FORWARD_SCHEMA';status['maintenanceHeld']=False
  except Exception:
   status['recovery']='OPERATOR_RECONCILIATION_REQUIRED'
   try:nginx_held=True;nginx_write(held);status['maintenanceHeld']=True
   except Exception:status['maintenanceHeld']='UNKNOWN_REQUIRES_IMMEDIATE_OPERATOR_ACTION'
  save(ATTEMPT/'failure.json',status);save(ATTEMPT/'state.json',status);print('CN_RELEASE_FAILED',json.dumps(status),flush=True);raise SystemExit(1)

if __name__=='__main__':
 try:main()
 except Rejected as e:print('CN_RELEASE_REJECTED',str(e),flush=True);raise SystemExit(1)
