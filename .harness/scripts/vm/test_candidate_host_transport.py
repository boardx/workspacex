import copy
import hashlib
import json
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from test_candidate_writer import fixture, seal_fixture
from candidate_host_transport import CandidateHostTransport, RetainedCandidateActor, RetainedBaselineCancellation
from candidate_writer import CandidateWriterAdapter
from writer_fence import DATABASES, digest

class Connection:
    def __init__(self, host, db):
        self.host, self.db = host, db
        self.binding = dict(tls=dict(ssl=True), pid=11, role='diagnostic')
    def query(self, key):
        self.host.queries.append((self.db, key))
        if key == 'migration-ledger': return dict(rowCount=0, ledger=[])
        if key == 'run-drain': return dict(rows=[])
        if key == 'candidate-sessions':
            p=self.host.p
            rows=[dict(pid=h['pid'], backendStart=h['backendStart'], role=h['role'],backendType=h['backendType'],
                       clientAddr='10.0.0.2',clientPort=100+h['pid'],ssl=True,state='idle') for h in p['heldSessions'][self.db]]
            if self.host.running:
                rows += [dict(pid=s['pid'],backendStart=s['backendStart'],role=s['role'],backendType=s['backendType'],
                              clientAddr='10.0.0.2',clientPort=300+s['pid'],ssl=True,state=s['transactionMode']) for s in seal_fixture(p,'a'*64)['sessions'][self.db]]
            return dict(peer=p['databasePeers'][self.db],sessions=rows,preparedTransactions=[])
        raise RuntimeError('unreviewed query')

class Host:
    def __init__(self,p):
        self.p=p;self.running=False;self.login=copy.deepcopy(p['closedAdmission']);self.commands=[];self.sql=[];self.queries=[];self.fail_pause=False
        self.plan=dict(identity=p['identity'],host=p['host'],databasePeers=p['databasePeers'],automationUnits=p['automationUnits'],
                       databaseWriterRoles=p['fencedRoles'],writers=p['baselineWriters'],toolRevision='0'*40,
                       diagnosticSessions={db:dict(tls=dict(ssl=True),pid=11,role='diagnostic') for db in DATABASES})
        self.diagnostic_connections={db:Connection(self,db) for db in DATABASES}
    def require_lock(self): pass
    def read_hold(self): return dict(schemaVersion=1,state='held',generation=self.p['holdGeneration'],identity=self.p['identity'],sha256='a'*64,device=1,inode=2)
    def docker_inventory(self):
        result=[]
        for w in self.p['candidateWriters']+self.p['baselineWriters']:
            candidate=w in self.p['candidateWriters'];b=w['binding']
            result.append(dict(Id=b['containerId'],Image=b['imageId'],Config=copy.deepcopy(b['_fixtureConfig']) if '_fixtureConfig' in b else configs[w['key']],State=dict(Running=True,Paused=not (candidate and self.running))))
        return result
    def observe(self,p):
        assert p==self.plan
        cid=self.p['candidateWriters'][0]['binding']['containerId']
        return dict(host=self.p['host'],scopes=['host-proc','all-docker-containers','systemd-writer-units','three-db-sessions','database-admission'],
                    unclassifiedContainers=[cid],unclassifiedProcesses=[dict(cgroup='/docker/'+cid)],
                    automationUnits={u:'masked' for u in self.p['automationUnits']},admission=copy.deepcopy(self.login))
    def run(self,args):
        self.commands.append(args)
        if args[1] in ('start','unpause'): self.running=True
        if args[1]=='pause':
            if self.fail_pause: raise RuntimeError('pause lost reply')
            self.running=False
        return b''
    def database_execute(self,db,sql,control=False):
        assert control
        self.sql.append((db,sql))
        if 'ALTER ROLE' in sql:
            self.login['login'][db]=copy.deepcopy(self.p['candidateAdmission' if '"lane" LOGIN;' in sql else 'closedAdmission']['login'][db])

configs={}
class Probes:
    def __init__(self,host): self.host=host
    def admission(self): return copy.deepcopy(self.host.login), {}

