"""Compiled candidate transport over the existing retained all-writer actor.

Import is inert. Construction accepts an already reviewed HostTransport and its
existing durable Journal; it never opens clients or acquires a different lock.
"""
import copy
import hashlib
import json
import pathlib
import re
import secrets
import time
from candidate_writer import validate, verify_candidate_backend_seal
from candidate_backend_collector import CandidateBackendCollector, conntrack_rows
from writer_fence import DATABASES, digest, require
from fixed_probes import FixedProbes, login_cas_sql
from host_transport import private, aggregate_run_drain
from control_connection import verify_bound_transport


class CandidateHostTransport:
    def __init__(self, host, plan, journal, artifact, read_private=private, proc_root='/proc', *, pointer_factory=None, docker_runner=None):
        validate(plan, plan['identity'])
        require(host.plan['identity'] == plan['identity'] and host.plan['host'] == plan['host']
                and host.plan['databasePeers'] == plan['databasePeers'], 'CANDIDATE_HOST_BINDING')
        require(host.plan['automationUnits'] == plan['automationUnits'] and
                all(set(host.plan['databaseWriterRoles'][db]) == set(plan['fencedRoles'][db]) for db in DATABASES),
                'CANDIDATE_SOURCE_ADMISSION_CLOSURE')
        require(host.plan['writers'] == plan['baselineWriters'], 'CANDIDATE_BASELINE_SOURCE_BINDING')
        require(journal.value['identity'] == plan['identity'], 'CANDIDATE_JOURNAL_IDENTITY')
        require(type(artifact) is dict and set(artifact) == {'path', 'sha256'} and
                artifact['sha256'] == plan['artifactSha256'] and artifact['path'].startswith('/etc/workspacex-cn/')
                and '..' not in pathlib.Path(artifact['path']).parts, 'CANDIDATE_ARTIFACT_BINDING')
        self.host, self.plan, self.journal = host, copy.deepcopy(plan), journal
        self.artifact, self.private = copy.deepcopy(artifact), read_private
        self.proc = pathlib.Path(proc_root)
        self.collector = CandidateBackendCollector(self, proc_root)
        self.runtime_sessions = None
        self.pointer_factory,self.docker_runner=pointer_factory,docker_runner

    def _docker(self,args):
        require(type(args) is list and args and args[0] in ('start','unpause','pause','kill'),'CANDIDATE_DOCKER_ACTION')
        ids={w['binding']['containerId'] for w in self.plan['candidateWriters']+self.plan['baselineWriters']}
        require(args[-1] in ids and (len(args)==2 or args[0]=='kill' and args[1:-1]==['--signal','KILL']),'CANDIDATE_DOCKER_OWNED_TARGET')
        if self.docker_runner is not None:return self.docker_runner(args)
        import compiled_maintenance_activation as source
        profile=json.loads(source.private('/etc/workspacex-cn/trusted-tool-binding.json'))
        descriptor=profile.get('candidateComposeEmitter',{})
        require(profile['toolRevision']==self.host.plan['toolRevision'] and descriptor.get('dockerPath')=='/usr/bin/docker' and re.fullmatch('[a-f0-9]{64}',descriptor.get('dockerSha256','')),'CANDIDATE_DOCKER_SOURCE_PROFILE')
        return source.invoke({'binaries':{'docker':{'path':descriptor['dockerPath'],'sha256':descriptor['dockerSha256']}}},'docker',args)

    def promote_candidate_pointer(self):
        from candidate_pointer_adapter import CandidatePointerAdapter
        profile=json.loads(self.private('/etc/workspacex-cn/trusted-tool-binding.json')) if self.pointer_factory is None else None
        binding=profile['candidatePointerPromotion']['binding'] if profile is not None else None
        return (self.pointer_factory or CandidatePointerAdapter)(self,binding).promote_under_hold()

    def require_lock(self): self.host.require_lock()
    def read_hold(self):
        value = self.host.read_hold()
        require(type(value) is dict and all(k in value for k in ('schemaVersion', 'state', 'generation', 'identity')), 'CANDIDATE_HOLD_RESPONSE')
        return {k: value[k] for k in ('schemaVersion', 'state', 'generation', 'identity')}
    def docker_inventory(self): return self.host.docker_inventory()
    def read_host(self):
        return dict(instanceId=FixedProbes(self.host).instance()['instanceId'],
                    bootId=(self.proc / 'sys/kernel/random/boot_id').read_text().strip())

    def _guard(self, plan):
        require(plan == self.plan, 'CANDIDATE_HOST_PLAN_DRIFT')
        self.require_lock()
        require(self.read_hold() == dict(schemaVersion=1, state=getattr(self, '_observation_hold_state', 'held'), generation=plan['holdGeneration'],
                                        identity=plan['identity']), 'CANDIDATE_HOST_HOLD_DRIFT')
        require(self.read_host() == plan['host'], 'CANDIDATE_HOST_IDENTITY_DRIFT')

    def read_candidate_database_sessions(self, db):
        self._guard(self.plan)
        require(db in DATABASES and db in self.host.diagnostic_connections, 'CANDIDATE_DIAGNOSTIC_REQUIRED')
        # The helper must expose this source-owned fixed query; arbitrary SQL is
        # deliberately not passed through database_json or a new connection.
        return self.host.diagnostic_connections[db].query('candidate-sessions')

    def read_candidate_conntrack(self):
        self._guard(self.plan)
        path = self.proc / 'net/nf_conntrack'
        require(path.exists(), 'CANDIDATE_CONNTRACK_VISIBILITY_REQUIRED')
        return conntrack_rows(path.read_text())

    def read_candidate_transport_evidence(self, db):
        # Fresh authoritative provider evidence uses the existing reviewed probe.
        read = getattr(self.host, 'read_candidate_transport_evidence', None)
        require(callable(read), 'CANDIDATE_PROVIDER_AUTHORITY_NOT_IMPLEMENTED')
        self._guard(self.plan)
        return read(db)

    def _inventory(self, plan):
        inventory = self.docker_inventory(); indexed = {c['Id']: c for c in inventory}
        require(len(indexed) == len(inventory), 'CANDIDATE_CONTAINER_DUPLICATE')
        result = {}
        for writer in plan['candidateWriters'] + plan['baselineWriters']:
            b = writer['binding']; c = indexed.get(b['containerId'])
            require(c is not None and c['Image'] == b['imageId'] and digest(c['Config']) == b['configSha256'],
                    'CANDIDATE_CONTAINER_DRIFT')
            labels = c['Config']['Labels']
            require(labels.get('com.docker.compose.service') == b['service'] and
                    labels.get('com.docker.compose.project.config_files') == b['composePath'] and
                    hashlib.sha256(self.private(b['composePath'])).hexdigest() == b['composeSha256'],
                    'CANDIDATE_COMPOSE_DRIFT')
            require(type(c['State']['Running']) is bool and type(c['State']['Paused']) is bool,
                    'CANDIDATE_CONTAINER_STATE')
            result[writer['key']] = dict(binding=copy.deepcopy(b), state='paused' if c['State']['Paused'] else
                                        'running' if c['State']['Running'] else 'stopped')
        return result

    def verify_staging(self, plan):
        self._guard(plan); writers = self._inventory(plan)
        require(hashlib.sha256(self.private(self.artifact['path'])).hexdigest() == self.artifact['sha256'],
                'CANDIDATE_ARTIFACT_DRIFT')
        require(all(writers[w['key']]['state'] in ('paused', 'stopped') for w in plan['candidateWriters']),
                'CANDIDATE_STAGING_NOT_HELD')
        self._guard(plan)
        return copy.deepcopy(plan['stagingIdentity'])

    def verify_completed_migration(self, plan, nonce):
        self._guard(plan)
        require(type(nonce) is str and re.fullmatch('[a-f0-9]{64}', nonce), 'CANDIDATE_MIGRATION_NONCE')
        receipt = self.journal.value.get('migrationCompletionReceipt')
        expected = '/etc/workspacex-cn/migration-completion-inputs/' + plan['identity']['sourceRevision'] + '/' + plan['identity']['attemptId'] + '.completed.json'
        require(type(receipt) is dict and receipt == self.journal.value.get('migrationCompletionIntent') and
                receipt['path'] == expected and receipt['sha256'] == plan['migrationCompletionSha256'] and
                any(e['state'] == 'migration-completion-durable' and e.get('receipt') == receipt and
                    e.get('holdGeneration') == plan['holdGeneration'] for e in self.journal.value['events']),
                'CANDIDATE_MIGRATION_DURABLE_RECEIPT_REQUIRED')
        raw = self.private(expected); require(hashlib.sha256(raw).hexdigest() == receipt['sha256'], 'CANDIDATE_COMPLETION_DRIFT')
        completed = json.loads(raw)
        connection = self.host.diagnostic_connections['workspacex']
        require(connection.binding == self.host.plan['diagnosticSessions']['workspacex'], 'CANDIDATE_LEDGER_CONNECTION_DRIFT')
        verify_bound_transport(self.host.plan, 'workspacex', 'diagnostic', connection.binding)
        value = connection.query('migration-ledger')
        require(value['rowCount'] == len(value['ledger']) and len({r['name'] for r in value['ledger']}) == len(value['ledger']),
                'CANDIDATE_LEDGER_PROTOCOL')
        ledger = sorted([dict(name=r['name'], checksum=r['checksum']) for r in value['ledger']], key=lambda r: r['name'])
        from candidate_completion_contract import validate_completed
        ledger_sha=validate_completed(completed,plan['identity'],ledger)
        require(ledger_sha == plan['migrationLedgerSha256'], 'CANDIDATE_LEDGER_DRIFT')
        self._guard(plan); require(self.private(expected) == raw, 'CANDIDATE_COMPLETION_RACE')
        proof = dict(identity=plan['identity'], epoch=plan['epoch'], holdGeneration=plan['holdGeneration'],
                     completionSha256=receipt['sha256'], ledgerSha256=ledger_sha, nonce=nonce,
                     observedAt=time.time(), source='durable-completion-and-live-diagnostic-ledger', databasePeers=plan['databasePeers'])
        proof['evidenceSha256'] = digest(dict(proof=proof, connection=connection.binding))
        return proof

    def attest_candidate_backends(self, plan, nonce):
        self._guard(plan)
        proof = self.collector.collect(plan, nonce)
        self.runtime_sessions = verify_candidate_backend_seal(plan, nonce, proof)
        return proof

    def observe_candidate(self, plan):
        self._guard(plan)
        # Existing exhaustive process/unit/admission observation is retained.
        base = self.host.observe(self.host.plan); writers = self._inventory(plan)
        candidate_ids = {w['binding']['containerId'] for w in plan['candidateWriters']}
        unknown = [v for v in base['unclassifiedContainers'] if v not in candidate_ids]
        def candidate_process(value):
            segments = re.split(r'[/\s:.]+', value['cgroup'])
            return any(cid in segments or 'docker-' + cid in segments for cid in candidate_ids)
        processes = [v for v in base['unclassifiedProcesses'] if not candidate_process(v)]
        opened = any(writers[w['key']]['state'] == 'running' for w in plan['candidateWriters'])
        collect = getattr(self, '_opened_collector', None) or self.collector.collect
        proof = collect(plan, secrets.token_hex(32)) if opened else None
        sessions = verify_candidate_backend_seal(plan, proof['nonce'], proof) if proof else {db: [] for db in DATABASES}
        dbs = {}
        for db in DATABASES:
            live = self.read_candidate_database_sessions(db)
            require(live['peer'] == plan['databasePeers'][db] and live['preparedTransactions'] == [], 'CANDIDATE_LIVE_DB_DRIFT')
            require(len({(row['pid'], row['backendStart']) for row in live['sessions']}) == len(live['sessions']), 'CANDIDATE_SESSION_DUPLICATE')
            held = []
            for row in live['sessions']:
                matches = [h for h in plan['heldSessions'][db] if all(h[k] == row[k] for k in ('pid', 'backendStart', 'role', 'backendType'))]
                require(self.collector._tls(plan, db, row), 'CANDIDATE_SESSION_TRANSPORT')
                if matches:
                    require(len(matches) == 1 and row['state'] in ('idle', 'active'), 'CANDIDATE_HELD_SESSION_STATE')
                    held.append(copy.deepcopy(matches[0]))
                else:
                    found = [s for s in sessions[db] if all(s[k] == row[k] for k in ('pid', 'backendStart', 'role', 'backendType'))]
                    require(len(found) == 1 and found[0]['transactionMode'] == row['state'], 'CANDIDATE_FOREIGN_SESSION')
            require(len(held) == len(plan['heldSessions'][db]) and all(h in held for h in plan['heldSessions'][db]), 'CANDIDATE_HELD_SESSION_MISSING')
            dbs[db] = dict(peer=live['peer'], preparedTransactions=[], sessions=held + sessions[db])
        drain = aggregate_run_drain(self.host.diagnostic_connections['workspacex'].query('run-drain')['rows'])
        self._guard(plan)
        return dict(host=base['host'], observedAt=time.time(), scopes=base['scopes'], writers=writers,
                    unclassifiedContainers=unknown, unclassifiedProcesses=processes, automationUnits=base['automationUnits'],
                    admission=base['admission'], databases=dbs, runDrain=drain)

    def observe_opened_candidate(self, plan, collect_opened):
        # This scoped context is reachable only from the fixed read-only dispatcher.
        # The collector independently verifies CLEARED, never receives a fake HELD.
        require(callable(collect_opened), 'CANDIDATE_OPEN_COLLECTOR_NOT_IMPLEMENTED')
        self._observation_hold_state, self._opened_collector = 'cleared', collect_opened
        try:
            observation = self.observe_candidate(plan)
            require(observation['admission'] == plan['candidateAdmission'] and all(
                observation['writers'][w['key']]['state'] == 'running' for w in plan['candidateWriters']) and all(
                observation['writers'][w['key']]['state'] in ('paused', 'stopped') for w in plan['baselineWriters']) and
                observation['unclassifiedContainers'] == [] and observation['unclassifiedProcesses'] == [] and
                observation['automationUnits'] == {u: 'masked' for u in plan['automationUnits']} and
                all(type(v) is int and v == 0 for v in observation['runDrain'].values()), 'CANDIDATE_OPEN_OBSERVATION_FAILED')
            return observation
        finally:
            del self._observation_hold_state
            del self._opened_collector

    def _admission(self, plan, desired):
        for db in DATABASES:
            self._guard(plan)
            before = FixedProbes(self.host).admission()[0]['login'][db]
            require(before in (plan['closedAdmission']['login'][db], plan['candidateAdmission']['login'][db]),
                    'CANDIDATE_ADMISSION_DRIFT')
            after = desired['login'][db]
            if before != after: self.host.database_execute(db, login_cas_sql(plan['databasePeers'][db], before, after), control=True)
        require(FixedProbes(self.host).admission()[0] == desired, 'CANDIDATE_ADMISSION_READBACK')

    def reopen_candidate(self, plan):
        self._guard(plan); self.verify_staging(plan)
        require(self.journal.value.get('candidateResumeIntent', {}).get('planSha256') == digest(plan),
                'CANDIDATE_DURABLE_RESUME_INTENT_REQUIRED')
        self.promote_candidate_pointer()
        # Paused baseline containers still own the native loopback ports. Kill
        # only these exact held baseline identities; never unpause old app code.
        for writer in plan['baselineWriters']:
            if writer['binding']['service'] not in ('web','api'):continue
            self._guard(plan);state=self._inventory(plan)[writer['key']]['state']
            if state!='stopped':
                self.journal.record('baseline-port-release-intent',binding=writer['binding'],holdDisposition='retain')
                self._docker(['kill','--signal','KILL',writer['binding']['containerId']])
                require(self._inventory(plan)[writer['key']]['state']=='stopped','BASELINE_PORT_RELEASE_UNKNOWN')
                self.journal.record('baseline-port-release-readback',binding=writer['binding'],holdDisposition='retain')
        self._admission(plan, plan['candidateAdmission'])
        for writer in plan['candidateWriters']:
            self._guard(plan); state = self._inventory(plan)[writer['key']]['state']
            if state != 'running': self._docker(['unpause' if state == 'paused' else 'start', writer['binding']['containerId']])

    def reblock_candidate(self, plan):
        self._guard(plan); errors = []
        try: self._admission(plan, plan['closedAdmission'])
        except BaseException as error: errors.append(error)
        for writer in plan['candidateWriters']:
            try:
                self._guard(plan)
                if self._inventory(plan)[writer['key']]['state'] == 'running': self._docker(['pause',writer['binding']['containerId']])
            except BaseException as error: errors.append(error)
        for db in DATABASES:
            try:
                self._guard(plan); live = self.read_candidate_database_sessions(db)
                require(live['peer'] == plan['databasePeers'][db], 'CANDIDATE_TERMINATE_PEER')
                for row in live['sessions']:
                    if row['role'] not in plan['candidateRoles'][db]: continue
                    require(type(row['pid']) is int and row['pid'] > 1 and re.fullmatch('[0-9T: .+Z-]+', row['backendStart']), 'CANDIDATE_TERMINATE_SESSION')
                    sql = "SELECT pid,pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND pid=%d AND usename='%s' AND backend_start='%s'::timestamptz;" % (row['pid'], row['role'], row['backendStart'])
                    self.host.database_execute(db, sql, control=True)
            except BaseException as error: errors.append(error)
        self.runtime_sessions = None
        if errors: raise RuntimeError('CANDIDATE_REBLOCK_INCOMPLETE') from errors[0]
        observation = self.observe_candidate(plan)
        require(observation['admission'] == plan['closedAdmission'] and all(
            observation['writers'][w['key']]['state'] in ('paused', 'stopped') for w in plan['candidateWriters']), 'CANDIDATE_REBLOCK_NOT_PROVEN')


