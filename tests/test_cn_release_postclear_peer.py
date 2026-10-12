import importlib.util,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('postclear_peer',ROOT/'tests/fixtures/cn-postclear-recovery/postgres_peer.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class PeerTests(unittest.TestCase):
    def value(self):return dict(database='workspacex',serverAddr='127.0.0.1/32',hostAddress='127.0.0.1',serverPort=34567,systemIdentifier='123456')
    def read(self,v):return m.read_peer(lambda db,q:json.dumps(v),'workspacex',dict(port=34567,systemIdentifier='123456'))
    def test_real_inet_text_preserved_for_original_cas(self):
        sys.path.insert(0,str(ROOT/'.harness/scripts/vm'))
        from fixed_probes import login_cas_sql
        peer=self.read(self.value());self.assertEqual(peer['serverAddr'],'127.0.0.1/32')
        query=login_cas_sql(peer,{'lane':False},{'lane':True})
        self.assertIn("inet_server_addr()::text IS DISTINCT FROM '127.0.0.1/32'",query)
        old=dict(peer,serverAddr='127.0.0.1');self.assertNotEqual(old['serverAddr'],self.value()['serverAddr'])
        self.assertNotIn("IS DISTINCT FROM '127.0.0.1/32'",login_cas_sql(old,{'lane':False},{'lane':True}))
    def test_peer_mismatch_refused(self):
        for key,value in [('database','other'),('hostAddress','8.8.8.8'),('serverAddr','127.0.0.1/24'),('serverPort',9999),('serverPort',True),('systemIdentifier','9')]:
            v=self.value();v[key]=value
            with self.assertRaises(RuntimeError):self.read(v)
    def test_original_query_shape(self):
        self.assertIn('inet_server_addr()::text',m.PEER_SQL);self.assertIn('host(inet_server_addr())',m.PEER_SQL)
    def test_fixed_sql_error_no_secret_output(self):
        self.assertEqual(m.sql_error_code(b'ERROR:  LOGIN_PEER_CAS\nCONTEXT: secret'),'LOGIN_PEER_CAS')
        self.assertEqual(m.sql_error_code(b'ERROR:  secret token\n'),'FIXTURE_SQL_FAILED')
