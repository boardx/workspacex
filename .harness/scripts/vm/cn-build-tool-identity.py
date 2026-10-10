#!/usr/bin/env python3
"""Explicit build-only tool binding; never authorizes prepare or activation."""
import datetime,fcntl,hashlib,json,os,pathlib,re,stat,subprocess,sys,tempfile,uuid
FILES={
 '.harness/scripts/vm/clone_quiescence.py':'/usr/local/lib/workspacex-cn/clone_quiescence.py',
 '.harness/scripts/vm/clone_quiescence_adapter.py':'/usr/local/lib/workspacex-cn/clone_quiescence_adapter.py',
 '.harness/scripts/vm/clone_quiescence_engine.py':'/usr/local/lib/workspacex-cn/clone_quiescence_engine.py',
 '.harness/scripts/vm/clone_quiescence.sql':'/usr/local/lib/workspacex-cn/clone_quiescence.sql',
 '.agents/skills/workspacex-cn-release/scripts/validate_preflight.py':None,
 '.harness/scripts/vm/acceptance_receipt_producer.cjs':'/usr/local/lib/workspacex-cn/acceptance_receipt_producer.cjs',
 '.harness/scripts/vm/acceptance_receipt_store.py':'/usr/local/lib/workspacex-cn/acceptance_receipt_store.py',
 '.harness/scripts/vm/acceptance_source_closure.cjs':'/usr/local/lib/workspacex-cn/acceptance_source_closure.cjs',
 '.harness/scripts/vm/backup_connection.cjs':'/usr/local/lib/workspacex-cn/backup_connection.cjs',
 '.harness/scripts/vm/backup_profile_transport.cjs':'/usr/local/lib/workspacex-cn/backup_profile_transport.cjs',
 '.harness/scripts/vm/build-cn-candidate-compose-source.mjs':None,
 '.harness/scripts/vm/build-cn-release-candidate.sh':'/usr/local/bin/workspacex-cn-build-candidate',
 '.harness/scripts/vm/candidate_backend_collector.py':'/usr/local/lib/workspacex-cn/candidate_backend_collector.py',
 '.harness/scripts/vm/candidate_browser_acceptance.py':'/usr/local/lib/workspacex-cn/candidate_browser_acceptance.py',
 '.harness/scripts/vm/candidate_canonical_acceptance.py':'/usr/local/lib/workspacex-cn/candidate_canonical_acceptance.py',
 '.harness/scripts/vm/candidate_completion_contract.py':'/usr/local/lib/workspacex-cn/candidate_completion_contract.py',
 '.harness/scripts/vm/candidate_host_transport.py':'/usr/local/lib/workspacex-cn/candidate_host_transport.py',
 '.harness/scripts/vm/candidate_plan_producer.py':'/usr/local/lib/workspacex-cn/candidate_plan_producer.py',
 '.harness/scripts/vm/candidate_pointer_adapter.py':'/usr/local/lib/workspacex-cn/candidate_pointer_adapter.py',
 '.harness/scripts/vm/candidate_readonly_docker.py':'/usr/local/lib/workspacex-cn/candidate_readonly_docker.py',
 '.harness/scripts/vm/candidate_stage_actions.py':'/usr/local/lib/workspacex-cn/candidate_stage_actions.py',
 '.harness/scripts/vm/candidate_stage_host.py':'/usr/local/lib/workspacex-cn/candidate_stage_host.py',
 '.harness/scripts/vm/candidate_writer.py':'/usr/local/lib/workspacex-cn/candidate_writer.py',
 '.harness/scripts/vm/cn-backup-fixed-queries.json':'/usr/local/lib/workspacex-cn/cn-backup-fixed-queries.json',
 '.harness/scripts/vm/cn-baseline-schema-contract.cjs':'/usr/local/lib/workspacex-cn/cn-baseline-schema-contract.cjs',
 '.harness/scripts/vm/cn-bootstrap-baseline-source.mjs':'/usr/local/lib/workspacex-cn/cn-bootstrap-baseline-source.mjs',
 '.harness/scripts/vm/cn-bootstrap-baseline.cjs':'/usr/local/lib/workspacex-cn/cn-bootstrap-baseline.cjs',
 '.harness/scripts/vm/cn-bootstrap-source-probe.mjs':'/usr/local/lib/workspacex-cn/cn-bootstrap-source-probe.mjs',
 '.harness/scripts/vm/cn-build-tool-identity.py':'/usr/local/lib/workspacex-cn/cn-build-tool-identity.py',
 '.harness/scripts/vm/cn-candidate-compose-source.cjs':'/usr/local/lib/workspacex-cn/cn-candidate-compose-source.cjs',
 '.harness/scripts/vm/cn-candidate-compose-source.cjs.source-closure.json':None,
 '.harness/scripts/vm/cn-maintenance-activation.py':'/usr/local/lib/workspacex-cn/cn-maintenance-activation.py',
 '.harness/scripts/vm/cn-maintenance-browser.cjs':'/usr/local/lib/workspacex-cn/cn-maintenance-browser.cjs',
 '.harness/scripts/vm/cn-maintenance-canonical.cjs':'/usr/local/lib/workspacex-cn/cn-maintenance-canonical.cjs',
 '.harness/scripts/vm/cn-maintenance-drain.cjs':'/usr/local/lib/workspacex-cn/cn-maintenance-drain.cjs',
 '.harness/scripts/vm/cn-maintenance-host-controller.cjs':'/usr/local/lib/workspacex-cn/cn-maintenance-host-controller.cjs',
 '.harness/scripts/vm/cn-maintenance-host-launcher.py':'/usr/local/lib/workspacex-cn/cn-maintenance-host-launcher.py',
 '.harness/scripts/vm/cn-maintenance-migrator.cjs':'/usr/local/lib/workspacex-cn/cn-maintenance-migrator.cjs',
 '.harness/scripts/vm/cn-maintenance-recovery-evidence-verifier.py':'/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py',
 '.harness/scripts/vm/cn-migration-snapshot-query.cjs':'/usr/local/lib/workspacex-cn/cn-migration-snapshot-query.cjs',
 '.harness/scripts/vm/cn-production-rds-identity-probe.py':'/usr/local/lib/workspacex-cn/cn-production-rds-identity-probe.py',
 '.harness/scripts/vm/cn-production-recovery-catalog.cjs':'/usr/local/lib/workspacex-cn/cn-production-recovery-catalog.cjs',
 '.harness/scripts/vm/cn-production-recovery-executor.py':'/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py',
 '.harness/scripts/vm/cn-production-recovery-fidelity.cjs':'/usr/local/lib/workspacex-cn/cn-production-recovery-fidelity.cjs',
 '.harness/scripts/vm/cn-production-recovery-readback.cjs':'/usr/local/lib/workspacex-cn/cn-production-recovery-readback.cjs',
 '.harness/scripts/vm/cn-release-orphans.py':'/usr/local/lib/workspacex-cn/cn-release-orphans.py',
 '.harness/scripts/vm/cn-release-preflight-evidence.mjs':'/usr/local/lib/workspacex-cn/cn-release-preflight-evidence.mjs',
 '.harness/scripts/vm/cn-tool-install-transaction.py':'/usr/local/lib/workspacex-cn/cn-tool-install-transaction.py',
 '.harness/scripts/vm/cn_backup_backend.py':'/usr/local/lib/workspacex-cn/cn_backup_backend.py',
 '.harness/scripts/vm/cn_backup_channel.py':'/usr/local/lib/workspacex-cn/cn_backup_channel.py',
 '.harness/scripts/vm/cn_backup_host.py':'/usr/local/lib/workspacex-cn/cn_backup_host.py',
 '.harness/scripts/vm/cn_backup_package.py':'/usr/local/lib/workspacex-cn/cn_backup_package.py',
 '.harness/scripts/vm/cn_backup_profile.py':'/usr/local/lib/workspacex-cn/cn_backup_profile.py',
 '.harness/scripts/vm/cn_backup_profile_host.py':'/usr/local/lib/workspacex-cn/cn_backup_profile_host.py',
 '.harness/scripts/vm/cn_backup_run.py':'/usr/local/lib/workspacex-cn/cn_backup_run.py',
 '.harness/scripts/vm/cn_backup_sql.py':'/usr/local/lib/workspacex-cn/cn_backup_sql.py',
 '.harness/scripts/vm/cn_backup_stream.py':'/usr/local/lib/workspacex-cn/cn_backup_stream.py',
 '.harness/scripts/vm/cn_backup_watchdog.py':'/usr/local/lib/workspacex-cn/cn_backup_watchdog.py',
 '.harness/scripts/vm/cn_maintenance_admission.py':'/usr/local/lib/workspacex-cn/cn_maintenance_admission.py',
 '.harness/scripts/vm/cn_maintenance_hold.py':'/usr/local/lib/workspacex-cn/cn_maintenance_hold.py',
 '.harness/scripts/vm/cn_object_inventory/inventory.py':None,
 '.harness/scripts/vm/cn_object_inventory/runtime_audit.py':None,
 '.harness/scripts/vm/cn_object_inventory/source_audit.py':None,
 '.harness/scripts/vm/cn_production_recovery_executor.py':'/usr/local/lib/workspacex-cn/cn_production_recovery_executor.py',
 '.harness/scripts/vm/cn_production_recovery_stream.py':'/usr/local/lib/workspacex-cn/cn_production_recovery_stream.py',
 '.harness/scripts/vm/cn_production_recovery_transport.py':'/usr/local/lib/workspacex-cn/cn_production_recovery_transport.py',
 '.harness/scripts/vm/cn_tool_profile.py':'/usr/local/lib/workspacex-cn/cn_tool_profile.py',
 '.harness/scripts/vm/collect-cn-migration-snapshot.py':'/usr/local/lib/workspacex-cn/collect-cn-migration-snapshot.py',
 '.harness/scripts/vm/collect-cn-release-preflight.sh':'/usr/local/lib/workspacex-cn/collect-cn-release-preflight.sh',
 '.harness/scripts/vm/concretize_candidate_template.py':'/usr/local/lib/workspacex-cn/concretize_candidate_template.py',
 '.harness/scripts/vm/control_connection.cjs':'/usr/local/lib/workspacex-cn/control_connection.cjs',
 '.harness/scripts/vm/control_connection.py':'/usr/local/lib/workspacex-cn/control_connection.py',
 '.harness/scripts/vm/current_epoch_qualification.py':'/usr/local/lib/workspacex-cn/current_epoch_qualification.py',
 '.harness/scripts/vm/current_held_epoch_evidence_producer.py':'/usr/local/lib/workspacex-cn/current_held_epoch_evidence_producer.py',
 '.harness/scripts/vm/deploy-cn-production.sh':'/usr/local/bin/workspacex-cn-deploy',
 '.harness/scripts/vm/fixed_probes.py':'/usr/local/lib/workspacex-cn/fixed_probes.py',
 '.harness/scripts/vm/held_candidate_expected.cjs':'/usr/local/lib/workspacex-cn/held_candidate_expected.cjs',
 '.harness/scripts/vm/held_candidate_expected_producer.cjs':'/usr/local/lib/workspacex-cn/held_candidate_expected_producer.cjs',
 '.harness/scripts/vm/held_candidate_queries.cjs':'/usr/local/lib/workspacex-cn/held_candidate_queries.cjs',
 '.harness/scripts/vm/host_transport.py':'/usr/local/lib/workspacex-cn/host_transport.py',
 '.harness/scripts/vm/isolated_canonical_plan_factory.py':'/usr/local/lib/workspacex-cn/isolated_canonical_plan_factory.py',
 '.harness/scripts/vm/isolated_conservation_evidence_producer.py':'/usr/local/lib/workspacex-cn/isolated_conservation_evidence_producer.py',
 '.harness/scripts/vm/isolated_conservation_inputs.py':'/usr/local/lib/workspacex-cn/isolated_conservation_inputs.py',
 '.harness/scripts/vm/isolated_conservation_plan.py':'/usr/local/lib/workspacex-cn/isolated_conservation_plan.py',
 '.harness/scripts/vm/isolated_conservation_stage.py':'/usr/local/lib/workspacex-cn/isolated_conservation_stage.py',
 '.harness/scripts/vm/isolated_rehearsal.py':'/usr/local/lib/workspacex-cn/isolated_rehearsal.py',
 '.harness/scripts/vm/maintenance_source_operations.py':'/usr/local/lib/workspacex-cn/maintenance_source_operations.py',
 '.harness/scripts/vm/opened_host_evidence.py':'/usr/local/lib/workspacex-cn/opened_host_evidence.py',
 '.harness/scripts/vm/opened_service_health.py':'/usr/local/lib/workspacex-cn/opened_service_health.py',
 '.harness/scripts/vm/parent_source_invocation_receipt.py':'/usr/local/lib/workspacex-cn/parent_source_invocation_receipt.py',
 '.harness/scripts/vm/prepare-cn-tool-install.py':'/usr/local/lib/workspacex-cn/prepare-cn-tool-install.py',
 '.harness/scripts/vm/publish-cn-release.sh':'/usr/local/lib/workspacex-cn/publish-cn-release.sh',
 '.harness/scripts/vm/retained_backend_observer.py':'/usr/local/lib/workspacex-cn/retained_backend_observer.py',
 '.harness/scripts/vm/retained_backup_helper.cjs':'/usr/local/lib/workspacex-cn/retained_backup_helper.cjs',
 '.harness/scripts/vm/retained_backup_host.py':'/usr/local/lib/workspacex-cn/retained_backup_host.py',
 '.harness/scripts/vm/retained_epoch_acquisition.py':'/usr/local/lib/workspacex-cn/retained_epoch_acquisition.py',
 '.harness/scripts/vm/retained_epoch_capture.py':'/usr/local/lib/workspacex-cn/retained_epoch_capture.py',
 '.harness/scripts/vm/source_invocation_receipt.py':'/usr/local/lib/workspacex-cn/source_invocation_receipt.py',
 '.harness/scripts/vm/verify-cn-release-preflight.sh':'/usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh',
 '.harness/scripts/vm/writer_fence.py':'/usr/local/lib/workspacex-cn/writer_fence.py',
 'packages/cloud-deploy/src/cn-candidate-compose-source-cli.ts':None,
 'packages/cloud-deploy/src/cn-candidate-compose-source.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/a_route.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/a_route_adapter.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/a_route_factory.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/acceptance_contract.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/activation_transport.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/controller.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/current_epoch_manifest_consumer.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/dynamic_gate.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/entry.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/fixed_public_json_reader.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/fixed_transport.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/migration_library.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/migration_snapshot_query.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/migration_transport.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/native_completion.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/offline_artifacts.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/pinned-app-9b/migration-pg.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/pinned-app-9b/migrator.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/pinned-app-9b/pg-config.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/production_consumers.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/production_factory.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/public_acceptance.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/public_observation_transport.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/recovery_audit.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/reused_actions.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/sealed_runtime.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/source_production_consumers.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority.ts':None,
 'packages/cloud-deploy/src/cn-maintenance-host/release_identity.ts':None,
 '.harness/scripts/cn-maintenance-release-identities.json':None,
 '.harness/scripts/generate-cn-maintenance-identities.py':None,
 'packages/cloud-deploy/src/cn-maintenance-host/typed_operations.ts':None,
 'packages/cloud-deploy/src/cn-migration-completion-cli.ts':None,
 'packages/cloud-deploy/src/cn-migration-completion.ts':None,
}
def require(value,code):
 if not value:raise ValueError(code)
