import importlib.util
from pathlib import Path
import unittest
p=Path(__file__).resolve().parents[1]/'scripts/us-tag-old-application-probe.py';s=importlib.util.spec_from_file_location('oldprobe',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_loopback_tls_preserves_hostname_and_fixed_probe(self):
  args=m.command('sha256:'+'a'*64,'owned','token');self.assertIn('host',args);self.assertIn('appv1.boardx.us:127.0.0.1',args);self.assertEqual(args[-1],'scripts/cloud-business-probe.ts');self.assertNotIn('NODE_TLS_REJECT_UNAUTHORIZED=0',args)
 def test_public_url_and_budget_must_match(self):
  raw=b'PROVISION_PUBLIC_URL=https://appv1.boardx.us\nPROVISION_TIMEOUT_MS=60000\nWORKSPACEX_DEPLOYMENT_MARKER=old\n';self.assertEqual(m.probe_env(raw),60000)
  for bad in [raw.replace(b'appv1.boardx.us',b'app.boardx.us'),raw+b'PROVISION_PUBLIC_URL=https://evil\n',raw.replace(b'60000',b'999999')]:
   with self.assertRaises(ValueError):m.probe_env(bad)
 def test_all_real_business_results_required(self):
  value={'ok':True,'loginVerified':True,'file':{'fileRoundtripVerified':True},'agent':{'agentBusinessVerified':True},'components':{'model':True,'sandbox':True}};self.assertTrue(m.accepted(value))
  for key in ['file','agent','components']:
   bad={**value,key:{}};self.assertFalse(m.accepted(bad))
if __name__=='__main__':unittest.main()