class Tests(unittest.TestCase):
    def setUp(self):
        self.identity,self.p,self.j,_=fixture();self.files={'/etc/workspacex-cn/artifact.json':b'artifact'}
        self.p['artifactSha256']=hashlib.sha256(b'artifact').hexdigest()
        for w in self.p['candidateWriters']+self.p['baselineWriters']:
            b=w['binding'];configs[w['key']]=dict(Labels={'com.docker.compose.service':b['service'],'com.docker.compose.project.config_files':b['composePath']})
            b['configSha256']=digest(configs[w['key']]);self.files[b['composePath']]=w['key'].encode();b['composeSha256']=hashlib.sha256(self.files[b['composePath']]).hexdigest()
        for index, db in enumerate(DATABASES):
            self.p['databasePeers'][db]['systemIdentifier']=str(100+index);self.p['databasePeers'][db]['database']=db
            self.p['candidateSessions'][db]=[dict(pid=100+index,backendStart='2026-10-03T00:00:00Z',role='lane',transactionMode='idle',backendType='client backend',peerSha256=digest(self.p['databasePeers'][db]),writerKey='candidate',binding=copy.deepcopy(self.p['candidateWriters'][0]['binding']))]
            for h in self.p['heldSessions'][db]: h['peerSha256']=digest(self.p['databasePeers'][db])
        self.p['stagingIdentity'].update(artifactSha256=self.p['artifactSha256'],writersSha256=digest(self.p['candidateWriters']))
        completed=dict(schemaVersion=1,kind='validated-migration-completion',identity=self.identity,toolRevision='0'*40)
        self.raw=json.dumps(completed).encode();path='/etc/workspacex-cn/migration-completion-inputs/'+self.identity['sourceRevision']+'/'+self.identity['attemptId']+'.completed.json'
        self.files[path]=self.raw;receipt=dict(path=path,sha256=hashlib.sha256(self.raw).hexdigest())
        self.p['migrationCompletionSha256']=receipt['sha256'];self.p['migrationLedgerSha256']=digest([])
        self.j.value['migrationCompletionIntent']=receipt;self.j.value['migrationCompletionReceipt']=receipt
        self.j.record('migration-completion-durable',receipt=receipt,holdGeneration=self.p['holdGeneration'])
        self.host=Host(self.p)
        self.t=CandidateHostTransport(self.host,self.p,self.j,dict(path='/etc/workspacex-cn/artifact.json',sha256=self.p['artifactSha256']),read_private=lambda p:self.files[p])
        self.t.read_host=lambda:self.p['host']
        self.t.collector.collect=lambda p,n:seal_fixture(p,n)
        self.probes=patch('candidate_host_transport.FixedProbes',Probes);self.probes.start();self.addCleanup(self.probes.stop)
    def test_existing_actor_full_candidate_resume_and_reblock(self):
        adapter=CandidateWriterAdapter(self.identity,self.p,self.t,self.j);adapter.resume_candidate(self.identity)
        self.assertTrue(self.host.running);self.assertIn('candidateResumeIntent',self.j.value)
        self.assertEqual(self.host.commands,[['/usr/bin/docker','unpause','1'*64]])
        self.assertTrue(any(q[1]=='candidate-sessions' for q in self.host.queries));self.assertTrue(any(q[1]=='migration-ledger' for q in self.host.queries))
        self.t.reblock_candidate(self.p);self.assertFalse(self.host.running);self.assertEqual(self.host.login,self.p['closedAdmission'])
        self.assertFalse(any('3'*64 in c for c in self.host.commands))
    def test_missing_durable_completion_blocks_sql_and_candidate_start(self):
        self.j.value.pop('migrationCompletionReceipt')
        adapter=CandidateWriterAdapter(self.identity,self.p,self.t,self.j)
        with self.assertRaisesRegex(RuntimeError,'DURABLE_RECEIPT'):adapter.resume_candidate(self.identity)
        self.assertEqual(self.host.commands,[]);self.assertEqual(self.host.sql,[])
    def test_ledger_drift_blocks_reopen(self):
        self.p['migrationLedgerSha256']='f'*64;self.t.plan=copy.deepcopy(self.p)
        with self.assertRaisesRegex(RuntimeError,'LEDGER_DRIFT'):self.t.verify_completed_migration(self.p,'a'*64)
        self.assertEqual(self.host.commands,[])
    def test_exact_container_config_drift_blocks_reopen(self):
        configs['candidate']['Labels']['extra']='drift'
        with self.assertRaisesRegex(RuntimeError,'CONTAINER_DRIFT'):self.t.verify_staging(self.p)
        self.assertEqual(self.host.commands,[])
    def test_no_intent_no_sql_or_start(self):
        with self.assertRaisesRegex(RuntimeError,'DURABLE_RESUME_INTENT'):self.t.reopen_candidate(self.p)
        self.assertEqual(self.host.sql,[]);self.assertEqual(self.host.commands,[])
    def test_reblock_continues_database_cleanup_after_pause_failure(self):
        self.host.running=True;self.host.login=copy.deepcopy(self.p['candidateAdmission']);self.host.fail_pause=True
        with self.assertRaisesRegex(RuntimeError,'REBLOCK_INCOMPLETE'):self.t.reblock_candidate(self.p)
        self.assertTrue(any('pg_terminate_backend' in sql for db,sql in self.host.sql))
        self.assertEqual(self.host.login,self.p['closedAdmission'])
    def test_foreign_session_blocks_closed_observation(self):
        old=self.host.diagnostic_connections['workspacex'].query
        def query(k):
            value=old(k)
            if k=='candidate-sessions':value['sessions'].append(dict(pid=99,backendStart='2026-10-03T00:00:00Z',role='outsider',backendType='client backend',ssl=True,state='idle'))
            return value
        self.host.diagnostic_connections['workspacex'].query=query
        with self.assertRaisesRegex(RuntimeError,'FOREIGN_SESSION'):self.t.observe_candidate(self.p)
    def test_scope_unknown_process_preserved(self):
        old=self.host.observe
        def observe(p):
            v=old(p);v['unclassifiedProcesses'].append(dict(cgroup='/system.slice/foreign.service'));return v
        self.host.observe=observe
        v=self.t.observe_candidate(self.p);self.assertEqual(v['unclassifiedProcesses'],[dict(cgroup='/system.slice/foreign.service')])
    def test_source_baseline_binding_cannot_be_replaced(self):
        self.host.plan['writers']=[]
        with self.assertRaisesRegex(RuntimeError,'BASELINE_SOURCE_BINDING'):CandidateHostTransport(self.host,self.p,self.j,self.t.artifact)
    def test_missing_fixed_candidate_query_fails_without_new_client(self):
        self.host.diagnostic_connections['workspacex'].query=lambda key: (_ for _ in ()).throw(RuntimeError('DIAGNOSTIC_QUERY_AUTHORITY'))
        with self.assertRaisesRegex(RuntimeError,'QUERY_AUTHORITY'):self.t.read_candidate_database_sessions('workspacex')

    def test_duplicate_held_row_cannot_replace_missing_diagnostic(self):
        old=self.host.diagnostic_connections['workspacex'].query
        def query(k):
            value=old(k)
            if k=='candidate-sessions':value['sessions']=[value['sessions'][0],copy.deepcopy(value['sessions'][0])]
            return value
        self.host.diagnostic_connections['workspacex'].query=query
        with self.assertRaisesRegex(RuntimeError,'SESSION_DUPLICATE'):self.t.observe_candidate(self.p)

    def actor(self):
        path='/etc/workspacex-cn/maintenance-candidate/'+self.identity['sourceRevision']+'/'+self.identity['attemptId']+'/candidate-plan.json'
        raw=json.dumps(dict(schemaVersion=1,toolRevision=self.host.plan['toolRevision'],plan=self.p,artifact=self.t.artifact)).encode()
        self.files[path]=raw
        actor=RetainedCandidateActor(self.host,self.j,dict(path=path,sha256=hashlib.sha256(raw).hexdigest()),read_private=lambda p:self.files[p])
        actor.transport.read_host=lambda:self.p['host']
        actor.transport.collector.collect=lambda p,n:seal_fixture(p,n)
        return actor
    def test_fixed_actor_returns_bound_protocol_and_rejects_unknown_operation(self):
        actor=self.actor();r=actor.dispatch('verify-staging',self.identity)
        self.assertEqual(r['kind'],'candidate-host-operation');self.assertFalse(r['ready']);self.assertFalse(r['productionAvailabilityProven'])
        with self.assertRaisesRegex(RuntimeError,'OPERATION_UNSUPPORTED'):actor.dispatch('run-shell',self.identity)
        self.assertEqual(self.host.commands,[])
    def test_actor_input_drift_precedes_commands(self):
        actor=self.actor();self.files[actor.reference['path']]+=b' '
        with self.assertRaisesRegex(RuntimeError,'INPUT_DRIFT'):actor.dispatch('resume',self.identity)
        self.assertEqual(self.host.commands,[])
    def test_new_hold_epoch_only_allows_block_and_never_reopen(self):
        actor=self.actor();actor.dispatch('resume',self.identity)
        self.host.read_hold=lambda:dict(schemaVersion=1,state='held',generation='f'*32,identity=self.identity)
        original=copy.deepcopy(actor.adapter.plan)
        actor.dispatch('rebind-held-epoch-for-reblock',self.identity)
        actor.dispatch('block',self.identity);actor.dispatch('verify-blocked',self.identity)
        self.assertFalse(self.host.running);self.assertEqual(actor.adapter.plan,original)
        self.assertEqual(actor.reblock_plan['holdGeneration'],'f'*32)
        with self.assertRaisesRegex(RuntimeError,'REBOUND_RESUME_FORBIDDEN'):actor.dispatch('resume',self.identity)
        self.assertTrue(any(e['state']=='candidate-rehold-block-intent' for e in self.j.value['events']))
    def test_rebind_journal_failure_permanently_disables_resume(self):
        actor=self.actor();actor.dispatch('resume',self.identity)
        self.host.read_hold=lambda:dict(schemaVersion=1,state='held',generation='f'*32,identity=self.identity)
        self.j.record=lambda *args,**kw:(_ for _ in ()).throw(RuntimeError('journal failure'))
        with self.assertRaisesRegex(RuntimeError,'journal failure'):actor.dispatch('rebind-held-epoch-for-reblock',self.identity)
        self.assertTrue(actor.resume_disabled);self.assertIsNone(actor.reblock_plan)
        with self.assertRaisesRegex(RuntimeError,'REBOUND_RESUME_FORBIDDEN'):actor.dispatch('resume',self.identity)
    def test_open_observation_requires_real_cleared_collector(self):
        actor=self.actor();actor.dispatch('resume',self.identity)
        self.host.read_hold=lambda:dict(schemaVersion=1,state='cleared',generation=self.p['holdGeneration'],identity=self.identity)
        actor.transport.collector.collect_opened=None
        with self.assertRaisesRegex(RuntimeError,'OPEN_COLLECTOR_NOT_IMPLEMENTED'):actor.dispatch('observe-opened',self.identity)
        def opened(plan,nonce):
            self.assertEqual(actor.transport.read_hold()['state'],'cleared')
            return seal_fixture(plan,nonce)
        actor.transport.collector.collect_opened=opened
        r=actor.dispatch('observe-opened',self.identity)
        self.assertEqual(r['holdState'],'cleared');self.assertFalse(r['productionAvailabilityProven'])
        self.assertFalse(hasattr(actor.transport,'_observation_hold_state'))
    def test_rebind_refuses_foreign_identity_hold(self):
        actor=self.actor();self.host.read_hold=lambda:dict(schemaVersion=1,state='held',generation='f'*32,identity={**self.identity,'attemptId':'foreign'})
        with self.assertRaisesRegex(RuntimeError,'REHOLD_REQUIRED'):actor.dispatch('rebind-held-epoch-for-reblock',self.identity)
        self.assertEqual(self.host.commands,[])

