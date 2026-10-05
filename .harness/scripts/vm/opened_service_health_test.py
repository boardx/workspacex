import copy,json,unittest
import opened_host_evidence_test as fixtures
import opened_service_health as m
class Tests(unittest.TestCase):
 def test_fixed_health_routes_without_docker_health(self):
  t,b,f,h,d,c,n=fixtures.Tests().fixture()
  for container in d:container['State'].pop('Health')
  proof=fixtures.mock_call(t,m.collect_service_health,t,'marker',lambda:n)
  self.assertEqual(proof['services'],{s:'healthy' for s in ('web','api','agent','sandbox')})
  self.assertNotIn('/run',m.PROBE.replace('/run/sandbox/skill-sandbox.sock',''))
  self.assertNotIn('model',m.PROBE)
 def test_rejects_unhealthy_or_fabricated_flags(self):
  for value in ({'web':True,'api':True,'agent':True,'sandbox':True},{'web':{'deploymentMarker':'marker'},'api':{'deploymentMarker':'marker','trustworthy':True},'agent':{'ok':False,'runtime':'workspacex-self-hosted'},'sandbox':{'ok':True}}):
   t,b,f,h,d,c,n=fixtures.Tests().fixture();t.host.run=lambda _:json.dumps(value).encode()
   with self.assertRaises(Exception):fixtures.mock_call(t,m.collect_service_health,t,'marker',lambda:n)
 def test_rejects_wrong_runtime_and_marker(self):
  t,b,f,h,d,c,n=fixtures.Tests().fixture();d[1]['Image']='other'
  with self.assertRaises(Exception):fixtures.mock_call(t,m.collect_service_health,t,'marker',lambda:n)
  t,b,f,h,d,c,n=fixtures.Tests().fixture()
  with self.assertRaises(Exception):fixtures.mock_call(t,m.collect_service_health,t,'other',lambda:n)
if __name__=='__main__':unittest.main()
