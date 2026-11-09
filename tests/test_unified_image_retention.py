import contextlib
import io
import tempfile
from types import SimpleNamespace
from unittest import mock
import datetime
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('retention', Path(__file__).parents[1] / 'scripts/unified-image-retention.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Retention(unittest.TestCase):
    def setUp(self):
        self.cfg = {'services': {'api': 'api'}, 'project': 'app', 'registryPrefix': 'registry/team'}
        self.versions = {'current': {'images': {'api': 'current'}}, 'previous': {'images': {'api': 'rollback'}}}
        self.containers = [{'Image': 'current', 'Config': {'Labels': {'com.docker.compose.project': 'app', 'com.docker.compose.service': 'api'}}, 'State': {'Running': True}}]
        self.now = datetime.datetime(2026, 11, 9, tzinfo=datetime.timezone.utc)
    def image(self, ident='old', refs=None, created='2026-11-01T00:00:00Z'):
        return {'Id': ident, 'RepoTags': refs if refs is not None else ['registry/team/api:old'], 'RepoDigests': [], 'Created': created}
    def plan(self, images):
        return m.plan(self.cfg, self.versions, self.containers, images, self.now)
    def test_old_scoped_image_is_candidate(self):
        self.assertEqual(self.plan([self.image()])[1][0]['id'], 'old')
    def test_current_previous_and_all_containers_are_protected(self):
        self.containers.append({'Image': 'stopped', 'Config': {'Labels': {}}, 'State': {'Running': False}})
        self.assertEqual(self.plan([self.image(x) for x in ('current', 'rollback', 'stopped')])[1], [])
    def test_unrelated_null_labels_still_protects_container_image(self):
        self.containers.append({'Image':'unlabeled','Config':{'Labels':None},'State':{'Running':False}})
        self.assertEqual(self.plan([self.image('unlabeled')])[1], [])
        self.assertEqual(self.plan([self.image()])[1][0]['id'], 'old')
    def test_foreign_mixed_untagged_and_young_not_deleted(self):
        images = [self.image(refs=['foreign/api:old']), self.image(refs=['registry/team/api:old', 'foreign/api:old']), self.image(refs=[]), self.image(created='2026-11-08T12:00:00Z')]
        self.assertEqual(self.plan(images)[1], [])
    def test_digest_only_reference_stays_scoped(self):
        image = self.image(refs=[]); image['RepoDigests'] = ['registry/team/api@sha256:old']
        self.assertEqual(self.plan([image])[1][0]['id'], 'old')
    def test_runtime_drift_fails_closed(self):
        self.containers[0]['Image'] = 'drift'
        with self.assertRaisesRegex(ValueError, 'RUNTIME_DRIFT'): self.plan([self.image()])
    def test_missing_stopped_duplicate_and_foreign_runtime_fail(self):
        for rows in ([], [{**self.containers[0], 'State': {'Running': False}}], self.containers * 2, [{'Image':'current','Config':{'Labels':{}},'State':{'Running':True}}]):
            with self.subTest(rows=rows), self.assertRaisesRegex(ValueError, 'RUNTIME_DRIFT'):
                m.plan(self.cfg,self.versions,rows,[self.image()],self.now)
    def test_incomplete_rollback_fails_closed(self):
        self.versions['previous']['images'] = {}
        with self.assertRaisesRegex(ValueError, 'SERVICE_SET_CHANGED'): self.plan([self.image()])
    def test_invalid_timestamp_fails_closed(self):
        with self.assertRaises(ValueError): self.plan([self.image(created='invalid')])

class MainBoundary(unittest.TestCase):
    def test_apply_never_forces_and_dry_run_never_deletes(self):
        for apply in (False, True):
            with self.subTest(apply=apply), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); (root/'log/release-test').mkdir(parents=True)
                lock = root/'lock'; lock.touch()
                fixture = Retention(); fixture.setUp()
                cfg = {**fixture.cfg, 'environment':'devapp', 'lockFile':str(lock)}
                versions = {**fixture.versions, 'attempt':str(root/'log/release-test')}
                versions['current']['tag'] = '123-1'
                result = {'status':'SUCCEEDED','attempt':versions['attempt'],'tag':'123-1'}
                values = {'release.json':cfg,'versions.json':versions,'result.json':result}
                calls = []
                def transport(*args):
                    calls.append(args)
                    if args == ('ps','-aq'): return 'container'
                    if args == ('inspect','container'): return __import__('json').dumps(fixture.containers)
                    if args == ('image','ls','-aq','--no-trunc'): return 'old'
                    if args[:2] == ('image','inspect'): return __import__('json').dumps([fixture.image()])
                    if args[:2] == ('image','rm'): return ''
                    raise AssertionError(args)
                real_stat = m.os.fstat
                def trusted_owner(fd):
                    info = real_stat(fd)
                    return SimpleNamespace(st_uid=0, st_mode=info.st_mode)
                with mock.patch.object(m,'ROOT',root), mock.patch.object(m,'read',side_effect=lambda p: values[Path(p).name]), mock.patch.object(m.os,'geteuid',return_value=0), mock.patch.object(m.os,'fstat',side_effect=trusted_owner), mock.patch.object(m,'docker',side_effect=transport), mock.patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=1)), contextlib.redirect_stdout(io.StringIO()):
                    m.main('devapp',apply)
                deletes = [call for call in calls if call[:2] == ('image','rm')]
                self.assertEqual(deletes, [('image','rm','registry/team/api:old')] if apply else [])
                self.assertTrue(all('--force' not in call and '-f' not in call for call in calls))

if __name__ == '__main__': unittest.main()
