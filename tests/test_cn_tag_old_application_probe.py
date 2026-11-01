import importlib.util
from pathlib import Path
import unittest
P=Path(__file__).resolve().parents[1]/'scripts/cn-tag-old-application-probe.py';s=importlib.util.spec_from_file_location('cn_old_browser',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Routing(unittest.TestCase):
 def test_exact_one_launch_patch_preserves_tls(self):
  raw=b'const url="https://app.boardx.com.cn";\n    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],\n'
  result=m.loopback_source(raw);self.assertIn(b'MAP app.boardx.com.cn 127.0.0.1',result);self.assertIn(b'https://app.boardx.com.cn',result);self.assertNotIn(b'ignoreHTTP',result)
  for bad in (b'',raw+raw):
   with self.assertRaises(ValueError):m.loopback_source(bad)
if __name__=='__main__':unittest.main()

class ActualBoundary(unittest.TestCase):
 def test_failed_browser_never_returns_verified_and_temp_is_removed(self):
  import tempfile
  from unittest.mock import Mock,patch
  raw=b'    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],'
  for result in (Mock(returncode=1,stdout=b'CN_BROWSER_SMOKE_PASSED\n'),Mock(returncode=0,stdout=b'wrong')):
   with tempfile.TemporaryDirectory() as tmp,patch.object(m.subprocess,'run',return_value=result) as run:
    with self.assertRaises(ValueError):m.run_browser(Path(tmp),raw)
    self.assertEqual(list(Path(tmp).iterdir()),[])
    args=run.call_args.args[0];self.assertIn('https://app.boardx.com.cn',args);self.assertNotIn('ignoreHTTPSErrors',str(run.call_args))
 def test_browser_timeout_cleans_temp(self):
  import tempfile
  from unittest.mock import patch
  raw=b'    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],'
  with tempfile.TemporaryDirectory() as tmp,patch.object(m.subprocess,'run',side_effect=TimeoutError()):
   with self.assertRaises(TimeoutError):m.run_browser(Path(tmp),raw)
   self.assertEqual(list(Path(tmp).iterdir()),[])
 def test_code_pin_does_not_accept_other_bytes(self):
  import tempfile
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'probe';path.write_bytes(b'changed')
   with patch.object(m,'trusted',return_value=path):
    with self.assertRaisesRegex(ValueError,'BROWSER_PIN_DRIFT'):m.verify_pin(path,m.PINS['cn-image-browser-probe.mjs'])
