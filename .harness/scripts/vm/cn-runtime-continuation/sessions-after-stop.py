"""Root host: fresh existing-role readonly session check after exact stop, locked."""
import datetime,fcntl,hashlib,json,os,stat,subprocess,sys
from pathlib import Path
def private(path):
 path=Path(path)
 for parent in path.parents:
  st=parent.lstat();assert stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  st=os.fstat(f.fileno());assert stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600 and st.st_size<=1048576
  return f.read()
root=Path(sys.argv[1]);expected=sys.argv[2];raw=private(root/'binding.json');assert hashlib.sha256(raw).hexdigest()==expected
b=json.loads(raw);assert b['draft'] is False and datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(b['expiresAt'])
assert hashlib.sha256(private(root/'sessions-after-stop.py')).hexdigest()==b['sessionsHelperSha256']
assert os.geteuid()==0 and root.parent==Path('/var/lib/workspacex-cn/runtime')
lock=root.parent/'release.lock';fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW);s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
if fd!=9:os.dup2(fd,9);os.close(fd)
helper=Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py');assert hashlib.sha256(helper.read_bytes()).hexdigest()==b['holdHelperSha256']
def hold():return json.loads(subprocess.check_output(['/usr/bin/python3','-I','-S','-B',str(helper),'read',str(root.parent)],stderr=subprocess.DEVNULL,timeout=30))
assert hold()==b['hold'] and b['hold']['state']=='held'
known=json.loads(private(root/'known-five-stop.json'));assert known['holdGeneration']==b['hold']['generation'] and known['knownFiveStopped'] is True
xs=json.loads(subprocess.check_output(['/usr/bin/docker','--host','unix:///run/docker.sock','inspect',*b['expectedContainers']],stderr=subprocess.DEVNULL,timeout=30))
assert len(xs)==5
for x in xs:
 assert x['Id']==b['expectedContainers'][x['Name']]['id'] and not x['State']['Running'] and not x['State']['Restarting']
script=private(root/'sessions-after-stop.sh');pin=json.loads(private(root/'sessions-check-pins.json'))
assert hashlib.sha256(script).hexdigest()==pin['scriptSha256'] and pin['bindingSha256']==expected
r=subprocess.run(['/bin/bash','-s'],input=script,capture_output=True,timeout=90,pass_fds=(9,));assert r.returncode==0 and len(r.stdout)<16384
v=json.loads(r.stdout);assert v['role']['readonly']=='on' and v['clientSessions']==0 and v['hiddenSessions']==0
assert hold()==b['hold']
result={'knownFiveStopped':True,'otherDatabaseClientSessions':0,'hiddenSessions':0,'holdGeneration':b['hold']['generation'],'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'existing-owner-observed-client-sessions-zero','allExternalWritersFenced':False,'sessionObservation':v}
print(json.dumps(result))
