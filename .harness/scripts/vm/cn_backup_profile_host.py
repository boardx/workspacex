"""Protected actual host capture + fixed canonical verifier; never writes profile.
Installation is a separately approved transaction. No caller-provided authority.
"""
import copy,hashlib,json,os,pathlib,re,stat,subprocess,sys
from types import SimpleNamespace
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


PROFILE='/etc/workspacex-cn/trusted-tool-binding.json'
SOURCE='.harness/scripts/vm/cn_backup_profile_host.py'
INSTALLED='/usr/local/lib/workspacex-cn/cn_backup_profile_host.py'
BINDING_KEYS=('backupHostPlan','backupRuntime','existingProductionTransport','backupPythonRuntime')

def reviewed_backup_identity(existing,host_reference,host,original_transport):
 """Independent root profile capability + retained original authority; no writes."""
 ref=getattr(original_transport,'reviewed_plan_ref',None)
 require(type(ref) is dict and set(ref)=={'path','sha256'} and type(ref['path']) is str and
         ref['path'].startswith('/etc/workspacex-cn/') and '..' not in pathlib.Path(ref['path']).parts and
         type(ref['sha256']) is str and re.fullmatch('[a-f0-9]{64}',ref['sha256']) and
         ref['sha256']==getattr(original_transport,'manifest_sha',None),'BACKUP_PROFILE_ORIGINAL_RAW_BINDING')
 raw=private(ref['path']);require(hashlib.sha256(raw).hexdigest()==ref['sha256'],'BACKUP_PROFILE_ORIGINAL_HASH')
 original=json.loads(raw)
 require(original.get('schemaVersion')==1 and original.get('mode')=='maintenance-all-writer-fence' and
         original.get('productionActionsAuthorized') is True and
         not any(k in original for k in ('runtimeSourcePlanSha256','controlSessions','diagnosticSessions')),
         'BACKUP_PROFILE_ORIGINAL_APPROVAL')
 identity=original.get('identity');plan=original_transport.plan
 require(type(identity) is dict and set(identity)=={'sourceRevision','baselineRevision','migrationPlanSha256','attemptId'} and
         identity==plan['identity'] and original.get('toolRevision')==plan['toolRevision']==existing['toolRevision'] and
         host.get('identity')==identity and host['backup']['identity']==identity and
         host['backup']['toolRevision']==existing['toolRevision'],'BACKUP_PROFILE_ORIGINAL_IDENTITY')
 source_sha=existing.get('filesSha256',{}).get(SOURCE)
 require(type(source_sha) is str and re.fullmatch('[a-f0-9]{64}',source_sha) and
         existing.get('installedFilesSha256',{}).get(INSTALLED)==source_sha and
         hashlib.sha256(private(INSTALLED,0o700)).hexdigest()==source_sha and
         hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()==source_sha,'BACKUP_PROFILE_BINDER_SOURCE_PIN')
 bound_ref=existing.get('backupHostPlan')
 require(bound_ref is None or bound_ref==host_reference,'BACKUP_PROFILE_EXISTING_AUTHORITY')
 if bound_ref is None:
  capability=existing.get('backupProfileBootstrap')
  require(type(capability) is dict and set(capability)=={'schemaVersion','sourcePath','sha256','originalHostPlan','backupHostPlan','allowedProfileKeys'} and
          capability['schemaVersion']==1 and capability['sourcePath']==SOURCE and capability['sha256']==source_sha and
          capability['originalHostPlan']==ref and capability['backupHostPlan']==host_reference and
          capability['allowedProfileKeys']==list(BINDING_KEYS),'BACKUP_PROFILE_BOOTSTRAP_CAPABILITY')
 return copy.deepcopy(identity)