def private_read(path,mode=None):
 p=pathlib.Path(path)
 for parent in p.parents:
  s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'TOOL_PARENT_TRUST')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());require(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o022 and (mode is None or stat.S_IMODE(s.st_mode)==mode),'TOOL_FILE_TRUST')
  raw=f.read();a=os.fstat(f.fileno());require((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns),'TOOL_FILE_CHANGED');return raw
def trust_git_root(root,bare,expected_uid=0,boundary=None):
 root=pathlib.Path(root)
 for p in (root,*root.parents):
  if boundary is not None and p==pathlib.Path(boundary).parent:break
  st=p.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==expected_uid and not st.st_mode&0o022,'GIT_ROOT_TRUST')
 gitdir=root if bare else root/'.git'
 st=gitdir.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==expected_uid and not st.st_mode&0o022,'GIT_DIRECTORY_REQUIRED')
 for name in ('commondir','gitdir','objects/info/alternates'):
  require(not os.path.lexists(gitdir/name),'GIT_EXTERNAL_DIRECTORY')
 for name in ('objects','refs'):
  st=(gitdir/name).lstat();require(stat.S_ISDIR(st.st_mode),'GIT_CLOSURE_DIRECTORY')
 for directory,dirs,files in os.walk(gitdir,followlinks=False):
  for name in dirs+files:
   path=pathlib.Path(directory)/name;st=path.lstat()
   require(st.st_uid==expected_uid and not st.st_mode&0o022 and (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)),'GIT_MEMBER_TRUST')
   if stat.S_ISREG(st.st_mode):require(st.st_nlink==1,'GIT_MEMBER_HARDLINK')
 for name in ('config','HEAD'):
  st=(gitdir/name).lstat();require(stat.S_ISREG(st.st_mode) and st.st_uid==expected_uid and st.st_nlink==1 and not st.st_mode&0o022,'GIT_IDENTITY_FILE_TRUST')
 fd=os.open(gitdir/'config',os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:config=f.read()
 require(not re.search(rb'^\s*\[(?:include(?:if)?|filter)[\s\]]',config,re.M|re.I),'GIT_CONFIG_INCLUDE')
 return gitdir
GIT_OPTIONS=['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.untrackedCache=false','-c','gc.auto=0']
def validate_full_prebuild(validator,prebuild_raw,validated_raw,artifact_only=False):
 # Execute the exact already hash-bound tool validator, not a second gate implementation.
 namespace={'__name__':'reviewed_preflight_validator','__file__':str(validator)}
 exec(compile(private_read(validator).decode(),str(validator),'exec'),namespace)
 result=namespace['validate'](json.loads(prebuild_raw));stored=json.loads(validated_raw)
 require(result==stored and result.get('schemaVersion')==2 and result.get('phase')==('artifact-build' if artifact_only else 'prebuild') and result.get('ready') is True and result.get('blockers')==[],'FULL_PREBUILD_VALIDATION')
 return result

def atomic_receipt(output,result):
 output=pathlib.Path(output);parent=output.parent
 for d in (parent,*parent.parents):
  st=d.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'RECEIPT_PARENT_TRUST')
 raw=(json.dumps(result,sort_keys=True)+'\n').encode()
 def sync_parent():
  directory=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:os.fsync(directory)
  finally:os.close(directory)
 if os.path.lexists(output):
  require(private_read(output,0o600)==raw,'RECEIPT_EXISTING_DIFFERENT')
  sync_parent();return hashlib.sha256(raw).hexdigest()
 temporary=parent/('.build-only.'+uuid.uuid4().hex+'.tmp')
 fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);identity=os.fstat(fd);linked=False
 try:
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  try:os.link(temporary,output,follow_symlinks=False);linked=True
  except FileExistsError:
   require(private_read(output,0o600)==raw,'RECEIPT_EXISTING_DIFFERENT')
  sync_parent()
  temporary.unlink()
  require(private_read(output,0o600)==raw,'RECEIPT_READBACK')
 except BaseException:
  if linked:
   try:
    st=output.lstat();require((st.st_dev,st.st_ino)==(identity.st_dev,identity.st_ino),'RECEIPT_FINAL_CHANGED')
    output.unlink();sync_parent()
    require(not os.path.lexists(output),'RECEIPT_FINAL_REMAINS')
   except BaseException:
    exists=os.path.lexists(output)
    print('RECEIPT_CLEANUP_UNPROVEN finalExists='+str(exists).lower(),file=sys.stderr)
    raise ValueError('RECEIPT_CLEANUP_UNPROVEN') from None
  raise
 finally:
  if os.path.lexists(temporary):
   st=temporary.lstat()
   if (st.st_dev,st.st_ino)==(identity.st_dev,identity.st_ino):temporary.unlink()
 return hashlib.sha256(raw).hexdigest()
