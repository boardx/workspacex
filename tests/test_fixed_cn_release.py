"""Offline orchestration integration: actual publisher CLI, fake Docker, loopback HTTP."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import shutil
import time
import unittest
from test_minimal_docker_release import Tests as DockerFixture

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixed', ROOT / 'scripts/fixed-cn-release.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
# Avoid unittest discovering the imported fixture twice.
del DockerFixture
import test_minimal_docker_release as fixture


def metadata():
    run = dict(id=m.RUN, head_sha=m.CONTROL, run_attempt=1, status='completed',
               conclusion='success', path='.github/workflows/build-cn-image-candidates.yml')
    names = (['cn-image-candidate-set', 'cn-candidate-plan']
             + ['cn-image-candidate-' + r for r in m.ROLES]
             + ['cn-image-candidate-metadata-' + r for r in m.ROLES])
    artifacts = [dict(id=i + 1, name=f'{n}-{m.RUN}-1', expired=False,
                      expires_at='2030-01-01T00:00:00Z', size_in_bytes=20)
                 for i, n in enumerate(names)]
    return run, artifacts


class Integration(unittest.TestCase):
    def setUp(self):
        self.f = fixture.Tests('runTest')
        self.f.setUp()
        self.root = self.f.root
        self.calls = []
        self.release_result = None

    def tearDown(self):
        evidence = Path('/tmp/fixed-cn-simulation-evidence') / self._testMethodName
        evidence.mkdir(parents=True, exist_ok=True)
        for result in self.root.glob('*/result.json'):
            dest = evidence / result.parent.name
            dest.mkdir(exist_ok=True)
            for file in result.parent.glob('*.json'):
                if file.name == 'result.json' or '.intent.' in file.name or '.evidence.' in file.name or '.receipt.' in file.name:
                    shutil.copyfile(file, dest / file.name)
        self.f.tearDown()

    def adapter(self, stage, timeout):
        self.calls.append(stage)
        details = {}
        if stage == 'candidate':
            run, artifacts = metadata()
            details = m.admission(run, artifacts, dt.datetime.now(dt.timezone.utc))
            self.assertFalse(details['ready'])
        elif stage == 'readonly-preflight':
            before = self.f.statepath.read_bytes()
            details = {'composeHash': m.sha((self.root / 'compose.json').read_bytes()),
                       'envHash': m.sha((self.root / 'existing.env').read_bytes())}
            self.assertEqual(before, self.f.statepath.read_bytes())
        elif stage == 'image-transfer':
            # Files stand for synthetic archive bytes, never production images.
            dest = self.root / 'transferred'; dest.mkdir()
            details = {}
            for role in m.ROLES:
                source = self.root / (role + '.fixture-archive')
                source.write_bytes(('synthetic archive ' + role).encode())
                shutil.copyfile(source, dest / source.name)
                pin = m.sha(source.read_bytes())
                self.assertEqual(pin, m.sha((dest / source.name).read_bytes()))
                details[role] = pin
        elif stage == 'compose-image-only':
            proc, result = self.f.run_cli(True)
            self.assertEqual(proc.returncode, 0, result)
            self.assertEqual(result['status'], 'SUCCEEDED')
            self.assertFalse(result['schemaMigrationExecuted'])
            self.release_result = result
            details = result
        elif stage == 'health':
            self.assertEqual(self.release_result['health']['httpStatus'], 200)
            self.assertEqual(sum('up' in c for c in self.f.actual['calls']), 1)
            details = self.release_result['health']
        elif stage == 'business':
            # Synthetic create/read journey; explicitly not canonical production acceptance.
            artifact = self.root / 'synthetic-business-output.json'
            artifact.write_text(json.dumps({'title': 'isolated fixture output', 'source': m.SOURCE}))
            self.assertEqual(json.loads(artifact.read_text())['source'], m.SOURCE)
            details = {'journey': 'synthetic-create-read', 'outputSha256': m.sha(artifact.read_bytes())}
        return m.raw(dict(stage=stage, source=m.SOURCE, control=m.CONTROL, run=m.RUN,
                          simulation=True, passed=True, details=details))

    def test_complete_chain(self):
        out = self.root / 'chain'
        result = m.simulate(out, self.adapter)
        self.assertEqual(result['status'], 'SIMULATION_PASSED')
        self.assertEqual(self.calls, list(m.STAGES))
        self.assertFalse(result['productionAccepted'])
        before_calls = list(self.calls)
        with self.assertRaises(FileExistsError):
            m.simulate(out, self.adapter)
        self.assertEqual(self.calls, before_calls)
        self.assertEqual(sum('up' in c for c in self.f.actual['calls']), 1)
        for row in result['completed']:
            self.assertEqual(row['sha256'], m.sha((out / (row['stage'] + '.evidence.json')).read_bytes()))
        # Durable CI artifact, fixture data only.
        evidence = Path('/tmp/fixed-cn-simulation-evidence')
        evidence.mkdir(exist_ok=True)
        shutil.copyfile(out / 'result.json', evidence / 'success.json')
        for file in out.glob('*.json'):
            shutil.copyfile(file, evidence / file.name)

    def test_each_stage_failure_stops(self):
        for stage in m.STAGES:
            with self.subTest(stage=stage):
                calls = []
                def fail(s, timeout):
                    calls.append(s)
                    if s == stage:
                        raise m.Rejected('INJECTED_FAILURE')
                    return m.raw(dict(stage=s, source=m.SOURCE, control=m.CONTROL,
                                      run=m.RUN, simulation=True, passed=True))
                result = m.simulate(self.root / ('failed-' + stage), fail)
                self.assertEqual(result['failedStage'], stage)
                self.assertEqual(result['code'], 'INJECTED_FAILURE')
                self.assertEqual(calls[-1], stage)
                self.assertEqual(len(calls), m.STAGES.index(stage) + 1)

    def test_missing_evidence(self):
        result = m.simulate(self.root / 'missing', lambda *_: b'')
        self.assertEqual(result['code'], 'EVIDENCE_MISSING')
        self.assertEqual(result['completed'], [])

    def test_candidate_mismatch_no_calls(self):
        result = m.simulate(self.root / 'mismatch', self.adapter, source='a' * 40)
        self.assertEqual(result['code'], 'FIXED_SOURCE_MISMATCH')
        self.assertEqual(self.calls, [])

    def test_repeat_cannot_replay(self):
        out = self.root / 'once'
        m.simulate(out, lambda *_: b'')
        before = (out / 'result.json').read_bytes()
        with self.assertRaises(FileExistsError):
            m.simulate(out, self.adapter)
        self.assertEqual(before, (out / 'result.json').read_bytes())
        self.assertEqual(self.calls, [])

    def test_wrong_evidence_binding(self):
        for field, value in [('source', 'a' * 40), ('simulation', False), ('passed', False),
                             ('stage', 'business'), ('control', 'b' * 40), ('run', 1)]:
            with self.subTest(field=field):
                row = dict(stage='candidate', source=m.SOURCE, control=m.CONTROL, run=m.RUN,
                           simulation=True, passed=True)
                row[field] = value
                result = m.simulate(self.root / field, lambda *_: m.raw(row))
                self.assertEqual(result['status'], 'SIMULATION_FAILED')
                self.assertEqual(result['completed'], [])

    def test_stage_timeout(self):
        old = m.TIMEOUTS['candidate']; m.TIMEOUTS['candidate'] = .03
        try:
            result = m.simulate(self.root / 'timeout', lambda *_: time.sleep(.2))
            self.assertEqual(result['code'], 'STAGE_TIMEOUT')
        finally:
            m.TIMEOUTS['candidate'] = old


class Admission(unittest.TestCase):
    def test_metadata_does_not_claim_ready(self):
        r, a = metadata()
        result = m.admission(r, a, dt.datetime.now(dt.timezone.utc))
        self.assertFalse(result['ready'])
        self.assertFalse(result['downloadVerified'])

    def test_expired_even_if_github_flag_false(self):
        r, a = metadata(); a[0]['expires_at'] = '2020-01-01T00:00:00Z'
        with self.assertRaisesRegex(m.Rejected, 'ARTIFACT_EXPIRED'):
            m.admission(r, a, dt.datetime.now(dt.timezone.utc))

    def test_missing_duplicate_and_empty_artifacts(self):
        for mode in ('missing', 'duplicate', 'empty'):
            with self.subTest(mode=mode):
                r, a = metadata()
                if mode == 'missing': a.pop()
                if mode == 'duplicate': a.append(a[0])
                if mode == 'empty': a[0]['size_in_bytes'] = 0
                with self.assertRaises(m.Rejected):
                    m.admission(r, a, dt.datetime.now(dt.timezone.utc))

    def test_wrong_control_or_run(self):
        for field, value in [('head_sha', 'a' * 40), ('id', 1), ('run_attempt', 2),
                             ('conclusion', 'failure'), ('path', 'other.yml')]:
            with self.subTest(field=field):
                r, a = metadata(); r[field] = value
                with self.assertRaises(m.Rejected):
                    m.admission(r, a, dt.datetime.now(dt.timezone.utc))


if __name__ == '__main__':
    unittest.main()
