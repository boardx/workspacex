"""Local diagnostics/fixture-shape regressions, never Linux execution evidence."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

SOURCE = Path(__file__).with_name('cn_release_boundary_reap_linux.py')
spec = importlib.util.spec_from_file_location('reap_diagnostic', SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ReapDiagnostic(unittest.TestCase):
    def test_large_secret_text_is_only_hashed(self):
        raw = b'password=do-not-output token=hidden https://secret.invalid/' * 2000
        value = m.child_diagnostic('child-exit', 1, raw, raw)
        encoded = json.dumps(value)
        self.assertLessEqual(len(encoded.encode()), 8192)
        for secret in ('do-not-output', 'hidden', 'secret.invalid', 'password='):
            self.assertNotIn(secret, encoded)
        self.assertEqual(value['stdout']['bytes'], len(raw))
        self.assertEqual(value['stdout']['sha256'], hashlib.sha256(raw).hexdigest())

    def test_allowlisted_reason_and_owned_process_facts_survive(self):
        out = json.dumps({'workerFailure': {'group': 100, 'expectedChild': 101,
            'adoptedChildren': [101], 'states': ['Z'], 'reason': 'TIMEOUT', 'exitCode': -9,
            'extra': 'secret-not-exported'}}).encode()
        value = m.child_diagnostic('child-exit', 1, out, b'RuntimeError: ADOPTED_MEMBER_NOT_OWNED_ZOMBIE\n')
        self.assertEqual(value['reasonCodes'], ['ADOPTED_MEMBER_NOT_OWNED_ZOMBIE'])
        self.assertEqual(value['workerFacts']['states'], ['Z'])
        self.assertNotIn('secret-not-exported', json.dumps(value))

    def test_unknown_stage_and_reason_do_not_escape(self):
        value = m.child_diagnostic('secret-stage', 1, b'not json', b'RuntimeError: PRIVATE_SECRET\n')
        self.assertEqual(value['stage'], 'unknown')
        self.assertEqual(value['reasonCodes'], [])
        self.assertEqual(value['workerFacts'], {})

    def test_fixed_source_frame_and_errno_without_traceback_text(self):
        raw = b'  File "/secret/path/cn_release_boundary_reap_linux.py", line 77, in worker\nPermissionError: [Errno 13] secret filename\n'
        value = m.child_diagnostic('child-exit', 1, stderr=raw)
        self.assertEqual(value['sourceFrames'], [{'file': 'cn_release_boundary_reap_linux.py', 'line': 77}])
        self.assertEqual(value['errorTypes'], ['PermissionError'])
        self.assertEqual(value['errno'], [13])
        self.assertNotIn('secret', json.dumps(value))

    def test_malformed_worker_objects_do_not_mask_failure(self):
        for value in ([], None, 'secret', {'workerFailure': []}, {'workerFailure': None}):
            self.assertEqual(m.child_diagnostic('child-exit', 1, json.dumps(value).encode())['workerFacts'], {})

    def test_invalid_process_facts_do_not_escape(self):
        out = json.dumps({'workerFailure': {'group': True, 'expectedChild': 'secret',
            'adoptedChildren': ['secret'], 'states': ['secret'], 'reason': 'secret'}}).encode()
        self.assertEqual(m.child_diagnostic('child-json', 0, out)['workerFacts'], {})

    def test_counterexample_requires_real_child_handshake_and_retained_parent(self):
        tree = ast.parse(SOURCE.read_text())
        worker = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'worker')
        raw = next(n.value.value for n in ast.walk(worker) if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'raw' for t in n.targets))
        self.assertEqual(raw, b'sleep 30 &\nchild=$!\nprintf "%s\\n" "$child"\nwait "$child"\n')
        self.assertNotIn(b'\\nwait', raw)
        text = SOURCE.read_text()
        self.assertIn("adopted == [expected_child]", text)
        self.assertIn("not entry.alive(group)", text)
        self.assertIn("not entry.alive(new_group)", text)


if __name__ == '__main__':
    unittest.main()
