import importlib.util
from pathlib import Path
import subprocess
import unittest

spec = importlib.util.spec_from_file_location('registration', Path(__file__).resolve().parents[1] / 'scripts/verify-cn-main-registration.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RegistrationTests(unittest.TestCase):
    def facts(self):
        return {'repository': 'boardx/workspacex', 'observedMain': 'a'*40, 'controlRevision': 'a'*40, 'sourceRevision': 'b'*40, 'prepareState': 'disabled_manually', 'pr': {'number':5512,'state':'closed','draft':False,'head':'c'*40,'merged':True,'mergeCommit':'a'*40}}
    def git(self, args):
        return "on:\n  workflow_dispatch:\n    inputs:\n      plan:\n        required: true\njobs:\n  export: {}" if args[0] == 'show' else ''
    def test_consistent_offline_inputs(self):
        result=module.verify(self.facts(),self.git)
        self.assertFalse(result['ready']);self.assertTrue(result['inputConsistent']);self.assertEqual(result['evidenceClass'],'OFFLINE_INPUT_CONSISTENCY');self.assertFalse(result['productionAuthorized'])
    def test_open_draft_cannot_freeze(self):
        f=self.facts();f['pr'].update(state='open',draft=True,merged=False,mergeCommit=None)
        self.assertFalse(module.verify(f,self.git)['inputConsistent'])
    def test_each_missing_identity_proof_blocks(self):
        for key,value in [('prepareState','active'),('controlRevision','d'*40),('observedMain','e'*40)]:
            f=self.facts();f[key]=value
            self.assertFalse(module.verify(f,self.git)['inputConsistent'])
    def test_git_failure_blocks(self):
        def broken(args): raise subprocess.CalledProcessError(1,args)
        self.assertFalse(module.verify(self.facts(),broken)['inputConsistent'])
    def test_branch_alias_and_extra_field_rejected(self):
        for f in [dict(self.facts(),sourceRevision='main'),dict(self.facts(),token='forbidden')]:
            with self.assertRaises(ValueError):module.verify(f,self.git)
    def test_unregistered_export_blocks(self):
        self.assertFalse(module.verify(self.facts(),lambda args:'')['inputConsistent'])

    def test_automatic_events_and_dispatch_comments_are_not_proof(self):
        for text in ['on:\n  push:\n  workflow_dispatch:\njobs: {}',
                     'on:\n  workflow_run:\n    workflows: [backend-gates]\n  workflow_dispatch:\njobs: {}',
                     '# on:\n#   workflow_dispatch:\non:\n  push:\njobs: {}',
                     'on: [workflow_dispatch, push]',
                     'on:\n  workflow_dispatch:\non:\n  push:']:
            result=module.verify(self.facts(),lambda args:text if args[0]=='show' else '')
            self.assertFalse(result['inputConsistent']);self.assertFalse(result['ready'])
    def test_fabricated_consistent_facts_never_authorize(self):
        result=module.verify(self.facts(),self.git)
        self.assertFalse(result['ready']);self.assertFalse(result['productionAuthorized'])
        self.assertTrue(any('unauthenticated' in x for x in result['limitations']))

if __name__ == '__main__':unittest.main()
