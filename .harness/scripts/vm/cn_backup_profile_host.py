"""Protected actual host capture + fixed canonical verifier; never writes profile.
Installation is a separately approved transaction. No caller-provided authority.
"""
import hashlib,json,os,pathlib,stat,subprocess
from cn_backup_profile import bind_backup_profile,ExistingTransportAuthority
from host_transport import private,SAFE_ENV
from writer_fence import require


def capture_file(path,mode):
 raw=private(path,int(mode,8));s=os.lstat(path)
 # private() checks ancestors, uid/gid/link/mode/nofollow actual descriptor.
 return dict(bytes=raw,uid=s.st_uid,gid=s.st_gid,mode=mode,links=s.st_nlink,
             regular=stat.S_ISREG(s.st_mode),symlink=stat.S_ISLNK(s.st_mode),parentsProtected=True)


class ProtectedCanonicalAuthority(ExistingTransportAuthority):
 def __init__(self,host_reference,existing,host):
  self.reference=host_reference;self.profile=existing;self.host=host
 def verify(self,host,configuration_bytes):
  require(host==self.host,'BACKUP_PROFILE_CAPTURE_DRIFT')
  runtime=host['connection']['runtime'];node=runtime['nodePath'];helper='/usr/local/lib/workspacex-cn/backup_profile_transport.cjs'
  require(node=='/usr/bin/node' and hashlib.sha256(private(node,0o755)).hexdigest()==runtime['nodeSha256'],'BACKUP_PROFILE_NODE_PIN')
  require(hashlib.sha256(private(helper,0o700)).hexdigest()==self.profile['installedFilesSha256'][helper],'BACKUP_PROFILE_CANONICAL_HELPER_PIN')
  result=subprocess.run([node,helper,'--protected-backup-profile',self.reference['path'],self.reference['sha256']],
   stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=SAFE_ENV,timeout=20,check=False)
  require(result.returncode==0 and len(result.stdout)<=65536,'BACKUP_PROFILE_CANONICAL_VERIFIER_FAILED')
  return json.loads(result.stdout)


def prepare_backup_profile(host_reference):
 require(os.geteuid()==0 and os.uname().sysname=='Linux','BACKUP_PROFILE_HOST_ENTRY')
 raw=private(host_reference['path']);require(hashlib.sha256(raw).hexdigest()==host_reference['sha256'],'BACKUP_PROFILE_HOST_SHA')
 host=json.loads(raw);existing=json.loads(private('/etc/workspacex-cn/trusted-tool-binding.json'))
 files={host_reference['path']:capture_file(host_reference['path'],'0600')}
 for ref in (host['roleApproval'],host['publicCapabilityApproval']):files[ref['path']]=capture_file(ref['path'],'0600')
 runtime=host['connection']['runtime'];files[runtime['nodePath']]=capture_file(runtime['nodePath'],'0755')
 for path in runtime['files']:files[path]=capture_file(path,'0644')
 for ref in (host['queryTable'],):files[ref['path']]=capture_file(ref['path'],'0700')
 for path in (host['connection']['helper']['path'],'/usr/local/lib/workspacex-cn/cn-maintenance-migrator.cjs'):
  files[path]=capture_file(path,'0700')
 cfg=host['connection']['transport']['workspacex']['configurationPath'];files[cfg]=capture_file(cfg,'0600')
 python=host['pythonRuntime'];require(__import__('re').fullmatch(r'/usr/bin/python3\.[0-9]+',python['path']),'BACKUP_PROFILE_PYTHON_PATH')
 require(hashlib.sha256(private(python['path'],0o755)).hexdigest()==python['sha256'],'BACKUP_PROFILE_PYTHON_PIN')
 watchdog='/usr/local/lib/workspacex-cn/cn_backup_watchdog.py'
 require(hashlib.sha256(private(watchdog,0o700)).hexdigest()==existing['installedFilesSha256'][watchdog],'BACKUP_PROFILE_WATCHDOG_PIN')
 bound=bind_backup_profile(existing,host_reference,files,ProtectedCanonicalAuthority(host_reference,existing,host))
 require('backupPythonRuntime' not in bound or bound['backupPythonRuntime']==python,'BACKUP_PROFILE_PYTHON_DRIFT');bound['backupPythonRuntime']=python
 return bound
