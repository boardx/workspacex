"""Pure trusted-tool profile schema, shared by producer and installer.
Receives exact Git-bound rows; has no filesystem, network or action capability.
"""
import re
VERIFIER_SOURCE='.harness/scripts/vm/cn-maintenance-recovery-evidence-verifier.py'
VERIFIER_TARGET='/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py'
EXECUTOR_SOURCE='.harness/scripts/vm/cn-production-recovery-executor.py'
EXECUTOR_TARGET='/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py'
def build_profile(tool,rows,runtime=None):
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
 return value
