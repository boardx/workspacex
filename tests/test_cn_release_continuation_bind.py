"""Offline trust-boundary tests. Package fixture is a materializer test double.
ReviewedPackageIntegration below executes the persisted original materializer and validator.
It generates bindings using synthetic evidence; it does not execute production mutations.
"""
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/cn-release-continuation-bind.py'
spec = importlib.util.spec_from_file_location('continuation_bind', SCRIPT)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
enc = lambda value: (json.dumps(value, sort_keys=True) + '\n').encode()

# This deliberately invokes the package's validator, proving the adapter does
# not substitute its own phase-admission implementation.
PREPARE = '''import json, hashlib, sys, importlib.util
from pathlib import Path
ROOT=Path(__file__).parent
spec=importlib.util.spec_from_file_location('upgrade', ROOT/'upgrade-draft.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
c=json.loads(Path(sys.argv[1]).read_bytes())
b=json.loads((ROOT/'binding.template.json').read_bytes())
a=json.loads(Path(c['authorization']).read_bytes())
b.update(draft=False,attemptId=a['attemptId'],expiresAt=a['expiresAt'])
if c['phase']!='hold':
 h=json.loads(Path(c['hold']).read_bytes())
 assert h['identity']['sourceRevision']==m.SOURCE and h['identity']['baselineRevision']==m.BASELINE
 assert h['identity']['attemptId']==a['attemptId'];b['hold']=h
for key in ('stop','hostBackup','rdsBackup'):
 if key in c:
  r=json.loads(Path(c[key]).read_bytes());assert r['holdGeneration']==b['hold']['generation']
for name, key in [('upgrade-draft.py','scriptSha256'),('backup-host.DRAFT.py','backupHelperSha256')]:
 b[key]=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
m.validate_binding(b)
out=Path(c['output']);out.mkdir()
(out/'binding.json').write_text(json.dumps(b))
'''
UPGRADE = '''SOURCE = %r
BASELINE = %r
def validate_binding(b):
 assert b['sourceRevision']==SOURCE and b['baselineRevision']==BASELINE
 assert b.get('rejectOriginalValidator') is not True
''' % ('a'*40, 'b'*40)
BACKUP = '''def main(b):
 assert b['sourceRevision'] == %r
''' % ('a'*40)


class BindTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.package = self.root/'package'; self.package.mkdir()
        sources = {'prepare-phase.py': PREPARE, 'upgrade-draft.py': UPGRADE,
                   'backup-host.DRAFT.py': BACKUP, 'sessions-after-stop.py': '# session helper\n',
                   'sessions-after-stop.sh': '# reviewed session readback\n'}
        for name, source in sources.items(): (self.package/name).write_text(source)
        self.now = dt.datetime.now(dt.timezone.utc)
        issued = (self.now-dt.timedelta(seconds=5)).isoformat()
        expires = (self.now+dt.timedelta(minutes=20)).isoformat()
        self.request = dict(schemaVersion=1, sourceRevision='c'*40, baselineRevision='d'*40,
                            controlRevision='e'*40, publicationAttemptId='build-next',
                            attemptId='runtime-next', phase='hold', inputs={}, requestedAt=issued,
                            deadlineAt=(self.now+dt.timedelta(minutes=25)).isoformat())
        self.inputs = {
            'authorization': enc(dict(sourceRevision='c'*40, baselineRevision='d'*40,
                attemptId='runtime-next', scope=m.SCOPE, runtimeStartSideEffectsIncluded=True,
                directUserEvidence='reviewed user evidence reference', issuedAt=issued, expiresAt=expires)),
            'publication': enc(dict(receiptKind='cn-candidate-published-v2', sourceRevision='c'*40,
                                  controlRevision='e'*40, attemptId='build-next')),
            'template': enc(dict(draft=True, sourceRevision='c'*40, baselineRevision='d'*40)),
            'migrationDiff': enc(dict(sourceRevision='c'*40, baselineRevision='d'*40,
                                      changedFiles=[], schemaMigrationRequired=False))}
        self.approval = dict(kind='cn-continuation-materialization-approval-v1', requestSha256='',
                             issuedAt=issued, expiresAt=expires,
                             packageFiles={n:m.sha((self.package/n).read_bytes()) for n in m.PACKAGE_FILES})

    def run_bind(self, name='out', resign=True):
        self.request['inputs'] = {k:m.sha(v) for k,v in self.inputs.items()}
        raw = enc(self.request)
        if resign: self.approval['requestSha256'] = m.sha(raw)
        return m.bind(raw, enc(self.approval), self.package, self.inputs, self.root/name, now=self.now)

    def test_actual_publisher_receipt_method_is_consumed(self):
        # Compile the actual pure receipt producer, not a mirrored schema fixture.
        import ast
        from types import SimpleNamespace
        tree=ast.parse((SCRIPT.parent/'cn_candidate_host.py').read_text())
        cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Commands')
        method=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='receipt')
        module=ast.fix_missing_locations(ast.Module(body=[method],type_ignores=[]))
        scope={'a':SimpleNamespace(sha=m.sha,PREFIX='fixture-registry')}
        exec(compile(module,'actual-publisher-receipt','exec'),scope)
        old=json.loads(self.inputs['publication']);old.pop('receiptKind')
        host=SimpleNamespace(binding=old,approval_sha='a'*64,host_identity={'fixture':True})
        self.inputs['publication']=enc(scope['receipt'](host,{'images':{}},b'manifest',b'seal'))
        self.run_bind()

    def test_invented_kind_alias_is_not_a_publisher_receipt(self):
        pub=json.loads(self.inputs['publication']);pub['kind']=pub.pop('receiptKind')
        self.inputs['publication']=enc(pub)
        with self.assertRaisesRegex(ValueError, 'PUBLICATION_ATTEMPT'):self.run_bind()

    def test_next_source_runtime_and_backup_are_bound(self):
        result = self.run_bind()
        binding = json.loads((self.root/'out/binding.json').read_bytes())
        self.assertEqual(binding['sourceRevision'], 'c'*40)
        self.assertEqual(binding['attemptId'], 'runtime-next')
        self.assertEqual(binding['scriptSha256'], m.sha((self.root/'out/upgrade-draft.py').read_bytes()))
        self.assertEqual(binding['backupHelperSha256'], m.sha((self.root/'out/backup-host.DRAFT.py').read_bytes()))
        self.assertEqual(binding['deadlineAt'], self.request['deadlineAt'])
        self.assertEqual(result['cloudCalls'], 0)
        self.assertFalse(result['dispatchAuthorizedByGenerator'])

    def test_phase_chain_and_cross_attempt(self):
        self.run_bind('hold')
        hold = dict(state='held', generation='generation-next', identity=dict(
            sourceRevision='c'*40, baselineRevision='d'*40, attemptId='runtime-next'))
        self.inputs['hold'] = enc(hold)
        for phase in ('stop', 'backup', 'switch'):
            self.request['phase'] = phase
            if phase == 'backup': self.inputs['stop'] = enc(dict(holdGeneration='generation-next'))
            if phase == 'switch':
                for key in ('hostBackup','rdsBackup'): self.inputs[key] = enc(dict(holdGeneration='generation-next'))
            self.run_bind(phase)
        hold['identity']['attemptId'] = 'other-attempt'; self.inputs['hold'] = enc(hold)
        with self.assertRaisesRegex(ValueError, 'MATERIALIZER_REJECTED'): self.run_bind('cross')

    def test_cross_generation_rejected_by_original_materializer(self):
        self.request['phase']='backup'
        self.inputs['hold']=enc(dict(generation='new',identity=dict(sourceRevision='c'*40,baselineRevision='d'*40,attemptId='runtime-next')))
        self.inputs['stop']=enc(dict(holdGeneration='old'))
        with self.assertRaisesRegex(ValueError,'MATERIALIZER_REJECTED'): self.run_bind()

    def test_original_validator_still_runs(self):
        value=json.loads(self.inputs['template']);value['rejectOriginalValidator']=True
        self.inputs['template']=enc(value)
        with self.assertRaisesRegex(ValueError,'MATERIALIZER_REJECTED'): self.run_bind()

    def test_package_tamper_rejected_before_execution(self):
        (self.package/'prepare-phase.py').write_text('raise RuntimeError("must not run")')
        with self.assertRaisesRegex(ValueError,'PACKAGE_HASH'): self.run_bind()

    def test_request_approval_mismatch_and_self_approval(self):
        with self.assertRaisesRegex(ValueError,'APPROVAL_REQUEST_MISMATCH'): self.run_bind(resign=False)
        self.request['hasApproval']=True
        with self.assertRaisesRegex(ValueError,'REQUEST_FIELDS'): self.run_bind()

    def test_budget_and_receipt_identity(self):
        self.request['deadlineAt']=(self.now+dt.timedelta(minutes=31)).isoformat()
        with self.assertRaisesRegex(ValueError,'END_TO_END_DEADLINE'): self.run_bind()
        self.request['deadlineAt']=(self.now+dt.timedelta(minutes=10)).isoformat()
        with self.assertRaisesRegex(ValueError,'OVER_BUDGET'): self.run_bind()

    def test_expired_and_wrong_control(self):
        self.approval['expiresAt']=(self.now-dt.timedelta(seconds=1)).isoformat()
        with self.assertRaisesRegex(ValueError,'APPROVAL_EXPIRED'): self.run_bind()
        self.approval['expiresAt']=(self.now+dt.timedelta(minutes=20)).isoformat()
        pub=json.loads(self.inputs['publication']);pub['controlRevision']='f'*40;self.inputs['publication']=enc(pub)
        with self.assertRaisesRegex(ValueError,'PUBLICATION_IDENTITY'): self.run_bind()

    def test_outputs_exclusive(self):
        self.run_bind()
        with self.assertRaisesRegex(ValueError,'OUTPUT_EXISTS'): self.run_bind()

    def test_cli_cannot_supply_approval_path(self):
        r=subprocess.run([sys.executable,str(SCRIPT),'--approval','/tmp/fake'],capture_output=True)
        self.assertNotEqual(r.returncode,0)
        with patch.object(m,'private_read',return_value=b'approved') as read:
            self.assertEqual(m.load_approval('a'*64),b'approved')
            read.assert_called_once_with(m.APPROVAL_ROOT/('a'*64+'.json'))

    def test_no_global_literal_rewrite(self):
        raw=(UPGRADE+"UNRELATED = "+repr('a'*40)+"\n").encode()
        specialized=m.specialize(raw,'c'*40,'d'*40,'a'*40,'b'*40)
        self.assertIn(("UNRELATED = "+repr('a'*40)).encode(),specialized)
        with self.assertRaisesRegex(ValueError,'BACKUP_IDENTITY_GUARD_CHANGED'):
            m.specialize(b'pass\n','c'*40,'d'*40,'a'*40,'b'*40,backup=True)

    def test_elapsed_budget_blocks_switch_and_recovery_is_separate(self):
        self.request['phase']='switch'
        self.request['requestedAt']=(self.now-dt.timedelta(minutes=31)).isoformat()
        self.request['deadlineAt']=(self.now-dt.timedelta(minutes=1)).isoformat()
        with self.assertRaisesRegex(ValueError,'END_TO_END_DEADLINE'): self.run_bind()
        self.request['phase']='rollback'
        with self.assertRaisesRegex(ValueError,'PHASE'): self.run_bind()

    def test_duplicate_json_rejected(self):
        with self.assertRaisesRegex(ValueError,'DUPLICATE_JSON_KEY'): m.parse(b'{"a":1,"a":2}')


