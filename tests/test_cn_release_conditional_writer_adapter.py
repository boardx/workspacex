"""Actual driver/router/journal/materializer integration, fixture external I/O.

This exercises fixed adapter logic, not root installation or provider services.
"""
import datetime as dt
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import test_cn_release_full_chain as full

ROOT=Path(__file__).resolve().parents[1]
def module(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/('cn-release-'+name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
adapter=module('conditional-writer-adapter')
policy=module('conditional-writer-policy')
store=module('conditional-writer-store')


class AdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): full.FullChain.setUpClass()
    @classmethod
    def tearDownClass(cls): full.FullChain.tearDownClass()
    def setUp(self):
        self.f=full.FullChain();self.f.setUp();self.addCleanup(self.f.doCleanups)
        pub=full.r.e.decode(self.f.publication)
        for key in ('postgres','redis'):pub['images'][key]={'image':'registry.example/'+key+'@sha256:'+'f'*64}
        self.f.publication=full.r.e.encode(pub)
        path=Path('/var/lib/workspacex-cn/archive-published')/self.f.identity['sourceRevision']/self.f.identity['publicationAttemptId']/'published.json'
        self.f.virtual[str(path)]=self.f.publication
        self.assertEqual(self.f.coordinate()['status'],'WAITING_FOR_WRITER_APPROVAL')
        self.policies=self.f.root.resolve()/'conditional-policies';self.state=self.f.root.resolve()/'conditional-state';self.writers=self.f.root.resolve()/'writers'
        for path in (self.policies/'by-release',self.state/'locks',self.state/'claims',self.state/'decisions',self.writers/'by-release'):
            path.mkdir(parents=True,mode=0o700)
        for root in (self.policies,self.state,self.writers):root.chmod(0o700)
        self.codes=dict(self.f.a['codeFiles'])
        for name in set(adapter.MODULES.values())|{adapter.SELF}|policy.CODES:
            self.codes[name]=policy.sha((ROOT/name).read_bytes())
        inputs=self.f.router.terminal_inputs()
        inputs.update(status=self.f.router.evidence('acceptance'),userAuthorization=(self.f.inputs/self.f.release/'writer-authorization.json').read_bytes(),testDataScope=(self.f.inputs/self.f.release/'test-data-scope.json').read_bytes())
        self.p=dict(kind='cn-conditional-writer-policy-v1',policyId='e'*32,releaseSha256=self.f.release,
            identity=self.f.identity,target=policy.TARGET,issuedAt=self.f.a['issuedAt'],expiresAt=self.f.a['expiresAt'],
            imageDigests={k:pub['images'][k]['image'].rsplit('@',1)[1] for k in policy.IMAGES},codeFiles=self.codes,
            evidencePins={k:policy.sha(inputs[k]) for k in ('userAuthorization','testDataScope')},scope=policy.SCOPE,
            publicOrigin=policy.ORIGIN,maxObservationAgeSeconds=60)
        self.raw=policy.enc(self.p);self.pointer=policy.enc({'policySha256':policy.sha(self.raw)})
        for path,raw in ((self.policies/(policy.sha(self.raw)+'.json'),self.raw),(self.policies/'by-release'/(self.f.release+'.json'),self.pointer)):
            path.write_bytes(raw);path.chmod(0o600)
        self.modules={'terminal':self.f.router.load('terminal'),'entry':full.r.e,'policy':policy,'store':store,'journal':self.f.router.load('journal')}

    def execute(self):
        return adapter._execute(self.f.raw,self.raw,self.pointer,self.modules,
            (self.policies,self.state,self.writers,self.f.outputs,self.f.inputs,Path('/var/lib/workspacex-cn/archive-published')),
            full.r.e.read,lambda:self.codes,clock=lambda:dt.datetime.now(dt.timezone.utc))

    def test_actual_adapter_then_router_consumes_exact_approval(self):
        decision=self.execute();self.assertFalse(decision['writerResumed'])
        pointer=self.writers/'by-release'/(self.f.release+'.json')
        pin=policy.parse(pointer.read_bytes())['approvalSha256']
        prefix='/etc/workspacex-cn/writer-resume-approvals/'
        self.f.virtual[prefix+'by-release/'+self.f.release+'.json']=pointer.read_bytes()
        self.f.virtual[prefix+pin+'.json']=(self.writers/(pin+'.json')).read_bytes()
        exists=Path.exists
        pointer_path=Path(prefix+'by-release/'+self.f.release+'.json')
        with patch.object(Path,'exists',lambda value: True if value==pointer_path else exists(value)):
            self.assertIsNone(full.r.Router.admission(self.f.router,self.f.release,'clear-hold'))
        self.f.approved=True
        self.assertEqual(self.f.coordinate()['status'],'CHAIN_COMPLETED')
        self.assertEqual(self.f.calls,list(full.r.e.STAGES))
        self.assertTrue((self.f.router.base/'terminal/conditional-writer-resume/parameters.json').exists())

    def test_second_call_never_reuses_claim(self):
        self.execute()
        with self.assertRaises(FileExistsError):self.execute()
        self.assertNotIn('clear-hold',self.f.calls)

    def test_old_release_without_new_closure_cannot_enable_policy(self):
        with self.assertRaisesRegex(ValueError,'CONDITIONAL_CLOSURE_MISSING'):
            adapter.closure(self.f.a,self.p)

    def test_changed_chain_fails_before_claim(self):
        path=self.f.state/self.f.identity['attemptId']/'14-acceptance.evidence.json'
        path.write_bytes(path.read_bytes()+b' ')
        with self.assertRaises(Exception):self.execute()
        self.assertEqual(list((self.state/'claims').glob('*.json')),[])
        self.assertEqual(list((self.writers/'by-release').glob('*.json')),[])

    def test_public_default_is_disabled(self):
        with self.assertRaisesRegex(ValueError,'POLICY_DISABLED'):adapter.materialize(self.f.release)


if __name__=='__main__':unittest.main()
