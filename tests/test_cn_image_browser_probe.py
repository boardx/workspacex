import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('browser',Path(__file__).parents[1]/'scripts/cn-image-browser-probe.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class RuntimeTrust(unittest.TestCase):
 def exercise(self, mutate=None, bad=None):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td)/'runtime';root.mkdir();f=root/'package.json';f.write_bytes(b'{}')
   (root/'manifest.json').write_text(json.dumps({'package.json':hashlib.sha256(b'{}').hexdigest()}))
   if mutate:mutate(root)
   def metadata(p):
    uid,mode=(bad(root,p) if bad else (0,stat.S_IFREG|0o644))
    return SimpleNamespace(st_uid=uid,st_mode=mode)
   with patch.object(m,'RUNTIME',root),patch.object(Path,'lstat',metadata):m.verify_runtime()
 def test_matching_bytes_and_trusted_ancestors(self):self.exercise()
 def test_changed_dependency_bytes_rejected(self):
  with self.assertRaisesRegex(OSError,'DRIFT'):self.exercise(lambda r:(r/'package.json').write_bytes(b'changed'))
 def test_runner_owned_ancestor_rejected(self):
  with self.assertRaisesRegex(OSError,'UNTRUSTED'):self.exercise(bad=lambda r,p:(1000 if p==r.parent else 0,stat.S_IFDIR|0o755))
 def test_group_writable_ancestor_rejected(self):
  with self.assertRaisesRegex(OSError,'UNTRUSTED'):self.exercise(bad=lambda r,p:(0,stat.S_IFDIR|(0o775 if p==r else 0o755)))
 def test_symlink_component_rejected(self):
  with self.assertRaisesRegex(OSError,'UNTRUSTED'):self.exercise(bad=lambda r,p:(0,stat.S_IFLNK|0o777 if p==r else stat.S_IFDIR|0o755))
 def test_manifest_path_escape_rejected(self):
  with self.assertRaisesRegex(OSError,'PATH'):self.exercise(lambda r:(r/'manifest.json').write_text(json.dumps({'../x':'x'})))

if __name__=='__main__':unittest.main()
