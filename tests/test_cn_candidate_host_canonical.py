"""Real canonical TS generation/seal/validation through the v2 host adapter.

Only final filesystem publication is captured; Docker/registry are not invoked.
The inherited atomic writer is exercised separately by archive real-CLI tests.
"""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_cn_candidate_host import h
import test_cn_archive_real_cli as fixture


class CandidateCanonicalTests(unittest.TestCase):
    def setUp(self):
        fixture.ArchiveCanonicalIntegration.setUp(self)
        self.adapter.__class__ = h.Commands
        self.adapter.approval_sha = '9'*64
        self.adapter.plan.update(candidatePlanRawSha256='1'*64,
            candidateSetRawSha256='2'*64, publicationIntentRawSha256='3'*64)
        self.binding = {k:self.adapter.plan[k] for k in ('candidatePlanRawSha256',
            'candidateSetRawSha256', 'publicationIntentRawSha256')}
        self.binding.update(candidateIdentity='4'*64, sourceRevision=fixture.fixture.SHA,
            controlRevision='5'*40, attemptId='archive-real-cli-1',
            redisImage=self.build_input['images']['redis']['image'],
            redisObservedAt=self.adapter.plan['immutableEvidence']['observedAt'],
            candidateExpiresAt=self.adapter.archive_expiry, releaseReady=False, productionReady=False)

    def test_real_canonical_six_digest_and_original_binding(self):
        captured = {}
        def store(value, manifest, seal):
            captured['manifest'] = manifest.read_bytes()
            captured['seal'] = seal.read_bytes()
            return self.adapter.receipt(value, captured['manifest'], captured['seal'])
        with patch.object(self.adapter, 'store_canonical_result', store):
            result = self.adapter.canonical_publish_candidate(self.build_input, self.binding)
        self.assertEqual(result['images'], self.build_input['images'])
        self.assertEqual(set(result['images']), {'web','api','agent','sandbox','postgres','redis'})
        self.assertEqual(result['manifestSha256'], h.a.sha(captured['manifest']))
        self.assertEqual(result['sealSha256'], h.a.sha(captured['seal']))
        for key, value in self.binding.items(): self.assertEqual(result[key], value)
        self.assertIs(h.Commands.store_canonical_result, h.legacy.Commands.store_canonical_result)
        self.assertEqual(json.loads(captured['manifest'])['sourceRevision'], fixture.fixture.SHA)

    def test_tampered_canonical_configuration_rejected_before_final_write(self):
        self.adapter.plan['canonicalConfigurationSha256'] = '0'*64
        with patch.object(self.adapter, 'store_canonical_result') as store:
            with self.assertRaisesRegex(ValueError, 'CONTROL_CONFIGURATION_HASH_MISMATCH'):
                self.adapter.canonical_publish_candidate(self.build_input, self.binding)
            store.assert_not_called()

if __name__ == '__main__': unittest.main()
