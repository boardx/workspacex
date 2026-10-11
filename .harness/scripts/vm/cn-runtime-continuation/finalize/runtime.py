"""Bound small receipt readback / exact-five status / same-generation hold clear."""
import base64,datetime,fcntl,hashlib,json,os,re,stat,subprocess
from pathlib import Path
C=__CONFIG__
RUNTIME=Path('/var/lib/workspacex-cn/runtime')
HELPER=Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py')
HELPER_SHA='322e1d8342c787a282fe4a41093e3a9925d4c0ca20010b68f824e83b2691a230'
READABLE={'hold-result.json','known-five-stop.json','stop-receipt.json','backup-result.json','switch-intent.json','switch-result.json','rollback-result.json','abort-original-result.json'}
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def dt(s):return datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
def private(path):
 for parent in path.parents:
  s=parent.lstat();assert stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  s=os.fstat(f.fileno());assert stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=65536
  return f.read()
def validate_status(b,root,xs):
 assert len(xs)==5 and {x['Name']for x in xs}==set(b['expectedContainers'])
 assert {x['Config']['Labels']['com.docker.compose.service']for x in xs}==set(b['candidateImages']),'EXACT_FIVE_SERVICES_REQUIRED'
 out=[]
 for x in xs:
  service=x['Config']['Labels']['com.docker.compose.service'];assert service in b['candidateImages']and x['Name']=='/workspacex-cn-'+service+'-1','CONTAINER_SERVICE_NAME_MISMATCH'
  assert x['Id']!=b['expectedContainers'][x['Name']]['id'] and x['Config']['Image']==b['candidateImages'][service],'NEW_CONTAINER_NOT_PROVEN'
  assert x['State']['Running']is True and not x['State']['Restarting']and x['State']['Status']=='running'and x['RestartCount']==0
  health=x['State'].get('Health',{}).get('Status');assert health in (None,'healthy'),'CONTAINER_HEALTH_NOT_READY'
  labels=x['Config']['Labels'];assert labels['com.docker.compose.project']=='workspacex-cn'and labels['com.docker.compose.project.working_dir']==b['workingDir']
  assert labels['com.docker.compose.project.config_files'].split(',')==[x['path']for x in b['composeFiles']]+[str(root/'switch-images.json')]
  out.append(dict(name=x['Name'],id=x['Id'],service=service,image=x['Config']['Image'],running=True,health=health,restartCount=x['RestartCount']))
 return sorted(out,key=lambda x:x['name'])
def validate_clear(c,b,status,now):
 assert status['kind']=='f0eb-exact-five-status-v1' and status['bindingSha256']==c['bindingSha256']and status['switchReceiptSha256']==c['switchReceiptSha256']
 assert status['hold']==b['hold']==c['hold'] and status['hold']['state']=='held','HOLD_GENERATION_CHANGED'
 assert status['attemptId']==b['attemptId']and status['sourceRevision']==b['sourceRevision']
 assert status['exactFiveVerified']is True and status['runtimeMutation']is False
 assert datetime.timedelta(0)<=now-dt(status['observedAt'])<=datetime.timedelta(minutes=10),'STATUS_STALE'
