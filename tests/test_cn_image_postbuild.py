"""Local post-build boundary fixtures; no Docker, network, or cloud execution."""
import gzip
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('candidate_fixtures', Path(__file__).with_name('test_cn_image_candidate.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
a, b, c = fixture.a, fixture.b, fixture.c


class PostBuildBoundaryTests(unittest.TestCase):
    def saved(self, path, plan, compressed=False, bad_identity=False, damage=None, layers=1, bad_platform=False, bad_diff=False):
        # A real inner layer tar, with DiffID over its uncompressed bytes.
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w', format=tarfile.USTAR_FORMAT) as layer:
            member = tarfile.TarInfo('fixture'); member.size = 1
            layer.addfile(member, io.BytesIO(b'x'))
        plain = buf.getvalue()
        blob = gzip.compress(plain, mtime=0) if compressed else plain
        if damage == 'truncated': blob = blob[:-4]
        if damage == 'corrupt': blob = blob[:-8] + b'BADCRC!!'
        config = a.json_bytes(dict(os='linux', architecture='arm64' if bad_platform else 'amd64', config={'Labels': {
            'org.opencontainers.image.revision': c.SOURCE,
            c.LABEL: '0' * 64 if bad_identity else c.identity(plan)}},
            rootfs={'type': 'layers', 'diff_ids': ['sha256:' + ('0' * 64 if bad_diff else a.sha(plain))] * layers}))
        config_name = 'blobs/sha256/' + a.sha(config)
        layer_name = 'blobs/sha256/' + a.sha(blob)
        layer_names = [layer_name + ('-' + str(i) if layers > 1 else '') for i in range(layers)]
        manifest = a.json_bytes([dict(Config=config_name, RepoTags=[c.tag(plan, 'agent')], Layers=layer_names)])
        with tarfile.open(path, 'w', format=tarfile.USTAR_FORMAT) as saved:
            for name, data in [(config_name, config), *[(n, blob) for n in layer_names], ('manifest.json', manifest), ('oci-layout', b'{"imageLayoutVersion":"1.0.0"}')]:
                member = tarfile.TarInfo(name); member.size = len(data)
                saved.addfile(member, io.BytesIO(data))

    def test_uncompressed_blob_paths_normalize_and_preserve_identity(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); plan = fixture.plan(); self.saved(root/'save.tar', plan)
            result = b.normalize(root/'save.tar', root/'agent.tar', plan, 'agent')
            self.assertEqual(result['stagingTag'], c.tag(plan, 'agent'))
            self.assertEqual(result, c.inspect(root/'agent.tar', plan, 'agent'))

    def test_gzip_multilayer_preserves_uncompressed_diff_ids(self):
        for layers in (1, 3):
            with self.subTest(layers=layers), tempfile.TemporaryDirectory() as td:
                root = Path(td); plan = fixture.plan(); self.saved(root/'save.tar', plan, compressed=True, layers=layers)
                result = b.normalize(root/'save.tar', root/'agent.tar', plan, 'agent')
                self.assertEqual(len(result['layers']), layers)
                with tarfile.open(root/'save.tar') as original, tarfile.open(root/'agent.tar') as normalized:
                    source_config = a.decode(a.small_member(original, a.members(original)['manifest.json']))[0]['Config']
                    self.assertEqual(original.extractfile(source_config).read(), normalized.extractfile(source_config).read())
                self.assertEqual(result, c.inspect(root/'agent.tar', plan, 'agent'))

    def test_corrupt_or_truncated_gzip_rejects_before_target(self):
        for damage in ('corrupt', 'truncated'):
            with self.subTest(damage=damage), tempfile.TemporaryDirectory() as td:
                root = Path(td); plan = fixture.plan(); self.saved(root/'save.tar', plan, compressed=True, damage=damage)
                with self.assertRaises(a.Rejected) as caught:
                    b.normalize(root/'save.tar', root/'agent.tar', plan, 'agent')
                self.assertEqual(str(caught.exception), 'CANDIDATE_LAYER_COMPRESSION')
                self.assertFalse((root/'agent.tar').exists())
                self.assertFalse(list(root.glob('wsx-normalize-*')))

    def test_expansion_budget_and_tar_padding_budget_reject(self):
        # Small injected budgets exercise the algorithm without GiB allocation.
        for limit in (1024, 15000):
            with self.subTest(limit=limit), tempfile.TemporaryDirectory() as td:
                root = Path(td); plan = fixture.plan(); self.saved(root/'save.tar', plan, compressed=True)
                plan['maxArchiveBytes'] = limit
                if limit == 1024:
                    # Raw tar precheck separately established; isolate expansion.
                    from unittest.mock import patch
                    with patch.object(b.Path, 'stat', return_value=type('S', (), {'st_size': 1})()):
                        with self.assertRaises(a.Rejected) as caught:
                            b.normalize(root/'save.tar', root/'agent.tar', plan, 'agent')
                else:
                    with self.assertRaises(a.Rejected) as caught:
                        b.normalize(root/'save.tar', root/'agent.tar', plan, 'agent')
                self.assertEqual(str(caught.exception), 'CANDIDATE_NORMALIZE_LIMIT')
                self.assertFalse((root/'agent.tar').exists())

    def test_wrong_identity_fails_after_normalization(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); plan = fixture.plan(); self.saved(root/'save.tar', plan, compressed=True, bad_identity=True)
            with self.assertRaises(a.Rejected) as caught:
                b.normalize(root/'save.tar', root/'agent.tar', plan, 'agent')
            self.assertEqual(str(caught.exception), 'CANDIDATE_LABELS')
            self.assertFalse((root/'agent.tar').exists())
            self.assertFalse(list(root.glob('wsx-normalize-*')))

    def test_compressed_layer_does_not_bypass_platform_or_diff_ids(self):
        for fields, code in [({'bad_platform': True}, 'CANDIDATE_IMAGE_PLATFORM'), ({'bad_diff': True}, 'CANDIDATE_DIFF_IDS')]:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as td:
                root = Path(td); plan = fixture.plan(); self.saved(root/'save.tar', plan, compressed=True, **fields)
                with self.assertRaises(a.Rejected) as caught:
                    b.normalize(root/'save.tar', root/'agent.tar', plan, 'agent')
                self.assertEqual(str(caught.exception), code)
                self.assertFalse((root/'agent.tar').exists())
                self.assertFalse((root/'candidate-fragment.json').exists())

    def test_existing_target_is_preserved(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); plan = fixture.plan(); self.saved(root/'save.tar', plan, compressed=True)
            (root/'agent.tar').write_bytes(b'existing-owner')
            with self.assertRaises(FileExistsError):
                b.normalize(root/'save.tar', root/'agent.tar', plan, 'agent')
            self.assertEqual((root/'agent.tar').read_bytes(), b'existing-owner')

    def test_raw_save_limit_precedes_tar_parse_and_target_creation(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); plan = fixture.plan(); saved = root/'save.tar'
            # Sparse file tests the exact 2GiB boundary without allocating it.
            with saved.open('wb') as stream: stream.truncate(plan['maxArchiveBytes'] + 1)
            with self.assertRaises(a.Rejected) as caught:
                b.normalize(saved, root/'agent.tar', plan, 'agent')
            self.assertEqual(str(caught.exception), 'CANDIDATE_SAVE_LIMIT')
            self.assertFalse((root/'agent.tar').exists())


if __name__ == '__main__':
    unittest.main()