class CancellationTests(unittest.TestCase):
    setUp = Tests.setUp
    # Reuse local retained-host fixture; the existing adapter methods are mocked
    # only at the source-owned test seam. No host/client/runtime operations run.
    def cancellation(self):
        self.j.value['events']=[dict(state='writes-held')]
        self.j.value.pop('migrationCompletionIntent');self.j.value.pop('migrationCompletionReceipt')
        self.host.plan.update(holdGeneration=self.p['holdGeneration'],closedAdmission=copy.deepcopy(self.p['closedAdmission']),originalAdmission=copy.deepcopy(self.p['closedAdmission']),
            migrationAuthorization=dict(identity=self.identity,toolRevision=self.host.plan['toolRevision'],baselineLedger=[]))
        for db in DATABASES:self.host.plan['originalAdmission']['login'][db]['app']=True
        prior=dict(host=self.p['host'],writers={'baseline':dict(binding=self.p['baselineWriters'][0]['binding'],state='running')},
                   admission=copy.deepcopy(self.host.plan['originalAdmission']),automationUnits={'release.timer':'inactive'},
                   automationUnitDetails={'release.timer':dict(UnitFileState='enabled',ActiveState='inactive',LoadState='loaded')})
        self.j.value['prior']=copy.deepcopy(prior);self.host.baseline_running=False;self.host.restored_units=False
        def held():
            h=self.host.read_hold()
            if h['state']!='held' or h['generation']!=self.host.plan['holdGeneration']:raise RuntimeError('HOLD_NOT_PROVEN')
            return h
        def blocked(identity):
            if self.host.baseline_running:raise RuntimeError('WRITER_STILL_RUNNING')
        def observe(admission):
            if self.host.login!=admission:raise RuntimeError('ADMISSION_NOT_PROVEN')
            value=copy.deepcopy(prior);value['writers']['baseline']['state']='running' if self.host.baseline_running else 'paused'
            if not self.host.restored_units:value['automationUnits']={'release.timer':'masked'}
            return value
        adapter=SimpleNamespace(plan=self.host.plan,journal=self.j,transport=self.host,hold=held,verifyWritesBlocked=blocked,observe=observe)
        def apply(action,plan):
            assert plan==self.host.plan
            self.host.commands.append(action)
            if action['kind']=='resume-writer':self.host.baseline_running=True
            elif action['kind']=='restore-unit':self.host.restored_units=True
            elif action['kind']=='restore-database-admission':self.host.login=copy.deepcopy(action['after'])
        self.host.apply=apply
        return RetainedBaselineCancellation(self.host,adapter,self.j)
    def test_cancellation_uses_fresh_ledger_and_exact_prior_without_acceptance(self):
        cancel=self.cancellation();cancel.dispatch('verify-no-migration',self.identity)
        cancel.dispatch('resume-baseline',self.identity);r=cancel.dispatch('verify-baseline',self.identity)
        self.assertEqual([a['kind'] for a in self.host.commands],['resume-writer','restore-unit','restore-database-admission'])
        self.assertEqual(self.host.commands[0]['binding']['containerId'],'3'*64)
        self.assertFalse(r['productionAvailabilityProven']);self.assertEqual(r['holdState'],'held')
        self.assertNotIn('acceptanceEvidence',self.j.value)
    def test_cancellation_migrate_intent_forbids_even_unchanged_ledger(self):
        cancel=self.cancellation();self.j.record('migration-intent')
        with self.assertRaisesRegex(RuntimeError,'AFTER_MIGRATION_INTENT_FORBIDDEN'):cancel.dispatch('resume-baseline',self.identity)
        self.assertEqual(self.host.commands,[])
    def test_cancellation_foreign_live_ledger_never_resumes(self):
        cancel=self.cancellation();self.host.diagnostic_connections['workspacex'].query=lambda key:dict(rowCount=1,ledger=[dict(name='extra',checksum='f'*64)])
        with self.assertRaisesRegex(RuntimeError,'LIVE_LEDGER_CHANGED'):cancel.dispatch('resume-baseline',self.identity)
        self.assertEqual(self.host.commands,[])
    def test_cancellation_prior_image_drift_blocks_baseline_resume(self):
        cancel=self.cancellation();self.j.value['prior']['writers']['baseline']['binding']['imageId']='sha256:'+'f'*64
        with self.assertRaisesRegex(RuntimeError,'PRIOR_IDENTITY'):cancel.dispatch('resume-baseline',self.identity)
        self.assertEqual(self.host.commands,[])
    def test_cancellation_resume_intent_journal_failure_no_writes_and_no_retry(self):
        cancel=self.cancellation();old=self.j.record
        def record(state,**data):
            if state=='baseline-cancel-resume-intent':raise RuntimeError('journal failure')
            return old(state,**data)
        self.j.record=record
        with self.assertRaisesRegex(RuntimeError,'journal failure'):cancel.dispatch('resume-baseline',self.identity)
        self.assertEqual(self.host.commands,[])
        with self.assertRaisesRegex(RuntimeError,'RETRY_REQUIRES_RECONCILIATION'):cancel.dispatch('resume-baseline',self.identity)
    def test_cancellation_partial_resume_failure_requires_reconciliation(self):
        cancel=self.cancellation();old=self.host.apply
        def apply(action,plan):
            old(action,plan)
            if action['kind']=='resume-writer':raise RuntimeError('lost resume reply')
        self.host.apply=apply
        with self.assertRaisesRegex(RuntimeError,'lost resume reply'):cancel.dispatch('resume-baseline',self.identity)
        self.assertEqual(self.j.value['events'][-1]['state'],'baseline-cancel-write-state-unknown')
        with self.assertRaisesRegex(RuntimeError,'RETRY_REQUIRES_RECONCILIATION'):cancel.dispatch('resume-baseline',self.identity)

if __name__=='__main__':unittest.main()