def run(c):
 assert os.geteuid()==os.getegid()==0;mode=c['mode'];assert mode in ('read-receipts','status','clear-hold')
 now=datetime.datetime.now(datetime.timezone.utc);assert dt(c['issuedAt'])<=now<dt(c['expiresAt'])and dt(c['expiresAt'])-dt(c['issuedAt'])<=datetime.timedelta(minutes=30),'REQUEST_EXPIRED'
 root=Path(c['root']);assert root.parent==RUNTIME and re.fullmatch('upgrade-f0eb-[a-z0-9-]{1,64}',root.name)
 fd=os.open(RUNTIME/'release.lock',os.O_RDWR|os.O_NOFOLLOW);s=os.fstat(fd);assert stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600
 fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 if fd!=9:os.dup2(fd,9);os.close(fd)
 os.set_inheritable(9,True)
 try:
  raw=private(root/'binding.json');assert sha(raw)==c['bindingSha256'];b=json.loads(raw)
  assert b['draft']is False and b['sourceRevision']=='f0eb9d07398a66fdd5646a9e6b855fa1b940e571'and b['holdHelperSha256']==HELPER_SHA
  if mode=='read-receipts':
   assert type(c['files'])is list and 1<=len(c['files'])<=3 and len(c['files'])==len(set(c['files']))and set(c['files'])<=READABLE
   result={};total=0
   for name in c['files']:
    if not (root/name).exists():result[name]={'exists':False};continue
    value=private(root/name);total+=len(value);assert total<=12288,'SMALL_RECEIPT_LIMIT';result[name]=dict(exists=True,sha256=sha(value),bytes=len(value),base64=base64.b64encode(value).decode())
   return dict(kind='f0eb-small-receipts-v1',bindingSha256=sha(raw),files=result,runtimeMutation=False)
  assert b['hold']==c['hold']and b['hold']['state']=='held'
  helper=HELPER.read_bytes();assert sha(helper)==HELPER_SHA
  command=['/usr/bin/python3','-I','-S','-B',str(HELPER)]
  def hold():return json.loads(subprocess.check_output(command+['read',str(RUNTIME)],stderr=subprocess.DEVNULL,timeout=30,pass_fds=(9,)))
  assert hold()==b['hold'],'HOLD_GENERATION_CHANGED'
  sr=private(root/'switch-result.json');assert sha(sr)==c['switchReceiptSha256'];switch=json.loads(sr);assert switch=={'exactFiveRunning':True,'holdRetained':True,'businessAcceptancePassed':False}
  # Require the switch intent to bind the same current binding and generation.
  intent=json.loads(private(root/'switch-intent.json'));assert intent=={'bindingSha256':c['bindingSha256'],'holdGeneration':b['hold']['generation']}
  for f in b['composeFiles']+b['envFiles']:assert sha(private(Path(f['path'])))==f['sha256']
  xs=json.loads(subprocess.check_output(['/usr/bin/docker','--host','unix:///run/docker.sock','inspect',*b['expectedContainers']],stderr=subprocess.DEVNULL,timeout=30));observed=validate_status(b,root,xs)
  if mode=='status':return dict(kind='f0eb-exact-five-status-v1',sourceRevision=b['sourceRevision'],attemptId=b['attemptId'],bindingSha256=c['bindingSha256'],switchReceiptSha256=c['switchReceiptSha256'],hold=b['hold'],containers=observed,exactFiveVerified=True,runtimeMutation=False,businessAcceptancePassed=False,observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
  assert c['clearHoldAuthorized']is True
  status_raw=base64.b64decode(c['statusBase64'],validate=True);assert sha(status_raw)==c['statusSha256'];status=json.loads(status_raw);validate_clear(c,b,status,now);assert status['containers']==observed,'FINAL_CONTAINERS_CHANGED'
  assert hold()==b['hold']
  clear_now=datetime.datetime.now(datetime.timezone.utc);assert dt(c['issuedAt'])<=clear_now<dt(c['expiresAt']),'REQUEST_EXPIRED'
  validate_clear(c,b,status,clear_now)
  p=subprocess.run(command+['clear',str(RUNTIME)],input=json.dumps(b['hold']).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30,pass_fds=(9,));assert p.returncode==0,'CLEAR_UNKNOWN_RECONCILE_NO_RETRY'
  result=hold();assert result['state']=='cleared'and result['generation']==b['hold']['generation']and result['identity']==b['hold']['identity']
  return dict(kind='f0eb-hold-cleared-v1',actualHoldCleared=True,generation=result['generation'],identity=result['identity'],bindingSha256=c['bindingSha256'],statusSha256=c['statusSha256'],observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),applicationRecreated=False,businessAcceptancePassed=False)
 finally:os.close(9)
if __name__=='__main__':
 try:print(json.dumps(run(C),sort_keys=True))
 except Exception:
  print('{"ok":false,"code":"F0EB_FINALIZE_FAILED_RECONCILE_NO_RETRY"}');raise SystemExit(1)
