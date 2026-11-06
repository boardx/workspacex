"""Synthetic independently approved A3/A4 observations; no SQL/restore/cloud calls."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('gate',ROOT/'scripts/cn-release-safety-gates.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
enc=lambda v:(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
sha=lambda raw:hashlib.sha256(raw).hexdigest()


def safety_policy():
    return dict(kind='cn-a3-a4-policy-v1',sqlFiles={f'apps/api/migrations/fixture-{i}.sql':str(i)*64 for i in range(1,5)},
                isolatedDatabaseId='isolated-db',explicitWriterRequired=True)


class Evidence:
    def __init__(self,a,release,migration,now):
        self.a=a;self.release=release;self.migration=migration;self.now=now;self.files={};self.calls=[]
        for raw in (b'fixture raw provider restore',b'fixture raw restore readback',b'fixture raw schema inventory',b'fixture raw independent authorization'):
            self.files[gate.EVIDENCE/(sha(raw)+'.raw')]=raw
        self.host=dict(actual={'restoreTested':False},holdGeneration='fixture-generation')
        self.rds=dict(holdGeneration='fixture-generation',isolatedRestoreTested=False,attemptId=a['identity']['attemptId'],
                      dbInstanceId=a['rds']['dbInstanceId'],backupStatus='Success',backupId='100',
                      backupEndTime=(now-dt.timedelta(seconds=90)).isoformat())
        self.restore=dict(kind='cn-isolated-restore-observation-v1',identity=copy.deepcopy(a['identity']),target=a['target'],
            holdGeneration='fixture-generation',hostBackupSha256=sha(enc(self.host)),rdsBackupSha256=sha(enc(self.rds)),
            backupId='100',sourceDatabaseId=a['rds']['dbInstanceId'],restoredDatabaseId='isolated-db',
            restoreSucceeded=True,readbackVerified=True,providerEvidenceSha256=sha(b'fixture raw provider restore'),readbackEvidenceSha256=sha(b'fixture raw restore readback'),
            startedAt=(now-dt.timedelta(seconds=80)).isoformat(),completedAt=(now-dt.timedelta(seconds=70)).isoformat())
        self.sql=dict(kind='cn-four-sql-compatibility-observation-v1',identity=copy.deepcopy(a['identity']),target=a['target'],
            holdGeneration='fixture-generation',databaseId=a['rds']['dbInstanceId'],migrationDiffSha256=sha(migration),
            schemaMigrationRequired=False,schemaInventorySha256=sha(b'fixture raw schema inventory'),observedAt=(now-dt.timedelta(seconds=65)).isoformat(),
            files={name:dict(sourceSha256=digest,compatible=True,readOnly=True,evidenceSha256=sha(('fixture raw readonly '+name).encode()))for name,digest in a['safetyGates']['sqlFiles'].items()})
        for name in self.sql['files']:
            raw=('fixture raw readonly '+name).encode();self.files[gate.EVIDENCE/(sha(raw)+'.raw')]=raw
        self.approval=dict(kind='cn-approved-a3-a4-evidence-v1',releaseSha256=release,identity=copy.deepcopy(a['identity']),target=a['target'],
            issuedAt=(now-dt.timedelta(seconds=60)).isoformat(),expiresAt=(now+dt.timedelta(minutes=10)).isoformat(),
            restoreReceiptSha256='',sqlReceiptSha256='',authorizationEvidenceSha256=sha(b'fixture raw independent authorization'))
        self.publish()
    def publish(self):
        for key,value in [('restoreReceiptSha256',self.restore),('sqlReceiptSha256',self.sql)]:
            raw=enc(value);self.approval[key]=sha(raw);self.files[gate.EVIDENCE/(sha(raw)+'.json')]=raw
        raw=enc(self.approval);self.approval_sha=sha(raw)
        self.files[gate.APPROVALS/(self.approval_sha+'.json')]=raw
        self.files[gate.APPROVALS/'by-release'/(self.release+'.json')]=enc(dict(approvalSha256=self.approval_sha))
    def read(self,path,*args):
        self.calls.append(path)
        if path not in self.files:raise FileNotFoundError(path)
        return self.files[path]
    def consume(self):return gate.consume(self.release,self.a,enc(self.host),enc(self.rds),self.migration,self.read,self.now)


class Safety(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime.now(dt.timezone.utc)
        identity=dict(sourceRevision=gate.SOURCE,baselineRevision='b'*40,controlRevision='c'*40,publicationAttemptId='p',
            attemptId='a',requestedAt=(self.now-dt.timedelta(seconds=120)).isoformat(),deadlineAt=(self.now+dt.timedelta(minutes=20)).isoformat())
        self.migration=enc(dict(sourceRevision=gate.SOURCE,baselineRevision='b'*40,changedFiles=[],schemaMigrationRequired=False))
        self.a=dict(identity=identity,target={'fixed':'fixture'},safetyGates=safety_policy(),rds={'dbInstanceId':'prod-db'},
            runtime={'staticInputHashes':{'migrationDiff':sha(self.migration)}})
        self.f=Evidence(self.a,'a'*64,self.migration,self.now)
    def test_same_epoch_original_backups_and_four_sql_mapping(self):
        v=self.f.consume();self.assertFalse(v['productionAccepted'])
        self.assertEqual(v['restoreReceiptSha256'],self.f.approval['restoreReceiptSha256'])
        self.assertEqual(v['sqlReceiptSha256'],self.f.approval['sqlReceiptSha256'])
        self.assertEqual(v['hostBackupSha256'],sha(enc(self.f.host)))
    def test_missing_independent_pointer_is_wait_not_backup_restore_claim(self):
        del self.f.files[gate.APPROVALS/'by-release'/('a'*64+'.json')]
        self.assertIsNone(self.f.consume())
        self.assertFalse(self.f.host['actual']['restoreTested'])
    def test_missing_pinned_receipt_is_not_wait_or_success(self):
        del self.f.files[gate.EVIDENCE/(self.f.approval['restoreReceiptSha256']+'.json')]
        with self.assertRaises(FileNotFoundError):self.f.consume()
    def test_four_sql_unknown_mismatch_or_mutation_rejected(self):
        for change in ({'compatible':None},{'compatible':False},{'readOnly':False},{'sourceSha256':'0'*64},{'evidenceSha256':'bad'}):
            f=Evidence(self.a,'a'*64,self.migration,self.now);next(iter(f.sql['files'].values())).update(change);f.publish()
            with self.subTest(change=change),self.assertRaisesRegex(ValueError,'A4_SQL_UNPROVEN'):f.consume()
        self.f.sql['files'].pop(next(iter(self.f.sql['files'])));self.f.publish()
        with self.assertRaisesRegex(ValueError,'A4_FOUR_SQL_REQUIRED'):self.f.consume()
    def test_honest_nonempty_diff_never_becomes_empty_compatibility(self):
        self.f.migration=enc(dict(sourceRevision=gate.SOURCE,baselineRevision='b'*40,changedFiles=['permission.sql'],schemaMigrationRequired=False))
        self.a['runtime']['staticInputHashes']['migrationDiff']=sha(self.f.migration)
        with self.assertRaisesRegex(ValueError,'SQL_MIGRATION_ROUTE_BLOCKED'):self.f.consume()
    def test_restore_epoch_target_backup_and_readback_must_match(self):
        for key,value in [('restoreSucceeded',False),('readbackVerified',False),('restoredDatabaseId','prod-db'),
                          ('hostBackupSha256','0'*64),('rdsBackupSha256','0'*64),('backupId','other'),('holdGeneration','old')]:
            f=Evidence(self.a,'a'*64,self.migration,self.now);f.restore[key]=value;f.publish()
            with self.subTest(key=key),self.assertRaises(ValueError):f.consume()
    def test_root_approval_scope_hash_and_window(self):
        for key,value in [('releaseSha256','b'*64),('target',{'other':True}),('expiresAt',(self.now-dt.timedelta(seconds=1)).isoformat())]:
            f=Evidence(self.a,'a'*64,self.migration,self.now);f.approval[key]=value;f.publish()
            with self.subTest(key=key),self.assertRaises(ValueError):f.consume()
        path=gate.APPROVALS/(self.f.approval_sha+'.json');self.f.files[path]=b'{}'
        with self.assertRaisesRegex(ValueError,'SAFETY_APPROVAL_HASH'):self.f.consume()
    def test_restore_and_sql_time_order_and_original_epoch(self):
        self.f.restore['startedAt']=(self.now-dt.timedelta(seconds=100)).isoformat();self.f.publish()
        with self.assertRaisesRegex(ValueError,'A3_EXECUTION_ORDER'):self.f.consume()
        f=Evidence(self.a,'a'*64,self.migration,self.now);f.sql['observedAt']=(self.now-dt.timedelta(seconds=100)).isoformat();f.publish()
        with self.assertRaisesRegex(ValueError,'A4_EXECUTION_ORDER'):f.consume()
        f=Evidence(self.a,'a'*64,self.migration,self.now);f.rds['backupEndTime']=(self.now-dt.timedelta(hours=1)).isoformat()
        f.restore['rdsBackupSha256']=sha(enc(f.rds));f.publish()
        with self.assertRaisesRegex(ValueError,'BACKUP_ORIGINAL_EPOCH'):f.consume()
    def test_passed_flags_without_original_proof_closure_never_suffice(self):
        key=gate.EVIDENCE/(self.f.restore['providerEvidenceSha256']+'.raw')
        self.f.files[key]=b'changed'
        with self.assertRaisesRegex(ValueError,'SAFETY_RAW_PROOF_HASH'):self.f.consume()
        del self.f.files[key]
        with self.assertRaises(FileNotFoundError):self.f.consume()
    def test_policy_requires_four_pinned_sources_and_isolated_target(self):
        self.a['safetyGates']['isolatedDatabaseId']='prod-db'
        with self.assertRaisesRegex(ValueError,'ISOLATED_TARGET_REQUIRED'):self.f.consume()
        self.a['safetyGates']=safety_policy();self.a['safetyGates']['sqlFiles'].pop(next(iter(self.a['safetyGates']['sqlFiles'])))
        with self.assertRaisesRegex(ValueError,'FOUR_SQL_POLICY_REQUIRED'):self.f.consume()

if __name__=='__main__':unittest.main()
