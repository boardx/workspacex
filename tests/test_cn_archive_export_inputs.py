import importlib.util
from pathlib import Path
import unittest
from test_cn_image_archive import plan, c
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('inputs', ROOT/'scripts/check-cn-archive-export-inputs.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class InputsTests(unittest.TestCase):
    def setUp(self):
        self.build=plan();self.raw=c.json_bytes(self.build);self.calls=[]
    def command(self, repository, args):
        self.calls.append(args)
        if args == ['rev-parse','HEAD']:return 0,self.build['controlRevision'].encode()
        if args == ['rev-parse','refs/remotes/origin/main']:return 0,self.build['controlRevision'].encode()
        return 0,b''
    def test_valid_input_never_claims_dispatch_or_production_ready(self):
        result=m.check(self.raw,c.sha(self.raw),ROOT,self.command)
        self.assertEqual(result['codeBlockers'],[]);self.assertEqual(len(result['services']),5)
        self.assertFalse(result['ready']);self.assertFalse(result['buildStarted'])
        self.assertIn('artifact-storage-and-download-allowance',result['externalInputsRequired'])
        self.assertTrue(all(a[0] in ('rev-parse','merge-base','cat-file') for a in self.calls))
    def test_source_and_control_main_gate_and_registration(self):
        def missing(repository,args):
            if args[0] in ('merge-base','cat-file'):return 1,b''
            return self.command(repository,args)
        result=m.check(self.raw,c.sha(self.raw),ROOT,missing)
        self.assertEqual(len(result['codeBlockers']),3)
        self.assertIn('FORMAL_WORKFLOW_NOT_IN_LOCAL_MAIN',result['codeBlockers'])
    def test_raw_hash_failure_precedes_any_git(self):
        with self.assertRaisesRegex(c.Rejected,'PLAN_RAW_HASH_MISMATCH'):m.check(self.raw,'f'*64,ROOT,self.command)
        self.assertEqual(self.calls,[])
    def test_invalid_contract_precedes_any_git(self):
        self.build['maxTotalBytes']=1;raw=c.json_bytes(self.build)
        with self.assertRaises(c.Rejected):m.check(raw,c.sha(raw),ROOT,self.command)
        self.assertEqual(self.calls,[])
    def test_control_ancestor_is_not_dispatch_tip(self):
        def newer(repository,args):
            if args==['rev-parse','refs/remotes/origin/main']:return 0,b'c'*40
            return self.command(repository,args)
        result=m.check(self.raw,c.sha(self.raw),ROOT,newer)
        self.assertIn('CONTROL_NOT_LOCAL_MAIN_TIP',result['codeBlockers'])
    def test_missing_git_metadata_fails_closed(self):
        with self.assertRaisesRegex(c.Rejected,'LOCAL_HEAD_UNAVAILABLE'):
            m.check(self.raw,c.sha(self.raw),ROOT,lambda *_:(1,b''))


if __name__=='__main__':unittest.main()