class RetainedCandidateActor:
    """Fixed operation dispatcher bound to one immutable private candidate input."""
    operations = ('prepare-resume-intent', 'verify-staging', 'resume', 'verify-resumed', 'block', 'observe-opened',
                  'rebind-held-epoch-for-reblock', 'verify-blocked')

    def __init__(self, host, journal, reference, read_private=private, proc_root='/proc'):
        from candidate_writer import CandidateWriterAdapter, APP, BASELINE
        identity = host.plan['identity']
        expected = '/etc/workspacex-cn/maintenance-candidate/' + identity['sourceRevision'] + '/' + identity['attemptId'] + '/candidate-plan.json'
        require(type(reference) is dict and set(reference) == {'path', 'sha256'} and reference['path'] == expected
                and re.fullmatch('[a-f0-9]{64}', reference['sha256']) and identity['sourceRevision'] == APP
                and identity['baselineRevision'] == BASELINE, 'CANDIDATE_ACTOR_PRIVATE_BINDING')
        raw = read_private(expected); require(hashlib.sha256(raw).hexdigest() == reference['sha256'], 'CANDIDATE_ACTOR_INPUT_PIN')
        value = json.loads(raw)
        require(type(value) is dict and set(value) == {'schemaVersion', 'toolRevision', 'plan', 'artifact'}
                and value['schemaVersion'] == 1 and value['toolRevision'] == host.plan['toolRevision']
                and value['plan']['identity'] == identity, 'CANDIDATE_ACTOR_INPUT_IDENTITY')
        self.host, self.journal, self.reference, self.private = host, journal, copy.deepcopy(reference), read_private
        self.raw, self.tool_revision = raw, value['toolRevision']
        self.transport = CandidateHostTransport(host, value['plan'], journal, value['artifact'], read_private, proc_root)
        self.adapter = CandidateWriterAdapter(identity, value['plan'], self.transport, journal)
        self.reblock_plan = None
        self.resume_disabled = False

    def _input(self, identity):
        require(identity == self.adapter.identity and self.host.plan['identity'] == identity and
                self.host.plan['toolRevision'] == self.tool_revision, 'CANDIDATE_ACTOR_IDENTITY_CHANGED')
        require(self.private(self.reference['path']) == self.raw, 'CANDIDATE_ACTOR_INPUT_DRIFT')
        self.transport.require_lock()

    def dispatch(self, operation, identity):
        require(operation in self.operations, 'CANDIDATE_ACTOR_OPERATION_UNSUPPORTED')
        self._input(identity); observation = None
        if operation == 'rebind-held-epoch-for-reblock':
            held = self.transport.read_hold()
            require(held['schemaVersion'] == 1 and held['state'] == 'held' and held['identity'] == identity and
                    re.fullmatch('[a-f0-9]{32}', held['generation']), 'CANDIDATE_REHOLD_REQUIRED')
            self.resume_disabled = True  # Journal failure must never leave reopening enabled.
            self.journal.record('candidate-rehold-block-intent', originalPlanSha256=digest(self.adapter.plan),
                                oldGeneration=self.adapter.plan['holdGeneration'], newGeneration=held['generation'],
                                reason='post-open-observation-failed', holdDisposition='retain', lockDisposition='retain')
            derived = copy.deepcopy(self.adapter.plan); derived['holdGeneration'] = held['generation']
            self.reblock_plan = derived
        elif operation in ('block', 'verify-blocked'):
            plan = self.reblock_plan or self.adapter.plan
            original = self.transport.plan
            try:
                self.transport.plan = copy.deepcopy(plan)
                if operation == 'block': self.transport.reblock_candidate(plan)
                observation = self.transport.observe_candidate(plan)
                require(observation['admission'] == plan['closedAdmission'] and all(
                    observation['writers'][w['key']]['state'] in ('paused', 'stopped') for w in plan['candidateWriters'] + plan['baselineWriters'])
                    and all(len(v['sessions']) == len(plan['heldSessions'][db]) and all(s in plan['heldSessions'][db] for s in v['sessions']) for db,v in observation['databases'].items()),
                    'CANDIDATE_BLOCKED_READBACK_FAILED')
                self.journal.record('candidate-blocked-live', observationSha256=digest(observation),
                                    holdGeneration=plan['holdGeneration'], holdDisposition='retain')
            finally: self.transport.plan = original
        else:
            require(not self.resume_disabled, 'CANDIDATE_REBOUND_RESUME_FORBIDDEN')
            if operation == 'prepare-resume-intent': self.adapter.prepare_resume_intent(identity)
            elif operation == 'verify-staging': observation = self.transport.verify_staging(self.adapter.plan)
            elif operation == 'resume': observation = self.adapter.resume_candidate(identity, require_prepared=True)
            elif operation == 'verify-resumed':
                self.adapter._guard(identity)
                require(self.adapter.runtime_sessions is not None and any(e['state'] == 'candidate-resumed'
                        for e in self.journal.value['events']), 'CANDIDATE_RESUME_NOT_DURABLE')
                observation = self.adapter._observe(opened=True)
            else:
                require(self.adapter.runtime_sessions is not None and any(e['state'] == 'candidate-resumed'
                        for e in self.journal.value['events']), 'CANDIDATE_OPEN_WITHOUT_RESUME')
                held = self.transport.read_hold()
                require(held == dict(schemaVersion=1,state='cleared',generation=self.adapter.plan['holdGeneration'],identity=identity),
                        'CANDIDATE_OPEN_HOLD_NOT_CLEARED')
                collect = getattr(self.transport.collector, 'collect_opened', None)
                require(callable(collect), 'CANDIDATE_OPEN_COLLECTOR_NOT_IMPLEMENTED')
                observation = self.transport.observe_opened_candidate(self.adapter.plan, collect)
                self.journal.record('candidate-opened-observed', observationSha256=digest(observation),
                                    holdGeneration=self.adapter.plan['holdGeneration'])
        return dict(schemaVersion=1,kind='candidate-host-operation',identity=copy.deepcopy(identity),operation=operation,
                    planSha256=self.reference['sha256'], candidatePlanSha256=digest(self.adapter.plan),
                    holdState=self.transport.read_hold()['state'],
                    **(dict(observationSha256=digest(observation)) if observation is not None else {}),
                    ready=False,productionAvailabilityProven=False)