def preserve_profile_scope(existing,bound):
 require(type(bound) is dict and set(bound)-set(existing)<=set(BINDING_KEYS) and
         set(existing)<=set(bound) and all(k in BINDING_KEYS or bound[k]==v for k,v in existing.items()),
         'BACKUP_PROFILE_OUTPUT_SCOPE')
 require(all(k not in existing or bound[k]==existing[k] for k in BINDING_KEYS),'BACKUP_PROFILE_EXISTING_BINDING_DRIFT')


def prepare_backup_profile(host_reference,*,original_transport):
 require(os.geteuid()==0 and os.uname().sysname=='Linux','BACKUP_PROFILE_HOST_ENTRY')
 raw=private(host_reference['path']);require(hashlib.sha256(raw).hexdigest()==host_reference['sha256'],'BACKUP_PROFILE_HOST_SHA')
 host=json.loads(raw);profile_raw=private(PROFILE);existing=json.loads(profile_raw)
 expected_identity=reviewed_backup_identity(existing,host_reference,host,original_transport)
 original_ref=copy.deepcopy(original_transport.reviewed_plan_ref);original_raw=private(original_ref['path'])
 require(hashlib.sha256(original_raw).hexdigest()==original_ref['sha256'],'BACKUP_PROFILE_ORIGINAL_HASH')
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
 bound=bind_backup_profile(existing,host_reference,files,ProtectedCanonicalAuthority(host_reference,existing,host),expected_identity=expected_identity)
 require('backupPythonRuntime' not in bound or bound['backupPythonRuntime']==python,'BACKUP_PROFILE_PYTHON_DRIFT');bound['backupPythonRuntime']=python
 preserve_profile_scope(existing,bound)
 require(private(PROFILE)==profile_raw and private(original_ref['path'])==original_raw and
         original_transport.reviewed_plan_ref==original_ref and original_transport.manifest_sha==original_ref['sha256'],
         'BACKUP_PROFILE_AUTHORITY_CHANGED')
 return bound

def main(argv=None):
 """Selected refs are data; only an existing protected capability admits them.
 This read-only authority is not a live HostTransport or production writer fence.
 """
 args=sys.argv[1:] if argv is None else argv
 require(os.geteuid()==0 and os.uname().sysname=='Linux','BACKUP_PROFILE_HOST_ENTRY')
 require(len(args)==5 and args[0]=='--prepare-backup-profile','BACKUP_PROFILE_ARGUMENTS')
 backup_ref={'path':args[1],'sha256':args[2]};original_ref={'path':args[3],'sha256':args[4]}
 for ref in (backup_ref,original_ref):
  require(type(ref['path']) is str and ref['path'].startswith('/etc/workspacex-cn/') and
          '..' not in pathlib.Path(ref['path']).parts and type(ref['sha256']) is str and
          re.fullmatch('[a-f0-9]{64}',ref['sha256']),'BACKUP_PROFILE_CLI_REFERENCE')
 profile_raw=private(PROFILE);profile=json.loads(profile_raw);capability=profile.get('backupProfileBootstrap')
 require(type(capability) is dict and capability.get('originalHostPlan')==original_ref and
         capability.get('backupHostPlan')==backup_ref,'BACKUP_PROFILE_CLI_CAPABILITY')
 original_raw=private(original_ref['path']);require(hashlib.sha256(original_raw).hexdigest()==original_ref['sha256'],'BACKUP_PROFILE_ORIGINAL_HASH')
 original=json.loads(original_raw)
 authority=SimpleNamespace(plan=original,manifest_sha=original_ref['sha256'],reviewed_plan_ref=original_ref)
 bound=prepare_backup_profile(backup_ref,original_transport=authority)
 require(private(PROFILE)==profile_raw and private(original_ref['path'])==original_raw,'BACKUP_PROFILE_AUTHORITY_CHANGED')
 print(json.dumps(bound,sort_keys=True))
 return 0

if __name__=='__main__':
 try:result=main()
 except BaseException:
  sys.stderr.write('BACKUP_PROFILE_PREPARATION_DENIED\n');sys.exit(1)
 sys.exit(result)
