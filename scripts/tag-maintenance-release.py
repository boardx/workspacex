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
import stat
import subprocess
import sys
import time

SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116'
TAG='41248889927-1'
SERVICES={'api','web','agent','sandbox','sandbox-sessions'}
class Rejected(Exception):pass
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

class Host:
 def __init__(self,policy,attempt,lock_fd):self.p=policy;self.attempt=attempt;self.lock_fd=lock_fd
 def run(self,args,timeout=120):
  result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,pass_fds=(self.lock_fd,),env={'PATH':'/usr/bin:/bin','HOME':'/root','LANG':'C.UTF-8','WSX_RELEASE_LOCK_FD':str(self.lock_fd)})
  need(result.returncode==0,'HOST_COMMAND_FAILED');return result.stdout
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
 def stop(self):self.run(['/usr/bin/docker','stop','--time','30',*[self.p['baseline'][s]['containerId'] for s in sorted(SERVICES)]],180)
 def start(self):self.run(['/usr/bin/docker','start',*[self.p['baseline'][s]['containerId'] for s in sorted(SERVICES)]],120)
 def nginx(self,expected,replacement):replace_nginx(Path(self.p['nginx']['path']),expected,replacement,self.run)
 def verify_old(self):
  runtime_set(self.runtime(),self.p['project'],self.p['baseline'],True)
  need(self.adapter('oldApplicationProbe','verify')['status']=='OLD_APPLICATION_VERIFIED','OLD_APPLICATION_FAILED')

def run_attempt(p,attempt,host,now=time.time):
 original=pinned(p['nginx']).read_bytes();held=maintenance_bytes(original,p['environment'])
 save(attempt/'nginx-original.json',{'sha256':digest(original),'bytesHex':original.hex()})
 for ref in p['configurationPins']:pinned(ref,private=ref.get('private',False))
 runtime_set(host.runtime(),p['project'],p['baseline'],True)
 need(host.adapter('databaseCommand','preflight')['status']=='BASELINE','BASELINE_LEDGER')
 host.verify_old()
 save(attempt/'state.json',{'status':'MAINTENANCE_INTENT','source':SOURCE,'tag':TAG,'time':now()})
 held_active=False;stopped=False;write_intent=False
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
  host.start();host.verify_old()
  save(attempt/'state.json',{'status':'FORWARD_SCHEMA_OLD_APPLICATION_VERIFIED','source':SOURCE,'tag':TAG,'time':now(),'maintenanceHeld':True})
  host.nginx(held,original);held_active=False
  receipt={'status':'SCHEMA_COMPLETE_OLD_APPLICATION_AVAILABLE','source':SOURCE,'tag':TAG,'environment':p['environment'],'time':now(),'maintenanceHeld':False,'targetImagesActivated':False}
  save(attempt/'receipt.json',receipt);save(attempt/'state.json',receipt);return receipt
 except Exception:
  status={'status':'RECONCILIATION_REQUIRED','source':SOURCE,'tag':TAG,'maintenanceHeld':held_active,'databaseMayHaveChanged':write_intent,'automaticSqlRollback':False}
  # Only independently observed BASELINE or COMPLETE permits old-service restart.
  # Never replay apply after a transport failure or uncertain COMMIT.
  try:
   if write_intent:need(host.adapter('databaseCommand','drain')['status']=='DRAINED','UNKNOWN_WRITER_STILL_ACTIVE')
   observed=host.adapter('databaseCommand','reconcile')['status'] if write_intent else 'BASELINE'
   need(observed in ('BASELINE','COMPLETE'),'DATABASE_TERMINALITY_UNKNOWN')
   if stopped:host.start()
   host.verify_old()
   if held_active:host.nginx(held,original);held_active=False
   status.update(status='FAILED_OLD_APPLICATION_VERIFIED',databaseStatus=observed,maintenanceHeld=False)
  except Exception:status['recovery']='OPERATOR_RECONCILIATION_REQUIRED'
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
 policy_path=trusted(sys.argv[1],private=True);p=json.loads(policy_path.read_bytes())
 need(p['source']==SOURCE and p['tag']==TAG and p['environment'] in ('cn','us'),'RELEASE_BINDING')
 need(set(p['baseline'])==SERVICES and len({v['containerId'] for v in p['baseline'].values()})==5,'BASELINE_SERVICE_SET')
 for v in p['baseline'].values():need(re.fullmatch('[a-f0-9]{64}',v['containerId']) and re.fullmatch('sha256:[a-f0-9]{64}',v['imageId']),'BASELINE_ID')
 need(0<time.time()-p['preparedAt']<3600,'PREPARATION_EXPIRED')
 receipt=json.loads(pinned(p['preparationReceipt'],private=True).read_bytes())
 need(receipt.get('source')==SOURCE and receipt.get('tag')==TAG and receipt.get('environment')==p['environment'] and receipt.get('status')=='PREPARED_FOR_MAINTENANCE','PREPARATION_BINDING')
 for key in ('databaseCommand','backupCommand','oldApplicationProbe'):
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
if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as e:
  print(json.dumps({'status':'MAINTENANCE_FAILED','code':str(e) if isinstance(e,Rejected) else 'HOST_OPERATION_FAILED'}));raise SystemExit(1)
