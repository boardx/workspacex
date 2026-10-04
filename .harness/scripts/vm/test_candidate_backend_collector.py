import copy
import os
import pathlib
import tempfile
import unittest
from candidate_backend_collector import CandidateBackendCollector, CANDIDATE_SESSION_SQL, conntrack_rows
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
    def test_conntrack_snapshot_parser_preserves_both_tuples(self):
        raw='ipv4 2 tcp 6 431999 ESTABLISHED src=10.0.0.2 dst=10.0.0.1 sport=43210 dport=5432 src=10.0.0.1 dst=192.168.100.40 sport=5432 dport=50000 [ASSURED] mark=0 use=1\n'
        self.assertEqual(conntrack_rows(raw.replace('ESTABLISHED','SYN_SENT')),[])
        self.assertEqual(conntrack_rows(raw.replace('ESTABLISHED','TIME_WAIT')),[])
        self.assertEqual(conntrack_rows(raw+raw.replace('ESTABLISHED','SYN_SENT')),conntrack_rows(raw))
        result=conntrack_rows(raw)
        self.assertEqual(result[0]['original']['srcPort'],43210)
        self.assertEqual(result[0]['reply']['dstAddr'],'192.168.100.40')
        for bad in (raw.replace('[ASSURED]',''),raw.replace('dport=50000','dport=0'),raw+' tcp ESTABLISHED [ASSURED]'):
            with self.assertRaises(RuntimeError):conntrack_rows(bad)

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
    def test_bridge_direct_namespace_socket_supported(self):
        i,p,j,t=fixture();source=Source(p)
        source.inventory[0]['HostConfig']['NetworkMode']='project_default'
        with tempfile.TemporaryDirectory() as td:
            root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
            (root/'100/ns/net').unlink();os.symlink('net:[999]',root/'100/ns/net')
            (root/'100/net').mkdir()
            (root/'100/net/tcp').write_text((root/'net/tcp').read_text())
            (root/'net/tcp').write_text('header\n')
            proof=CandidateBackendCollector(source,root).collect(p,'a'*64)
            self.assertEqual(proof['sessions'][DATABASES[0]][0]['pid'],42)

    def test_bridge_snat_live_conntrack_join_and_failures(self):
        for variant in ('valid','duplicate','missing','wrong-original','wrong-reply','race','candidate-syn','candidate-timewait','seal-original','seal-reply','seal-port','seal-namespace'):
            i,p,j,t=fixture();source=Source(p)
            source.inventory[0]['HostConfig']['NetworkMode']='project_default'
            source.rows[DATABASES[0]]['sessions'][-1]['clientAddr']='192.168.100.40'
            source.rows[DATABASES[0]]['sessions'][-1]['clientPort']=50000
            mapping=dict(original=dict(srcAddr='10.0.0.2',srcPort=43210,dstAddr='10.0.0.1',dstPort=5432),
                         reply=dict(srcAddr='10.0.0.1',srcPort=5432,dstAddr='192.168.100.40',dstPort=50000))
            entries=[mapping]
            if variant=='duplicate':entries.append(copy.deepcopy(mapping))
            if variant=='missing':entries=[]
            if variant=='wrong-original':mapping['original']['srcPort']=43211
            if variant=='wrong-reply':mapping['reply']['dstPort']=50001
            if variant in ('candidate-syn','candidate-timewait'):
                state='SYN_SENT' if variant=='candidate-syn' else 'TIME_WAIT'
                entries=conntrack_rows('ipv4 2 tcp 6 30 '+state+' src=10.0.0.2 dst=10.0.0.1 sport=43210 dport=5432 src=10.0.0.1 dst=192.168.100.40 sport=5432 dport=50000 [ASSURED]')
            calls=[0]
            def conntrack():
                calls[0]+=1
                result=copy.deepcopy(entries)
                if variant=='race' and calls[0]>1:result=[]
                return result
            source.read_candidate_conntrack=conntrack
            with tempfile.TemporaryDirectory() as td:
                root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
                (root/'100/ns/net').unlink();os.symlink('net:[999]',root/'100/ns/net')
                (root/'100/net').mkdir()
                (root/'100/net/tcp').write_text((root/'net/tcp').read_text())
                (root/'net/tcp').write_text('header\n')
                if variant in ('valid','seal-original','seal-reply','seal-port','seal-namespace'):
                    proof=CandidateBackendCollector(source,root).collect(p,'a'*64)
                    witness=proof['socketWitnesses'][DATABASES[0]][0]
                    self.assertEqual(witness['localAddr'],'10.0.0.2')
                    self.assertEqual(witness['pgClientAddr'],'192.168.100.40')
                    if variant=='seal-original':witness['conntrack']['original']['srcAddr']='10.0.0.3'
                    if variant=='seal-reply':witness['conntrack']['reply']['dstAddr']='192.168.100.41'
                    if variant=='seal-port':witness['conntrack']['reply']['dstPort']=True
                    if variant=='seal-namespace':witness['networkNamespace']='untrusted'
                    if variant!='valid':
                        with self.assertRaises(RuntimeError):verify_candidate_backend_seal(p,'a'*64,proof)
                    else:
                        for direction in ('original','reply'):
                            for field in ('srcAddr','dstAddr','srcPort','dstPort'):
                                changed=copy.deepcopy(proof)
                                entry=changed['socketWitnesses'][DATABASES[0]][0]['conntrack'][direction]
                                entry[field]='10.99.99.99' if field.endswith('Addr') else entry[field]+1
                                with self.assertRaises(RuntimeError):verify_candidate_backend_seal(p,'a'*64,changed)
                        for field in ('networkNamespace','conntrack'):
                            changed=copy.deepcopy(proof)
                            del changed['socketWitnesses'][DATABASES[0]][0][field]
                            with self.assertRaises(RuntimeError):verify_candidate_backend_seal(p,'a'*64,changed)
                        for value in (True,0,-1,65536,'5432'):
                            changed=copy.deepcopy(proof)
                            changed['socketWitnesses'][DATABASES[0]][0]['conntrack']['original']['srcPort']=value
                            with self.assertRaises(RuntimeError):verify_candidate_backend_seal(p,'a'*64,changed)
                else:
                    with self.assertRaises(RuntimeError):CandidateBackendCollector(source,root).collect(p,'a'*64)

    def test_serverless_exception_requires_bound_shared_verifier_result(self):
        import time
        for variant in ('valid','stale','wrongpeer','wrongidentity','wrongkind','wrongmode','bad-hash','raw-provider','race'):
            i,p,j,t=fixture();source=Source(p)
            row=source.rows[DATABASES[0]]['sessions'][-1];row['ssl']=False
            evidence=dict(schemaVersion=1,kind='existing-production-maintenance-transport-verified',
                identity=p['identity'],peer=p['databasePeers'][DATABASES[0]],
                endpoint=dict(address='10.0.0.1',port=5432),observedAt=time.time(),
                proof=dict(sslMode='disable',configurationSha256='a'*64,providerEvidenceSha256='b'*64))
            if variant=='stale':evidence['observedAt']-=31
            if variant=='wrongpeer':evidence['peer']={}
            if variant=='wrongidentity':evidence['identity']={}
            if variant=='wrongkind':evidence['kind']='caller-json'
            if variant=='wrongmode':evidence['proof']['sslMode']='verify-full'
            if variant=='bad-hash':evidence['proof']['configurationSha256']='bad'
            if variant=='raw-provider':evidence['providerAuthority']={'SSLEnabled':'off'}
            calls=[0]
            def read(db):
                calls[0]+=1;result=copy.deepcopy(evidence)
                if variant=='race' and calls[0]>1:result['proof']['providerEvidenceSha256']='c'*64
                return result
            source.read_candidate_transport_evidence=read
            with tempfile.TemporaryDirectory() as td:
                root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
                if variant=='valid':CandidateBackendCollector(source,root).collect(p,'a'*64)
                else:
                    with self.assertRaises(RuntimeError):CandidateBackendCollector(source,root).collect(p,'a'*64)

    def test_database_or_fd_race_rejected(self):
        for variant in ('database','fd','fdset','processset'):
            i,p,j,t=fixture();source=Source(p)
            with tempfile.TemporaryDirectory() as td:
                root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
                original=source.read_candidate_database_sessions;calls={db:0 for db in DATABASES}
                def read(db):
                    calls[db]+=1;result=original(db)
                    if db==DATABASES[0] and calls[db]==1 and variant=='fd':
                        (root/'100/fd/3').unlink();os.symlink('socket:[999]',root/'100/fd/3')
                    if db==DATABASES[0] and calls[db]==1 and variant=='fdset':
                        os.symlink('socket:[999]',root/'100/fd/4')
                    if db==DATABASES[0] and calls[db]==1 and variant=='processset':
                        (root/'101').mkdir()
                    if db==DATABASES[0] and calls[db]>1 and variant=='database':
                        result['sessions'][-1]['backendStart']='other'
                    return result
                source.read_candidate_database_sessions=read
                with self.assertRaisesRegex(RuntimeError,'RACE'):
                    CandidateBackendCollector(source,root).collect(p,'a'*64)

    def test_null_server_addr_uses_verified_endpoint_without_plan_rewrite(self):
        import time
        for network in ('host','bridge'):
            for variant in ('valid','missing','wrong-address','wrong-port','race','seal-address','seal-hash'):
                i,p,j,t=fixture();db=DATABASES[0]
                p['databasePeers'][db]['serverAddr']=None
                for h in p['heldSessions'][db]:h['peerSha256']=digest(p['databasePeers'][db])
                source=Source(p)
                for row in source.rows[db]['sessions']:row['ssl']=False
                if network=='bridge':
                    source.inventory[0]['HostConfig']['NetworkMode']='project_default'
                    source.rows[db]['sessions'][-1].update(clientAddr='192.168.100.40',clientPort=50000)
                    source.read_candidate_conntrack=lambda:[dict(
                        original=dict(srcAddr='10.0.0.2',srcPort=43210,dstAddr='10.0.0.1',dstPort=5432),
                        reply=dict(srcAddr='10.0.0.1',srcPort=5432,dstAddr='192.168.100.40',dstPort=50000))]
                evidence=dict(schemaVersion=1,kind='existing-production-maintenance-transport-verified',
                    identity=p['identity'],peer=p['databasePeers'][db],endpoint=dict(address='10.0.0.1',port=5432),
                    observedAt=time.time(),proof=dict(sslMode='disable',configurationSha256='a'*64,providerEvidenceSha256='b'*64))
                if variant=='wrong-address':evidence['endpoint']['address']='10.0.0.99'
                if variant=='wrong-port':evidence['endpoint']['port']=5433
                calls=[0]
                def read(database):
                    calls[0]+=1;result=copy.deepcopy(evidence)
                    if variant=='race' and calls[0]>1:result['endpoint']['address']='10.0.0.99'
                    return result
                if variant!='missing':source.read_candidate_transport_evidence=read
                with tempfile.TemporaryDirectory() as td:
                    root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
                    if network=='bridge':
                        (root/'100/ns/net').unlink();os.symlink('net:[999]',root/'100/ns/net')
                        (root/'100/net').mkdir()
                        (root/'100/net/tcp').write_text((root/'net/tcp').read_text())
                        (root/'net/tcp').write_text('header\n')
                    if variant in ('valid','seal-address','seal-hash'):
                        proof=CandidateBackendCollector(source,root).collect(p,'a'*64)
                        self.assertIsNone(p['databasePeers'][db]['serverAddr'])
                        witness=proof['socketWitnesses'][db][0]
                        self.assertEqual(witness['endpointAuthority']['address'],'10.0.0.1')
                        if variant=='seal-address':witness['endpointAuthority']['address']='10.0.0.99'
                        if variant=='seal-hash':witness['endpointAuthority']['configurationSha256']='invalid'
                        if variant!='valid':
                            with self.assertRaises(RuntimeError):verify_candidate_backend_seal(p,'a'*64,proof)
                    else:
                        with self.assertRaises(RuntimeError):CandidateBackendCollector(source,root).collect(p,'a'*64)

    def test_opened_observation_requires_cleared_same_generation(self):
        for variant in ('valid','held','wrong-generation','wrong-identity'):
            i,p,j,t=fixture();source=Source(p)
            hold=source.read_hold();hold['state']='cleared'
            if variant=='held':hold['state']='held'
            if variant=='wrong-generation':hold['generation']='b'*32
            if variant=='wrong-identity':hold['identity']={}
            source.read_hold=lambda:copy.deepcopy(hold)
            with tempfile.TemporaryDirectory() as td:
                root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
                collector=CandidateBackendCollector(source,root)
                if variant=='valid':
                    collector.collect_opened(p,'a'*64)
                    with self.assertRaises(RuntimeError):collector.collect(p,'a'*64)
                else:
                    with self.assertRaises(RuntimeError):collector.collect_opened(p,'a'*64)

    def test_shared_socket_owner_rejected(self):
        i,p,j,t=fixture();source=Source(p)
        with tempfile.TemporaryDirectory() as td:
            root=pathlib.Path(td);proc_fixture(root,p['candidateWriters'][0]['binding']['containerId'])
            import shutil
            shutil.copytree(root/'100',root/'101',symlinks=True)
            with self.assertRaisesRegex(RuntimeError,'OWNER_AMBIGUOUS'):
                CandidateBackendCollector(source,root).collect(p,'a'*64)

if __name__=='__main__':unittest.main()
