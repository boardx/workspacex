import subprocess
import unittest
from cn_backup_channel import BackupChannel, Cursor

class Pipe:
 def __init__(self):self.closed=False
 def close(self):self.closed=True

class ResistantProcess:
 def __init__(self):self.stdin=Pipe();self.stdout=Pipe();self.events=[];self.returncode=None
 def wait(self,timeout):
  self.events.append(('wait',timeout))
  if self.returncode is None:raise subprocess.TimeoutExpired('owned-fake-channel',timeout)
  return self.returncode
 def terminate(self):self.events.append(('terminate',))
 def kill(self):self.events.append(('kill',));self.returncode=-9

class ChannelTests(unittest.TestCase):
 def test_source_query_artifact_matches_closed_compiler(self):
  from cn_backup_channel import query_table
  import json
  from pathlib import Path
  self.assertEqual(json.loads((Path(__file__).parent/'cn-backup-fixed-queries.json').read_text()),query_table())

 def test_cleanup_only_rejects_permission_mutations_before_stdin(self):
  channel=BackupChannel.__new__(BackupChannel);channel.cleanup_only=True
  for action in ('login','create','grant'):
   with self.assertRaisesRegex(RuntimeError,'CLEANUP_ONLY'):
    channel.request({'operation':'mutation','action':action})
 def test_expired_cleanup_compiler_preserves_original_frozen_sql(self):
  from cn_backup_channel import mutation_table
  from test_cn_backup_package import fixture
  from unittest.mock import patch
  p,scope=fixture();frozen=mutation_table(p,scope,expected_identity=p['identity'])
  with patch('cn_backup_package.time.time',return_value=p['authorization']['expiresAt']+1):
   self.assertEqual(mutation_table(p,scope,cleanup_only=True,expected_identity=p['identity']),frozen)
   with self.assertRaisesRegex(RuntimeError,'LEASE'):mutation_table(p,scope,expected_identity=p['identity'])

 def test_term_resistant_owned_channel_is_killed_joined_and_pipes_closed(self):
  channel=BackupChannel.__new__(BackupChannel);channel.process=ResistantProcess()
  channel.close()
  self.assertIn(('terminate',),channel.process.events)
  self.assertIn(('kill',),channel.process.events)
  self.assertEqual(channel.process.events[-1][0],'wait')
  self.assertTrue(channel.process.stdin.closed)
  self.assertTrue(channel.process.stdout.closed)
 def test_cursor_arbitrary_sql_and_parameter_override_never_reach_channel(self):
  class FakeChannel:
   database='workspacex'
   host={'backup':{},'statements':{'workspacex':{'begin':['BEGIN']}}}
   def request(self,message):raise AssertionError('unexpected database request')
  cursor=Cursor(FakeChannel())
  for sql,params in [('DROP DATABASE workspacex',()),('BEGIN',('override',)),('SELECT 1',())]:
   with self.assertRaises(RuntimeError):cursor.execute(sql,params)

if __name__=='__main__':unittest.main()
