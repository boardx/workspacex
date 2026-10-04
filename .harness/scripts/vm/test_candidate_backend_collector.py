import copy
import os
import pathlib
import tempfile
import unittest
from candidate_backend_collector import CandidateBackendCollector, CANDIDATE_SESSION_SQL
from candidate_writer import verify_candidate_backend_seal
from test_candidate_writer import fixture
from writer_fence import DATABASES, digest

class Source:
    def __init__(self, plan):
        self.plan = plan
        self.inventory = []
        for w in plan['candidateWriters'] + plan['baselineWriters']:
            b=w['binding']; config={'Labels':{'com.docker.compose.service':b['service'],
                'com.docker.compose.project.config_files':b['composePath']}}
            b['configSha256']=digest(config)
            self.inventory.append(dict(Id=b['containerId'], Image=b['imageId'], Config=config,
                HostConfig={'NetworkMode':'host'},State={'Running':True,
                'Paused':w in plan['baselineWriters']}))
        plan['stagingIdentity']['writersSha256']=digest(plan['candidateWriters'])
        self.rows={db:dict(peer=plan['databasePeers'][db], preparedTransactions=[],
            sessions=[dict(pid=h['pid'],backendStart=h['backendStart'],role=h['role'],
                backendType='client backend',ssl=True,state='idle',clientAddr='10.0.0.2',
                clientPort=45000+n) for n,h in enumerate(plan['heldSessions'][db])]) for db in DATABASES}
        self.rows[DATABASES[0]]['sessions'].append(dict(pid=42,backendStart='2026-10-03T00:01:00Z',
            role='lane',backendType='client backend',ssl=True,state='idle',clientAddr='10.0.0.2',clientPort=43210))
    def require_lock(self): pass
    def read_hold(self): return dict(schemaVersion=1,state='held',generation=self.plan['holdGeneration'],identity=self.plan['identity'])
    def read_host(self): return self.plan['host']
    def docker_inventory(self): return copy.deepcopy(self.inventory)
    def read_candidate_database_sessions(self,db): return copy.deepcopy(self.rows[db])


def proc_fixture(root, container):
    (root/'1/ns').mkdir(parents=True); os.symlink('net:[123]',root/'1/ns/net')
    (root/'net').mkdir()
    (root/'net/tcp').write_text('header\n 0: 0200000A:A8CA 0100000A:1538 01 0:0 0:0 0 0 0 567\n')
    p=root/'100';(p/'fd').mkdir(parents=True);(p/'ns').mkdir()
    os.symlink('net:[123]',p/'ns/net');os.symlink('socket:[567]',p/'fd/3')
    (p/'stat').write_text('100 (worker with spaces) '+' '.join(['S']+['0']*18+['1234']))
    (p/'cgroup').write_text('0::/system.slice/docker-'+container+'.scope\n')

class Tests(unittest.TestCase):
    def test_actual_proc_parsers_join_backend_and_container(self):
        i,p,j,t=fixture();source=Source(p)
        with tempfile.TemporaryDirectory() as td:
            root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
            proof=CandidateBackendCollector(source,root).collect(p,'a'*64)
            self.assertEqual(proof['sessions'][DATABASES[0]][0]['pid'],42)
            self.assertEqual(proof['socketWitnesses'][DATABASES[0]][0]['processPid'],100)
            self.assertEqual(verify_candidate_backend_seal(p,'a'*64,proof),proof['sessions'])
        self.assertIn("'clientPort',client_port",CANDIDATE_SESSION_SQL)
        self.assertIn('BEGIN TRANSACTION READ ONLY',CANDIDATE_SESSION_SQL)
    def test_nat_namespace_cgroup_tls_baseline_and_unknown_fail_closed(self):
        for variant in ('nat','namespace','cgroup','tls','baseline','unknown','missingheld','bridge'):
            i,p,j,t=fixture();source=Source(p)
            with tempfile.TemporaryDirectory() as td:
                root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
                row=source.rows[DATABASES[0]]['sessions'][-1]
                if variant=='nat':row['clientPort']=33333
                if variant=='namespace':
                    (root/'100/ns/net').unlink();os.symlink('net:[999]',root/'100/ns/net')
                if variant=='cgroup':(root/'100/cgroup').write_text('0::/docker/'+'3'*64+'\n')
                if variant=='tls':row['ssl']=False
                if variant=='baseline':source.inventory[1]['State']['Paused']=False
                if variant=='unknown':row['role']='foreign'
                if variant=='missingheld':source.rows[DATABASES[0]]['sessions'].pop(0)
                if variant=='bridge':source.inventory[0]['HostConfig']['NetworkMode']='bridge'
                with self.assertRaises(RuntimeError):CandidateBackendCollector(source,root).collect(p,'a'*64)
    def test_database_or_fd_race_rejected(self):
        for variant in ('database','fd'):
            i,p,j,t=fixture();source=Source(p)
            with tempfile.TemporaryDirectory() as td:
                root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
                original=source.read_candidate_database_sessions;calls={db:0 for db in DATABASES}
                def read(db):
                    calls[db]+=1;result=original(db)
                    if db==DATABASES[0] and calls[db]==1 and variant=='fd':
                        (root/'100/fd/3').unlink();os.symlink('socket:[999]',root/'100/fd/3')
                    if db==DATABASES[0] and calls[db]>1 and variant=='database':
                        result['sessions'][-1]['backendStart']='other'
                    return result
                source.read_candidate_database_sessions=read
                with self.assertRaisesRegex(RuntimeError,'RACE'):
                    CandidateBackendCollector(source,root).collect(p,'a'*64)

    def test_shared_socket_owner_rejected(self):
        i,p,j,t=fixture();source=Source(p)
        with tempfile.TemporaryDirectory() as td:
            root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
            import shutil
            shutil.copytree(root/'100',root/'101',symlinks=True)
            with self.assertRaisesRegex(RuntimeError,'OWNER_AMBIGUOUS'):
                CandidateBackendCollector(source,root).collect(p,'a'*64)

if __name__=='__main__':unittest.main()
