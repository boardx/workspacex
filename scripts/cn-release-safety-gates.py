"""Read-only A3/A4 evidence consumption. Never observes DBs, restores or grants.

The root entry supplies the protected no-follow reader. Evidence authority is an
independently installed root approval/pointer, not a passed flag in caller JSON.
Pure functions support isolated fixtures; there is deliberately no approval CLI.
"""
import datetime as dt
import hashlib
import json
from pathlib import Path
import re

SOURCE='bc3d1254ce05c915801fb73fe6698072730a051c'
APPROVALS=Path('/etc/workspacex-cn/release-safety-approvals')
EVIDENCE=Path('/var/lib/workspacex-cn/release-safety-evidence')

def need(ok,code):
    if not ok:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def pin(v):return type(v)is str and re.fullmatch('[a-f0-9]{64}',v)is not None
def parse(raw):
    need(type(raw)is bytes and 0<len(raw)<=65536,'SAFETY_RAW_BOUND')
    def pairs(rows):
        value={}
        for k,v in rows:need(k not in value,'SAFETY_DUPLICATE_KEY');value[k]=v
        return value
    value=json.loads(raw,object_pairs_hook=pairs)
    need(type(value)is dict,'SAFETY_OBJECT');return value
def stamp(v):
    t=dt.datetime.fromisoformat(v.replace('Z','+00:00'))
    need(t.tzinfo is not None and t.utcoffset()==dt.timedelta(0),'SAFETY_UTC');return t

def policy(a):
    p=a['safetyGates']
    need(set(p)=={'kind','sqlFiles','isolatedDatabaseId','explicitWriterRequired'}
         and p['kind']=='cn-a3-a4-policy-v1' and p['explicitWriterRequired']is True,'SAFETY_POLICY')
    need(type(p['sqlFiles'])is dict and len(p['sqlFiles'])==4,'FOUR_SQL_POLICY_REQUIRED')
    for path,digest in p['sqlFiles'].items():
        name=Path(path)
        need(not name.is_absolute() and '..'not in name.parts and str(name)==path
             and path.endswith('.sql') and pin(digest),'SQL_SOURCE_PIN')
    need(type(p['isolatedDatabaseId'])is str and re.fullmatch('[A-Za-z0-9_-]{1,128}',p['isolatedDatabaseId'])
         and p['isolatedDatabaseId']!=a['rds']['dbInstanceId'],'ISOLATED_TARGET_REQUIRED')
    return p

