import hashlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'cn_auto_source.py'
spec = importlib.util.spec_from_file_location('cn_auto_source', SOURCE)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


class SourceImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / 'producer'
        self.repo.mkdir()
        M.git(self.repo, 'init')
        M.git(self.repo, 'config', 'user.name', 'test')
        M.git(self.repo, 'config', 'user.email', 'test@example.invalid')
        (self.repo / 'file').write_text('baseline')
        M.git(self.repo, 'add', 'file')
        M.git(self.repo, 'commit', '-m', 'baseline')
        self.baseline = M.git(self.repo, 'rev-parse', 'HEAD')
        (self.repo / 'file').write_text('candidate')
        M.git(self.repo, 'commit', '-am', 'candidate')
        self.revision = M.git(self.repo, 'rev-parse', 'HEAD')
        M.git(self.repo, 'update-ref', M.REMOTE_REF, self.revision)
        self.bundle = self.root / 'source.bundle'
        M.git(self.repo, 'bundle', 'create', str(self.bundle), M.REMOTE_REF)

    def tearDown(self):
        self.temp.cleanup()

    def bare(self, name):
        path = self.root / name
        M.git(self.root, 'init', '--bare', str(path))
        return path

    def test_complete_bundle_has_actual_ancestor_closure_and_cas_preserves_baseline(self):
        M.validate_bundle(self.bundle, self.revision)
        target = self.bare('cache.git')
        M.git(target, 'bundle', 'verify', str(self.bundle))
        M.git(target, 'fetch', str(self.bundle), M.REMOTE_REF + ':refs/heads/main')
        M.verify_closure(target)
        M.git(target, 'update-ref', 'refs/heads/main-cn', self.baseline)
        M.git(target, 'update-ref', 'refs/heads/main', self.baseline)
        M.import_objects(target, self.bundle, self.revision, self.baseline)
        self.assertEqual(M.git(target, 'rev-parse', 'refs/heads/main'), self.revision)
        self.assertEqual(M.git(target, 'rev-parse', 'refs/heads/main-cn'), self.baseline)
        # A replay can converge, but a stale expected ref cannot overwrite it.
        M.import_objects(target, self.bundle, self.revision, self.revision)
        with self.assertRaises(M.Rejected):
            M.import_objects(target, self.bundle, self.revision, self.baseline)

    def test_incremental_bundle_with_prerequisites_is_rejected(self):
        partial = self.root / 'partial.bundle'
        M.git(self.repo, 'bundle', 'create', str(partial), M.REMOTE_REF, '^' + self.baseline)
        with self.assertRaisesRegex(M.Rejected, 'BUNDLE_REFS'):
            M.validate_bundle(partial, self.revision)

    def test_extra_ref_and_wrong_sha_rejected(self):
        extra = self.root / 'extra.bundle'
        M.git(self.repo, 'bundle', 'create', str(extra), M.REMOTE_REF, 'HEAD')
        for path, revision in [(extra, self.revision), (self.bundle, self.baseline)]:
            with self.assertRaises(M.Rejected):
                M.validate_bundle(path, revision)

    def test_hash_bound_regular_input_and_mutation_fail_without_cache_writes(self):
        expected = hashlib.sha256(self.bundle.read_bytes()).hexdigest()
        copied = self.root / 'copy.bundle'
        with self.bundle.open('rb') as stream:
            M.copy_input(stream, copied, expected)
        self.assertEqual(copied.read_bytes(), self.bundle.read_bytes())
        with self.bundle.open('rb') as stream, self.assertRaisesRegex(M.Rejected, 'INPUT_CHANGED'):
            M.copy_input(stream, self.root / 'bad.bundle', '0' * 64)
        with tempfile.TemporaryFile() as empty, self.assertRaisesRegex(M.Rejected, 'STDIN_REGULAR'):
            M.copy_input(empty, self.root / 'empty.bundle', expected)
        readfd, writefd = os.pipe()
        os.close(writefd)
        with os.fdopen(readfd, 'rb') as pipe, self.assertRaisesRegex(M.Rejected, 'STDIN_REGULAR'):
            M.copy_input(pipe, self.root / 'pipe.bundle', expected)

    def test_shallow_or_borrowed_closure_rejected(self):
        target = self.bare('borrowed.git')
        (target / 'objects/info/alternates').write_text(str(self.repo / '.git/objects'))
        with self.assertRaisesRegex(M.Rejected, 'EXTERNAL_OBJECTS'):
            M.verify_closure(target)

    def test_github_live_desired_and_containment_are_independent_gates(self):
        revision = self.revision
        latest = 'a' * 40
        def read(path):
            if path.endswith('main-cn'):
                return {'object': {'sha': revision}}
            if path.endswith('/main'):
                return {'object': {'sha': latest}}
            return {'status': 'ahead', 'base_commit': {'sha': revision},
                    'merge_base_commit': {'sha': revision}}
        M.verify_desired(revision, read)
        with self.assertRaisesRegex(M.Rejected, 'STALE_MAIN_CN'):
            M.verify_desired(self.baseline, read)
        def divergent(path):
            value = read(path)
            return dict(value, status='diverged') if path.startswith('/compare') else value
        with self.assertRaisesRegex(M.Rejected, 'NOT_IN_MAIN'):
            M.verify_desired(revision, divergent)


if __name__ == '__main__':
    unittest.main()