def validate_identity(value,app,release,attempt,phase):
 require(phase=='prebuild','BUILD_ONLY_PHASE')
 require(value.get('schemaVersion')==1 and value.get('mode')=='build-only','BUILD_ONLY_MANIFEST')
 require(value.get('applicationRevision')==app and value.get('release')==release and value.get('attemptId')==attempt,'APPLICATION_BINDING')
 tool=value.get('toolRevision');require(isinstance(tool,str) and re.fullmatch('[a-f0-9]{40}',tool),'TOOL_REVISION')
 require(value.get('toolRoot')=='/opt/workspacex-cn/release-tools/'+tool,'TOOL_ROOT')
 require(set(value.get('filesSha256',{}))==set(FILES),'TOOL_CLOSURE')
 source=value.get('applicationSource',{})
 require(source.get('path')=='/var/lib/workspacex-cn/build-sources/'+app+'.git' and source.get('ref')=='refs/heads/candidate','APPLICATION_SOURCE_PATH')
 require(re.fullmatch('[a-f0-9]{40}',source.get('treeSha','')) and re.fullmatch('[a-f0-9]{64}',source.get('inventorySha256','')),'APPLICATION_OBJECT_IDENTITIES')
 return value['toolRoot']
def verify_completion_checkout(checkout,app,expected_uid=0,boundary=None):
 trust_git_root(checkout,False,expected_uid,boundary)
 env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_LAZY_FETCH':'1','GIT_NO_REPLACE_OBJECTS':'1','GIT_TERMINAL_PROMPT':'0'}
 def git(*args):return subprocess.check_output(['git',*GIT_OPTIONS,'-C',str(checkout),*args],env=env,stderr=subprocess.DEVNULL)
 require(git('rev-parse','HEAD').decode().strip()==app,'COMPLETION_CHECKOUT_REVISION')
 git('fsck','--full','--no-reflogs')
 entries=git('ls-tree','-r','-z',app).split(b'\0')
 for entry in entries:
  if not entry:continue
  metadata,name=entry.split(b'\t',1);mode,kind,blob=metadata.split();relative=name.decode()
  require(mode in (b'100644',b'100755') and kind==b'blob' and not pathlib.PurePosixPath(relative).is_absolute() and '..' not in pathlib.PurePosixPath(relative).parts,'COMPLETION_SOURCE_TYPE')
  target=pathlib.Path(checkout)/relative
  for parent in target.parents:
   st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==expected_uid and not st.st_mode&0o022,'COMPLETION_SOURCE_PARENT')
   if parent==pathlib.Path(checkout):break
  fd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb') as f:
   before=os.fstat(f.fileno());require(stat.S_ISREG(before.st_mode) and before.st_uid==expected_uid and before.st_nlink==1 and not before.st_mode&0o022,'COMPLETION_SOURCE_TRUST')
   digest=hashlib.sha1(('blob '+str(before.st_size)+'\0').encode())
   while True:
    chunk=f.read(1024*1024)
    if not chunk:break
    digest.update(chunk)
   after=os.fstat(f.fileno());named=target.lstat()
   require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns) and (named.st_dev,named.st_ino)==(before.st_dev,before.st_ino) and digest.hexdigest()==blob.decode(),'COMPLETION_SOURCE_CHANGED')
 require(not git('status','--porcelain'),'COMPLETION_CHECKOUT_DIRTY')
 return str(checkout)