class ReviewedPackageIntegration(unittest.TestCase):
    """Real subprocess integration of the committed, byte-preserved templates.

    All receipt/config values below are synthetic and nonsecret. These tests
    exercise actual admission/materialization, not Docker, OSS, RDS or deployment.
    """
    def setUp(self):
        BindTests.setUp(self)
        self.package = SCRIPT.parents[1] / '.harness/scripts/vm/cn-runtime-continuation'
        self.approval['packageFiles'] = {n:m.sha((self.package/n).read_bytes()) for n in m.PACKAGE_FILES}
        prefix = 'workspacex-cn-prod-registry-vpc.cn-shanghai.cr.aliyuncs.com/workspacex-prod/'
        repos = dict(api='api', web='web', agent='deep-agent', sandbox='skill-sandbox',
                     **{'sandbox-sessions':'skill-sandbox'})
        images = {key:prefix+repo+'@sha256:'+'1'*64 for key,repo in repos.items()}
        base='/var/lib/workspacex-cn/runtime/synthetic-integration'
        template = dict(draft=True, sourceRevision='c'*40, baselineRevision='d'*40,
            accountId='1177216024653153',ecsInstanceId='i-uf6ga92ewloganobbln6',region='cn-shanghai',
            migrationDiff=[],candidateImages={},rollbackImages=images,workingDir=base,
            composeFiles=[dict(path=base+'/compose.json',sha256='2'*64)],
            envFiles=[dict(path=base+'/synthetic.env',sha256='3'*64)],
            backupPaths=[base+'/sandbox',base+'/sessions'],backupScope='host-config-and-bind-only',
            expectedContainers={'/workspacex-cn-'+key+'-1':dict(id='4'*64,image=image)
                                for key,image in images.items()},
            holdHelperSha256='5'*64,previousHold=None,hold=None,
            stopReceiptSha256=None,hostBackupReceiptSha256=None,rdsBackupReceiptSha256=None,
            backupProviderObservationReviewed=False)
        self.inputs['template']=enc(template)
        publication=json.loads(self.inputs['publication'])
        publication['images']={key:dict(image=images[key]) for key in ('api','web','agent','sandbox')}
        self.inputs['publication']=enc(publication)

    run_bind = BindTests.run_bind

    def advance_inputs(self, phase):
        self.request['phase']=phase
        if phase!='hold':
            self.inputs['hold']=enc(dict(state='held',generation='fixture-generation',identity=dict(
                sourceRevision='c'*40,baselineRevision='d'*40,attemptId='runtime-next',
                migrationPlanSha256=m.sha(self.inputs['migrationDiff']))))
        if phase in ('backup','switch'):
            self.inputs['stop']=enc(dict(knownFiveStopped=True,otherDatabaseClientSessions=0,
                holdGeneration='fixture-generation',finishedAt=self.request['requestedAt']))
        if phase=='switch':
            self.inputs['hostBackup']=enc(dict(holdGeneration='fixture-generation'))
            self.inputs['rdsBackup']=enc(dict(holdGeneration='fixture-generation',backupStatus='Success',
                metaStatus='OK',dbInstanceId='pgm-uf6rg214cp381l49',
                backupStartTime=self.request['requestedAt']))

    def test_real_materializer_four_phase_chain_and_runtime_pins(self):
        for phase in ('hold','stop','backup','switch'):
            self.advance_inputs(phase)
            result=self.run_bind(phase)
            folder=self.root/phase; binding=json.loads((folder/'binding.json').read_bytes())
            self.assertEqual(binding['sourceRevision'],'c'*40)
            self.assertEqual(binding['baselineRevision'],'d'*40)
            self.assertEqual(binding['controlRevision'],'e'*40)
            self.assertEqual(binding['attemptId'],'runtime-next')
            self.assertEqual(binding['requestedAt'],self.request['requestedAt'])
            self.assertEqual(binding['deadlineAt'],self.request['deadlineAt'])
            for file,key in [('upgrade-draft.py','scriptSha256'),
                             ('backup-host.DRAFT.py','backupHelperSha256'),
                             ('sessions-after-stop.py','sessionsHelperSha256')]:
                self.assertEqual(binding[key],m.sha((folder/file).read_bytes()))
            self.assertNotEqual(binding['scriptSha256'],self.approval['packageFiles']['upgrade-draft.py'])
            self.assertEqual(result['cloudCalls'],0)
        for key, field in [('stop','stopReceiptSha256'),('hostBackup','hostBackupReceiptSha256'),
                           ('rdsBackup','rdsBackupReceiptSha256')]:
            self.assertEqual(binding[field],m.sha(self.inputs[key]))
        self.assertTrue(binding['backupProviderObservationReviewed'])
        # Original unspecialized runtime must reject this next release.
        original_spec=importlib.util.spec_from_file_location('original_upgrade',self.package/'upgrade-draft.py')
        original=importlib.util.module_from_spec(original_spec);original_spec.loader.exec_module(original)
        with self.assertRaises(AssertionError): original.validate_binding(binding)

    def test_real_materializer_rejects_cross_request_hold_and_backup(self):
        self.advance_inputs('switch')
        hold=json.loads(self.inputs['hold']);hold['identity']['attemptId']='other-release'
        self.inputs['hold']=enc(hold)
        with self.assertRaisesRegex(ValueError,'MATERIALIZER_REJECTED'): self.run_bind('cross-attempt')
        self.advance_inputs('switch')
        backup=json.loads(self.inputs['rdsBackup']);backup['holdGeneration']='other-generation'
        self.inputs['rdsBackup']=enc(backup)
        with self.assertRaisesRegex(ValueError,'MATERIALIZER_REJECTED'): self.run_bind('cross-backup')

    def test_byte_preserving_template_provenance(self):
        provenance=json.loads((self.package/'provenance.json').read_bytes())
        self.assertTrue(provenance['bytePreservingImport'])
        self.assertEqual(set(provenance['files']),set(m.PACKAGE_FILES))
        for name,entry in provenance['files'].items():
            raw=(self.package/name).read_bytes()
            self.assertEqual(entry['sha256'],m.sha(raw))
            self.assertEqual(entry['bytes'],len(raw))


if __name__=='__main__': unittest.main()
