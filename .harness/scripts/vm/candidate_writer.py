"""Inert candidate-only resume protocol. No host command or transport is implemented here.

Transport methods are compiled host obligations: require_lock, read_hold,
verify_staging, verify_completed_migration, observe_candidate, reopen_candidate,
reblock_candidate. All proof methods must collect live source facts, not echo plan.
Shared approved DB roles confer no baseline session exemption: each live writer
session must match an exact candidate-owned session binding. Candidate session bindings must be attested by the host before sealing the plan;
this module provides no safe mechanism to create new session bindings at reopen.
The supplied journal must be the existing durable writer-fence Journal.
"""
import copy
import time
import re
import secrets
from writer_fence import DATABASES, FAMILIES, digest, require

APP = '9b25bfa65662b96c0826fe67506b562ea46aa6d0'
BASELINE = 'ba6343199f3c834d6a198f83d0c771614292c82b'
SCOPES = {'host-proc', 'all-docker-containers', 'systemd-writer-units',
          'three-db-sessions', 'database-admission'}


def exact(value, keys, code):
    require(type(value) is dict and set(value) == set(keys), code)

def sha(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None

def session_schema(session, diagnostic_identity):
    exact(session, ('pid', 'backendStart', 'role', 'transactionMode', 'backendType',
                    'peerSha256', 'clientIdentity'), 'CANDIDATE_HELD_SESSION_SCHEMA')
    require(type(session['pid']) is int and session['pid'] > 1 and
            type(session['backendStart']) is str and session['backendStart'] and
            sha(session['peerSha256']) and session['backendType'] == 'client backend' and
            session['clientIdentity'] in ('maintenance-control', diagnostic_identity) and
            session['transactionMode'] == ('idle-controlled' if session['clientIdentity'] ==
                                          'maintenance-control' else 'read-only'),
            'CANDIDATE_HELD_SESSION_AUTHORITY')


def validate(plan, identity):
    exact(plan, ('identity', 'baselineRevision', 'host', 'holdGeneration', 'candidateWriters',
          'baselineWriters', 'artifactSha256', 'databasePeers', 'closedAdmission',
          'candidateAdmission', 'candidateRoles', 'baselineRoles', 'fencedRoles', 'heldSessions',
          'candidateSessions', 'automationUnits', 'stagingIdentity', 'epoch',
          'migrationCompletionSha256', 'migrationLedgerSha256', 'diagnosticClientIdentity'), 'CANDIDATE_PLAN_SCHEMA')
    exact(identity, ('attemptId', 'baselineRevision', 'migrationPlanSha256', 'sourceRevision'),
          'CANDIDATE_IDENTITY_SCHEMA')
    require(type(identity['attemptId']) is str and identity['attemptId'] and
            sha(identity['migrationPlanSha256']), 'CANDIDATE_IDENTITY_FORMAT')
    require(type(plan['diagnosticClientIdentity']) is str and plan['diagnosticClientIdentity'] and
            plan['diagnosticClientIdentity'] != 'maintenance-control', 'CANDIDATE_DIAGNOSTIC_IDENTITY')
    require(identity.get('sourceRevision') == APP and identity.get('baselineRevision') == BASELINE,
            'CANDIDATE_IDENTITY_FROZEN_REVISION')
    require(type(plan['holdGeneration']) is str and
            re.fullmatch('[a-f0-9]{32}', plan['holdGeneration']) is not None and
            sha(plan['artifactSha256']) and sha(plan['epoch']) and
            sha(plan['migrationCompletionSha256']) and sha(plan['migrationLedgerSha256']),
            'CANDIDATE_HASH_OR_GENERATION')
    exact(plan['host'], ('instanceId', 'bootId'), 'CANDIDATE_HOST_SCHEMA')
    require(all(type(v) is str and v for v in plan['host'].values()), 'CANDIDATE_HOST')
    all_ids = []
    for key in ('candidateWriters', 'baselineWriters'):
        require(type(plan[key]) is list and plan[key], 'CANDIDATE_WRITERS_TYPE')
        for w in plan[key]:
            exact(w, ('key', 'binding', 'families'), 'CANDIDATE_WRITER_SCHEMA')
            require(type(w['key']) is str and re.fullmatch('[a-zA-Z0-9_-]+', w['key']) and
                    type(w['families']) is list and w['families'] and
                    len(set(w['families'])) == len(w['families']) and
                    set(w['families']) <= set(FAMILIES), 'CANDIDATE_FAMILIES_SCHEMA')
            b = w['binding']
            exact(b, ('kind', 'containerId', 'imageId', 'configSha256', 'service', 'composePath', 'composeSha256'), 'CANDIDATE_BINDING_SCHEMA')
            require(b['kind'] == 'container' and sha(b['containerId']) and
                    type(b['imageId']) is str and b['imageId'].startswith('sha256:') and
                    sha(b['imageId'][7:]) and sha(b['configSha256']) and sha(b['composeSha256']) and
                    type(b['service']) is str and re.fullmatch('[a-zA-Z0-9_-]+', b['service']) and
                    type(b['composePath']) is str and b['composePath'].startswith('/'), 'CANDIDATE_BINDING_FORMAT')
            all_ids.append(b['containerId'])
        require({f for w in plan[key] for f in w['families']} == set(FAMILIES),
                'CANDIDATE_FAMILY_CLOSURE')
    require(len(set(all_ids)) == len(all_ids), 'CANDIDATE_DUPLICATE_CONTAINER')
    for key in ('baselineRoles', 'candidateRoles', 'fencedRoles', 'heldSessions', 'candidateSessions'):
        exact(plan[key], DATABASES, 'CANDIDATE_DATABASE_MAP')
    for db in DATABASES:
        peer = plan['databasePeers'][db]
        require(type(peer) is dict and type(peer.get('systemIdentifier')) is str and
                peer['systemIdentifier'], 'CANDIDATE_PEER_SCHEMA')
        for key in ('baselineRoles', 'candidateRoles', 'fencedRoles'):
            rs = plan[key][db]
            require(type(rs) is list and rs and len(set(rs)) == len(rs) and
                    all(type(r) is str and re.fullmatch('[a-zA-Z0-9_-]+', r) for r in rs),
                    'CANDIDATE_ROLE_SCHEMA')
        exact(plan['closedAdmission']['login'][db],
              plan['fencedRoles'][db], 'CANDIDATE_ROLE_CLOSURE')
        require(set(plan['baselineRoles'][db]) | set(plan['candidateRoles'][db]) <=
                set(plan['fencedRoles'][db]), 'CANDIDATE_FENCED_ROLE_CLOSURE')
        require(type(plan['heldSessions'][db]) is list and len(plan['heldSessions'][db]) == 2,
                'CANDIDATE_HELD_SESSION_CLOSURE')
        for session in plan['heldSessions'][db]:
            session_schema(session, plan['diagnosticClientIdentity'])
            if session['clientIdentity'] == 'maintenance-control':
                require(session['role'] in plan['fencedRoles'][db] and
                        session['role'] not in plan['candidateRoles'][db] and
                        session['role'] not in plan['baselineRoles'][db],
                        'CANDIDATE_CONTROL_ROLE_NOT_FENCED')
            else:
                require(session['role'] not in plan['fencedRoles'][db],
                        'CANDIDATE_DIAGNOSTIC_WRITER_ROLE')
        require({s['clientIdentity'] for s in plan['heldSessions'][db]} ==
                {'maintenance-control', plan['diagnosticClientIdentity']} and
                len({s['pid'] for s in plan['heldSessions'][db]}) == 2,
                'CANDIDATE_HELD_SESSION_ALIAS')
        require(type(plan['candidateSessions'][db]) is list, 'CANDIDATE_SESSION_TYPE')
        for session in plan['candidateSessions'][db]:
            exact(session, ('pid', 'backendStart', 'role', 'transactionMode', 'backendType',
                            'peerSha256', 'writerKey', 'binding'), 'CANDIDATE_SESSION_SCHEMA')
            require(type(session['pid']) is int and session['pid'] > 1 and
                    type(session['backendStart']) is str and session['backendStart'] and
                    sha(session['peerSha256']) and session['backendType'] == 'client backend' and
                    session['transactionMode'] in ('idle', 'active', 'idle in transaction') and
                    session['role'] in plan['candidateRoles'][db] and
                    any(w['key'] == session['writerKey'] and w['binding'] == session['binding']
                        for w in plan['candidateWriters']), 'CANDIDATE_SESSION_AUTHORITY')
        require(len({s['pid'] for s in plan['candidateSessions'][db] + plan['heldSessions'][db]}) ==
                len(plan['candidateSessions'][db]) + len(plan['heldSessions'][db]),
                'CANDIDATE_SESSION_PID_ALIAS')
    require(type(plan['automationUnits']) is list and
            len(set(plan['automationUnits'])) == len(plan['automationUnits']) and
            all(type(u) is str and re.fullmatch(r'[a-zA-Z0-9_-]+\.(service|timer)', u)
                for u in plan['automationUnits']), 'CANDIDATE_AUTOMATION_SCHEMA')


class CandidateWriterAdapter:
    def __init__(self, identity, plan, transport, journal):
        validate(plan, identity)
        self.identity = copy.deepcopy(identity)
        self.plan = copy.deepcopy(plan)
        self.transport, self.journal = transport, journal
        require(identity['sourceRevision'] == APP and plan['baselineRevision'] == BASELINE,
                'CANDIDATE_FROZEN_REVISION')
        require(plan['identity'] == identity and journal.value['identity'] == identity,
                'CANDIDATE_IDENTITY')
        require(set(plan['databasePeers']) == set(DATABASES), 'CANDIDATE_THREE_DATABASES')
        candidates, baseline = plan['candidateWriters'], plan['baselineWriters']
        require(candidates and baseline and len({w['key'] for w in candidates + baseline}) ==
                len(candidates + baseline), 'CANDIDATE_WRITER_CLOSURE')
        require(all(w['binding']['kind'] == 'container' and
                    w['binding'].get('containerId') and w['binding'].get('imageId') and
                    w['binding'].get('configSha256') for w in candidates),
                'CANDIDATE_EXACT_CONTAINER_BINDING')
        require(not ({w['binding']['containerId'] for w in candidates} &
                     {w['binding'].get('containerId') for w in baseline}),
                'CANDIDATE_BASELINE_ALIAS')
        require(plan['stagingIdentity'] == {'identity': identity, 'sourceRevision': APP,
                'baselineRevision': BASELINE, 'writersSha256': digest(candidates),
                'artifactSha256': plan['artifactSha256'], 'epoch': plan['epoch']}, 'CANDIDATE_STAGING_SCHEMA')
        require(set(plan['heldSessions']) == set(plan['candidateSessions']) == set(DATABASES),
                'CANDIDATE_SESSION_CLOSURE')
        closed, opened = plan['closedAdmission'], plan['candidateAdmission']
        exact(closed, ('kind', 'login'), 'CANDIDATE_ADMISSION_SCHEMA')
        exact(opened, ('kind', 'login'), 'CANDIDATE_ADMISSION_SCHEMA')
        require(closed['kind'] == opened['kind'] == 'role-login-v1' and
                set(closed['login']) == set(opened['login']) == set(DATABASES),
                'CANDIDATE_ADMISSION_SCHEMA')
        roles = plan['candidateRoles']
        require(set(roles) == set(DATABASES), 'CANDIDATE_ROLE_DATABASES')
        for db in DATABASES:
            require(roles[db] and len(set(roles[db])) == len(roles[db]) and
                    set(closed['login'][db]) == set(opened['login'][db]) and
                    set(roles[db]) <= set(closed['login'][db]) and
                    all(type(v) is bool and not v for v in closed['login'][db].values()) and
                    all(type(v) is bool for v in opened['login'][db].values()) and
                    opened['login'][db] == {r: r in roles[db] for r in closed['login'][db]},
                    'CANDIDATE_ONLY_ADMISSION')
        for db in DATABASES:
            for other in DATABASES:
                if plan['databasePeers'][db]['systemIdentifier'] == plan['databasePeers'][other]['systemIdentifier']:
                    require(closed['login'][db] == closed['login'][other] and
                            opened['login'][db] == opened['login'][other],
                            'CANDIDATE_CLUSTER_ADMISSION_DIVERGENCE')
        require(journal.value.get('candidatePlanSha256', digest(plan)) == digest(plan),
                'CANDIDATE_PLAN_DRIFT')
        journal.value['candidatePlanSha256'] = digest(plan)
        journal.save()

    def _guard(self, identity):
        require(identity == self.identity, 'CANDIDATE_CALLBACK_IDENTITY')
        self.transport.require_lock()
        h = self.transport.read_hold()
        exact(h, ('schemaVersion', 'state', 'generation', 'identity'), 'CANDIDATE_HOLD_SCHEMA')
        require(type(h['schemaVersion']) is int and h['schemaVersion'] == 1 and h['identity'] == identity and h['generation'] == self.plan['holdGeneration'] and
                h['state'] == 'held', 'CANDIDATE_HOLD_NOT_PROVEN')
        return h

    def _observe(self, opened=False):
        s = self.transport.observe_candidate(copy.deepcopy(self.plan))
        require(s['host'] == self.plan['host'] and type(s['observedAt']) in (int, float) and
                0 <= time.time() - s['observedAt'] <= 30 and set(s['scopes']) == SCOPES,
                'CANDIDATE_OBSERVATION_FRESHNESS')
        require(s['unclassifiedProcesses'] == [] and s['unclassifiedContainers'] == [],
                'CANDIDATE_UNCLASSIFIED_WRITER')
        writers = self.plan['candidateWriters'] + self.plan['baselineWriters']
        require(set(s['writers']) == {w['key'] for w in writers}, 'CANDIDATE_INVENTORY_CLOSURE')
        for w in writers:
            live = s['writers'][w['key']]
            require(live['binding'] == w['binding'], 'CANDIDATE_BINDING_DRIFT')
            states = ('running',) if opened and w in self.plan['candidateWriters'] else ('paused', 'stopped')
            require(live['state'] in states, 'CANDIDATE_WRITER_STATE')
        require(s['admission'] == self.plan['candidateAdmission' if opened else 'closedAdmission'],
                'CANDIDATE_ADMISSION_NOT_PROVEN')
        require(set(s['runDrain']) == {'queued', 'running', 'writebackPending'} and
                all(type(v) is int and v == 0 for v in s['runDrain'].values()),
                'CANDIDATE_RUNS_NOT_DRAINED')
        require(s['automationUnits'] == {u: 'masked' for u in self.plan['automationUnits']},
                'CANDIDATE_AUTOMATION_RUNNING')
        require(set(s['databases']) == set(DATABASES), 'CANDIDATE_DATABASE_CLOSURE')
        for db, v in s['databases'].items():
            require(v['peer'] == self.plan['databasePeers'][db] and v['preparedTransactions'] == [],
                    'CANDIDATE_DATABASE_PEER_OR_PREPARED')
            require(type(v['sessions']) is list and all(bound in v['sessions'] for bound in
                    self.plan['heldSessions'][db]), 'CANDIDATE_HELD_SESSION_NOT_LIVE')
            for session in v['sessions']:
                # Exact session bindings include PID, backendStart, role and real peer/TLS facts.
                require(session in self.plan['heldSessions'][db] or
                        (opened and session in self.plan['candidateSessions'][db] and
                         session['role'] in self.plan['candidateRoles'][db] and
                         session['writerKey'] in {w['key'] for w in self.plan['candidateWriters']} and
                         session['binding'] == next(w['binding'] for w in self.plan['candidateWriters']
                                                    if w['key'] == session['writerKey'])),
                        'CANDIDATE_FOREIGN_DATABASE_SESSION')
        return s

    def resume_candidate(self, identity):
        self._guard(identity)
        require(self.journal.value.get('candidateResumeIntent') is None,
                'CANDIDATE_RETRY_REQUIRES_RECONCILIATION')
        require(any(e['state'] == 'writes-held' for e in self.journal.value['events']),
                'CANDIDATE_DURABLE_HELD_PROOF_MISSING')
        before = self._observe()
        nonce = secrets.token_hex(32)
        # Host MUST read fsynced completion file and query the held diagnostic session;
        # echoing the plan or consulting an intent event is not a valid implementation.
        proof = self.transport.verify_completed_migration(copy.deepcopy(self.plan), nonce)
        exact(proof, ('identity', 'epoch', 'holdGeneration', 'completionSha256',
                     'ledgerSha256', 'observedAt', 'nonce', 'evidenceSha256',
                     'source', 'databasePeers'), 'CANDIDATE_MIGRATION_PROOF_SCHEMA')
        require(proof['identity'] == identity and proof['epoch'] == self.plan['epoch'] and
                proof['holdGeneration'] == self.plan['holdGeneration'] and
                proof['completionSha256'] == self.plan['migrationCompletionSha256'] and
                proof['ledgerSha256'] == self.plan['migrationLedgerSha256'] and
                proof['databasePeers'] == self.plan['databasePeers'] and
                proof['nonce'] == nonce and sha(proof['evidenceSha256']) and
                proof['source'] == 'durable-completion-and-live-diagnostic-ledger' and
                type(proof['observedAt']) in (int, float) and
                0 <= time.time() - proof['observedAt'] <= 30,
                'CANDIDATE_MIGRATION_NOT_COMPLETED')
        staging = self.transport.verify_staging(copy.deepcopy(self.plan))
        require(staging == self.plan['stagingIdentity'], 'CANDIDATE_STAGING_DRIFT')
        self._guard(identity)
        before = self._observe()  # Recollect after proof I/O; never reopen from a stale inventory.
        require(0 <= time.time() - proof['observedAt'] <= 30, 'CANDIDATE_MIGRATION_PROOF_STALE')
        intent = {'identity': identity, 'planSha256': digest(self.plan),
                  'observationSha256': digest(before), 'stagingIdentity': staging,
                  'epoch': self.plan['epoch'], 'migrationProofSha256': digest(proof)}
        self.journal.value['candidateResumeIntent'] = intent
        self.journal.record('candidate-resume-intent', intent=intent, holdDisposition='retain')
        try:
            self.transport.reopen_candidate(copy.deepcopy(self.plan))
            self._guard(identity)
            live = self._observe(opened=True)
            self.journal.record('candidate-resumed', observation=live, holdDisposition='retain')
            return live
        except BaseException:
            self.journal.record('candidate-resume-uncertain', holdDisposition='retain')
            try:
                self.transport.reblock_candidate(copy.deepcopy(self.plan))
                self._guard(identity)
                closed = self._observe()
                self.journal.record('candidate-reblocked', observation=closed, holdDisposition='retain')
            except BaseException:
                self.journal.record('candidate-reconciliation-required', holdDisposition='retain',
                                    lockDisposition='retain')
            raise

    def resume_baseline(self, identity):
        self._guard(identity)
        require(not any('migration' in e['state'] for e in self.journal.value['events']),
                'BASELINE_RESUME_AFTER_MIGRATION_FORBIDDEN')
        raise RuntimeError('BASELINE_RESUME_UNSUPPORTED_BY_CANDIDATE_ADAPTER')