def validate_operational_identity(value,app,release,attempt,phase):
 require(phase=='preactivate' and value.get('schemaVersion')==1 and value.get('mode')=='operational-preactivate','OPERATIONAL_DYNAMIC_ONLY')
 require(re.fullmatch('[a-f0-9]{40}',value.get('baselineRevision','')),'OPERATIONAL_BASELINE')
 for key in ('sealSha256','manifestSha256','prebuildSha256'):
  require(re.fullmatch('[a-f0-9]{64}',value.get(key,'')),'OPERATIONAL_LINEAGE_HASH')
 normalized=dict(value,mode='build-only')
 return validate_identity(normalized,app,release,attempt,'prebuild')
def validate_maintenance_identity(value,app,release,attempt,phase):
 require(phase=='preactivate' and value.get('mode')=='maintenance-operational-preactivate','MAINTENANCE_DYNAMIC_ONLY')
 # Admission module is imported only AFTER its complete source/installed hash
 # verification in main; hold/opt-in/recovery validation runs at that boundary.
 return validate_operational_identity(dict(value,mode='operational-preactivate'),app,release,attempt,phase)
def verify_operational_lineage(value,manifest_raw,seal_raw,prior_raw):
 for key,raw in (('sealSha256',seal_raw),('manifestSha256',manifest_raw),('prebuildSha256',prior_raw)):
  require(hashlib.sha256(raw).hexdigest()==value[key],'OPERATIONAL_LINEAGE_DRIFT')
 manifest=json.loads(manifest_raw);seal=json.loads(seal_raw);prior=json.loads(prior_raw)
 require(manifest.get('sourceRevision')==value['applicationRevision'] and manifest.get('release')==value['release'] and seal.get('schemaVersion')==1 and seal.get('status')=='sealed' and seal.get('sourceRevision')==value['applicationRevision'] and seal.get('manifestSha256')==value['manifestSha256'],'OPERATIONAL_SEALED_APPLICATION')
 require(prior.get('schemaVersion')==2 and prior.get('phase')=='prebuild' and prior.get('sourceSha')==value['applicationRevision'] and prior.get('baselineSha')==value['baselineRevision'] and prior.get('release')==value['release'] and prior.get('attemptId')==value['attemptId'],'OPERATIONAL_PREBUILD_LINEAGE')
