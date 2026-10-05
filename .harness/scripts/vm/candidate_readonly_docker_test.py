import json,types,unittest
from unittest.mock import patch
import candidate_readonly_docker as m
class Tests(unittest.TestCase):
 def fixture(self):
  socket=dict(device=1,inode=2,uid=0,gid=0,mode=0o660);profile=json.dumps(dict(candidateComposeEmitter=dict(dockerPath='/usr/bin/docker',dockerSha256='d'*64,dockerSocket=socket))).encode();calls=[]
  source=types.SimpleNamespace(private=lambda _:profile,invoke=lambda *args:(calls.append(args) or b'{}'))
  return source,profile,calls,socket
 def test_only_fixed_readiness_and_health_source_use_pinned_binary(self):
  source,profile,calls,socket=self.fixture()
  with patch.object(m,'socket_authority',lambda e:socket):
   for op in ('data-readiness','service-readiness','service-health'):m.invoke_readonly_docker(source,profile,op,api_id='a'*64)
  self.assertEqual(len(calls),3)
  for call in calls:self.assertEqual(call[0],{'binaries':{'docker':{'path':'/usr/bin/docker','sha256':'d'*64}}});self.assertEqual(call[2][:4],['--config','/etc/workspacex-cn/docker-offline','--host','unix:///run/docker.sock'])
 def test_invalid_unchecked_binary_or_unknown_command_reject_before_exec(self):
  for mode in ('binary','operation','container'):
   source,profile,calls,socket=self.fixture()
   if mode=='binary':p=json.loads(profile);p['candidateComposeEmitter']['dockerPath']='/tmp/docker';profile=json.dumps(p).encode();source.private=lambda _:profile
   with patch.object(m,'socket_authority',lambda e:socket):
    with self.assertRaises(Exception):m.invoke_readonly_docker(source,profile,'unsafe-exec' if mode=='operation' else 'data-readiness',api_id='other' if mode=='container' else 'a'*64)
   self.assertEqual(calls,[])
 def test_actual_pinned_invoke_failure_has_no_raw_docker_fallback(self):
  source,profile,calls,socket=self.fixture();source.invoke=lambda *_:(_ for _ in ()).throw(RuntimeError('BINARY_HASH'))
  with patch.object(m,'socket_authority',lambda e:socket):
   with self.assertRaisesRegex(RuntimeError,'BINARY_HASH'):m.invoke_readonly_docker(source,profile,'data-readiness',api_id='a'*64)
 def test_changed_socket_or_profile_after_exec_rejects(self):
  source,profile,calls,socket=self.fixture()
  with patch.object(m,'socket_authority',side_effect=[socket,dict(socket,inode=3)]):
   with self.assertRaisesRegex(RuntimeError,'AUTHORITY_CHANGED'):m.invoke_readonly_docker(source,profile,'service-health',api_id='a'*64)
if __name__=='__main__':unittest.main()
