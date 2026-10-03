import copy
import time
import unittest
from candidate_writer import APP, BASELINE, SCOPES, CandidateWriterAdapter
from writer_fence import DATABASES, FAMILIES, digest

class Journal:
    def __init__(self, identity):
        self.value = {'identity': identity, 'events': []}
        self.durable = []
    def save(self):
        self.durable = copy.deepcopy(self.value['events'])
    def record(self, state, **data):
        self.value['events'].append(dict(state=state, **data)); self.save()

class Transport:
    def __init__(self, p, j):
        self.p, self.j = p, j
        self.opened = False
        self.fail = False
        self.calls = []
        self.mutate = lambda s: None
    def require_lock(self): pass
    def read_hold(self):
        return dict(schemaVersion=1, identity=self.p['identity'], generation=self.p['holdGeneration'], state='held')
    def verify_staging(self, p): return p['stagingIdentity']
    def verify_completed_migration(self, p, nonce):
        return dict(identity=p['identity'], epoch=p['epoch'], holdGeneration=p['holdGeneration'],
                    completionSha256=p['migrationCompletionSha256'], ledgerSha256=p['migrationLedgerSha256'],
                    observedAt=time.time(), nonce=nonce, evidenceSha256='e'*64,
                    source='durable-completion-and-live-diagnostic-ledger', databasePeers=p['databasePeers'])
    def reopen_candidate(self, p):
        assert self.j.durable[-1]['state'] == 'candidate-resume-intent'
        self.calls.append('reopen'); self.opened = True
        if self.fail: raise RuntimeError('lost-response')
    def reblock_candidate(self, p): self.calls.append('reblock'); self.opened = False
    def observe_candidate(self, p):
        s = dict(host=p['host'], observedAt=time.time(), scopes=list(SCOPES),
                 unclassifiedProcesses=[], unclassifiedContainers=[],
                 admission=p['candidateAdmission' if self.opened else 'closedAdmission'],
                 automationUnits={'release.timer': 'masked'},
                 runDrain=dict(queued=0, running=0, writebackPending=0),
                 writers={w['key']: dict(binding=w['binding'], state='running' if
                    self.opened and w in p['candidateWriters'] else 'paused')
                    for w in p['candidateWriters'] + p['baselineWriters']},
                 databases={db: dict(peer=p['databasePeers'][db], preparedTransactions=[],
                                     sessions=copy.deepcopy(p['heldSessions'][db])) for db in DATABASES})
        self.mutate(s)
        return s

def fixture():
    identity = {'sourceRevision': APP, 'baselineRevision': BASELINE, 'attemptId': 'one', 'migrationPlanSha256': 'd'*64}
    c = [{'key': 'candidate', 'binding': dict(kind='container', containerId='1'*64,
           imageId='sha256:'+'2'*64, configSha256='a' * 64, service='api', composePath='/etc/candidate.yml', composeSha256='e'*64), 'families': list(FAMILIES)}]
    b = [{'key': 'baseline', 'binding': dict(kind='container', containerId='3'*64, imageId='sha256:'+'4'*64, configSha256='c'*64, service='api', composePath='/etc/baseline.yml', composeSha256='f'*64), 'families': list(FAMILIES)}]
    p = dict(identity=identity, baselineRevision=BASELINE, host={'instanceId': 'host', 'bootId':'boot'},
             diagnosticClientIdentity='workspacex-maintenance-one-diag', holdGeneration='a'*32, epoch='5'*64, migrationCompletionSha256='6'*64,
             migrationLedgerSha256='7'*64, candidateWriters=c, baselineWriters=b, artifactSha256='b' * 64,
             databasePeers={db: {'systemIdentifier': db} for db in DATABASES},
             closedAdmission={'kind': 'role-login-v1', 'login': {db: {'app': False, 'lane': False, 'migration_admin':False} for db in DATABASES}},
             candidateAdmission={'kind': 'role-login-v1', 'login': {db: {'app': False, 'lane': True, 'migration_admin':False} for db in DATABASES}},
             candidateRoles={db: ['lane'] for db in DATABASES}, baselineRoles={db: ['app'] for db in DATABASES},
             fencedRoles={db: ['app','lane','migration_admin'] for db in DATABASES},
             heldSessions={db: [dict(pid=10+n, backendStart='2026-10-03T00:00:00Z',
                 role='migration_admin' if n==0 else 'diagnostic', transactionMode='idle-controlled' if n==0 else 'read-only',
                 backendType='client backend', peerSha256='8'*64,
                 clientIdentity='maintenance-control' if n==0 else 'workspacex-maintenance-one-diag') for n in range(2)] for db in DATABASES}, candidateSessions={db: [] for db in DATABASES},
             automationUnits=['release.timer'])
    p['stagingIdentity'] = dict(identity=identity, sourceRevision=APP, baselineRevision=BASELINE,
                               writersSha256=digest(c), artifactSha256=p['artifactSha256'], epoch=p['epoch'])
    j = Journal(identity); j.record('writes-held'); t = Transport(p, j)
    return identity, p, j, t

