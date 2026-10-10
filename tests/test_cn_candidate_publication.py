"""Real candidate tar parsing plus isolated publication-port failure injection."""
import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cn_candidate_publication as p
import cn_image_archive as a
import cn_image_candidate as c
from test_cn_image_candidate import archive, plan, receipt


class Port:
    def __init__(self, build, images):
        self.build = build
        self.images = images
        self.events = []
        self.local_images = {}
        self.remote_images = {}
        self.fail_redis = False
        self.lost_ack = False
        self.no_commit = False
        self.on_validity = None

    def check_validity(self):
        if self.on_validity:
            self.on_validity()

    def local(self, tag):
        return self.local_images.get(tag)

    def image(self, service):
        return {'Id': self.images[service]['imageId'], 'Os': 'linux', 'Architecture': 'amd64',
                'Config': {'Labels': {'org.opencontainers.image.revision': self.build['sourceRevision'],
                                      c.LABEL: c.identity(self.build)}}}

    def protect_running_targets(self, *_):
        self.events.append('protect')

    def authenticate(self):
        self.events.append('authenticate')

    def remote_config_id(self, tag):
        return self.remote_images.get(tag, {}).get('Id')

    def pull_required(self, reference):
        self.events.append('redis-pull')
        if self.fail_redis:
            raise a.Rejected('FAKE_REDIS_AUTH_FAILURE')
        self.local_images[reference] = {'Os': 'linux', 'Architecture': 'amd64'}

    def registry_digest(self, reference, image):
        if '@' in reference:
            self.events.append('redis-readback')
            return reference
        return reference.rsplit(':', 1)[0] + '@sha256:' + '7' * 64

    def pull_optional(self, tag):
        self.events.append('pull:' + tag)
        return self.remote_images.get(tag)

    def load(self, path):
        self.events.append('load:' + path.stem)
        self.local_images[self.images[path.stem]['stagingTag']] = self.image(path.stem)

    def tag(self, source, target):
        self.events.append('tag:' + target)
        self.local_images[target] = self.local_images[source]

    def push(self, target):
        self.events.append('push:' + target)
        if not self.no_commit:
            self.remote_images[target] = self.local_images[target]
        return not self.lost_ack

    def canonical_publish_candidate(self, value, binding):
        self.events.append('seal')
        return {'manifestInput': value, 'binding': binding}

    def remove_owned_tag(self, tag, image_id):
        self.events.append('cleanup:' + tag)
        self.local_images.pop(tag, None)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.plan = plan()
        self.plan_raw = a.json_bytes(self.plan)
        self.images = {s: archive(self.folder / (s + '.tar'), self.plan, s) for s in a.REPOSITORIES}
        self.receipt = receipt(self.plan, self.images)
        self.raw = a.json_bytes(self.receipt)
        self.intent = {'kind': 'cn-candidate-publication-intent-v2', 'schemaVersion': 2,
                       'candidatePlanRawSha256': a.sha(self.plan_raw), 'candidateSetRawSha256': a.sha(self.raw),
                       'candidateIdentity': c.identity(self.plan),
                       **{key: self.plan[key] for key in ('sourceRevision', 'controlRevision', 'attemptId')},
                       'release': '2026.10.10', 'registryPrefix': a.PREFIX,
                       'redisImage': a.PREFIX + '/base-redis@sha256:' + '6' * 64}
        self.port = Port(self.plan, self.images)

    def invoke(self):
        intent_raw = a.json_bytes(self.intent)
        return p.publish(self.plan_raw, a.sha(self.plan_raw), self.raw, a.sha(self.raw),
                         intent_raw, a.sha(intent_raw), self.folder, self.port)

    def test_success_redis_precedes_all_candidate_mutations_and_six_digest_seal(self):
        before = {x.name: a.sha(x.read_bytes()) for x in self.folder.iterdir()}
        result = self.invoke()
        self.assertEqual(set(result['manifestInput']['images']), set(a.REPOSITORIES) | {'redis'})
        index = self.port.events.index('redis-readback')
        self.assertTrue(all(i > index for i, x in enumerate(self.port.events)
                            if x.startswith(('load:', 'tag:', 'push:'))))
        self.assertFalse(result['binding']['releaseReady'])
        self.assertFalse(result['binding']['productionReady'])
        self.assertEqual(result['binding']['candidateExpiresAt'], self.receipt['expiresAt'])
        self.assertEqual(before, {x.name: a.sha(x.read_bytes()) for x in self.folder.iterdir()})

    def test_identity_and_unknown_fields_rejected_before_adapter(self):
        for key, value in [('sourceRevision', 'e' * 40), ('controlRevision', 'f' * 40),
                           ('attemptId', 'different'), ('candidateSetRawSha256', '0' * 64),
                           ('candidatePlanRawSha256', '0' * 64), ('authenticatedRedis', True),
                           ('registryPrefix', 'other/namespace')]:
            with self.subTest(key=key):
                old = copy.deepcopy(self.intent)
                self.intent[key] = value
                with self.assertRaises(a.Rejected):
                    self.invoke()
                self.assertEqual(self.port.events, [])
                self.intent = old

    def test_actual_tar_tamper_rejected_before_adapter(self):
        with (self.folder / 'api.tar').open('ab') as f:
            f.write(b'tamper')
        with self.assertRaises(a.Rejected):
            self.invoke()
        self.assertEqual(self.port.events, [])

    def test_expired_receipt_rejected_without_refresh(self):
        old = datetime.now(timezone.utc) - timedelta(hours=2)
        self.receipt['producedAt'] = old.isoformat()
        self.receipt['expiresAt'] = (old + timedelta(hours=1)).isoformat()
        self.raw = a.json_bytes(self.receipt)
        self.intent['candidateSetRawSha256'] = a.sha(self.raw)
        with self.assertRaisesRegex(a.Rejected, 'CANDIDATE_EXPIRED'):
            self.invoke()
        self.assertEqual(self.port.events, [])

    def test_redis_failure_prevents_candidate_load_tag_push(self):
        self.port.fail_redis = True
        with self.assertRaisesRegex(a.Rejected, 'FAKE_REDIS_AUTH_FAILURE'):
            self.invoke()
        self.assertFalse(any(x.startswith(('load:', 'tag:', 'push:')) for x in self.port.events))

    def test_remote_collision_rejects_before_redis_or_candidate_mutations(self):
        target = a.PREFIX + '/api:' + self.plan['sourceRevision']
        self.port.remote_images[target] = {'Id': 'sha256:' + 'f' * 64}
        with self.assertRaisesRegex(a.Rejected, 'PUBLICATION_REMOTE_COLLISION'):
            self.invoke()
        self.assertNotIn('redis-pull', self.port.events)
        self.assertFalse(any(x.startswith(('load:', 'tag:', 'push:')) for x in self.port.events))

    def test_lost_push_ack_reads_back_without_second_push(self):
        self.port.lost_ack = True
        self.invoke()
        pushes = [x for x in self.port.events if x.startswith('push:')]
        self.assertEqual(len(pushes), 5)
        self.assertEqual(len(set(pushes)), 5)

    def test_unconfirmed_push_stops_and_cleans_only_owned_staging(self):
        self.port.no_commit = True
        self.port.lost_ack = True
        with self.assertRaisesRegex(a.Rejected, 'PUBLICATION_PUSH_UNCONFIRMED'):
            self.invoke()
        self.assertEqual(sum(x.startswith('push:') for x in self.port.events), 1)
        self.assertEqual(sum(x.startswith('cleanup:') for x in self.port.events), 1)
        self.assertNotIn('seal', self.port.events)

    def test_existing_same_remote_skips_candidate_load_tag_push(self):
        for service, repository in a.REPOSITORIES.items():
            self.port.remote_images[a.PREFIX + '/' + repository + ':' + self.plan['sourceRevision']] = self.port.image(service)
        self.invoke()
        self.assertFalse(any(x.startswith(('load:', 'tag:', 'push:', 'cleanup:')) for x in self.port.events))

    def test_legacy_label_does_not_authorize_candidate(self):
        entry = self.images['api']
        image = self.port.image('api')
        image['Config']['Labels']['org.workspacex.archive-build-identity'] = '9' * 64
        self.port.local_images[entry['stagingTag']] = image
        with self.assertRaisesRegex(a.Rejected, 'PUBLICATION_IMAGE_LABELS'):
            self.invoke()
        self.assertEqual(self.port.events, [])

    def test_receipt_expires_after_tag_before_push(self):
        events = self.port.events
        current = datetime.now(timezone.utc)
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return current + (timedelta(hours=2) if any(x.startswith('tag:') for x in events) else timedelta())
        with patch.object(c, 'datetime', Clock), self.assertRaisesRegex(a.Rejected, 'CANDIDATE_EXPIRED'):
            self.invoke()
        self.assertFalse(any(x.startswith('push:') for x in events))
        self.assertEqual(sum(x.startswith('cleanup:') for x in events), 1)

    def test_redis_digest_mismatch_prevents_candidate_mutation(self):
        with patch.object(self.port, 'registry_digest', return_value=a.PREFIX + '/base-redis@sha256:' + '9' * 64):
            with self.assertRaisesRegex(a.Rejected, 'PUBLICATION_REDIS_DIGEST'):
                self.invoke()
        self.assertFalse(any(x.startswith(('load:', 'tag:', 'push:')) for x in self.port.events))

    def test_cleanup_failure_preserves_primary_exception(self):
        self.port.no_commit = True
        self.port.lost_ack = True
        with patch.object(self.port, 'remove_owned_tag', side_effect=RuntimeError('private error')):
            with self.assertRaisesRegex(a.Rejected, 'PUBLICATION_PUSH_UNCONFIRMED') as caught:
                self.invoke()
        self.assertEqual(caught.exception.__notes__, ['PUBLICATION_OWNED_TAG_CLEANUP_UNCONFIRMED'])

    def test_cleanup_failure_tries_all_owned_tags_and_rejects_success(self):
        with patch.object(self.port, 'remove_owned_tag', side_effect=RuntimeError('private error')) as cleanup:
            with self.assertRaisesRegex(a.Rejected, 'PUBLICATION_OWNED_TAG_CLEANUP_UNCONFIRMED'):
                self.invoke()
        self.assertEqual(cleanup.call_count, 5)


if __name__ == '__main__':
    unittest.main()
