import importlib.util,unittest,types,subprocess
from pathlib import Path
P=Path(__file__).resolve().parents[1]/'scripts/devapp-diagnostic-browser-probe.py'
def module():
 s=importlib.util.spec_from_file_location('diagnostic',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class OriginalJourneyContract(unittest.TestCase):
 def test_exact_original_script_url_credentials_and_baseline(self):
  m=module();expected=['/usr/bin/node','/root/wsx-devapp-5921-probe/devapp-image-browser-probe.mjs','https://devapp.boardx.us','/root/wsx-devapp-5921-probe/credentials.env'];self.assertEqual(m.browser_command([]),expected);self.assertEqual(m.browser_command(['--baseline']),expected+['--baseline'])
  for args in (['--other'],['--baseline','extra']):
   with self.assertRaises(ValueError):m.browser_command(args)
 def test_markers_do_not_accept_wrong_mode_or_nonzero(self):
  m=module()
  for args,marker in (([],b'DEVAPP_BROWSER_SMOKE_PASSED'),(['--baseline'],b'DEVAPP_BROWSER_BASELINE_PASSED')):
   self.assertTrue(m.accepted(types.SimpleNamespace(returncode=0,stdout=marker),args));self.assertFalse(m.accepted(types.SimpleNamespace(returncode=1,stdout=marker),args))
  self.assertFalse(m.accepted(types.SimpleNamespace(returncode=0,stdout=b'DEVAPP_BROWSER_BASELINE_PASSED'),[]))
 def test_source_preserves_original_contract_and_no_raw_stderr_forward(self):
  source=P.read_text();self.assertIn('capture_output=True,timeout=100',source);self.assertIn("'PLAYWRIGHT_BROWSERS_PATH':'/root/.cache/ms-playwright'",source);self.assertIn('adapter.browser_diagnostics(result.stderr)',source);self.assertNotIn('print(result.stderr',source);self.assertIn("'..' not in relative.parts",source)

class DynamicDiagnosticContract(unittest.TestCase):
 def fixture(self):
  import tempfile,json
  from unittest.mock import patch
  m=module();tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name);runtime=root/'runtime';runtime.mkdir();script=root/'original.mjs';script.write_text('original journey');cred=root/'credentials.env';cred.write_text('secret fixture');payload=runtime/'package.json';payload.write_text('{}');manifest=runtime/'manifest.json';manifest.write_text(json.dumps({'package.json':m.digest(payload)}));cfg=root/'config.json';cfg.write_text(json.dumps({'verificationFiles':[{'path':str(p),'sha256':m.digest(p)} for p in (script,cred,manifest)]}));policy=root/'policy.json';policy.write_text(json.dumps({'diagnosticBrowser':True,'source':'b3e9977de08b056a564058ca0419d85d421fdd4a','tag':'41388409479-1','closurePins':{P.name:m.digest(P),'devapp-reviewed-tag-release.py':m.digest(P.with_name('devapp-reviewed-tag-release.py'))}}))
  for name,value in [('RUNTIME',runtime),('SCRIPT',script),('CREDENTIALS',cred),('POLICY',policy)]:
   p=patch.object(m,name,value);p.start();self.addCleanup(p.stop)
  def trusted(path,*args,**kwargs):return cfg if str(path)=='/etc/workspacex-image-release/devapp.json' else Path(path)
  for p in (patch.object(m,'trusted',side_effect=trusted),patch.object(m.os,'geteuid',return_value=0),patch.object(m.socket,'gethostname',return_value='iZrj96m8nydns2hro306o7Z')):p.start();self.addCleanup(p.stop)
  return m,runtime,manifest,payload,cfg
 def test_full_runtime_hash_check_and_safe_diagnostics(self):
  import io,contextlib
  from unittest.mock import patch
  m,runtime,manifest,payload,cfg=self.fixture();result=types.SimpleNamespace(returncode=1,stdout=b'private stdout',stderr=b'private stderr\nBROWSER_DIAG phase=billing-contract errorType=TimeoutError netCode=ERR_TIMED_OUT\nBROWSER_DIAG phase=private errorType=Error netCode=ERR_PRIVATE\n');out=io.StringIO();err=io.StringIO()
  with patch.object(m.subprocess,'run',return_value=result) as run,contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):self.assertEqual(m.main([]),1)
  self.assertEqual(run.call_args.kwargs,{'env':{'PATH':'/usr/bin:/bin','HOME':'/root','PLAYWRIGHT_BROWSERS_PATH':'/root/.cache/ms-playwright'},'capture_output':True,'timeout':100});self.assertIn('phase=billing-contract',err.getvalue());self.assertNotIn('private',err.getvalue()+out.getvalue());self.assertIn('DEVAPP_PUBLIC_BROWSER_FAILED',err.getvalue())
 def test_runtime_or_original_pin_drift_prevents_node(self):
  from unittest.mock import patch
  for drift in ('runtime','original','manifest-path'):
   with self.subTest(drift=drift):
    import json
    m,runtime,manifest,payload,cfg=self.fixture()
    if drift=='runtime':payload.write_text('drift')
    elif drift=='original':m.SCRIPT.write_text('drift')
    else:
     manifest.write_text(json.dumps({'../outside':'a'*64}));value=json.loads(cfg.read_text());next(x for x in value['verificationFiles'] if x['path']==str(manifest))['sha256']=m.digest(manifest);cfg.write_text(json.dumps(value))
    with patch.object(m.subprocess,'run') as run:
     with self.assertRaises(ValueError):m.main([])
     run.assert_not_called()
 def test_unavailable_keeps_generic_safe_status(self):
  import io,contextlib
  from unittest.mock import patch
  m,*_=self.fixture();err=io.StringIO()
  with patch.object(m.subprocess,'run',side_effect=subprocess.TimeoutExpired('private',100,stderr=b'private')),contextlib.redirect_stderr(err):self.assertEqual(m.main([]),1)
  self.assertEqual(err.getvalue(),'DEVAPP_PUBLIC_BROWSER_UNAVAILABLE\n')
