import importlib.util
from pathlib import Path
import unittest
p=Path(__file__).resolve().parents[1]/'scripts/us-tag-old-application-probe.py';s=importlib.util.spec_from_file_location('oldprobe',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_bounded_profile_changes_only_budget_and_is_explicit(self):
  self.assertEqual(m.profile_budget(None,90000),90000)
  self.assertEqual(m.profile_budget('bounded-30s-v1',90000),30000)
  for value in ['unknown','bounded-1s-v1','',30000,False]:
   with self.assertRaises(ValueError):m.profile_budget(value,90000)
   with self.assertRaises(ValueError):m.command('sha256:'+'a'*64,'name','token',value)
  original=m.command('sha256:'+'a'*64,'name','token')
  bounded=m.command('sha256:'+'a'*64,'name','token','bounded-30s-v1')
  self.assertNotIn('--env',original);offset=bounded.index('--env')
  self.assertEqual(bounded[offset:offset+2],['--env','PROVISION_TIMEOUT_MS=30000']);self.assertLess(bounded.index('--env-file'),offset)
  self.assertEqual(bounded[:offset]+bounded[offset+2:],original)
 def test_real_child_receives_exact_bounded_docker_argv(self):
  import subprocess,sys,json
  args=m.command('sha256:'+'a'*64,'owned','token','bounded-30s-v1')
  raw=subprocess.check_output([sys.executable,'-c','import sys,json;print(json.dumps(sys.argv[1:]))',*args])
  received=json.loads(raw);self.assertEqual(received,args);offset=received.index('--env');self.assertEqual(received[offset+1],'PROVISION_TIMEOUT_MS=30000');self.assertGreater(offset,received.index('--env-file'))

 def test_only_fixed_runner_owned_data_directories(self):
  import stat
  from unittest.mock import Mock,patch
  account=Mock(pw_uid=1001,pw_gid=1001);group=Mock(gr_gid=1001)
  leaf=Mock(st_mode=stat.S_IFDIR|0o700,st_uid=1001,st_gid=1001)
  with patch.object(m,'trusted',side_effect=lambda p:Path(p)) as parent,patch.object(m.pwd,'getpwnam',return_value=account),patch.object(m.grp,'getgrnam',return_value=group),patch.object(Path,'lstat',return_value=leaf):
   self.assertEqual(m.data_directory('/etc/workspacex-selfhost/sandbox'),Path('/etc/workspacex-selfhost/sandbox'))
   parent.assert_called_once_with(Path('/etc/workspacex-selfhost'))
   for value in [Mock(st_mode=stat.S_IFDIR|0o700,st_uid=1002,st_gid=1001),Mock(st_mode=stat.S_IFDIR|0o700,st_uid=1001,st_gid=1002),Mock(st_mode=stat.S_IFDIR|0o777,st_uid=1001,st_gid=1001),Mock(st_mode=stat.S_IFLNK|0o700,st_uid=1001,st_gid=1001)]:
    with patch.object(Path,'lstat',return_value=value),self.assertRaises(ValueError):m.data_directory('/etc/workspacex-selfhost/sessions')
   with self.assertRaises(ValueError):m.data_directory('/etc/workspacex-selfhost/other')
 def test_actual_api_mounts_must_match_both_fixed_data_sources(self):
  mounts=[{'Type':'bind','Source':'/etc/workspacex-selfhost/'+name,'Destination':'/run/'+name,'RW':True} for name in ['sandbox','sessions']]
  m.data_mounts({'Mounts':mounts})
  for bad in [mounts[:1],mounts+[mounts[0]],[{**mounts[0],'Source':'/tmp/foreign'},mounts[1]],[{**mounts[0],'Destination':'/run/other'},mounts[1]],[{**mounts[0],'Type':'volume'},mounts[1]],[{**mounts[0],'RW':False},mounts[1]]]:
   with self.assertRaises(ValueError):m.data_mounts({'Mounts':bad})

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
