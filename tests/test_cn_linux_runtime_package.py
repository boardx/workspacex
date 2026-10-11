import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('builder', ROOT / 'scripts/build-cn-linux-runtime.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

class PackageTests(unittest.TestCase):
    def test_tree_normal(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t); (p/'file').write_text('a'); b.normalize(p)
            self.assertEqual(b.tree(p, 1), {'file':hashlib.sha256(b'a').hexdigest()})
    def test_tree_symlink(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t); (p/'link').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError): b.tree(p, 100)
    def test_tree_size(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t); (p/'file').write_text('ab'); b.normalize(p)
            with self.assertRaises(ValueError): b.tree(p, 1)
    def test_tree_hardlink(self):
        import os
        with tempfile.TemporaryDirectory() as t:
            p=Path(t); (p/'file').write_text('a'); os.link(p/'file',p/'other')
            with self.assertRaises(ValueError): b.tree(p, 100)
    def test_node_archive_link(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t); archive=p/'a.tar'
            with tarfile.open(archive,'w') as tf:
                m=tarfile.TarInfo('node-v22.20.0-linux-x64/bin/node');m.type=tarfile.SYMTYPE;m.linkname='/etc/passwd';tf.addfile(m)
            with self.assertRaises(ValueError): b.node_extract(archive,p)
    def test_all_npm_dependencies_integrity(self):
        packages=json.loads((ROOT/b.PLAN/'package-lock.json').read_text())['packages']
        for name, row in packages.items():
            if name:
                self.assertTrue(row['resolved'].startswith('https://registry.npmjs.org/'))
                self.assertTrue(row['integrity'].startswith('sha512-'))
    def test_rds_sources_locked(self):
        rows=json.loads((ROOT/b.PLAN/'rds-sources.json').read_text())
        self.assertEqual(len({r['package'] for r in rows}),len(rows))
        for row in rows:
            self.assertRegex(row['sha256'],r'^[a-f0-9]{64}$')
            self.assertTrue(row['url'].startswith('https://files.pythonhosted.org/'))
            self.assertGreater(row['bytes'],0)
    def test_diagnostic_never_outputs_raw_credentials(self):
        from unittest.mock import patch
        from contextlib import redirect_stderr
        import subprocess
        output=io.StringIO()
        error=subprocess.CalledProcessError(1,['pip'],stderr='Authorization: Bearer TOPSECRET')
        with patch.object(b.subprocess,'run',side_effect=error), redirect_stderr(output):
            with self.assertRaises(RuntimeError): b.run(['pip'])
        self.assertNotIn('TOPSECRET',output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['stderrBytes'],31)
    def test_chrome_exact_path_bounds(self):
        from unittest.mock import patch
        cap=512*1024**2
        for relative, exception, size, accepted in [
            ('chromium/chrome','chromium/chrome',cap,True),
            ('chromium/chrome','chromium/chrome',cap+1,False),
            ('other/chrome','chromium/chrome',256*1024**2+1,False),
            ('chromium/sub/chrome','chromium/chrome',256*1024**2+1,False),
            ('chromium/chrome.so','chromium/chrome',256*1024**2+1,False),
            ('chrome','chrome',cap,True),
            ('chrome',None,256*1024**2+1,False)]:
            with self.subTest(relative=relative,exception=exception,size=size), tempfile.TemporaryDirectory() as t:
                root=Path(t); target=root/relative; target.parent.mkdir(parents=True,exist_ok=True)
                with target.open('wb') as f: f.truncate(size)
                b.normalize(root)
                with patch.object(b,'sha',return_value='a'*64):
                    if accepted: self.assertEqual(b.tree(root,256*1024**2,exception),{relative:'a'*64})
                    else:
                        with self.assertRaises(ValueError): b.tree(root,256*1024**2,exception)
    def test_chrome_exception_cannot_raise_sdk_or_arbitrary_path(self):
        with tempfile.TemporaryDirectory() as t:
            for limit,exception in [(32*1024**2,'chrome'),(256*1024**2,'other/chrome'),(256*1024**2,'../chrome')]:
                with self.assertRaises(ValueError): b.tree(Path(t),limit,exception)
    def test_recipe_empty_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t); (p/b.PLAN).mkdir(parents=True)
            manifest=p/b.PLAN/'recipe-files.json'; manifest.write_text('{}')
            with self.assertRaises(ValueError): b.verify_recipe(p,b.sha(manifest))
    def test_recipe_closure(self):
        manifest=ROOT/b.PLAN/'recipe-files.json'
        b.verify_recipe(ROOT,b.sha(manifest))
        with self.assertRaises(ValueError): b.verify_recipe(ROOT,'0'*64)

if __name__=='__main__': unittest.main()