class Tests(unittest.TestCase):
    def test_resume_intent_durable_and_candidate_only(self):
        i,p,j,t = fixture(); CandidateWriterAdapter(i,p,t,j).resume_candidate(i)
        self.assertEqual(t.calls, ['reopen'])
        self.assertEqual(j.durable[-1]['state'], 'candidate-resumed')
    def test_response_loss_reblocks_and_retry_denied(self):
        i,p,j,t = fixture(); a=CandidateWriterAdapter(i,p,t,j); t.fail=True
        with self.assertRaisesRegex(RuntimeError,'lost-response'): a.resume_candidate(i)
        self.assertEqual(t.calls,['reopen','reblock'])
        self.assertEqual(j.durable[-1]['state'],'candidate-reblocked')
        with self.assertRaisesRegex(RuntimeError,'RECONCILIATION'): a.resume_candidate(i)
    def test_unknown_stale_baseline_foreign_session_reject_before_mutation(self):
        for mutate in (lambda s:s.update(observedAt=time.time()-31),
                       lambda s:s.update(host=dict(instanceId='host',bootId='other')),
                       lambda s:s['writers']['candidate'].update(binding=dict(s['writers']['candidate']['binding'],composeSha256='0'*64)),
                       lambda s:s.update(unclassifiedContainers=['foreign']),
                       lambda s:s['runDrain'].update(running=1),
                       lambda s:s['writers']['baseline'].update(state='running'),
                       lambda s:s['databases'][DATABASES[0]]['sessions'].append({'role':'app'})):
            i,p,j,t=fixture(); t.mutate=mutate
            with self.assertRaises(RuntimeError): CandidateWriterAdapter(i,p,t,j).resume_candidate(i)
            self.assertEqual(t.calls,[])
    def test_post_reopen_unknown_reblocks(self):
        i,p,j,t=fixture(); t.mutate=lambda s:s.update(unclassifiedProcesses=['foreign']) if t.opened else None
        with self.assertRaisesRegex(RuntimeError,'UNCLASSIFIED'): CandidateWriterAdapter(i,p,t,j).resume_candidate(i)
        self.assertEqual(t.calls,['reopen','reblock'])
    def test_baseline_after_migration_forbidden(self):
        i,p,j,t=fixture();j.record('migration-intent')
        with self.assertRaisesRegex(RuntimeError,'AFTER_MIGRATION'): CandidateWriterAdapter(i,p,t,j).resume_baseline(i)
        self.assertEqual(t.calls,[])
    def test_missing_durable_hold_and_failed_reblock_retain(self):
        i,p,j,t=fixture(); j.value['events']=[]
        with self.assertRaisesRegex(RuntimeError,'HELD_PROOF'): CandidateWriterAdapter(i,p,t,j).resume_candidate(i)
        self.assertEqual(t.calls,[])
        i,p,j,t=fixture();t.fail=True
        def fail_reblock(p): raise RuntimeError('cannot-close')
        t.reblock_candidate=fail_reblock
        with self.assertRaisesRegex(RuntimeError,'lost-response'): CandidateWriterAdapter(i,p,t,j).resume_candidate(i)
        self.assertEqual(j.durable[-1]['state'],'candidate-reconciliation-required')
        self.assertEqual(j.durable[-1]['holdDisposition'],'retain')

    def test_migration_proof_required_not_event_or_echo(self):
        for mutate in (lambda proof:proof.update(epoch='f'*64),
                       lambda proof:proof.update(source='intent'),
                       lambda proof:proof.update(observedAt=time.time()-31),
                       lambda proof:proof.update(nonce='e'*64),
                       lambda proof:proof.update(completionSha256='0'*64)):
            i,p,j,t=fixture();j.record('migration-completed')
            original=t.verify_completed_migration
            def bad(plan, nonce):
                proof=original(plan,nonce);mutate(proof);return proof
            t.verify_completed_migration=bad
            with self.assertRaisesRegex(RuntimeError,'MIGRATION'): CandidateWriterAdapter(i,p,t,j).resume_candidate(i)
            self.assertEqual(t.calls,[])

    def test_shared_approved_role_candidate_owned_session(self):
        i,p,j,t=fixture()
        for db in DATABASES:
            p['baselineRoles'][db]=['app']
            p['candidateRoles'][db]=['app']
            p['fencedRoles'][db]=['app','migration_admin']
            p['closedAdmission']['login'][db]={'app':False,'migration_admin':False}
            p['candidateAdmission']['login'][db]={'app':True,'migration_admin':False}
        # Fixture-only attested binding. Production dynamic sealing is unresolved.
        session=dict(pid=42, backendStart='2026-10-03T00:01:00Z', role='app',
                     transactionMode='idle', backendType='client backend', peerSha256='9'*64,
                     writerKey='candidate', binding=p['candidateWriters'][0]['binding'])
        p['candidateSessions'][DATABASES[0]]=[session]
        original=t.observe_candidate
        def observe(plan):
            s=original(plan)
            if t.opened: s['databases'][DATABASES[0]]['sessions'].append(copy.deepcopy(session))
            return s
        t.observe_candidate=observe
        CandidateWriterAdapter(i,p,t,j).resume_candidate(i)
        self.assertEqual(t.calls,['reopen'])

    def test_shared_role_baseline_running_or_session_never_admitted(self):
        for variant in ('running','session'):
            i,p,j,t=fixture()
            for db in DATABASES:
                p['baselineRoles'][db]=p['candidateRoles'][db]=['app']
                p['fencedRoles'][db]=['app','migration_admin']
                p['closedAdmission']['login'][db]={'app':False,'migration_admin':False}
                p['candidateAdmission']['login'][db]={'app':True,'migration_admin':False}
            def mutate(s):
                if not t.opened: return
                if variant=='running': s['writers']['baseline']['state']='running'
                else:
                    s['databases'][DATABASES[0]]['sessions'].append(dict(pid=42,
                        backendStart='2026-10-03T00:01:00Z', role='app', transactionMode='idle',
                        backendType='client backend', peerSha256='9'*64, writerKey='baseline',
                        binding=p['baselineWriters'][0]['binding']))
            t.mutate=mutate
            with self.assertRaises(RuntimeError): CandidateWriterAdapter(i,p,t,j).resume_candidate(i)
            self.assertEqual(t.calls,['reopen','reblock'])
            self.assertEqual(j.durable[-1]['state'],'candidate-reblocked')

    def test_exact_fenced_admin_session_no_pid_or_backend_exemption(self):
        for field,value in (('pid',999), ('backendStart','2026-10-03T00:09:00Z')):
            i,p,j,t=fixture()
            def mutate(s): s['databases'][DATABASES[0]]['sessions'][0][field]=value
            t.mutate=mutate
            with self.assertRaisesRegex(RuntimeError,'HELD_SESSION_NOT_LIVE'):
                CandidateWriterAdapter(i,p,t,j).resume_candidate(i)
            self.assertEqual(t.calls,[])

    def test_hold_drift_or_noncanonical_schema_rejects(self):
        for mutate in (lambda h:h.update(generation='0'*32),
                       lambda h:h.update(epoch='e'*64),
                       lambda h:h.update(identity=dict(h['identity'],attemptId='other'))):
            i,p,j,t=fixture();original=t.read_hold
            def bad():
                h=original();mutate(h);return h
            t.read_hold=bad
            with self.assertRaises(RuntimeError): CandidateWriterAdapter(i,p,t,j).resume_candidate(i)
            self.assertEqual(t.calls,[])

    def test_bad_revision_admission_staging_alias(self):
        for mutate in (lambda p:p.update(baselineRevision='main'),
                       lambda p:p['identity'].update(baselineRevision='main'),
                       lambda p:p['candidateWriters'][0]['binding'].update(containerId='short'),
                       lambda p:p['candidateWriters'][0].update(families=['http']),
                       lambda p:p['heldSessions'][DATABASES[0]][0].update(role='app'),
                       lambda p:p['baselineRoles'][DATABASES[0]].append('unfenced'),
                       lambda p:p.update(holdGeneration=1),
                       lambda p:p['candidateAdmission']['login'][DATABASES[0]].update(migration_admin=True),
                       lambda p:p['candidateAdmission']['login'][DATABASES[0]].update(app=True),
                       lambda p:p['stagingIdentity'].update(sourceRevision='main'),
                       lambda p:p['baselineWriters'][0]['binding'].update(containerId='1'*64)):
            i,p,j,t=fixture();mutate(p)
            with self.assertRaises(RuntimeError): CandidateWriterAdapter(i,p,t,j)
            self.assertEqual(t.calls,[])

if __name__ == '__main__': unittest.main()
