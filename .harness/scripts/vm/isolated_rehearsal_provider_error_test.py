import sys,unittest,tempfile,hashlib,os,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import isolated_rehearsal as core
import isolated_rehearsal_provider_contract_test as fixtures
class SafeErrors(unittest.TestCase):
 def setUp(self):
  fixture=fixtures.ObserveTests();fixture.setUp();self.binding=fixture.b
 def child(self,raw,adapter=False):
  with tempfile.TemporaryDirectory(dir=str(Path(tempfile.gettempdir()).resolve())) as td:
   p=Path(td)/'child.py'
   modules={}
   if adapter:
    s=Path(__file__).with_name('isolated_rehearsal_aliyun.py').read_text()
    injection="\nos.geteuid=lambda:0\ncredential=lambda role:{}\ndef fake_rpc(*args):raise ProviderError("+repr(raw)+")\nrpc=fake_rpc\n"
    s=s.replace("if __name__=='__main__':",injection+"if __name__=='__main__':")
    m=Path(__file__).with_name('isolated_rehearsal.py');modules={'isolated_rehearsal.py':{'path':str(m),'sha256':hashlib.sha256(m.read_bytes()).hexdigest()}}
   else:s='import sys\nsys.stdout.write('+repr(raw)+')\nsys.exit(1)\n'
   p.write_text(s);p.chmod(0o600)
   return core.ProcessAdapter(p,hashlib.sha256(p.read_bytes()).hexdigest(),5,modules)('observe',{'binding':self.binding})
 def test_real_adapter_known_provider_codes_nonzero(self):
  for code in core.SAFE_PROVIDER_CODES:
   with self.subTest(code=code),self.assertRaisesRegex(core.UnknownOutcome,'^PROVIDER_REJECTED:'+code+'$'):self.child(code,True)
 def test_unknown_provider_codes_never_exposed(self):
  for code in ('SECRET_TOKEN_abc','Forbidden secret password','Forbidden.extra'):
   with self.subTest(code=code),self.assertRaisesRegex(core.UnknownOutcome,'^ADAPTER_PROCESS_FAILED$'):self.child(code,True)
 def test_malformed_and_secret_bodies_never_exposed(self):
  for body in ('secret password token',json.dumps({'providerErrorCode':'Forbidden','body':'secret'}),json.dumps({'providerErrorCode':['Forbidden']}),json.dumps({'providerErrorCode':'SECRET'}),'x'*1024):
   with self.subTest(body=body[:20]),self.assertRaisesRegex(core.UnknownOutcome,'^ADAPTER_PROCESS_FAILED$'):self.child(body)
 def test_canonical_terminal_log_retains_only_safe_code(self):
  import subprocess
  source=Path(__file__).with_name('isolated_rehearsal.py').read_text()
  for code in ('Forbidden','User.NoPermission','InvalidAccountPassword.Format','SECRET_PASSWORD'):
   with tempfile.TemporaryDirectory(dir=str(Path(tempfile.gettempdir()).resolve())) as td:
    p=Path(td)/'main.py'
    inject="\ndef main():raise UnknownOutcome("+repr('PROVIDER_REJECTED:'+code)+")\n"
    p.write_text(source.replace("if __name__=='__main__':",inject+"if __name__=='__main__':"))
    r=subprocess.run([sys.executable,str(p)],capture_output=True,text=True)
    self.assertEqual(r.returncode,1);self.assertEqual(r.stdout,'')
    if code in core.SAFE_PROVIDER_CODES:
     j=json.loads(r.stderr.splitlines()[0]);self.assertEqual(j,{'providerErrorCode':code,'mutationOutcome':'unknown','readbackRequired':True})
    else:self.assertEqual(r.stderr,'ISOLATED_REHEARSAL_REJECTED\n')
 def test_rehearse_catch_preserves_diagnostic_without_reposting(self):
  import subprocess,datetime
  for stage,code in (('cleanup-register','User.NoPermission'),('account-create','InvalidAccountPassword.Format')):
   b=dict(self.binding);b['providerCreatedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();b['tls']={'sslmode':'verify-full'};b['readbackBudgetSeconds']=0;b['deleteReadbackBudgetSeconds']=0
   program=r"""
import sys,json,tempfile
from pathlib import Path
sys.path.insert(0,sys.argv[1]);import isolated_rehearsal as c
b=json.loads(sys.argv[2]);stage=sys.argv[3];code=sys.argv[4];calls=[]
def invoke(op,p):
 calls.append(op)
 if op==stage:raise c.UnknownOutcome('PROVIDER_REJECTED:'+code)
 if op=='observe':return {k:b[k] for k in ('targetInstanceId','peer','providerCreatedUtc')}
 if op=='cleanup-readback':return {'registered':stage!='cleanup-register','terminal':True,'targetInstanceId':b['targetInstanceId'],'deleteBeginEpoch':c.created(b)+6900}
 if op=='account-readback':return {'exists':False}
 if op=='cleanup-readback-deleted':return {'notFound':True}
 if op=='cleanup-registration-readback-removed':return {'removed':True}
 return {}
with tempfile.TemporaryDirectory(dir=str(Path(tempfile.gettempdir()).resolve())) as td:
 try:c.rehearse(b,Path(td),invoke)
 except c.UnknownOutcome as error:print(json.dumps({'terminal':str(error),'calls':calls}))
"""
   r=subprocess.run([sys.executable,'-c',program,str(Path(__file__).parent),json.dumps(b),stage,code],capture_output=True,text=True)
   self.assertEqual(r.returncode,0,r.stderr);j=json.loads(r.stdout);self.assertEqual(j['terminal'],'READBACK_NOT_READY');self.assertEqual(j['calls'].count(stage),1);self.assertIn('cleanup',j['calls']);self.assertIn('cleanup-iam-remove',j['calls']);self.assertEqual(json.loads(r.stderr),{'providerErrorCode':code,'mutationOutcome':'unknown','readbackRequired':True})
 def test_custom_system_temp_runs_real_child_cases(self):
  import subprocess
  with tempfile.TemporaryDirectory(dir=str(Path(tempfile.gettempdir()).resolve())) as selected:
   env=dict(os.environ,TMPDIR=selected,TEMP=selected,TMP=selected)
   r=subprocess.run([sys.executable,str(Path(__file__).resolve()),'SafeErrors.test_real_adapter_known_provider_codes_nonzero','SafeErrors.test_canonical_terminal_log_retains_only_safe_code','SafeErrors.test_rehearse_catch_preserves_diagnostic_without_reposting'],env=env,capture_output=True,text=True)
   self.assertEqual(r.returncode,0,r.stderr)
if __name__=='__main__':unittest.main(verbosity=2)
