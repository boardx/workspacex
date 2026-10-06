#!/usr/bin/env python3
"""Protected bounded online-backup entry. Installation/execution need approval.
A backup receipt explicitly never declares a common epoch or production release.
"""
import hashlib,json,os,pathlib,stat,sys
ROOT=pathlib.Path('/usr/local/lib/workspacex-cn')
CLOSURE=('cn_backup_run.py','cn_backup_host.py','cn_backup_watchdog.py','cn_backup_channel.py','cn_backup_package.py','cn_backup_stream.py','cn_backup_sql.py','cn_backup_backend.py','candidate_backend_collector.py','candidate_writer.py','writer_fence.py','host_transport.py','fixed_probes.py','control_connection.py','cn_maintenance_hold.py','backup_connection.cjs','control_connection.cjs','cn-maintenance-migrator.cjs','cn-backup-fixed-queries.json')
def bootstrap_read(path,mode):
 p=pathlib.Path(path)
 if not p.is_absolute() or '..' in p.parts:raise RuntimeError('BACKUP_BOOTSTRAP_PATH')
 for parent in p.parents:
  st=parent.lstat()
  if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or st.st_mode&0o022:raise RuntimeError('BACKUP_BOOTSTRAP_PARENT')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  st=os.fstat(f.fileno())
  if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or st.st_nlink!=1 or stat.S_IMODE(st.st_mode)!=mode:raise RuntimeError('BACKUP_BOOTSTRAP_FILE')
  raw=f.read(16777217)
  if len(raw)>16777216:raise RuntimeError('BACKUP_BOOTSTRAP_BOUND')
  return raw

def bootstrap(read=bootstrap_read):
 if os.geteuid()!=0 or os.getegid()!=0 or sys.platform!='linux' or pathlib.Path(__file__).resolve()!=ROOT/'cn_backup_run.py':raise RuntimeError('BACKUP_BOOTSTRAP_ENTRY')
 profile=json.loads(read('/etc/workspacex-cn/trusted-tool-binding.json',0o600))
 for name in CLOSURE:
  path=str(ROOT/name)
  if hashlib.sha256(read(path,0o700)).hexdigest()!=profile['installedFilesSha256'][path]:raise RuntimeError('BACKUP_BOOTSTRAP_SOURCE_CLOSURE')
 sys.path.insert(0,str(ROOT))

def load_runtime():
 bootstrap()
 global private,BackupLease,require,BackupHost,require_canonical_lock,Journal
 from host_transport import private
 from cn_backup_package import BackupLease,require
 from cn_backup_host import BackupHost
 from cn_maintenance_hold import require_canonical_lock
 from writer_fence import Journal


def run(reference):
 require(os.geteuid()==0 and sys.platform=='linux','BACKUP_RUN_HOST')
 require_canonical_lock() # Caller holds existing canonical FD9; never race deploy.
 raw=private(reference['path']);require(hashlib.sha256(raw).hexdigest()==reference['sha256'],'BACKUP_RUN_PLAN_PIN')
 h=json.loads(raw);profile=json.loads(private('/etc/workspacex-cn/trusted-tool-binding.json'))
 require(profile['backupHostPlan']==reference and profile['toolRevision']==h['backup']['toolRevision'],'BACKUP_RUN_PROFILE')
 runtime=h['pythonRuntime'];require(os.path.realpath(sys.executable)==runtime['path'] and hashlib.sha256(private(runtime['path'],0o755)).hexdigest()==runtime['sha256']==profile['backupPythonRuntime']['sha256'],'BACKUP_RUN_PYTHON_PIN')
 directory='/var/lib/workspacex-cn/runtime/backup-journals/'+h['identity']['attemptId']
 require(h['journalDirectory']==directory,'BACKUP_RUN_JOURNAL_PATH')
 journal=Journal(directory,h['identity']);host=None
 try:
  host=BackupHost(reference);receipt=BackupLease(h['backup'],host,journal,expected_identity=host.expected_identity).run()
  require(receipt['productionReleaseReady'] is False and receipt['currentEpochVerified'] is False,'BACKUP_RUN_SCOPE')
  return receipt
 finally:
  if host and host.channels:host.close_channels()
  journal.close()

if __name__=='__main__':
 try:
  if len(sys.argv)!=4 or sys.argv[1] not in ('--protected-backup','--backup-watchdog'):raise RuntimeError('BACKUP_RUN_ARGUMENTS')
  load_runtime()
  reference={'path':sys.argv[2],'sha256':sys.argv[3]}
  if sys.argv[1]=='--backup-watchdog':
   from cn_backup_watchdog import serve
   serve(reference)
  else:print(json.dumps(run(reference),sort_keys=True))
 except BaseException:sys.stderr.write('BACKUP_RUN_INCOMPLETE_RECONCILIATION_REQUIRED\n');sys.exit(1)