def sealed_receipt(binding,manifest_raw,seal_raw,prebuild_raw,inspect,validate_prebuild):
 manifest=json.loads(manifest_raw);seal=json.loads(seal_raw);prebuild=json.loads(prebuild_raw)
 app=binding['applicationRevision']
 require(manifest.get('sourceRevision')==app and manifest.get('release')==binding['release'],'MANIFEST_APPLICATION_IDENTITY')
 require(seal.get('schemaVersion')==1 and seal.get('status')=='sealed' and seal.get('sourceRevision')==app and seal.get('manifestSha256')==hashlib.sha256(manifest_raw).hexdigest(),'SEAL_BINDING')
 full=validate_prebuild(prebuild_raw)
 require(full.get('ready') is True and full.get('blockers')==[] and full.get('schemaVersion')==2,'FULL_PREBUILD_VALIDATION')
 require(full.get('phase')=='artifact-build' and full.get('sourceSha')==app and full.get('release')==binding['release'] and full.get('attemptId')==binding['attemptId'],'PREBUILD_IDENTITY')
 require(set(manifest.get('images',{}))=={'web','api','agent','sandbox','postgres','redis'},'SEALED_SERVICE_CLOSURE')
 digests={}
 for service,artifact in manifest['images'].items():
  image=artifact.get('image','');match=re.fullmatch(r'[a-z0-9][a-z0-9./:_-]*@(sha256:[a-f0-9]{64})',image)
  require(match,'IMMUTABLE_IMAGE_REQUIRED')
  actual=re.search(r'^Digest:\s+(sha256:[a-f0-9]{64})\s*$',inspect(image),re.M)
  require(actual and actual.group(1)==match.group(1),'REGISTRY_DIGEST_MISMATCH');digests[service]=image
 return {'schemaVersion':1,'mode':'build-only','applicationRevision':app,'toolRevision':binding['toolRevision'],'release':binding['release'],'attemptId':binding['attemptId'],'filesSha256':binding['filesSha256'],'applicationSource':binding['applicationSource'],'manifestSha256':hashlib.sha256(manifest_raw).hexdigest(),'sealSha256':hashlib.sha256(seal_raw).hexdigest(),'prebuildSha256':hashlib.sha256(prebuild_raw).hexdigest(),'images':digests,'registryReadbackVerified':True,'prepared':False,'productionActivated':False,'ready':False}

