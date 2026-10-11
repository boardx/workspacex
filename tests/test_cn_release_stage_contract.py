import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/('cn-release-'+name+'.py'))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
c=load('stage-contract')

class ContractTests(unittest.TestCase):
    def context(self,stage):
        prior={'requestSha256':'a'*64,'stage':'backup'}
        return prior, {'previousReceiptSha256':c.e.digest(c.e.encode(prior)),'stage':stage}
    def test_rds_entry_previous_object_and_strict_result_all_modes(self):
        prior,m=self.context('rds-backup');raw=b'{"backup":"exact"}\n';seen=[]
        def verify(raw2,m2,p,mode,release):
            self.assertEqual(p,m['previousReceiptSha256']);seen.append(mode)
            return {'valid':True,'externalWritesTerminal':True,'backupReceiptSha256':c.e.digest(raw2),'isolatedRestoreTested':False}
        with patch.object(c,'context',return_value=({}, {},m,'f'*64)),patch.object(c,'load',return_value=SimpleNamespace(verify=verify)):
            for mode in ('advance','reconcile','terminal'):
                self.assertEqual(c.verify('rds-backup',raw,m,prior,mode),{'externalWritesTerminal':True} if mode=='terminal' else True)
        self.assertEqual(seen,['advance','reconcile','terminal'])
    def test_rds_false_or_wrong_raw_never_terminal(self):
        prior,m=self.context('rds-backup')
        for result in ({'valid':False,'externalWritesTerminal':True,'backupReceiptSha256':c.e.digest(b'x')},
                       {'valid':True,'externalWritesTerminal':True,'backupReceiptSha256':'0'*64},
                       {'valid':True,'externalWritesTerminal':False,'backupReceiptSha256':c.e.digest(b'x')}):
            with patch.object(c,'context',return_value=({}, {},m,'f'*64)),patch.object(c,'load',return_value=SimpleNamespace(verify=lambda *a:result)):
                with self.assertRaisesRegex(c.e.Rejected,'RDS_RESULT_CONTRACT'):c.verify('rds-backup',b'x',m,prior,'terminal')
    def test_business_previous_digest_all_modes(self):
        prior,m=self.context('observe')
        def verify(raw,m,p,mode,release):
            self.assertEqual(p,m['previousReceiptSha256'])
            return {'externalWritesTerminal':True} if mode=='terminal' else True
        with patch.object(c,'context',return_value=({}, {},m,'f'*64)),patch.object(c,'load',return_value=SimpleNamespace(verify=verify)):
            for mode in ('advance','reconcile','terminal'):
                self.assertEqual(c.verify('observe',b'x',m,prior,mode),{'externalWritesTerminal':True} if mode=='terminal' else True)
    def test_business_unexpected_dictionary_rejected(self):
        prior,m=self.context('observe')
        with patch.object(c,'context',return_value=({}, {},m,'f'*64)),patch.object(c,'load',return_value=SimpleNamespace(verify=lambda *a:{'valid':True})):
            with self.assertRaisesRegex(c.e.Rejected,'BUSINESS_RESULT_CONTRACT'):c.verify('observe',b'x',m,prior,'advance')
    def test_staging_requires_preserved_binding_versions(self):
        root=Path('/var/lib/workspacex-cn/runtime/upgrade-f0eb-fixture')
        current=b'{"phase":"switch"}\n';old=b'{"phase":"backup"}\n'
        ctx={'remoteRoot':str(root),'phase':'switch','bindingSha256':c.e.digest(current),'expectedOldBindingSha256':c.e.digest(old),'filesSha256':{'binding.json':c.e.digest(current)}}
        files={root/'binding.json':current,root/'bindings'/(c.e.digest(current)+'.json'):current,root/'bindings'/(c.e.digest(old)+'.json'):old}
        with patch.object(c.e,'read',lambda p,*args:files[p]):
            self.assertTrue(c.e.decode(c.staged(ctx))['originalBindingsPreserved'])
            files[root/'bindings'/(c.e.digest(old)+'.json')]=b'changed'
            with self.assertRaisesRegex(c.e.Rejected,'BINDING_VERSION_CHANGED'):c.staged(ctx)
            del files[root/'bindings'/(c.e.digest(old)+'.json')]
            with self.assertRaises(KeyError):c.staged(ctx)

    def test_fresh_root_pointer_routes_original_manifest_and_raw(self):
        prior,m=self.context('switch');release='f'*64;identity={'attemptId':'fixture'}
        request=c.e.digest(c.e.encode(m));fresh=c.e.encode({'releaseSha256':release,
            'failedRequestSha256':request,'failedStage':'switch','identity':identity})
        pin=c.e.digest(fresh);pointer=c.e.encode({'approvalSha256':pin})
        files={c.RECOVERY_APPROVALS/'by-failed-request'/(request+'.json'):pointer,
               c.RECOVERY_APPROVALS/(pin+'.json'):fresh}
        seen=[]
        def verify(raw,manifest,previous,mode,ctx):
            seen.append((raw,manifest,previous,mode,ctx))
            return {'externalWritesTerminal':True,'safeToRecover':True}
        with patch.object(c,'context',return_value=({'identity':identity},{},m,release)),patch.object(c.e,'read',lambda p,*args:files[p]),patch.object(c,'load',return_value=SimpleNamespace(verify=verify)):
            self.assertEqual(c.verify('switch',b'original',m,prior,'pre-recovery'),{'externalWritesTerminal':True,'safeToRecover':True})
            self.assertEqual(seen,[(b'original',m,prior,'pre-recovery',{'releaseSha256':release,'recoveryApprovalSha256':pin})])
            files[c.RECOVERY_APPROVALS/(pin+'.json')]=fresh+b' '
            with self.assertRaisesRegex(c.e.Rejected,'RECOVERY_APPROVAL_HASH'):c.verify('switch',b'original',m,prior,'pre-recovery')
    def test_pointer_cannot_select_foreign_identity_or_unscoped_result(self):
        prior,m=self.context('switch');release='f'*64;request=c.e.digest(c.e.encode(m))
        for identity,result,error in [({'attemptId':'foreign'}, {'externalWritesTerminal':True,'safeToRecover':True},'RECOVERY_POINTER_SCOPE'),
                                      ({'attemptId':'fixture'},True,'RECOVERY_RESULT_CONTRACT')]:
            fresh=c.e.encode({'releaseSha256':release,'failedRequestSha256':request,'failedStage':'switch','identity':identity});pin=c.e.digest(fresh)
            files={c.RECOVERY_APPROVALS/'by-failed-request'/(request+'.json'):c.e.encode({'approvalSha256':pin}),c.RECOVERY_APPROVALS/(pin+'.json'):fresh}
            with patch.object(c,'context',return_value=({'identity':{'attemptId':'fixture'}},{},m,release)),patch.object(c.e,'read',lambda p,*args:files[p]),patch.object(c,'load',return_value=SimpleNamespace(verify=lambda *args:result)):
                with self.assertRaisesRegex(c.e.Rejected,error):c.verify('switch',b'original',m,prior,'pre-recovery')

    def test_all_stages_route_both_live_and_normal_modes(self):
        for stage in c.e.STAGES:
            for mode in ('advance','reconcile','terminal'):
                expected={'externalWritesTerminal':True} if mode=='terminal' else True
                raw=c.e.encode({'local':'verified'})
                prior,m=self.context(stage);ctx={'approvalSha256':'a'*64,'requestSha256':'b'*64}
                helper=SimpleNamespace(verify=lambda *args: expected)
                if stage=='rds-backup':helper=SimpleNamespace(verify=lambda *args:{'valid':True,'externalWritesTerminal':True,'backupReceiptSha256':c.e.digest(raw)})
                with self.subTest(stage=stage,mode=mode),patch.object(c,'context',return_value=({},ctx,m,'f'*64)),patch.object(c,'load',return_value=helper),patch.object(c,'staged',return_value=raw):
                    self.assertEqual(c.verify(stage,raw,m,prior,mode),expected)

if __name__=='__main__':unittest.main()
