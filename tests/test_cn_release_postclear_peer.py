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
    def test_socket_fixture_uses_actual_peer_original_verifier_stays_strict(self):
        import copy
        sys.path.insert(0,str(ROOT/'.harness/scripts/vm'))
        from test_candidate_host_transport import Tests
        from test_candidate_writer import seal_fixture
        from candidate_writer import verify_candidate_backend_seal
        from writer_fence import DATABASES,digest
        f=Tests();f.setUp()
        try:
            config=dict(port=34567,systemIdentifier='123456')
            for db in DATABASES:
                peer=dict(database=db,serverAddr='127.0.0.1/32',serverPort=34567,systemIdentifier='123456')
                f.p['databasePeers'][db]=peer
                for row in f.p['heldSessions'][db]+f.p['candidateSessions'][db]:row['peerSha256']=digest(peer)
            nonce='f'*64
            with self.assertRaisesRegex(RuntimeError,'CANDIDATE_SOCKET_OWNER_NOT_PROVEN'):
                verify_candidate_backend_seal(f.p,nonce,seal_fixture(f.p,nonce))
            proof=m.isolated_socket_seal(f.p,nonce,config)
            verify_candidate_backend_seal(f.p,nonce,proof)
            for field,value in [('remotePort',5432),('remoteAddr','10.0.0.1'),('cgroupContainerId','0'*64)]:
                bad=copy.deepcopy(proof);bad['socketWitnesses'][DATABASES[0]][0][field]=value
                with self.assertRaisesRegex(RuntimeError,'CANDIDATE_SOCKET_OWNER_NOT_PROVEN'):
                    verify_candidate_backend_seal(f.p,nonce,bad)
            for field,value in [('serverPort',34568),('serverAddr','8.8.8.8'),('systemIdentifier','999')]:
                bad=copy.deepcopy(f.p);bad['databasePeers'][DATABASES[0]][field]=value
                with self.assertRaisesRegex(RuntimeError,'FIXTURE_DATABASE_PEER'):
                    m.isolated_socket_seal(bad,nonce,config)
        finally:f.doCleanups()
