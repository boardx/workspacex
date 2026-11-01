#!/usr/bin/env python3
"""Root-only reviewed schema maintenance; never an ordinary image-deploy waiver.

Pinned host adapters supply backup, database and old-business verification.
No target-image activation, automatic DDL retry or SQL rollback exists here.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import subprocess
import sys
import time

SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116'
TAG='41248889927-1'
SERVICES={'api','web','agent','sandbox','sandbox-sessions'}
class Rejected(Exception):pass
class MaintenanceInterrupted(RuntimeError):pass
def need(value,code):
 if not value:raise Rejected(code)
def digest(value):return hashlib.sha256(value).hexdigest()
def trusted(path,private=False):
 p=Path(path);need(p.is_absolute(),'ABSOLUTE_PATH')
 for item in (*reversed(p.parents),p):
  s=item.lstat();need(not stat.S_ISLNK(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'ROOT_PATH_REQUIRED')
 s=p.stat();need(stat.S_ISREG(s.st_mode) and s.st_nlink==1,'REGULAR_FILE_REQUIRED')
 if private:need(not s.st_mode&0o077,'PRIVATE_FILE_REQUIRED')
 return p
def pinned(ref,private=False):
 p=trusted(ref['path'],private);raw=p.read_bytes();need(digest(raw)==ref['sha256'],'INPUT_HASH_DRIFT');return p

def save(path,value):
 raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode();tmp=path.with_name(path.name+'.'+secrets.token_hex(6))
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
 os.replace(tmp,path);fd=os.open(path.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)

def maintenance_bytes(original,environment):
 host={'us':'appv1.boardx.us','cn':'app.boardx.com.cn'}[environment]
 # This deliberately narrow adapter rejects includes/comments/complex server
 # layouts rather than rewriting another virtual host or an unparsed block.
 need(b'wsx-tag-maintenance' not in original,'MAINTENANCE_ALREADY_PRESENT')
 names=re.findall(rb'\bserver_name\s+([^;]+);',original)
 need(1<=len(names)<=2 and all(x.strip()==host.encode() for x in names),'NGINX_SCOPE')
 anchor=b'server_name '+host.encode()+b';'
 need(original.count(anchor)==len(names),'NGINX_ANCHOR')
 return original.replace(anchor,anchor+b'\n    # wsx-tag-maintenance\n    if ($remote_addr != 127.0.0.1) { return 503; }')

def atomic_bytes(path,raw,mode):
 tmp=path.with_name('.wsx-maint-'+secrets.token_hex(6));fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 with os.fdopen(fd,'wb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
 os.replace(tmp,path);fd=os.open(path.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)

def replace_nginx(path,expected,replacement,run):
 need(path.read_bytes()==expected,'NGINX_CAS')
 mode=stat.S_IMODE(path.stat().st_mode);atomic_bytes(path,replacement,mode)
 try:run(['/usr/sbin/nginx','-t']);run(['/usr/bin/systemctl','reload','nginx'])
 except Exception:
  # Restore original bytes even if syntax validation failed before reload.
  atomic_bytes(path,expected,mode)
  run(['/usr/sbin/nginx','-t']);run(['/usr/bin/systemctl','reload','nginx'])
  raise

def runtime_set(rows,project,baseline,running):
 need(len(rows)==5 and len({x['Id'] for x in rows})==5,'RUNTIME_SET')
 seen={}
 for row in rows:
  labels=row.get('Config',{}).get('Labels',{});service=labels.get('com.docker.compose.service')
  need(service in SERVICES and service not in seen and labels.get('com.docker.compose.project')==project,'RUNTIME_PROJECT')
  need(row['Id']==baseline[service]['containerId'] and row['Image']==baseline[service]['imageId'],'RUNTIME_CAS')
  need(row['State']['Running'] is running and not row['State'].get('Restarting'),'RUNTIME_STATE')
  seen[service]=row
 need(set(seen)==SERVICES,'RUNTIME_SERVICES');return seen

def startup_marker(rows):
 markers=[]
 for service in ('api','web'):
  selected=[x for x in rows if x.get('Config',{}).get('Labels',{}).get('com.docker.compose.service')==service]
  need(len(selected)==1,'STARTUP_MARKER_SERVICE_SET')
  values=[v.split('=',1)[1] for v in selected[0]['Config'].get('Env',[]) if v.startswith('WORKSPACEX_DEPLOYMENT_MARKER=')]
  need(len(values)==1 and re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',values[0]),'STARTUP_MARKER_REQUIRED');markers.append(values[0])
 need(markers[0]==markers[1],'STARTUP_MARKER_DRIFT');return markers[0]

def readiness_pair(environment,marker,run,timeout):
 hostname={'us':'appv1.boardx.us','cn':'app.boardx.com.cn'}[environment]
 need(0<timeout<=3,'READINESS_REQUEST_BUDGET')
 for path in ('/api/healthz','/.well-known/workspacex-deployment'):
  args=['/usr/bin/curl','--disable','--silent','--show-error','--fail','--noproxy','*','--request','GET','--proto','=https','--tlsv1.2','--max-redirs','0','--max-time',str(timeout),'--connect-timeout',str(timeout),'--max-filesize','65536','--resolve',hostname+':443:127.0.0.1','--write-out','\\n%{http_code}','https://'+hostname+path]
  raw=run(args,timeout=timeout);need(len(raw)<=65540,'READINESS_RESPONSE_BOUND');body,status=raw.rsplit(b'\n',1);need(status==b'200','STARTUP_HTTP');value=json.loads(body)
  need(type(value) is dict and value.get('deploymentMarker')==marker and (path!='/api/healthz' or value.get('trustworthy') is True),'STARTUP_MARKER_OR_HEALTH_MISMATCH')
 return {'apiHealth':True,'webMarker':True,'readOnlyGet':True,'tlsVerification':True}

class Host:
 def __init__(self,policy,attempt,lock_fd):self.p=policy;self.attempt=attempt;self.lock_fd=lock_fd;self.expected_startup_marker=None
 def run(self,args,timeout=120):
  child=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,pass_fds=(self.lock_fd,),env={'PATH':'/usr/bin:/bin','HOME':'/root','LANG':'C.UTF-8','WSX_RELEASE_LOCK_FD':str(self.lock_fd)})
  try:output,_=child.communicate(timeout=timeout)
  except BaseException:
   # subprocess.run kills immediately on InterruptedError. Give the fixed
   # adapter its own SIGTERM/finally cleanup before bounded escalation.
   if child.poll() is None:
    child.terminate()
    try:child.communicate(timeout=15)
    except subprocess.TimeoutExpired:child.kill();child.communicate(timeout=5)
   raise
  need(child.returncode==0,'HOST_COMMAND_FAILED');return output
 def runtime(self):
  ids=[self.p['baseline'][s]['containerId'] for s in sorted(SERVICES)]
  return json.loads(self.run(['/usr/bin/docker','inspect',*ids]))
 def adapter(self,name,mode):
  adapter=self.p[name];executable=pinned(adapter['executable'])
  for ref in adapter.get('inputs',[]):pinned(ref,private=ref.get('private',False))
  raw=self.run([str(executable),mode,str(self.attempt)],timeout=adapter['timeoutSeconds'])
  need(len(raw)<=65536,'ADAPTER_OUTPUT_BOUND');value=json.loads(raw)
  need(value.get('source')==SOURCE and value.get('tag')==TAG and value.get('environment')==self.p['environment'],'ADAPTER_IDENTITY')
  save(self.attempt/(name+'-'+mode+'.json'),value);return value
 def capture_startup(self,rows):
  self.expected_startup_marker=startup_marker(rows)
  save(self.attempt/'startup-expected.json',{'source':SOURCE,'tag':TAG,'deploymentMarker':self.expected_startup_marker,'baseline':self.p['baseline']})
 def wait_readiness(self):
  budget=self.p.get('startupReadinessTimeoutSeconds',60)
  need(type(budget) is int and 1<=budget<=120 and self.expected_startup_marker,'STARTUP_READINESS_BINDING')
  deadline=time.monotonic()+budget
  while True:
   try:
    rows=self.runtime();runtime_set(rows,self.p['project'],self.p['baseline'],True);need(startup_marker(rows)==self.expected_startup_marker,'STARTUP_RUNTIME_MARKER_DRIFT')
    remaining=deadline-time.monotonic();need(remaining>0,'STARTUP_READINESS_DEADLINE')
    # Each pair can consume two request budgets. Reserve both within total.
    result=readiness_pair(self.p['environment'],self.expected_startup_marker,self.run,min(3,remaining/2));need(time.monotonic()<=deadline,'STARTUP_READINESS_DEADLINE');return result
   except MaintenanceInterrupted:raise
   except Exception:
    remaining=deadline-time.monotonic()
    if remaining<=0:raise Rejected('STARTUP_READINESS_DEADLINE')
    time.sleep(min(.25,remaining))
 def database_proof_ref(self,mode,status):
  path=trusted(self.attempt/('databaseCommand-'+mode+'.json'),private=True);raw=path.read_bytes();need(len(raw)<=65536,'COMMIT_PROOF_BOUND');value=json.loads(raw)
  need(value.get('status')==status and value.get('source')==SOURCE and value.get('tag')==TAG and value.get('environment')==self.p['environment'] and (mode!='apply' or value.get('commitAcknowledged') is True),'COMMIT_ORIGINAL_PROOF_BINDING')
  snapshot=self.attempt/('verified-'+mode+'.json');atomic_bytes(snapshot,raw,0o600)
  return {'path':str(snapshot),'sha256':digest(raw),'original':{'path':str(path),'sha256':digest(raw)}}
 def stop(self):self.run(['/usr/bin/docker','stop','--time','30',*[self.p['baseline'][s]['containerId'] for s in sorted(SERVICES)]],180)
 def start(self):self.run(['/usr/bin/docker','start',*[self.p['baseline'][s]['containerId'] for s in sorted(SERVICES)]],120)
 def nginx(self,expected,replacement):replace_nginx(Path(self.p['nginx']['path']),expected,replacement,self.run)
 def verify_old(self):
  runtime_set(self.runtime(),self.p['project'],self.p['baseline'],True)
  need(self.adapter('oldApplicationProbe','verify')['status']=='OLD_APPLICATION_VERIFIED','OLD_APPLICATION_FAILED')

def require_bootstrap(policy):
 spec=policy.get('bootstrapProbe')
 need(type(spec) is dict and bool(spec) and type(spec.get('binding')) is dict and bool(spec['binding']) and type(spec.get('inputs')) is list and bool(spec['inputs']) and type(spec.get('executable')) is dict,'BOOTSTRAP_PROBE_REQUIRED')
 need(type(spec.get('timeoutSeconds')) is int and 5<=spec['timeoutSeconds']<=60,'BOOTSTRAP_PROBE_BUDGET')
 return spec

def run_attempt(p,attempt,host,now=time.time):
 require_bootstrap(p)
 original=pinned(p['nginx']).read_bytes();held=maintenance_bytes(original,p['environment'])
 save(attempt/'nginx-original.json',{'sha256':digest(original),'bytesHex':original.hex()})
 for ref in p['configurationPins']:pinned(ref,private=ref.get('private',False))
 initial=host.runtime();runtime_set(initial,p['project'],p['baseline'],True);host.capture_startup(initial)
 host.wait_readiness()
 need(host.adapter('databaseCommand','preflight')['status']=='BASELINE','BASELINE_LEDGER')
 host.verify_old()
 save(attempt/'state.json',{'status':'MAINTENANCE_INTENT','source':SOURCE,'tag':TAG,'time':now()})
 held_active=False;stopped=False;write_intent=False;commit_verified=False;business_attempted=False;commit_record=None
 try:
  host.nginx(original,held);held_active=True
  stopped=True;host.stop();runtime_set(host.runtime(),p['project'],p['baseline'],False)
  need(host.adapter('databaseCommand','drain')['status']=='DRAINED','WRITERS_NOT_DRAINED')
  backup=host.adapter('backupCommand','prepare')
  need(backup['status']=='BACKUP_RESTORE_VERIFIED' and backup.get('writersStopped') is True,'BACKUP_RESTORE_REQUIRED')
  # Full source, ledger, archive and restore authority belongs to independently
  # hash-pinned adapters; an arbitrary request cannot supply success booleans.
  runtime_set(host.runtime(),p['project'],p['baseline'],False)
  for ref in p['configurationPins']:pinned(ref,private=ref.get('private',False))
  need(host.adapter('databaseCommand','drain')['status']=='DRAINED','WRITERS_NOT_DRAINED')
  save(attempt/'state.json',{'status':'TRANSACTION_INTENT','source':SOURCE,'tag':TAG,'time':now()});write_intent=True
  result=host.adapter('databaseCommand','apply')
  need(result['status']=='COMMITTED' and result.get('commitAcknowledged') is True,'TRANSACTION_UNCERTAIN')
  need(host.adapter('databaseCommand','reconcile')['status']=='COMPLETE','POST_MIGRATION_LEDGER')
  commit_record={'status':'COMMIT_VERIFIED_COMPLETE','source':SOURCE,'tag':TAG,'environment':p['environment'],'databaseStatus':'COMPLETE','ack':host.database_proof_ref('apply','COMMITTED'),'reconcile':host.database_proof_ref('reconcile','COMPLETE'),'time':now()}
  save(attempt/'database-terminal.json',commit_record);save(attempt/'state.json',commit_record);commit_verified=True
  need(host.adapter('bootstrapProbe','preactivate')['status']=='CANDIDATE_BOOTSTRAP_COMPATIBLE','POST_MIGRATION_BOOTSTRAP_UNPROVEN')
  host.start();stopped=False;host.wait_readiness();business_attempted=True;host.verify_old()
  save(attempt/'state.json',{'status':'FORWARD_SCHEMA_OLD_APPLICATION_VERIFIED','source':SOURCE,'tag':TAG,'time':now(),'maintenanceHeld':True})
  host.nginx(held,original);held_active=False
  receipt={'status':'SCHEMA_COMPLETE_OLD_APPLICATION_AVAILABLE','source':SOURCE,'tag':TAG,'environment':p['environment'],'time':now(),'maintenanceHeld':False,'targetImagesActivated':False}
  save(attempt/'receipt.json',receipt);save(attempt/'state.json',receipt);return receipt
 except Exception:
  status={'status':'RECONCILIATION_REQUIRED','source':SOURCE,'tag':TAG,'maintenanceHeld':held_active,'databaseMayHaveChanged':write_intent,'automaticSqlRollback':False,'databaseTerminal':commit_record,'businessProbeAttempted':business_attempted}
  # Only independently observed BASELINE or COMPLETE permits old-service restart.
  # Never replay apply after a transport failure or uncertain COMMIT.
  try:
   if write_intent and not commit_verified:need(host.adapter('databaseCommand','drain')['status']=='DRAINED','UNKNOWN_WRITER_STILL_ACTIVE')
   observed=host.adapter('databaseCommand','reconcile')['status'] if write_intent else 'BASELINE'
   need(observed in ('BASELINE','COMPLETE'),'DATABASE_TERMINALITY_UNKNOWN')
   if commit_verified:need(observed=='COMPLETE','VERIFIED_COMMIT_LEDGER_DRIFT')
   if stopped:host.start();stopped=False
   host.wait_readiness()
   need(not business_attempted,'BUSINESS_RECONCILIATION_REQUIRED')
   business_attempted=True;host.verify_old()
   if held_active:host.nginx(held,original);held_active=False
   status.update(status='FAILED_OLD_APPLICATION_VERIFIED',databaseStatus=observed,maintenanceHeld=False)
  except Exception as recovery_error:
   status['recovery']='OPERATOR_RECONCILIATION_REQUIRED'
   status['recoveryCode']=str(recovery_error) if isinstance(recovery_error,Rejected) else 'RECOVERY_VERIFICATION_FAILED'
  status['businessProbeAttempted']=business_attempted
  save(attempt/'failure.json',status);save(attempt/'state.json',status);raise Rejected(status['status'])

def canonical_lock(policy):
 expected={'us':'/run/workspacex-selfhost-deploy.lock','cn':'/var/lib/workspacex-cn/runtime/release.lock'}
 need(policy.get('lockFile')==expected.get(policy.get('environment')),'CANONICAL_LOCK_REQUIRED')
 return policy['lockFile']

def pending_path(state):return state/'pending.json'

def reserve_pending(state,attempt,policy_sha):
 pending=pending_path(state);need(not pending.exists() and not pending.is_symlink(),'PREVIOUS_ATTEMPT_REQUIRES_RECONCILIATION')
 save(pending,{'kind':'reviewed-schema-maintenance','attempt':str(attempt),'policySha256':policy_sha,'source':SOURCE,'tag':TAG})
 return pending

def main():
 need(os.geteuid()==0 and len(sys.argv)==2,'ROOT_FIXED_POLICY_REQUIRED')
 policy_path=trusted(sys.argv[1],private=True);p=json.loads(policy_path.read_bytes());require_bootstrap(p)
 need(p['source']==SOURCE and p['tag']==TAG and p['environment'] in ('cn','us'),'RELEASE_BINDING')
 need(set(p['baseline'])==SERVICES and len({v['containerId'] for v in p['baseline'].values()})==5,'BASELINE_SERVICE_SET')
 for v in p['baseline'].values():need(re.fullmatch('[a-f0-9]{64}',v['containerId']) and re.fullmatch('sha256:[a-f0-9]{64}',v['imageId']),'BASELINE_ID')
 need(0<time.time()-p['preparedAt']<3600,'PREPARATION_EXPIRED')
 receipt=json.loads(pinned(p['preparationReceipt'],private=True).read_bytes())
 need(receipt.get('source')==SOURCE and receipt.get('tag')==TAG and receipt.get('environment')==p['environment'] and receipt.get('status')=='PREPARED_FOR_MAINTENANCE','PREPARATION_BINDING')
 for key in ('databaseCommand','backupCommand','oldApplicationProbe','bootstrapProbe'):
  need(1<=p[key]['timeoutSeconds']<=600,'ADAPTER_TIMEOUT');pinned(p[key]['executable'])
 lock_path=trusted(canonical_lock(p),private=True);fd=os.open(lock_path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);s=os.fstat(fd);n=lock_path.stat();need((s.st_dev,s.st_ino)==(n.st_dev,n.st_ino),'LOCK_DRIFT')
  state=Path(p['stateDirectory']);need(state.is_absolute() and state.stat().st_uid==0 and stat.S_IMODE(state.stat().st_mode)==0o700 and not state.is_symlink(),'STATE_DIRECTORY')
  attempt=state/p['attempt'];need(re.fullmatch('tag-maintenance-[a-f0-9]{32}',p['attempt']),'ATTEMPT_NAME');attempt.mkdir(mode=0o700)
  save(attempt/'policy.json',p)
  # Persist global no-retry marker before any maintenance action. Only a
  # separately reviewed reconciliation operation may clear an uncertain marker.
  pending=reserve_pending(state,attempt,digest(policy_path.read_bytes()))
  result=run_attempt(p,attempt,Host(p,attempt,fd));pending.unlink();print(json.dumps(result));return 0
 finally:os.close(fd)
def install_signal_handlers():
 def interrupted(*_):raise MaintenanceInterrupted('MAINTENANCE_INTERRUPTED')
 for name in ('SIGTERM','SIGHUP','SIGINT'):signal.signal(getattr(signal,name),interrupted)

if __name__=='__main__':
 install_signal_handlers()
 try:raise SystemExit(main())
 except Exception as e:
  print(json.dumps({'status':'MAINTENANCE_FAILED','code':str(e) if isinstance(e,Rejected) else 'HOST_OPERATION_FAILED'}));raise SystemExit(1)
