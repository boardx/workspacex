"""Actual driver/router/journal/materializer integration, fixture external I/O.

This exercises fixed adapter logic, not root installation or provider services.
"""
import datetime as dt
import importlib.util
import os
from pathlib import Path
import unittest
from cn_release_private_fixture import private_temporary_directory
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
        if getattr(self,'conditional',False):
            self.f.a['conditionalWriterPolicy']={'enabled':True}
            for name in set(adapter.MODULES.values())|{adapter.SELF}|policy.CODES:
                self.f.a['codeFiles'][name]=policy.sha((ROOT/name).read_bytes())
            old=self.f.release;self.f.raw=policy.enc(self.f.a);self.f.release=policy.sha(self.f.raw)
            (self.f.inputs/old).rename(self.f.inputs/self.f.release)
            self.f.router.release=self.f.release;self.f.router.raw=self.f.raw
            self.f.router.base=self.f.outputs/self.f.release
        self.assertEqual(self.f.coordinate()['status'],'WAITING_FOR_WRITER_APPROVAL')
        self.private_tmp=private_temporary_directory();self.addCleanup(self.private_tmp.cleanup)
        private_root=Path(self.private_tmp.name).resolve()
        self.policies=private_root/'conditional-policies';self.state=private_root/'conditional-state';self.writers=private_root/'writers'
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


class RouterTests(unittest.TestCase):
    conditional=True
    setUp=AdapterTests.setUp
    execute=AdapterTests.execute
    @classmethod
    def setUpClass(cls):AdapterTests.setUpClass()
    @classmethod
    def tearDownClass(cls):AdapterTests.tearDownClass()

    def actual_route(self):
        import types
        outer=self
        class LocalAdapter:
            def disposition(self,release,enabled=False):
                return adapter._disposition(release,(outer.policies,outer.state,outer.writers),
                    full.r.e.read,clock=lambda:dt.datetime.now(dt.timezone.utc))
            def materialize(self,release,enabled=False):
                if not (outer.policies/'by-release'/(release+'.json')).exists():
                    # Exercise the public missing-policy branch; root filesystem
                    # ownership is a fixture seam, never a live validation claim.
                    with patch.object(adapter,'POLICIES',outer.policies), patch.object(adapter,'private',full.r.e.read), patch.object(adapter.os,'geteuid',lambda:0):
                        return adapter.materialize(release,enabled=enabled)
                result=outer.execute();outer.mirror();return result
        self.f.router.modules['conditional-writer']=LocalAdapter()
        self.f.router.admission=types.MethodType(full.r.Router.admission,self.f.router)
        exists=Path.exists
        self.patch=patch.object(Path,'exists',lambda path: True if str(path) in self.f.virtual else exists(path))
        self.patch.start();self.addCleanup(self.patch.stop)

    def mirror(self):
        prefix='/etc/workspacex-cn/writer-resume-approvals/'
        path=self.writers/'by-release'/(self.f.release+'.json')
        if path.exists():
            raw=path.read_bytes();self.f.virtual[prefix+'by-release/'+self.f.release+'.json']=raw
            pin=policy.parse(raw)['approvalSha256']
            self.f.virtual[prefix+pin+'.json']=(self.writers/(pin+'.json')).read_bytes()

    def test_actual_route_automatically_materializes_then_completes(self):
        self.actual_route()
        self.assertEqual(self.f.coordinate()['status'],'CHAIN_COMPLETED')
        self.assertEqual(self.f.calls,list(full.r.e.STAGES))
        self.assertEqual(len(list((self.state/'decisions').glob('*.json'))),1)

    def test_missing_policy_keeps_waiting_without_claim(self):
        (self.policies/'by-release'/(self.f.release+'.json')).unlink()
        self.actual_route()
        self.assertEqual(self.f.coordinate()['status'],'WAITING_FOR_WRITER_APPROVAL')
        self.assertEqual(list((self.state/'claims').glob('*.json')),[])
        self.assertNotIn('clear-hold',self.f.calls)

    def test_existing_static_approval_has_priority_without_claim(self):
        self.f.approve();self.actual_route()
        self.assertEqual(self.f.coordinate()['status'],'CHAIN_COMPLETED')
        self.assertEqual(list((self.state/'claims').glob('*.json')),[])

    def generate_clear_package(self):
        previous=policy.sha((self.f.state/self.f.identity['attemptId']/'14-acceptance.receipt.json').read_bytes())
        request=self.f.router.generate(self.f.release,'clear-hold',previous)
        self.assertEqual(full.r.e.entry('status',request,self.f.identity['attemptId'])['status'],'NOT_STARTED')
        return request

    def test_generated_package_revocation_blocks_before_advance(self):
        self.execute();self.mirror();self.actual_route();request=self.generate_clear_package()
        (self.policies/'by-release'/(self.f.release+'.json')).unlink()
        self.assertEqual(self.f.router.lookup(self.f.release,'clear-hold'),request)
        with self.assertRaisesRegex(ValueError,'CONDITIONAL_CONSUMPTION_UNKNOWN'):self.f.coordinate()
        self.assertNotIn('clear-hold',self.f.calls)
        self.assertFalse((self.f.state/self.f.identity['attemptId']/'15-clear-hold.intent.json').exists())
        # Historical status/reconcile remain read-only and do not require a new grant.
        self.assertEqual(self.f.coordinate('status')['status'],'NOT_STARTED')
        self.assertEqual(self.f.coordinate('reconcile')['status'],'NOT_STARTED')

    def test_generated_static_package_retains_compatible_execution(self):
        self.f.approve();self.actual_route();self.generate_clear_package()
        self.assertEqual(self.f.coordinate()['status'],'CHAIN_COMPLETED')
        self.assertEqual(self.f.calls.count('clear-hold'),1)
        self.assertEqual(self.f.coordinate()['status'],'CHAIN_COMPLETED')
        self.assertEqual(self.f.calls.count('clear-hold'),1)

    def test_pointer_before_decision_crash_is_not_static_approval(self):
        pid=os.fork()
        if pid==0:
            original=store._Directory.publish
            def crashing(directory,name,raw):
                original(directory,name,raw)
                if name==self.f.release+'.json':os._exit(73)
            store._Directory.publish=crashing
            try:self.execute()
            except BaseException:os._exit(74)
            os._exit(75)
        _,status=os.waitpid(pid,0);self.assertEqual(os.waitstatus_to_exitcode(status),73)
        self.mirror();self.actual_route()
        with self.assertRaisesRegex(ValueError,'CONDITIONAL_CONSUMPTION_UNKNOWN'):self.f.coordinate()
        self.assertNotIn('clear-hold',self.f.calls)

    def test_policy_replacement_cannot_reset_release_consumption(self):
        self.execute()
        p=dict(self.p,policyId='d'*32);raw=policy.enc(p)
        path=self.policies/(policy.sha(raw)+'.json');path.write_bytes(raw);path.chmod(0o600)
        path=self.policies/'by-release'/(self.f.release+'.json')
        path.write_bytes(policy.enc({'policySha256':policy.sha(raw)}))
        self.mirror();self.actual_route()
        with self.assertRaisesRegex(ValueError,'CONDITIONAL_POLICY_CHANGED'):self.f.coordinate()
        self.assertNotIn('clear-hold',self.f.calls)


if __name__=='__main__':unittest.main()
