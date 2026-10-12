"""Real local failed-worker evidence; never calls GitHub or OSS."""
import importlib.util
import json
import multiprocessing
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('failure_uploader', ROOT/'scripts/cn-hk-original-artifact-upload.py')
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)


class AcceptedPutThenDisconnect:
    def __init__(self, output):
        self.output = output

    def __call__(self, name):
        u.save_json(self.output/(name+'.put-intent.json'), {
            'key': 'runs/38146134231/1/'+name+'.zip',
            'sha256': 'a'*64, 'bytes': 3})
        # Models an accepted request whose response cannot be observed.
        raise ConnectionError('SECRET_PROVIDER_BODY_MUST_NOT_ESCAPE')


class FailureEvidence(unittest.TestCase):
    def retention_step(self):
        text = (ROOT/'.github/workflows/transfer-cn-candidates-via-hongkong.yml').read_text()
        return text.split('      - name: Retain only sanitized receipt', 1)[1]

    def test_failed_transfer_always_retains_only_bounded_diagnostics(self):
        step = self.retention_step()
        self.assertIn('if: ${{ always() }}', step)
        paths = [line.strip() for line in step.splitlines() if '${{ runner.temp }}' in line]
        selected = {p.split('/hk-original-artifacts/', 1)[1] for p in paths}
        self.assertEqual(selected, {
            'receipt.json', 'revalidation/hk-cloud-proof/candidate-revalidation.json',
            'revalidation/revalidation-policy.json', '*.put-intent.json',
            '*.worker-result.json', 'pipeline-failed.json', 'proof-failed.json',
            'pipeline-complete.json'})
        self.assertIn('retention-days: 1', step)
        self.assertIn('if-no-files-found: warn', step)
        self.assertNotIn('continue-on-error', step)

    def test_real_child_disconnect_preserves_intent_without_secret_or_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            with self.assertRaises(Exception):
                u.pipeline({'artifacts': {'api': {}}}, output, 5,
                           worker=AcceptedPutThenDisconnect(output),
                           context=multiprocessing.get_context('fork'))
            intent = json.loads((output/'api.put-intent.json').read_bytes())
            self.assertEqual(intent['bytes'], 3)
            failed = json.loads((output/'pipeline-failed.json').read_bytes())
            self.assertFalse(failed['externalWritesTerminal'])
            self.assertFalse(failed['retryAllowed'])
            self.assertEqual(failed['states']['api'], 'failed-or-unknown')
            self.assertFalse((output/'receipt.json').exists())
            self.assertNotIn(b'SECRET_PROVIDER', b''.join(p.read_bytes() for p in output.iterdir()))


if __name__ == '__main__':
    unittest.main()
