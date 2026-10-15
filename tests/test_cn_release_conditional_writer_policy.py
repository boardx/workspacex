"""Pure evaluator counterexamples; no root approval/install/cloud integration."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('conditional_writer', Path(__file__).resolve().parents[1] / 'scripts/cn-release-conditional-writer-policy.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 10, 12, 10, 5, tzinfo=dt.timezone.utc)
        r = dict(sourceRevision='a'*40, baselineRevision='b'*40, controlRevision='c'*40,
                 publicationAttemptId='build-one', attemptId='release-one',
                 requestedAt='2026-10-12T10:00:00Z', deadlineAt='2026-10-12T10:30:00Z')
        self.release = m.enc(dict(kind='cn-fixed-release-approval-v1', identity=r, target=m.TARGET,
                                 issuedAt=r['requestedAt'], expiresAt=r['deadlineAt']))
        hold = {'state': 'held', 'generation': '9'*32}
        binding = {k: v for k, v in r.items() if k != 'publicationAttemptId'} | {'hold': hold}
        self.inputs = dict(binding=m.enc(binding), hold=m.enc(hold), switchReceipt=m.enc({'switched': True}),
                           userAuthorization=b'explicit approved scope', testDataScope=m.enc({'org': 'fixture'}))
        self.inputs['status'] = m.enc({'bindingSha256': m.sha(self.inputs['binding']),
                                      'switchReceiptSha256': m.sha(self.inputs['switchReceipt'])})
        self.p = dict(kind='cn-conditional-writer-policy-v1', policyId='e'*32,
                      releaseSha256=m.sha(self.release), identity=r, target=m.TARGET,
                      issuedAt=r['requestedAt'], expiresAt=r['deadlineAt'],
                      imageDigests={k: 'sha256:'+'f'*64 for k in m.IMAGES},
                      codeFiles={k: 'd'*64 for k in m.CODES},
                      evidencePins={k: m.sha(self.inputs[k]) for k in ('userAuthorization', 'testDataScope')},
                      scope=m.SCOPE, publicOrigin=m.ORIGIN, maxObservationAgeSeconds=60)
        self.o = dict(kind='cn-verified-writer-chain-projection-v1', releaseSha256=m.sha(self.release),
                      identity=r, target=m.TARGET, observedAt=self.now.isoformat(), holdGeneration='9'*32,
                      inputHashes={k: m.sha(v) for k, v in self.inputs.items()}, imageDigests=self.p['imageDigests'])

    def call(self, **overrides):
        policy, obs = m.enc(self.p), m.enc(self.o)
        args = dict(approved_policy_sha256=m.sha(policy), verified_observation_sha256=m.sha(obs),
                    observed_code_hashes=self.p['codeFiles'], consumed_policy_ids=(), now=self.now, enabled=True)
        args.update(overrides)
        return m.derive_proposal(policy, self.release, obs, self.inputs, **args)

    def test_compatible_uninstalled_proposal(self):
        result = self.call()
        w = m.parse(result['writerApprovalRaw'])
        self.assertEqual(set(w), {'kind', 'releaseSha256', 'identity', 'target', 'issuedAt', 'expiresAt',
                                'holdGeneration', 'scope', 'publicOrigin'} | set(m.INPUTS.values()))
        self.assertEqual(w['holdGeneration'], '9'*32)
        self.assertFalse(result['executionAuthorized'])
        self.assertFalse(result['installed'])
        self.assertTrue(result['requiresAtomicConsumption'])
        self.assertTrue(result['requiresTerminalChainRecheck'])
        self.assertEqual(result['cloudCalls'], 0)

    def test_default_disabled(self):
        with self.assertRaisesRegex(ValueError, 'POLICY_DISABLED'):
            m.derive_proposal(m.enc(self.p), self.release, m.enc(self.o), self.inputs)

    def test_no_approval(self):
        with self.assertRaisesRegex(ValueError, 'POLICY_NOT_APPROVED'):
            self.call(approved_policy_sha256=None)

    def test_tampered_policy(self):
        old = m.sha(m.enc(self.p)); self.p['policyId'] = 'f'*32
        with self.assertRaisesRegex(ValueError, 'POLICY_NOT_APPROVED'):
            self.call(approved_policy_sha256=old)

    def test_no_independent_observation(self):
        with self.assertRaisesRegex(ValueError, 'OBSERVATION_NOT_VERIFIED'):
            self.call(verified_observation_sha256=None)

    def test_wrong_generation(self):
        self.o['holdGeneration'] = '8'*32
        with self.assertRaisesRegex(ValueError, 'HOLD_GENERATION'): self.call()

    def test_expired(self):
        with self.assertRaisesRegex(ValueError, 'RELEASE_EXPIRED'):
            self.call(now=self.now + dt.timedelta(minutes=25))

    def test_policy_expired(self):
        self.p['expiresAt'] = self.now.isoformat()
        with self.assertRaisesRegex(ValueError, 'POLICY_EXPIRED'): self.call()

    def test_stale_or_future_observation(self):
        for seconds in (-61, 1):
            self.o['observedAt'] = (self.now + dt.timedelta(seconds=seconds)).isoformat()
            with self.assertRaisesRegex(ValueError, 'OBSERVATION_STALE'): self.call()

    def test_duplicate_json(self):
        raw = m.enc(self.p).replace(b'{', b'{"kind":"duplicate",', 1)
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_KEY'):
            m.derive_proposal(raw, self.release, m.enc(self.o), self.inputs, enabled=True,
                             approved_policy_sha256=m.sha(raw), verified_observation_sha256=m.sha(m.enc(self.o)))

    def test_known_replay_and_duplicate_history(self):
        for ids, code in ((('e'*32,), 'POLICY_REPLAY'), (('a'*32, 'a'*32), 'DUPLICATE_HISTORY')):
            with self.assertRaisesRegex(ValueError, code): self.call(consumed_policy_ids=ids)

    def test_history_is_required(self):
        with self.assertRaisesRegex(ValueError, 'HISTORY_REQUIRED'): self.call(consumed_policy_ids=None)

    def test_code_changed(self):
        hashes = dict(self.p['codeFiles']); hashes[next(iter(hashes))] = '0'*64
        with self.assertRaisesRegex(ValueError, 'CODE_PINS'): self.call(observed_code_hashes=hashes)

    def test_raw_input_tamper(self):
        self.inputs['switchReceipt'] += b' '
        with self.assertRaisesRegex(ValueError, 'OBSERVATION_RAW_HASHES'): self.call()

    def test_five_images_exact(self):
        self.p['imageDigests'] = dict(self.p['imageDigests']); self.p['imageDigests'].pop('postgres')
        with self.assertRaisesRegex(ValueError, 'FIVE_IMAGES'): self.call()

    def test_different_observed_image(self):
        self.o['imageDigests'] = dict(self.o['imageDigests']); self.o['imageDigests']['api'] = 'sha256:'+'0'*64
        with self.assertRaisesRegex(ValueError, 'OBSERVATION_BINDING'): self.call()

    def test_target_or_identity_changed(self):
        for field, value in (('target', {}), ('identity', {})):
            original = self.p[field]; self.p[field] = value
            with self.assertRaises(ValueError): self.call()
            self.p[field] = original

    def test_hold_mismatch_even_with_new_observation_hash(self):
        hold = m.parse(self.inputs['hold']); hold['generation'] = '8'*32
        self.inputs['hold'] = m.enc(hold)
        self.o['inputHashes']['hold'] = m.sha(self.inputs['hold'])
        with self.assertRaisesRegex(ValueError, 'HOLD_GENERATION'): self.call()


if __name__ == '__main__':
    unittest.main()
