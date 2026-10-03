import hashlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import cn_backup_watchdog as w

class WatchdogTests(unittest.TestCase):
 def test_nologin_precedes_exact_owned_container_removal(self):
  events=[];calls=[0]
  def inventory(owner):
   calls[0]+=1
   return [{'Id':'a'*64}] if calls[0]<=2 else []
  def dispatch(*args,**kwargs):events.append(('dispatch',args[4]))
  with patch.object(w,'capture',return_value={'role':[{}],'sessions':[]}),patch.object(w,'dispatch',side_effect=dispatch),patch.object(w,'owned_inventory',side_effect=inventory),patch.object(w,'docker',side_effect=lambda args:events.append(('docker',args))),patch.object(w,'permission_gaps',return_value=[]):
   r=w.cleanup({}, {}, SimpleNamespace(allowed_public_temp=()),dict.fromkeys(w.DATABASES,object()),'b'*32)
  self.assertEqual(events[0],('dispatch','close'))
  self.assertEqual(events[1],('docker',['rm','--force','a'*64]))
  self.assertTrue(r['exactRevocationVerified'])
 def test_foreign_image_never_authorizes_removal(self):
  identifier='a'*64;owner='b'*32;calls=[]
  def docker(args):
   calls.append(args)
   if args[0]=='ps':return (identifier+'\n').encode()
   return json.dumps([{'Id':identifier,'Image':'sha256:'+'0'*64,'Config':{'Labels':{'wsx.backup.owner':owner}},'HostConfig':{'NetworkMode':'host'},'Name':'/wsx-backup-'+'c'*32}]).encode()
  with patch.object(w,'docker',side_effect=docker):
   with self.assertRaisesRegex(RuntimeError,'FOREIGN_CONTAINER'):w.owned_inventory(owner)
  self.assertFalse(any(args[0]=='rm' for args in calls))
 def test_unknown_sessions_or_revoke_proof_cannot_return_success(self):
  for sessions,gaps in ([{'pid':99}],[]),([],['write-permission']):
   with patch.object(w,'capture',return_value={'role':[{}],'sessions':sessions}),patch.object(w,'dispatch'),patch.object(w,'owned_inventory',return_value=[]),patch.object(w,'permission_gaps',return_value=gaps):
    with self.assertRaises(RuntimeError):w.cleanup({}, {}, SimpleNamespace(allowed_public_temp=()),dict.fromkeys(w.DATABASES,object()),'b'*32)
 def serve_fixture(self,message,expired=False,journal_error=False):
  host={'backup':{'authorization':{'expiresAt':1000},'timeoutSeconds':330},'connection':{'transport':{db:{'expiresAt':1000,'notBefore':100} for db in w.DATABASES}},'objectScope':{}}
  raw=json.dumps(host).encode();reference={'path':'/fixture','sha256':hashlib.sha256(raw).hexdigest()}
  channels=[]
  def channel(*args,**kwargs):
   c=SimpleNamespace(close=lambda:None);channels.append(c);return c
  cleanup=SimpleNamespace(calls=0)
  def cleaned(*args):cleanup.calls+=1;return {'kind':'owned-backup-cleanup-verified'}
  with patch.object(w,'private',return_value=raw),patch.object(w,'validate'),patch.object(w,'protected_authorization',return_value=object()),patch.object(w,'BackupChannel',side_effect=channel),patch.object(w,'capture',return_value={'role':[]}),patch.object(w,'cleanup',side_effect=cleaned),patch.object(w.time,'time',side_effect=[100,100]+[1250]*20 if expired else None,return_value=100),patch.object(w.select,'select',return_value=([object()],[],[])),patch.object(w.sys,'stdin',SimpleNamespace(buffer=SimpleNamespace(fileno=lambda:123))),patch.object(w.os,'read',side_effect=[message,b'']),patch.object(w,'journal_event'),patch.object(w.sys,'stdout',io.StringIO()):
   try:w.serve(reference)
   except (RuntimeError,OSError):
    if not journal_error and message in (b'',b'finish\n') or expired:raise
  return cleanup.calls
 def test_parent_eof_always_triggers_cleanup(self):self.assertEqual(self.serve_fixture(b''),1)
 def test_deadline_without_parent_message_triggers_cleanup(self):self.assertEqual(self.serve_fixture(b'',True),1)
 def test_partial_parent_frame_cannot_block_cleanup(self):self.assertEqual(self.serve_fixture(b'fin'),1)
 def test_cleanup_audit_failure_cannot_skip_role_revocation(self):self.assertEqual(self.serve_fixture(b'unexpected\n',journal_error=True),1)
 def test_invalid_parent_protocol_still_triggers_cleanup(self):self.assertEqual(self.serve_fixture(b'unexpected\n'),1)

if __name__=='__main__':unittest.main()
