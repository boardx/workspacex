import copy,hashlib,os,pathlib,tempfile,unittest
from cn_backup_backend import BackupBackendCollector, PG_DUMP_ARGV, BACKUP_SESSION_SQL
from cn_backup_package import IMAGE,ROLE
from test_cn_backup_package import fixture
from test_candidate_backend_collector import proc_fixture
from writer_fence import DATABASES,require

class Source:
 def __init__(self,db,cid,binary):
  self.context=(db,cid,100,'wsx-backup-test')
  self.pinned=dict(imageId=IMAGE,versionMajor=16,exePath='/usr/bin/pg_dump',sha256=hashlib.sha256(binary).hexdigest())
  self.inventory=[dict(Id=cid,Image=IMAGE,HostConfig={'NetworkMode':'host'},State={'Running':True,'Paused':False})]
  self.observed=dict(peer=dict(database=db,serverAddr='192.168.100.44',serverPort=5432,systemIdentifier='verified'),
    preparedTransactions=[],sessions=[dict(pid=42,backendStart='2026-10-03T01:00:00Z',role=ROLE,
     applicationName='wsx-backup-test',backendType='client backend',clientAddr='192.168.100.40',
     clientPort=43210,state='active',ssl=True)])
  self.exception_calls=[]
 def verify_backup_context(self,p,*context): require(context==self.context,'CONTEXT')
 def verified_pg_dump16(self): return self.pinned
 def docker_inventory(self): return copy.deepcopy(self.inventory)
 def read_backup_database_sessions(self,db):return copy.deepcopy(self.observed)
 def verify_backup_peer(self,p,peer):require(peer['systemIdentifier']=='verified','PEER')
 def verify_existing_no_tls_exception(self,p,facts):
  self.exception_calls.append(facts);return facts['session']['clientAddr']=='192.168.100.40' and facts['peer']['serverAddr']=='192.168.100.44'

def setup(root,cid):
 binary=b'fixture pinned pg_dump16'
 proc_fixture(root,cid);p=root/'100';(p/'root/usr/bin').mkdir(parents=True)
 (p/'root/usr/bin/pg_dump').write_bytes(binary);os.symlink('/usr/bin/pg_dump',p/'exe')
 (p/'cmdline').write_bytes(b'pg_dump\0'+b'\0'.join(a.encode() for a in PG_DUMP_ARGV)+b'\0')
 (root/'net/tcp').write_text('header\n0: 2864A8C0:A8CA 2C64A8C0:1538 01 0:0 0:0 0 0 0 567\n')
 return binary

class Tests(unittest.TestCase):
 def test_owned_dump_and_source_authorized_no_tls_attestation(self):
  for tls in (True,False):
   p,_=fixture();db=DATABASES[0];cid='1'*64
   with tempfile.TemporaryDirectory() as td:
    root=pathlib.Path(td);s=Source(db,cid,setup(root,cid));s.observed['sessions'][0]['ssl']=tls
    proof=BackupBackendCollector(s,root).collect(p,db,cid,100,'wsx-backup-test',expected_identity=p['identity'])
    self.assertFalse(proof['readOnlyEvidence']['sqlObserved'])
    self.assertEqual(proof['facts']['session']['pid'],42)
    self.assertEqual(len(s.exception_calls),0 if tls else 1)
  self.assertIn('client_port',BACKUP_SESSION_SQL);self.assertIn('application_name',BACKUP_SESSION_SQL)
 def test_foreign_process_peer_nat_image_cmdline_or_no_tls_flag_reject(self):
  for variant in ('exe','cmdline','peer','nat','image','role','appname','tls'):
   p,_=fixture();db=DATABASES[0];cid='1'*64
   with tempfile.TemporaryDirectory() as td:
    root=pathlib.Path(td);s=Source(db,cid,setup(root,cid));row=s.observed['sessions'][0]
    if variant=='exe':(root/'100/root/usr/bin/pg_dump').write_bytes(b'changed')
    if variant=='cmdline':(root/'100/cmdline').write_bytes(b'psql\0')
    if variant=='peer':s.observed['peer']['systemIdentifier']='foreign'
    if variant=='nat':row['clientPort']=33333
    if variant=='image':s.inventory[0]['Image']='postgres:16'
    if variant=='role':row['role']='other'
    if variant=='appname':row['applicationName']='precheck'
    if variant=='tls':row['ssl']=False;s.verify_existing_no_tls_exception=None
    with self.assertRaises(RuntimeError):BackupBackendCollector(s,root).collect(p,db,cid,100,'wsx-backup-test',expected_identity=p['identity'])
 def test_strong_sql_readonly_requirement_cannot_be_faked(self):
  p,_=fixture()
  with self.assertRaisesRegex(RuntimeError,'NOT_OBSERVABLE'):
   BackupBackendCollector(None,'/nonexistent').collect(p,DATABASES[0],'1'*64,100,'app',True,expected_identity=p['identity'])

if __name__=='__main__':unittest.main()
