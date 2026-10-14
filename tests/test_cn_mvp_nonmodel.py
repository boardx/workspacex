import importlib.util,json,threading,unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
s=importlib.util.spec_from_file_location('nonmodel',Path(__file__).parents[1]/'scripts/cn-release-mvp-nonmodel.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class HTTPJourney(unittest.TestCase):
 def setUp(self):
  self.fixtures={role:{'userId':role,'orgId':'other'if role=='foreign'else'company','projectId':role+'-project'}for role in ('primary','foreign','restricted')};self.fixtures['deploymentMarker']='test-marker'
  self.credentials={role:{'email':role,'password':'private-password'}for role in ('primary','foreign','restricted')};self.leak=False;self.login_calls=0;self.admissions=0;owner=self
  class Handler(BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def send(self,status,body):
    raw=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(raw)
   def do_POST(self):
    owner.login_calls+=1;body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));role=body['email'];self.send(200,{'userId':role,'orgs':[owner.fixtures[role]['orgId']],'sessionToken':'secret-'+role})
   def do_GET(self):
    if self.path=='/api/healthz':return self.send(200,{'trustworthy':True,'rlsForced':True,'appRoleIsOwner':False,'deploymentMarker':'test-marker'})
    if self.path=='/.well-known/workspacex-deployment':return self.send(200,{'deploymentMarker':'test-marker'})
    token=self.headers.get('Authorization','');project=self.path.split('/')[-2]
    if not token:return self.send(401,{'reasonCode':'SESSION_EXPIRED'})
    if project==token.removeprefix('Bearer secret-')+'-project'or owner.leak:return self.send(200,{'projectId':project})
    return self.send(403,{'reasonCode':'NO_PROJECT_ROLE'})
  self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.origin='http://127.0.0.1:'+str(self.server.server_port)
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
 def admit(self,*args):self.admissions+=1
 def run_journeys(self,admit=None):return m.execute({'sourceRevision':'a'*40,'controlRevision':'b'*40,'releaseId':'test','contentManifestSha256':'c'*64},self.fixtures,self.credentials,self.origin,14,admit or self.admit)
 def test_real_http_journeys_and_redaction(self):
  result=self.run_journeys();self.assertEqual(self.login_calls,3);self.assertEqual(self.admissions,5);self.assertTrue(all(v=='PASSED'for v in result['checks'].values()));self.assertNotIn('secret-',json.dumps(result));self.assertNotIn('private-password',json.dumps(result))
 def test_cross_tenant_leak_rejected(self):
  self.leak=True
  with self.assertRaisesRegex(ValueError,'RESOURCE_DENIAL_UNPROVEN'):self.run_journeys()
 def test_missing_runtime_authority_blocks_before_login(self):
  def reject(*args):raise ValueError('RUNTIME_NOT_ADMITTED')
  with self.assertRaisesRegex(ValueError,'RUNTIME_NOT_ADMITTED'):self.run_journeys(reject)
  self.assertEqual(self.login_calls,0)
 def test_wrong_fixture_tenant_scope_blocks_before_login(self):
  self.fixtures['foreign']['orgId']='company'
  with self.assertRaisesRegex(ValueError,'TENANT_FIXTURE_SCOPE'):self.run_journeys()
  self.assertEqual(self.login_calls,0)
if __name__=='__main__':unittest.main()
