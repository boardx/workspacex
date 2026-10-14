import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('content_stage', Path(__file__).parents[1] / 'scripts/cn-release-mvp-content-stage.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
SOURCE = 'a' * 40


class ContentStageTests(unittest.TestCase):
    def inputs(self):
        request = json.dumps({'sourceRevision': SOURCE, 'expectedDatabase': 'workspacex_a1cb_20261006', 'beforeStateSha256': 'b' * 64}).encode()
        backup = json.dumps({'sourceRevision': SOURCE, 'requestSha256': M.digest(request), 'beforeStateSha256': 'b' * 64, 'status': 'Success', 'independentlyObserved': True}).encode()
        return request, backup

    def run_local(self, root, failure=None):
        # Real subprocess/OS bytes and exit status exercise durable orchestration.
        # DB semantics remain covered by the existing actual PostgreSQL tests.
        fixture = root / 'fixture.py'
        fixture.write_text('''import json,sys
mode,source,request_sha,failure=sys.argv[1:]
if mode == failure:
 print(json.dumps({'status':'REJECTED_OR_UNKNOWN'})); sys.exit(70)
row = {'beforeStateSha256':'b'*64,'expectedBeforeStateMatches':True,'sourceInputsVerified':True,'productionWrites':False} if mode == 'preflight' else {'skillVersions':2,'roleVersions':7,'workflows':1,'pendingBindings':3,'contentReadbackPassed':True,'acceptanceScope':'mvp-non-model','realModel':'SKIPPED','aiOutputQuality':'SKIPPED','skillVerificationPromotion':'NOT_PERFORMED','fullBusinessAcceptance':False}
print(json.dumps({'kind':'cn-platform-content-release-receipt-v1','mode':mode,'sourceRevision':source,'requestSha256':request_sha,'observedAt':'2026-10-14T04:00:00Z','receipt':row}))
''')
        def runner(args):
            return subprocess.run([sys.executable, str(fixture), args[4], args[7], args[6], failure or 'none'], capture_output=True, timeout=10)
        return runner

    def test_real_subprocess_retains_three_originals_and_intent(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            result = M.execute(*self.inputs(), SOURCE, '/fixed/control', sys.executable, root, runner=self.run_local(root))
            self.assertEqual(result['contentReadback'], 'PASSED')
            self.assertEqual(result['tenantProtection'], 'NOT_PROVEN_BY_CONTENT_STAGE')
            self.assertEqual(len(result['originals']), 3)
            self.assertTrue((root / 'apply-intent.json').exists())
            with self.assertRaises(FileExistsError):
                M.execute(*self.inputs(), SOURCE, '/fixed/control', sys.executable, root)

    def test_uncertain_apply_preserves_intent_and_never_readbacks_or_retries(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with self.assertRaisesRegex(ValueError, 'NO_RETRY'):
                M.execute(*self.inputs(), SOURCE, '/fixed/control', sys.executable, root, runner=self.run_local(root, 'apply'))
            self.assertTrue((root / 'apply-intent.json').exists())
            self.assertTrue((root / 'apply.json').exists())
            self.assertFalse((root / 'readback.json').exists())

    def test_preflight_failure_has_no_apply_intent(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with self.assertRaises(ValueError):
                M.execute(*self.inputs(), SOURCE, '/fixed/control', sys.executable, root, runner=self.run_local(root, 'preflight'))
            self.assertFalse((root / 'apply-intent.json').exists())

    def test_backup_cross_release_rejected_before_any_command(self):
        request, backup = self.inputs()
        value = json.loads(backup)
        value['sourceRevision'] = 'c' * 40
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError, 'BACKUP_BINDING'):
                M.execute(request, json.dumps(value).encode(), SOURCE, '/fixed/control', sys.executable, d)
            self.assertEqual(list(Path(d).iterdir()), [])

    def test_shell_commands_are_not_an_interface(self):
        with self.assertRaisesRegex(ValueError, 'IDENTITY'):
            M.command('apply', '/fixed', '/node', '/input', '$(touch /tmp/x)', 'a' * 64, '/backup', 'b' * 64)

    def test_duplicate_receipt_keys_rejected(self):
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_KEY'):
            M.decode(b'{"mode":"apply","mode":"readback"}')


if __name__ == '__main__':
    unittest.main()
