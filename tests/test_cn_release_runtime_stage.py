"""Real binder/template materialization, no privileged staging or cloud execution."""
import ast
import base64
import importlib.util
import json
from pathlib import Path
import unittest
import zlib

ROOT=Path(__file__).resolve().parents[1]
def mod(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=mod('stage_adapter',ROOT/'scripts/cn-release-runtime-stage.py')
f=mod('stage_bind_fixture',ROOT/'tests/test_cn_release_continuation_bind.py')


class StageTests(unittest.TestCase):
    def setUp(self):
        self.f=f.ReviewedPackageIntegration();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.approval=dict(kind='cn-fixed-release-approval-v1',identity={k:self.f.request[k]for k in m.IDENTITY},target=m.TARGET,
            issuedAt=self.f.approval['issuedAt'],expiresAt=self.f.approval['expiresAt'],
            runtimeStage=dict(remoteRoot='/var/lib/workspacex-cn/runtime/upgrade-f0eb-new-release',templateSha256=m.sha(m.TEMPLATE.read_bytes())))
        self.previous=None

    def phase(self,phase):
        self.f.advance_inputs(phase);self.f.run_bind(phase)
        out={p.name:p.read_bytes()for p in (self.f.root/phase).iterdir()}
        prior={}
        if self.previous is not None:prior['previous-binding.json']=self.previous
        for name,key in [('stop-receipt.json','stop'),('backup-result.json','hostBackup'),('rds-backup-receipt.json','rdsBackup')]:
            if key in self.f.inputs:prior[name]=self.f.inputs[key]
        result=m.generate_phase_actions(self.approval,phase,out,prior,now=self.f.now)
        self.previous=out['binding.json'];return result,out,prior

    def test_real_four_phase_materialization_and_exact_cas(self):
        last=None
        for phase in ('hold','stop','backup','switch'):
            result,out,prior=self.phase(phase)
            self.assertEqual(result['expectedOldBindingSha256'],last)
            last=m.sha(out['binding.json'])
            self.assertIn(last,result['actionParameters']['CommandContent'])
            self.assertTrue(result['requiresAllStageObserverPreflightBeforeHold'])
            self.assertFalse(result['observersProvided'])
            self.assertEqual(result['cloudCalls'],0)
            self.assertLessEqual(len(result['stageParameters']['CommandContent'].encode()),18000)
            self.assertEqual('sessionsParameters'in result,phase=='stop')

    def test_bound_stage_uses_original_template_and_preserves_guard_logic(self):
        result,out,prior=self.phase('hold')
        command=result['stageParameters']['CommandContent']
        # Decode exactly the generated command payload without executing stage.
        code=command.split("\n",1)[1].rsplit('\nCN_RUNTIME_STAGE',1)[0]
        tree=ast.parse(code);encoded=tree.body[1].value.args[0].args[0].value
        payload=json.loads(zlib.decompress(base64.b64decode(encoded)));source=payload['stage'].encode()
        self.assertEqual(payload['files']['binding.json'].encode(),out['binding.json'])
        self.assertEqual(m.sha(source),result['stageSourceSha256'])
        compile(source,'bound-stage','exec')
        text=source.decode()
        self.assertIn('BINDING_CAS_CHANGED',text)
        self.assertIn('IMMUTABLE_ATTEMPT_CHANGED',text)
        self.assertIn('EXISTING_FILE_DRIFT',text)
        self.assertIn("b['sourceRevision'] == '"+'c'*40+"'",text)
        self.assertNotIn(m.SOURCE,text)

    def test_wrong_previous_identity_and_raw_receipt_fail(self):
        self.phase('hold');result,out,prior=self.phase('stop')
        old=json.loads(prior['previous-binding.json']);old['requestedAt']='2000-01-01T00:00:00+00:00'
        prior['previous-binding.json']=f.enc(old)
        with self.assertRaisesRegex(ValueError,'IMMUTABLE_ATTEMPT_CHANGED'):
            m.generate_phase_actions(self.approval,'stop',out,prior,now=self.f.now)
        result,out,prior=self.phase('backup');prior['stop-receipt.json']+=b' '
        with self.assertRaisesRegex(ValueError,'PRIOR_RECEIPT_HASH'):
            m.generate_phase_actions(self.approval,'backup',out,prior,now=self.f.now)

    def test_binder_file_tamper_and_unapproved_template_rejected(self):
        result,out,prior=self.phase('hold');out['upgrade-draft.py']+=b'\n'
        with self.assertRaisesRegex(ValueError,'BINDER_FILE_CHANGED'):
            m.generate_phase_actions(self.approval,'hold',out,prior,now=self.f.now)
        self.approval['runtimeStage']['templateSha256']='f'*64
        with self.assertRaisesRegex(ValueError,'TEMPLATE_PIN'):
            m.generate_phase_actions(self.approval,'hold',out,prior,now=self.f.now)

    def test_extra_prior_path_and_expired_budget_fail(self):
        result,out,prior=self.phase('hold');prior['../../other']=b'bytes'
        with self.assertRaisesRegex(ValueError,'PRIOR_EVIDENCE_CLOSURE'):
            m.generate_phase_actions(self.approval,'hold',out,prior,now=self.f.now)
        self.approval['expiresAt']='2000-01-01T00:00:00+00:00'
        with self.assertRaisesRegex(ValueError,'RELEASE_BUDGET'):
            m.generate_phase_actions(self.approval,'hold',out,{},now=self.f.now)

    def test_template_import_provenance_and_guard_change_fail_closed(self):
        raw=m.TEMPLATE.read_bytes();p=json.loads(m.TEMPLATE.with_name('stage-phase.provenance.json').read_bytes())
        self.assertEqual(p['sha256'],m.sha(raw));self.assertTrue(p['bytePreservingImport'])
        with self.assertRaisesRegex(ValueError,'TEMPLATE_IDENTITY_GUARD_CHANGED'):
            m.specialize(b'CONFIG=__CONFIG__\n','c'*40,'d'*40,{})


if __name__=='__main__':unittest.main()