def build_checkout(binding,app,attempt,create=False,*,base='/var/lib/workspacex-cn/build-checkouts',expected_uid=0,boundary=None):
 """Fixed derived checkout only; CLI never accepts a checkout path or test boundary.
 Caller has verified the protected binding and complete tool/installed closure.
 Independent protected main pin is checked against the complete offline cache.
 """
 require(re.fullmatch('[a-f0-9]{40}',app) and re.fullmatch('[a-z0-9][a-z0-9._-]{0,127}',attempt),'BUILD_CHECKOUT_ARGUMENTS')
 source=binding['applicationSource'];cache=pathlib.Path(source['path'])
 expected_cache=(pathlib.Path(boundary)/'build-sources' if boundary is not None else pathlib.Path('/var/lib/workspacex-cn/build-sources'))/(app+'.git')
 require(cache==expected_cache,'BUILD_CACHE_PATH')
 expected_base=str(pathlib.Path(boundary)/'build-checkouts') if boundary is not None else '/var/lib/workspacex-cn/build-checkouts'
 require(str(base)==expected_base,'BUILD_CHECKOUT_PATH')
 trust_git_root(cache,True,expected_uid,boundary)
 env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_LAZY_FETCH':'1','GIT_NO_REPLACE_OBJECTS':'1','GIT_TERMINAL_PROMPT':'0'}
 def git(root,*args):return subprocess.check_output(['/usr/bin/git',*GIT_OPTIONS,'-C',str(root),*args],env=env,stderr=subprocess.DEVNULL)
 require(git(cache,'rev-parse','--is-bare-repository').strip()==b'true','BUILD_CACHE_BARE')
 require(source.get('ref')=='refs/heads/candidate' and git(cache,'rev-parse',source['ref']+'^{commit}').decode().strip()==app,'BUILD_CACHE_CANDIDATE')
 require(git(cache,'rev-parse',app+'^{tree}').decode().strip()==source['treeSha'] and hashlib.sha256(git(cache,'ls-tree','-r','-z',app)).hexdigest()==source['inventorySha256'],'BUILD_CACHE_HASH')
 require(not os.path.lexists(cache/'shallow') and not list((cache/'objects/pack').glob('*.promisor')),'BUILD_CACHE_INCOMPLETE')
 partial=subprocess.run(['/usr/bin/git',*GIT_OPTIONS,'-C',str(cache),'config','--local','--get-regexp','remote\\..*\\.promisor|extensions\\.partialclone'],env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 require(partial.returncode==1 and not partial.stdout,'BUILD_CACHE_PARTIAL')
 git(cache,'fsck','--full','--no-reflogs')
 main=binding.get('mainSource')
 require(type(main) is dict and set(main)=={'ref','revision','repository'} and main['repository'] in (str(cache),binding.get('toolRoot')) and main['ref']==('refs/heads/main' if main['repository']==str(cache) else 'refs/remotes/origin/main') and type(main['revision']) is str and re.fullmatch('[a-f0-9]{40}',main['revision']),'BUILD_MAIN_AUTHORITY_REQUIRED')
 main_repo=pathlib.Path(main['repository']);main_bare=main_repo==cache
 trust_git_root(main_repo,main_bare,expected_uid,boundary)
 main_gitdir=main_repo if main_bare else main_repo/'.git'
 require(not os.path.lexists(main_gitdir/'shallow') and not list((main_gitdir/'objects/pack').glob('*.promisor')),'BUILD_MAIN_INCOMPLETE')
 main_partial=subprocess.run(['/usr/bin/git',*GIT_OPTIONS,'-C',str(main_repo),'config','--local','--get-regexp','remote\\..*\\.promisor|extensions\\.partialclone'],env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 require(main_partial.returncode==1 and not main_partial.stdout,'BUILD_MAIN_PARTIAL')
 git(main_repo,'fsck','--full','--no-reflogs')
 require(git(main_repo,'rev-parse',main['ref']+'^{commit}').decode().strip()==main['revision'],'BUILD_MAIN_REF_DRIFT')
 git(main_repo,'merge-base','--is-ancestor',app,main['revision'])
 base=pathlib.Path(base);checkout=base/app/attempt
 # All ancestors must already be protected; only owned derived directories are created.
 def protected_dir(path):
  s=path.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==expected_uid and not s.st_mode&0o022,'BUILD_CHECKOUT_PARENT_TRUST')
 ancestors=list(base.parents)
 for parent in ancestors:
  if boundary is not None and parent==pathlib.Path(boundary).parent:break
  protected_dir(parent)
 for directory in (base,base/app):
  if not os.path.lexists(directory):
   require(create,'BUILD_CHECKOUT_MISSING');directory.mkdir(mode=0o700)
  protected_dir(directory)
 if not os.path.lexists(checkout):
  require(create,'BUILD_CHECKOUT_MISSING')
  # Clone into a new leaf without borrowing/shared objects; never reset/clean an existing tree.
  subprocess.check_output(['/usr/bin/git',*GIT_OPTIONS,'clone','--no-local','--no-hardlinks','--no-checkout','--branch','candidate',str(cache),str(checkout)],env=env,stderr=subprocess.DEVNULL)
  git(checkout,'checkout','--quiet','--detach',app)
 trust_git_root(checkout,False,expected_uid,boundary)
 require(git(checkout,'rev-parse','--show-toplevel').decode().strip()==str(checkout),'BUILD_CHECKOUT_WORKTREE')
 require(git(checkout,'rev-parse','HEAD').decode().strip()==app and not git(checkout,'status','--porcelain'),'BUILD_CHECKOUT_IDENTITY')
 require(git(checkout,'rev-parse','refs/remotes/origin/candidate^{commit}').decode().strip()==app,'BUILD_CHECKOUT_CANDIDATE_REF')
 git(checkout,'fsck','--full','--no-reflogs')
 return str(checkout)

def main():
 completion_mode=len(sys.argv)>1 and sys.argv[1]=='--completion-checkout'
 receipt_mode=len(sys.argv)>1 and sys.argv[1]=='--receipt'
 checkout_mode=len(sys.argv)>1 and sys.argv[1] in ('--build-checkout','--verify-build-checkout')
 source_mode=len(sys.argv)>1 and sys.argv[1] in ('--source','--operational-source','--maintenance-source')
 maintenance_mode=len(sys.argv)>1 and sys.argv[1] in ('--maintenance','--maintenance-source')
 operational_mode=len(sys.argv)>1 and sys.argv[1] in ('--operational','--operational-source')
 args=sys.argv[2:] if receipt_mode or source_mode or operational_mode or maintenance_mode or checkout_mode else sys.argv[1:]
 if completion_mode:
  require(len(sys.argv)==4 and re.fullmatch('[a-f0-9]{40}',sys.argv[2]) and re.fullmatch('[a-zA-Z0-9-]{1,128}',sys.argv[3]),'COMPLETION_ARGUMENTS')
  completion_app,completion_attempt=sys.argv[2:]
  completion_binding='/etc/workspacex-cn/operational-bindings/'+completion_app+'/'+completion_attempt+'/preactivate.json'
  completion_value=json.loads(private_read(completion_binding,0o600))
  args=[completion_binding,completion_app,completion_value.get('release'),completion_attempt,'preactivate'];operational_mode=True

 require(os.geteuid()==0 and len(args)==(9 if receipt_mode else 5),'ROOT_ARGUMENTS')
 path,app,release,attempt,phase=args[:5];value=json.loads(private_read(path,0o600));root=(validate_maintenance_identity if maintenance_mode else validate_operational_identity if operational_mode else validate_identity)(value,app,release,attempt,phase)
 env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_LAZY_FETCH':'1','GIT_NO_REPLACE_OBJECTS':'1','GIT_TERMINAL_PROMPT':'0'}
 trust_git_root(root,False)
 source=value['applicationSource'];repo=pathlib.Path(source['path']);trust_git_root(repo,True)
 def git(*args):return subprocess.check_output(['git',*GIT_OPTIONS,'-C',root,*args],env=env,stderr=subprocess.DEVNULL)
 require(git('rev-parse','HEAD').decode().strip()==value['toolRevision'] and not git('status','--porcelain'),'TOOL_HEAD_DIRTY')
 for name,installed in FILES.items():
  raw=private_read(pathlib.Path(root)/name);actual=hashlib.sha256(raw).hexdigest()
  require(actual==value['filesSha256'][name] and raw==git('show',value['toolRevision']+':'+name),'TOOL_OBJECT_DRIFT')
  if installed:require(private_read(installed)==raw,'INSTALLED_TOOL_DRIFT')
 for d in (repo,*repo.parents):
  st=d.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'APPLICATION_CACHE_TRUST')
 require(not (repo/'objects/info/alternates').exists() and not list((repo/'objects/pack').glob('*.promisor')),'APPLICATION_BORROWED_OBJECTS')
 def source_git(*args):return subprocess.check_output(['git',*GIT_OPTIONS,'-C',str(repo),*args],env=env,stderr=subprocess.DEVNULL)
 require(source_git('rev-parse','--is-bare-repository').strip()==b'true' and source_git('rev-parse',source['ref']+'^{commit}').decode().strip()==app and source_git('rev-parse',app+'^{tree}').decode().strip()==source['treeSha'],'APPLICATION_SOURCE_IDENTITY')
 config=subprocess.run(['git',*GIT_OPTIONS,'-C',str(repo),'config','--local','--get-regexp','remote\\..*\\.promisor|extensions\\.partialclone'],env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 require(config.returncode==1 and not config.stdout,'APPLICATION_PARTIAL_CONFIG')
 source_git('fsck','--full','--no-reflogs')
 require(hashlib.sha256(source_git('ls-tree','-r','-z',app)).hexdigest()==source['inventorySha256'],'APPLICATION_INVENTORY_DRIFT')
 if checkout_mode:
  from cn_maintenance_hold import require_canonical_lock
  require_canonical_lock()
  print(build_checkout(value,app,attempt,create=sys.argv[1]=='--build-checkout'));return
 if completion_mode:
  from cn_maintenance_hold import require_canonical_lock
  require_canonical_lock()
  print(verify_completion_checkout('/var/lib/workspacex-cn/releases/'+app,app));return
 if operational_mode or maintenance_mode:
  expected='/etc/workspacex-cn/'+('maintenance-bindings/' if maintenance_mode else 'operational-bindings/')+app+'/'+attempt+'/preactivate.json'
  require(path==expected,'OPERATIONAL_FIXED_PATH')
  if maintenance_mode:
   from cn_maintenance_admission import admit
   admit(value,private_read=private_read,source_read=lambda name:git('show',value['toolRevision']+':'+name))
  else:
   subprocess.check_output(['python3','/usr/local/lib/workspacex-cn/cn_maintenance_hold.py','admit','/var/lib/workspacex-cn/runtime'],pass_fds=(9,),stderr=subprocess.DEVNULL)
  compose=subprocess.check_output(['docker','inspect','--format','{{index .Config.Labels "com.docker.compose.project.config_files"}}','workspacex-cn-api-1'],stderr=subprocess.DEVNULL).decode().strip()
  require(compose=='/var/lib/workspacex-cn/runtime/'+value['baselineRevision']+'/compose.json','OPERATIONAL_ACTUAL_BASELINE')
  manifest='/etc/workspacex-cn/releases/'+app+'.json';seal='/etc/workspacex-cn/releases/'+app+'.sealed.json'
  prebuild='/var/lib/workspacex-cn/preflight-receipts/'+app+'/'+attempt+'/prebuild.json'
  prior_raw=private_read(prebuild,0o600)
  verify_operational_lineage(value,private_read(manifest),private_read(seal),prior_raw)
  validate_full_prebuild(pathlib.Path(root)/'.agents/skills/workspacex-cn-release/scripts/validate_preflight.py',prior_raw,private_read(pathlib.Path(prebuild).with_name('prebuild.validated.json'),0o600))
 if receipt_mode:
  lock='/var/lib/workspacex-cn/runtime/release.lock'
  require(os.readlink('/proc/'+str(os.getppid())+'/fd/9')==lock,'CANONICAL_LOCK_FD')
  fd=os.open(lock,os.O_WRONLY|os.O_NOFOLLOW)
  try:
   try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:pass
   else:raise ValueError('CANONICAL_LOCK_NOT_HELD')
  finally:os.close(fd)
  manifest,seal,prebuild,output=args[5:]
  require(prebuild=='/var/lib/workspacex-cn/preflight-receipts/'+app+'/'+attempt+'/artifact-build.json','ARTIFACT_RECEIPT_FIXED_PATH')
  validated=str(pathlib.Path(prebuild).with_name('artifact-build.validated.json'))
  prebuild_raw=private_read(prebuild,0o600);validated_raw=private_read(validated,0o600)
  def validate_bound(raw):return validate_full_prebuild(pathlib.Path(root)/'.agents/skills/workspacex-cn-release/scripts/validate_preflight.py',raw,validated_raw,artifact_only=True)
  def inspect(image):return subprocess.check_output(['docker','buildx','imagetools','inspect',image],stderr=subprocess.DEVNULL,timeout=30).decode()
  result=sealed_receipt(value,private_read(manifest),private_read(seal),prebuild_raw,inspect,validate_bound)
  result['toolBindingSha256']=hashlib.sha256(private_read(path,0o600)).hexdigest()
  result['validatedPrebuildSha256']=hashlib.sha256(validated_raw).hexdigest()
  result['prebuildReceiptSha256']=json.loads(validated_raw)['receiptSha256']
  atomic_receipt(output,result)
  print('CN_BUILD_ONLY_SEALED_RECEIPT ready=false')
 else:print(source['path'] if source_mode else root)
if __name__=='__main__':
 try:main()
 except BaseException:print('CN_BUILD_TOOL_IDENTITY_REJECTED',file=sys.stderr);sys.exit(1)
