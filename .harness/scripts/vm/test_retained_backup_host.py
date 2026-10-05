import types,threading,time,unittest
from unittest.mock import patch
from test_cn_backup_package import fixture
from retained_backup_host import RetainedBackupHost,SerializedRetainedChannel,ParentOwnedDeadlineWatchdog,RetainedBackupHostObserverAuthority
from cn_backup_channel import mutation_table
from cn_backup_package import DATABASES
from cn_backup_channel import query_table
from writer_fence import digest
class HostTests(unittest.TestCase):
 def host(self):
  p,scope=fixture();h=RetainedBackupHost.__new__(RetainedBackupHost);h.plan=p;h.scope=scope;h.reference={'path':'/protected/host','sha256':'e'*64};h.host={'backup':p,'objectScope':scope,'statements':mutation_table(p,scope),'databasePeers':{db:{'database':db} for db in DATABASES}};h.channels={};h.mutex=threading.RLock();h.closing=False;h.password='private';h.clock=time.time;h.deadline=time.time()+100;h.owner='a'*32;h.read=lambda path:b'';h.stream_attempts=0;h.joined_streams=0;h.relays=[]
  h.bindings={db:{'peer':{'database':db},'role':'migration_admin','pid':10+n,'backendStart':'fixed'} for n,db in enumerate(DATABASES)}
  h.requests=[]
  def ch(db):
   obj=types.SimpleNamespace(binding=h.bindings[db],mode='control')
   def bind(ref):obj.retained_backup_protocol={'kind':'retained-fixed-backup-v1','identity':p['identity'],'toolRevision':p['toolRevision'],'database':db,'queriesSha256':digest(query_table()),'mutationsSha256':digest(h.host['statements'])}
   obj.bind_retained_backup=bind
   obj.request=lambda message,deadline_seconds:h.requests.append(message) or {'connection':obj.binding,'fields':[],'rows':[]}
   obj.close=lambda:(_ for _ in ()).throw(AssertionError('retained client must not close'))
   return obj
  h.retained={db:ch(db) for db in DATABASES};h.actor=types.SimpleNamespace(plan={'controlSessions':h.bindings})
  return h
 def test_open_negotiates_only_existing_and_close_does_not_end(self):
  h=self.host()
  with patch('cn_backup_channel.subprocess.Popen',side_effect=AssertionError('newadmin')):h.open_channels();self.assertEqual(set(h.channels),set(DATABASES));h.close_channels()
  self.assertEqual(h.requests,[])
 def test_whole_transaction_lock_prevents_interleave(self):
  h=self.host();h.open_channels();channel=h.channels[DATABASES[0]]
  channel.request({'operation':'mutation','action':'begin','statement':0})
  acquired=[]
  def rival():acquired.append(h.mutex.acquire(timeout=.01))
  t=threading.Thread(target=rival);t.start();t.join();self.assertEqual(acquired,[False])
  channel.request({'operation':'mutation','action':'rollback','statement':0});self.assertFalse(channel.transaction)
 def test_closing_is_sticky_no_login_create_grant(self):
  h=self.host();h.open_channels();h.closing=True
  for action in ('create','grant','login'):
   request={'operation':'mutation','action':action,'statement':0}
   if action=='login':request={'operation':'mutation','action':'login','password':'A'*48}
   with self.assertRaisesRegex(RuntimeError,'CLOSING_STICKY'):h.channels[DATABASES[0]].request(request)
  self.assertEqual(h.requests,[])
 def test_cleanup_uses_only_fixed_retained_transactions(self):
  h=self.host();h.open_channels();h.retained_close_revoke();self.assertTrue(h.closing);self.assertIsNone(h.password)
  actions=[r['request']['action'] for r in h.requests];self.assertEqual(actions.count('begin'),3);self.assertEqual(actions.count('commit'),3);self.assertIn('close',actions);self.assertEqual(actions.count('revoke'),sum(len(h.host['statements'][db]['revoke']) for db in DATABASES))
 def test_deadline_watchdog_parent_only_closing(self):
  h=self.host();h.deadline=time.time()-.01;called=[]
  h.retained_close_revoke=lambda:called.append(threading.get_ident())
  watchdog=ParentOwnedDeadlineWatchdog(h);watchdog.start();time.sleep(.02);watchdog.finish();self.assertTrue(h.closing);self.assertEqual(len(called),1)
 def test_no_backend_returns_none_without_receipt(self):
  h=self.host();authority=RetainedBackupHostObserverAuthority(h,DATABASES[0],'wsx-backup-'+'a'*32)
  h.owned_inventory=lambda timeout:[];self.assertIsNone(authority.locate_owned_backend(.1))
 def test_source_registry_top_backend_is_required(self):
  h=self.host();authority=RetainedBackupHostObserverAuthority(h,DATABASES[0],'wsx-backup-'+'a'*32)
  h.owned_inventory=lambda timeout:[{'Id':'c'*64,'Name':'/wsx-backup-'+'a'*32,'State':{'Running':True}}]
  h.fixed_docker=lambda args,timeout:b'PID COMMAND\n123 pg_dump\n456 pg_dump\n'
  with self.assertRaisesRegex(RuntimeError,'PGDUMP_UNIQUE'):authority.locate_owned_backend(.1)
if __name__=='__main__':unittest.main()
