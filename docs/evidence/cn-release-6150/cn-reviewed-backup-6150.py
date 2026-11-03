"""Actual fixed-CN stopped-writer owner/ACL restore proof; no source DDL."""
from pathlib import Path
import hashlib,importlib.util,json,os,re,time
HERE=Path(__file__).resolve().parent
SOURCE='151526a4f8dea1ad781d709ab8e3357f52714a96';TAG='41502993193-1'
def need(v,c):
 if not v:raise ValueError(c)
def load(name):
 p=HERE/(name+'.py');s=importlib.util.spec_from_file_location('backup6150_'+name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def ref(p):return {'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def qualify(out,adapter,ctx,metadata):
 core=ctx['mods']['schema-restore-rehearsal'];d=ctx['d'];prep=load('schema-acl-source-prepare');acl=load('schema-acl-rehearsal');cn=adapter.cn
 adapter.stopped();need(adapter.execute('drain').get('ledgerStatus')=='BASELINE','RESTORE_SOURCE_NOT_DRAINED')
 sql=prep.query_sql(acl.CATALOG_SQL,'migration_admin')
 def capture():
  def execute(args):
   args[-1]=cn.SHELL+"exec psql --no-password -X -qAt -v ON_ERROR_STOP=1 -c '"+sql.replace("'","'\\''")+"'";return d.run(args[1:],timeout=45)
  return prep.validate_capture(json.loads(cn.helper(d,'metadata',execute)),'cn')
 before=capture();need(before['ledger']==metadata['ledger']==adapter.base and len(adapter.base)==438,'RESTORE_CAPTURE_LEDGER')
 snapshot={k:before[k] for k in ('roles','memberships','catalog')};snapshot['migrationRole']='migration_admin'
 core.save(out/'intent.json',{'environment':'cn','source':SOURCE,'tag':TAG,'createdAt':time.time(),'sourceDatabaseWriteAttempted':False})
 core.save(out/'source-capture.json',before);core.save(out/'snapshot.json',snapshot)
 core.save(out/'receipt.json',{'status':'OWNER_ACL_SOURCE_CAPTURED','environment':'cn','archiveSha256':core.file_sha(out/'database.pgdump.enc'),'snapshotSha256':core.file_sha(out/'snapshot.json'),'sourceDatabaseWriteAttempted':False})
 names=('intent.json','source-capture.json','snapshot.json','database.pgdump.enc','backup.key','receipt.json')
 profile={'kind':'cn-source-faithful-isolated-clone-v1','environment':'cn','source':SOURCE,'tag':TAG,'captureDirectory':str(out),'files':{name:core.file_sha(out/name) for name in names},'imageId':cn.TOOL,'createdAt':time.time()}
 core.save(out/'cn-clone-profile.json',profile)
 result=acl.rehearse('/usr/bin/docker',cn.TOOL,out/'database.pgdump.enc',out/'backup.key',adapter.base,snapshot,adapter.files(),out/'owner-acl-rehearsal',cn_profile=out/'cn-clone-profile.json')
 need(result.get('status')=='OWNER_ACL_SQL_REHEARSED' and result.get('sourceOwnerAclRestored') is True and result.get('appRoleTransactionRollback') is True,'REAL_RESTORE_REHEARSAL_REQUIRED')
 adapter.stopped();need(adapter.execute('drain').get('ledgerStatus')=='BASELINE','POST_RESTORE_DRAIN');after=capture()
 need(all(before[k]==after[k] for k in ('database','role','ledger','roles','memberships','roleSettings','catalog')),'POST_RESTORE_SOURCE_DRIFT')
 files={str(p.relative_to(out)):core.file_sha(p) for p in out.rglob('*') if p.is_file()}
 proof={'kind':'cn-owner-acl-restore-6150','status':'STOPPED_OWNER_ACL_SQL_RESTORE_VERIFIED','environment':'cn','source':SOURCE,'tag':TAG,'sourceHost':cn.HOST,'database':cn.DB,'role':'migration_admin','baselineLedgerCount':438,'targetLedgerCount':449,'migrationChecksums':core.MIGRATIONS,'files':files,'createdAt':time.time(),'roleSettingsAcceptance':'NOT_PERFORMED','apiBootstrap':'SEPARATE_POST_MIGRATION_CHECK'}
 path=out/'owner-acl-qualification.json';core.save(path,proof);verify(ref(path),out.parent,core.MIGRATIONS);return ref(path)
def verify(reference,attempt,migrations):
 core=load('schema-restore-rehearsal');maint=load('tag-maintenance-release');path=maint.pinned(reference,private=True);out=Path(attempt)/'stopped-backup'
 need(path==out/'owner-acl-qualification.json','RESTORE_PROOF_PATH');proof=json.loads(path.read_bytes())
 need(proof.get('kind')=='cn-owner-acl-restore-6150' and proof.get('status')=='STOPPED_OWNER_ACL_SQL_RESTORE_VERIFIED' and proof.get('environment')=='cn' and proof.get('source')==SOURCE and proof.get('tag')==TAG and proof.get('migrationChecksums')==migrations and proof.get('baselineLedgerCount')==438 and proof.get('targetLedgerCount')==449,'RESTORE_PROOF_BINDING')
 need(type(proof.get('createdAt')) in (int,float) and 0<=time.time()-proof['createdAt']<600,'RESTORE_PROOF_EXPIRED')
 files=proof['files'];need(type(files) is dict and {'database.pgdump.enc','backup.key','snapshot.json','source-capture.json','cn-clone-profile.json','owner-acl-rehearsal/intent.json','owner-acl-rehearsal/restored.json','owner-acl-rehearsal/restored-catalog.json','owner-acl-rehearsal/catalog-comparison.json','owner-acl-rehearsal/receipt.json','owner-acl-rehearsal/cleanup.json'}<=set(files),'RESTORE_PROOF_FILES')
 for name,pin in files.items():
  p=Path(name);need(not p.is_absolute() and '..' not in p.parts,'RESTORE_PROOF_RELATIVE');maint.pinned({'path':str(out/p),'sha256':pin},private=True)
 read=lambda name:json.loads((out/name).read_bytes())
 result=read('owner-acl-rehearsal/receipt.json');need(result.get('status')=='OWNER_ACL_SQL_REHEARSED' and result.get('sourceOwnerAclRestored') is True and result.get('appRoleTransactionRollback') is True and result.get('migrationRoleAcceptance')=='EXACT_REVIEWED_SQL_LOGIN_ONLY' and set(result['migrationNames'])==set(migrations),'RESTORE_RESULT_NOT_PASSED')
 need(read('owner-acl-rehearsal/cleanup.json').get('removed') is True and read('owner-acl-rehearsal/catalog-comparison.json').get('equal') is True,'RESTORE_OR_CLEANUP_INCOMPLETE')
 return proof