class RetainedBaselineCancellation:
    """Pre-DDL cancellation only; never database recovery or old-version rollback.

    Reuses the original WriterFenceAdapter's captured prior and HostTransport
    apply protocol, without acceptance-bound legacy resumeWrites. A durable
    migration intent forbids this route even if the ledger still looks unchanged.
    """
    operations = ('verify-no-migration', 'resume-baseline', 'verify-baseline')

    def __init__(self, host, adapter, journal):
        from candidate_writer import APP, BASELINE
        require(host.plan == adapter.plan and journal is adapter.journal and adapter.transport is host,
                'BASELINE_CANCEL_EXISTING_ACTOR_REQUIRED')
        identity = host.plan['identity']
        require(identity['sourceRevision'] == APP and identity['baselineRevision'] == BASELINE,
                'BASELINE_CANCEL_FROZEN_IDENTITY')
        auth = host.plan.get('migrationAuthorization')
        require(type(auth) is dict and auth.get('identity') == identity and auth.get('toolRevision') == host.plan['toolRevision']
                and type(auth.get('baselineLedger')) is list, 'BASELINE_CANCEL_PINNED_LEDGER_REQUIRED')
        self.host, self.adapter, self.journal = host, adapter, journal
        self.identity, self.plan_hash = copy.deepcopy(identity), digest(host.plan)
        self.baseline_ledger = copy.deepcopy(auth['baselineLedger'])

    def _guard(self, identity):
        require(identity == self.identity and digest(self.host.plan) == self.plan_hash
                and self.adapter.plan == self.host.plan, 'BASELINE_CANCEL_IDENTITY_OR_PLAN_DRIFT')
        self.host.require_lock(); self.adapter.hold()
        require(not any(e['state'].startswith('migration-') or e['state'].startswith('retained-recovery-') or
                        e['state'].startswith('candidate-resume') or e['state'] == 'database-recovery-required'
                        for e in self.journal.value['events']) and
                not any(self.journal.value.get(k) for k in ('migrationCompletionIntent', 'migrationCompletionReceipt',
                       'candidateResumeIntent', 'databaseRecoveryRequired', 'retainedRecoveryStarted')),
                'BASELINE_CANCEL_AFTER_MIGRATION_INTENT_FORBIDDEN')

    def verify_no_migration(self, identity):
        self._guard(identity); self.adapter.verifyWritesBlocked(identity)
        connection = self.host.diagnostic_connections['workspacex']
        require(connection.binding == self.host.plan['diagnosticSessions']['workspacex'], 'BASELINE_CANCEL_DIAGNOSTIC_IDENTITY')
        verify_bound_transport(self.host.plan, 'workspacex', 'diagnostic', connection.binding)
        live = connection.query('migration-ledger')
        require(live['rowCount'] == len(live['ledger']) and len({r['name'] for r in live['ledger']}) == len(live['ledger']),
                'BASELINE_CANCEL_LEDGER_PROTOCOL')
        ledger = sorted([dict(name=r['name'], checksum=r['checksum']) for r in live['ledger']], key=lambda r: r['name'])
        require(ledger == self.baseline_ledger, 'BASELINE_CANCEL_LIVE_LEDGER_CHANGED')
        # Still held and no migrate intent after query I/O; an absent receipt alone
        # is never sufficient to permit restoring application write admission.
        self._guard(identity); self.adapter.verifyWritesBlocked(identity)
        value = dict(identity=identity, holdGeneration=self.host.plan['holdGeneration'], ledgerSha256=digest(ledger),
                     planSha256=self.plan_hash, observedAt=time.time(), connectionSha256=digest(connection.binding))
        self.journal.record('baseline-cancel-no-migration-proof', proof=value, holdDisposition='retain')
        return value

    def resume_baseline(self, identity):
        require(not self.journal.value.get('baselineCancellationResumeIntent'), 'BASELINE_CANCEL_RETRY_REQUIRES_RECONCILIATION')
        proof = self.verify_no_migration(identity)
        prior = self.journal.value.get('prior')
        require(type(prior) is dict and prior['host'] == self.host.plan['host'] and
                set(prior['writers']) == {w['key'] for w in self.host.plan['writers']} and
                all(prior['writers'][w['key']]['binding'] == w['binding'] and
                    prior['writers'][w['key']]['state'] in ('running', 'paused', 'stopped') for w in self.host.plan['writers']) and
                prior['admission'] == self.host.plan['originalAdmission'] and
                set(prior['automationUnits']) == set(self.host.plan['automationUnits']), 'BASELINE_CANCEL_PRIOR_IDENTITY')
        self.journal.value['baselineCancellationResumeIntent'] = dict(identity=identity, priorSha256=digest(prior), proofSha256=digest(proof))
        self.journal.record('baseline-cancel-resume-intent', intent=self.journal.value['baselineCancellationResumeIntent'], holdDisposition='retain')
        try:
            for writer in reversed(self.host.plan['writers']):
                self._guard(identity)
                if prior['writers'][writer['key']]['state'] == 'running':
                    action = dict(kind='resume-writer', key=writer['key'], binding=writer['binding'])
                    self.journal.record('baseline-cancel-action-intent', action=action)
                    self.host.apply(action, self.host.plan)
            for unit, state in prior['automationUnits'].items():
                self._guard(identity)
                action = dict(kind='restore-unit', unit=unit, state=state, priorDetails=prior.get('automationUnitDetails', {}).get(unit))
                self.journal.record('baseline-cancel-action-intent', action=action); self.host.apply(action, self.host.plan)
            self._guard(identity)
            action = dict(kind='restore-database-admission', before=self.host.plan['closedAdmission'], after=prior['admission'])
            self.journal.record('baseline-cancel-action-intent', action=action); self.host.apply(action, self.host.plan)
            self.journal.record('baseline-cancel-awaiting-readback', holdDisposition='retain')
        except BaseException:
            self.journal.record('baseline-cancel-write-state-unknown', holdDisposition='retain', lockDisposition='retain')
            raise

    def verify_baseline(self, identity):
        self._guard(identity)
        require(self.journal.value.get('baselineCancellationResumeIntent') and any(e['state'] == 'baseline-cancel-awaiting-readback'
                for e in self.journal.value['events']), 'BASELINE_CANCEL_RESUME_NOT_DURABLE')
        prior = self.journal.value['prior']
        require(digest(prior) == self.journal.value['baselineCancellationResumeIntent']['priorSha256'], 'BASELINE_CANCEL_PRIOR_DRIFT')
        observed = self.adapter.observe(prior['admission'])
        require(observed['writers'] == prior['writers'] and observed['automationUnits'] == prior['automationUnits'] and
                observed.get('automationUnitDetails') == prior.get('automationUnitDetails'), 'BASELINE_CANCEL_RESUME_READBACK_FAILED')
        self.journal.record('baseline-cancel-resumed', observationSha256=digest(observed), holdDisposition='retain')
        return observed

    def dispatch(self, operation, identity):
        require(operation in self.operations, 'BASELINE_CANCEL_OPERATION_UNSUPPORTED')
        value = self.verify_no_migration(identity) if operation == 'verify-no-migration' else self.resume_baseline(identity) if operation == 'resume-baseline' else self.verify_baseline(identity)
        return dict(schemaVersion=1,kind='baseline-cancellation-operation',identity=copy.deepcopy(identity), operation=operation,
                    planSha256=self.plan_hash, **(dict(observationSha256=digest(value)) if value is not None else {}),
                    writesHeld=operation == 'verify-no-migration', holdState='held',ready=False,productionAvailabilityProven=False)