def consume(release,a,host_raw,rds_raw,migration_raw,reader,now=None):
    """Return missing pointer as None, never waive failed/changed evidence.

    `reader` is e.read in the protected router. No workspace path argument or
    caller-supplied expected evidence digest enters that installed path.
    """
    p=policy(a);now=now or dt.datetime.now(dt.timezone.utc);identity=a['identity']
    host,rds,migration=map(parse,(host_raw,rds_raw,migration_raw))
    need(sha(migration_raw)==a['runtime']['staticInputHashes']['migrationDiff'],'SQL_DIFF_PIN')
    need(migration['sourceRevision']==identity['sourceRevision'] and migration['baselineRevision']==identity['baselineRevision']
         and migration['changedFiles']==[] and migration['schemaMigrationRequired']is False,'SQL_MIGRATION_ROUTE_BLOCKED')
    epoch=rds['holdGeneration']
    need(host['holdGeneration']==epoch and host['actual']['restoreTested']is False
         and rds['isolatedRestoreTested']is False and rds['attemptId']==identity['attemptId']
         and rds['dbInstanceId']==a['rds']['dbInstanceId'] and rds['backupStatus']=='Success','BACKUP_EPOCH_BINDING')
    try:pointer=parse(reader(APPROVALS/'by-release'/(release+'.json')))
    except FileNotFoundError:return None
    need(set(pointer)=={'approvalSha256'} and pin(pointer['approvalSha256']),'SAFETY_APPROVAL_POINTER')
    approval_raw=reader(APPROVALS/(pointer['approvalSha256']+'.json'))
    need(sha(approval_raw)==pointer['approvalSha256'],'SAFETY_APPROVAL_HASH')
    v=parse(approval_raw)
    need(set(v)=={'kind','releaseSha256','identity','target','issuedAt','expiresAt',
                 'restoreReceiptSha256','sqlReceiptSha256','authorizationEvidenceSha256'}
         and v['kind']=='cn-approved-a3-a4-evidence-v1' and v['releaseSha256']==release
         and v['identity']==identity and v['target']==a['target'],'SAFETY_APPROVAL_SCOPE')
    for k in ('restoreReceiptSha256','sqlReceiptSha256','authorizationEvidenceSha256'):need(pin(v[k]),'SAFETY_APPROVAL_PIN')
    start,end=stamp(v['issuedAt']),stamp(v['expiresAt'])
    need(stamp(identity['requestedAt'])<=start<=now<end<=stamp(identity['deadlineAt'])
         and end-start<=dt.timedelta(minutes=30),'SAFETY_APPROVAL_WINDOW')
    def receipt(key):
        raw=reader(EVIDENCE/(v[key]+'.json'));need(sha(raw)==v[key],'SAFETY_EVIDENCE_HASH');return parse(raw)
    def original(digest):
        need(pin(digest),'SAFETY_RAW_PROOF_PIN')
        raw=reader(EVIDENCE/(digest+'.raw'),1048576)
        need(type(raw)is bytes and 0<len(raw)<=1048576 and sha(raw)==digest,'SAFETY_RAW_PROOF_HASH')
    original(v['authorizationEvidenceSha256'])
    restore=receipt('restoreReceiptSha256');sql=receipt('sqlReceiptSha256')
    for value in (restore,sql):
        need(value['identity']==identity and value['target']==a['target']
             and value['holdGeneration']==epoch,'SAFETY_EVIDENCE_IDENTITY')
    need(restore['kind']=='cn-isolated-restore-observation-v1'
         and restore['hostBackupSha256']==sha(host_raw) and restore['rdsBackupSha256']==sha(rds_raw)
         and str(restore['backupId'])==str(rds['backupId'])
         and restore['sourceDatabaseId']==a['rds']['dbInstanceId']
         and restore['restoredDatabaseId']==p['isolatedDatabaseId']
         and restore['restoreSucceeded']is True and restore['readbackVerified']is True,'A3_RESTORE_BINDING')
    need(pin(restore['providerEvidenceSha256']) and pin(restore['readbackEvidenceSha256']),'A3_RAW_PROOF_PINS')
    original(restore['providerEvidenceSha256']);original(restore['readbackEvidenceSha256'])
    need(stamp(identity['requestedAt'])<=stamp(rds['backupEndTime']),'BACKUP_ORIGINAL_EPOCH')
    restored=stamp(restore['completedAt'])
    need(stamp(rds['backupEndTime'])<=stamp(restore['startedAt'])<=restored<=start,'A3_EXECUTION_ORDER')
    need(sql['kind']=='cn-four-sql-compatibility-observation-v1'
         and sql['databaseId']==a['rds']['dbInstanceId'] and sql['migrationDiffSha256']==sha(migration_raw)
         and sql['schemaMigrationRequired']is False and pin(sql['schemaInventorySha256'])
         and set(sql['files'])==set(p['sqlFiles']),'A4_FOUR_SQL_REQUIRED')
    original(sql['schemaInventorySha256'])
    for name,digest in p['sqlFiles'].items():
        row=sql['files'][name]
        need(set(row)=={'sourceSha256','compatible','readOnly','evidenceSha256'} and row['sourceSha256']==digest
             and row['compatible']is True and row['readOnly']is True and pin(row['evidenceSha256']),'A4_SQL_UNPROVEN')
        original(row['evidenceSha256'])
    need(restored<=stamp(sql['observedAt'])<=start,'A4_EXECUTION_ORDER')
    return dict(kind='cn-a3-a4-evidence-consumed-v1',releaseSha256=release,identity=identity,target=a['target'],
                consumedAt=now.isoformat(),approvalSha256=pointer['approvalSha256'],
                restoreReceiptSha256=v['restoreReceiptSha256'],sqlReceiptSha256=v['sqlReceiptSha256'],
                hostBackupSha256=sha(host_raw),rdsBackupSha256=sha(rds_raw),holdGeneration=epoch,
                productionAccepted=False)
