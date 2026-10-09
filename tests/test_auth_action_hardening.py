import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('harden',Path(__file__).parents[1]/'scripts/harden-aliyun-action.py')
h=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(h)
MAIN="""await fsx.writeFile(oidcTokenFilePath, idToken);
    const config = new Config({
      type: 'oidc_role_arn',
    });
    setOutput(accessKeyId, accessKeySecret, securityToken);
    return;
  }

  const config = new Config({
    type: 'ecs_ram_role'
  });
console.log(err.stack);
core.setFailed(err.message);
"""
class HardenTests(unittest.TestCase):
 def fixture(self,root):
  contents={'dist/main/index.js':MAIN,'dist/cleanup/index.js':'clearEnvironment();'}
  for name,content in contents.items():
   p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content)
  return {k:hashlib.sha256(v.encode()).hexdigest() for k,v in contents.items()}
 def test_failure_logging_and_token_cleanup(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);hashes=self.fixture(root)
   with patch.object(h,'HASHES',hashes):h.harden(root)
   main=(root/'dist/main/index.js').read_text()
   self.assertNotIn('err.stack',main);self.assertNotIn('err.message',main)
   self.assertIn('{mode: 0o600}',main);self.assertIn('finally {',main);self.assertIn('await fsx.unlink(oidcTokenFilePath)',main)
   self.assertIn("e.code !== 'ENOENT'",(root/'dist/cleanup/index.js').read_text())
 def test_source_drift_does_not_partially_patch(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);hashes=self.fixture(root);main=(root/'dist/main/index.js').read_bytes()
   (root/'dist/cleanup/index.js').write_text('changed')
   with patch.object(h,'HASHES',hashes),self.assertRaises(ValueError):h.harden(root)
   self.assertEqual(main,(root/'dist/main/index.js').read_bytes())
 def test_symlink_source_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);hashes=self.fixture(root);p=root/'dist/main/index.js';p.rename(root/'original');p.symlink_to(root/'original')
   with patch.object(h,'HASHES',hashes),self.assertRaises(ValueError):h.harden(root)
