import assert from 'node:assert/strict';
const { describe, it } = process.env.VITEST ? await import('vitest') : await import('node:test');
import { applyFenceModelEvent, createFenceModel, inspectFenceModel } from './lib/ci-candidate-fence-model.mjs';

// These are synthetic protocol scenarios, not protected CI receipts. No fixture
// can set an authority flag or cause a real skip, even when model CAS succeeds.
const sha = (letter) => letter.repeat(40);
const digest = (letter) => `sha256:${letter.repeat(64)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const config = () => ({
  controller: 'protected-controller-model',
  producers: [
    { id: 'smoke', workflowId: 17, suite: 'fullstack-smoke', startPaths: ['pull_request', 'workflow_dispatch', 're_run'] },
    { id: 'backend', workflowId: 18, suite: 'backend-gates', startPaths: ['pull_request', 're_run'] },
  ],
  consumers: ['main-a', 'main-b'], reservationTtlMs: 100, maxArtifactTtlMs: 5000,
});
const candidate = () => ({
  repositoryId: 1, kind: 'pull_request', id: 'pr:5400', baseSha: sha('a'), headSha: sha('b'), checkoutSha: sha('c'), sourceTree: sha('d'),
  definitionDigest: digest('a'), runtimeDigest: digest('b'), lockDigest: digest('c'), toolchainDigest: digest('d'), environmentDigest: digest('e'),
});
const execution = (producer, round = 0, attempt = 1) => ({ runId: (producer === 'smoke' ? 100 : 200) + round, runAttempt: attempt, jobId: (producer === 'smoke' ? 1000 : 2000) + round * 10 + attempt });
const initial = () => createFenceModel(config(), candidate());
function boundary(result) {
  assert.equal(result.inMemoryOnly, true);
  assert.equal(result.simulationInputsOnly, true);
  for (const field of ['durable', 'actualReuseAtomic', 'coordinatorCoverageVerified', 'realAuthority', 'protectedVerified', 'reuseAuthorized', 'skip']) assert.equal(result[field], false, field);
  assert.equal(result.runFull, true);
}
function apply(state, event) {
  const before = JSON.stringify(state);
  const result = applyFenceModelEvent(state, event);
  boundary(result);
  assert.equal(JSON.stringify(state), before, 'pure transition cannot mutate previous state');
  if (result.state) { assert.equal(Object.isFrozen(result.state), true); assert.equal(inspectFenceModel(result.state).validModelState, true, result.reason); }
  return result;
}
const control = (type, now, extra = {}) => ({ type, now, actor: 'protected-controller-model', ...extra });
function start(state, producerId, round = 0, attempt = 1, type = 'producer-start') {
  return apply(state, { type, now: state.now + 1, producerId, startPath: type === 'producer-rerun' ? 're_run' : 'pull_request', execution: execution(producerId, round, attempt) });
}
function terminal(state, producerId, round = 0, attempt = 1, conclusion = 'success', artifacts = undefined) {
  return apply(state, {
    type: 'producer-terminal', now: state.now + 1, producerId, execution: execution(producerId, round, attempt), conclusion,
    artifacts: artifacts ?? (conclusion === 'success' ? [{ id: (producerId === 'smoke' ? 30 : 40) + round, digest: digest(producerId === 'smoke' ? 'e' : 'f'), expiresAt: state.now + 1000 }] : []),
  });
}
function ready(round = 0, state = initial()) {
  for (const id of ['smoke', 'backend']) { const result = start(state, id, round); assert.equal(result.accepted, true); state = result.state; }
  for (const id of ['smoke', 'backend']) { const result = terminal(state, id, round); assert.equal(result.accepted, true); state = result.state; }
  assert.equal(inspectFenceModel(state).modelReady, true);
  return state;
}
function cas(state, type = 'reserve', consumerId = 'main-a', overrides = {}) {
  const view = inspectFenceModel(state);
  return { type, now: state.now + 1, consumerId, expectedEpoch: view.epoch, expectedGeneration: view.generation, identityDigest: view.evidenceDigest, ...(type === 'consume-cas' ? { reservationId: state.reservation.id } : {}), ...overrides };
}
function reserved() { const state = ready(); const result = apply(state, cas(state)); assert.equal(result.accepted, true); return result.state; }

describe('candidate fence model: success binds a complete synthetic lifecycle', () => {
  it('only all configured producers in one epoch can reserve and consume', () => {
    const state = ready(); const before = inspectFenceModel(state); boundary(before);
    const reservation = apply(state, cas(state));
    assert.equal(reservation.reason, 'model-reserved'); assert.equal(reservation.modelConsumeSucceeded, false);
    assert.equal(reservation.state.generation, state.generation + 1); assert.equal(reservation.state.epoch, state.epoch);
    const commit = apply(reservation.state, cas(reservation.state, 'consume-cas'));
    assert.equal(commit.reason, 'model-cas-committed'); assert.equal(commit.modelConsumeSucceeded, true);
    assert.equal(commit.state.consumed.evidenceDigest, before.evidenceDigest);
    assert.equal(inspectFenceModel(commit.state).modelReady, false);
    assert.deepEqual(inspectFenceModel(commit.state).reasons, ['already-consumed']);
  });
  it('deterministic identical scenarios produce identical states and CAS tokens', () => {
    assert.deepEqual(reserved(), reserved());
    const one = reserved(); const two = reserved();
    assert.deepEqual(apply(one, cas(one, 'consume-cas')), apply(two, cas(two, 'consume-cas')));
  });
  it('freezes every nested state field and does not retain caller aliases', () => {
    const sourceConfig = config(); const sourceCandidate = candidate(); const state = createFenceModel(sourceConfig, sourceCandidate);
    sourceConfig.producers[0].workflowId = 99; sourceCandidate.headSha = sha('f');
    assert.equal(state.config.producers[0].workflowId, 17); assert.equal(state.candidate.headSha, sha('b'));
    assert.throws(() => { state.config.producers.push({}); }, TypeError);
    assert.throws(() => { state.candidate.headSha = sha('f'); }, TypeError);
  });
  it('producer completions before a later producer start must be regenerated', () => {
    let state = start(initial(), 'smoke').state; state = terminal(state, 'smoke').state;
    const oldEpoch = state.epoch; state = start(state, 'backend').state;
    assert.equal(state.epoch, oldEpoch + 1); assert.equal(state.producers.smoke.receipt, null);
    state = terminal(state, 'backend').state;
    assert.equal(apply(state, cas(state)).reason, 'model-not-ready');
  });
  it('full identity includes repository, workflow/suite, candidate and every source attempt/artifact', () => {
    const state = ready(); const binding = inspectFenceModel(state).evidenceDigest;
    for (const change of [
      (s) => { s.config.producers[0].workflowId++; },
      (s) => { s.config.producers[0].suite = 'another-suite'; },
      (s) => { s.producers.smoke.lastExecution.runAttempt++; s.producers.smoke.receipt.execution.runAttempt++; },
      (s) => { s.producers.smoke.lastExecution.jobId++; s.producers.smoke.receipt.execution.jobId++; },
      (s) => { s.producers.smoke.lastExecution.runId++; s.producers.smoke.receipt.execution.runId++; },
      (s) => { s.producers.smoke.receipt.artifacts[0].id++; },
      (s) => { s.producers.smoke.receipt.artifacts[0].digest = digest('a'); },
      (s) => { s.producers.smoke.receipt.artifacts[0].expiresAt++; },
      (s) => { s.producers.smoke.receipt.startPath = 'workflow_dispatch'; },
    ]) { const changed = clone(state); change(changed); const view = inspectFenceModel(changed); assert.equal(view.validModelState, true); assert.notEqual(view.evidenceDigest, binding); boundary(view); }
  });
});

describe('epoch invalidation and monotonic generation prevent ABA', () => {
  for (const field of ['repositoryId', 'kind', 'id', 'baseSha', 'headSha', 'checkoutSha', 'sourceTree', 'definitionDigest', 'runtimeDigest', 'lockDigest', 'toolchainDigest', 'environmentDigest']) {
    it(`invalidates old reservation when candidate ${field} changes`, () => {
      const state = reserved(); const oldCas = cas(state, 'consume-cas'); const changed = candidate();
      changed[field] = field === 'repositoryId' ? 2 : field === 'kind' ? 'merge_group' : field === 'id' ? 'pr:5401' : field.endsWith('Digest') ? digest('f') : sha('f');
      const result = apply(state, control('candidate-change', state.now + 1, { candidate: changed }));
      assert.equal(result.accepted, true); assert.equal(result.state.epoch, state.epoch + 1); assert.equal(result.state.generation, state.generation + 1);
      assert.equal(result.state.reservation, null); assert.equal(apply(result.state, { ...oldCas, now: result.state.now + 1 }).reason, 'stale-cas');
    });
  }
  it('A -> B -> A never restores old epoch, generation, reservation or producer attempts', () => {
    const original = reserved(); const oldToken = original.reservation.id; const oldCas = cas(original, 'consume-cas');
    const other = { ...candidate(), headSha: sha('f') };
    let state = apply(original, control('candidate-change', 10, { candidate: other })).state;
    state = apply(state, control('candidate-change', 11, { candidate: candidate() })).state;
    assert.equal(inspectFenceModel(state).candidateDigest, inspectFenceModel(original).candidateDigest);
    assert.equal(state.epoch, original.epoch + 2); assert.equal(state.generation, original.generation + 2);
    assert.equal(start(state, 'smoke').reason, 'stale-producer-invocation');
    state = ready(1, state); state = apply(state, cas(state)).state;
    assert.notEqual(state.reservation.id, oldToken); assert.equal(apply(state, { ...oldCas, now: state.now + 1 }).reason, 'stale-cas');
  });
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'unknown']) {
    it(`a newer ${conclusion} invalidates earlier complete receipts`, () => {
      const state = reserved(); const oldCas = cas(state, 'consume-cas');
      const rerun = start(state, 'smoke', 0, 2, 'producer-rerun'); assert.equal(rerun.accepted, true);
      const result = terminal(rerun.state, 'smoke', 0, 2, conclusion);
      assert.equal(result.accepted, true); assert.equal(result.state.epoch, state.epoch + 2);
      assert.equal(result.state.producers.backend.receipt, null); assert.equal(inspectFenceModel(result.state).modelReady, false);
      assert.equal(apply(result.state, { ...oldCas, now: result.state.now + 1 }).reason, 'stale-cas');
    });
  }
  it('newer failure on another PR with the same head cannot reuse old PR evidence', () => {
    let state = reserved(); const oldCas = cas(state, 'consume-cas');
    state = apply(state, control('candidate-change', 10, { candidate: { ...candidate(), id: 'pr:5401' } })).state;
    state = start(state, 'smoke', 1).state; state = terminal(state, 'smoke', 1, 1, 'failure').state;
    assert.equal(state.candidate.headSha, candidate().headSha); assert.equal(inspectFenceModel(state).modelReady, false);
    assert.equal(apply(state, { ...oldCas, now: state.now + 1 }).modelConsumeSucceeded, false);
  });
  it('cancel and artifact revocation invalidate even an already reserved bundle', () => {
    let state = reserved(); const oldEpoch = state.epoch;
    state = start(state, 'smoke', 0, 2, 'producer-rerun').state;
    state = apply(state, { type: 'producer-cancel', now: 10, producerId: 'smoke', execution: execution('smoke', 0, 2) }).state;
    assert.equal(state.epoch, oldEpoch + 2); assert.equal(state.producers.smoke.active, null);
    const original = reserved(); const revoked = apply(original, control('artifact-invalidate', 20, { artifactId: 30 }));
    assert.equal(revoked.reason, 'artifact-invalidated'); assert.equal(revoked.state.epoch, original.epoch + 1); assert.equal(revoked.state.reservation, null);
    assert.equal(inspectFenceModel(revoked.state).modelReady, false);
  });
  it('manual allowed start is still an invalidating participant, not an independent bypass', () => {
    const state = reserved(); const result = apply(state, { type: 'producer-start', now: 20, producerId: 'smoke', startPath: 'workflow_dispatch', execution: execution('smoke', 1) });
    assert.equal(result.accepted, true); assert.equal(result.state.epoch, state.epoch + 1); assert.equal(result.state.producers.backend.receipt, null);
  });
});

describe('reservation CAS, expiry, concurrent consumers and crash windows', () => {
  it('one latest-state consumer wins; the other cannot consume the same token', () => {
    const state = ready(); const a = cas(state); const b = cas(state, 'reserve', 'main-b');
    const reservation = apply(state, a); assert.equal(reservation.accepted, true);
    assert.equal(apply(reservation.state, b).reason, 'stale-cas');
    assert.equal(apply(reservation.state, cas(reservation.state, 'reserve', 'main-b')).reason, 'reservation-exists');
    assert.equal(apply(reservation.state, cas(reservation.state, 'consume-cas', 'main-b')).reason, 'reservation-mismatch');
    const request = cas(reservation.state, 'consume-cas'); const committed = apply(reservation.state, request);
    assert.equal(committed.modelConsumeSucceeded, true);
    assert.equal(apply(committed.state, request).reason, 'stale-cas');
    assert.equal(apply(committed.state, { ...request, expectedGeneration: committed.state.generation, now: committed.state.now }).reason, 'already-consumed');
  });
  it('does not claim two independent copies have serialized themselves', () => {
    const state = reserved(); const request = cas(state, 'consume-cas');
    assert.equal(apply(state, request).modelConsumeSucceeded, true);
    assert.equal(apply(clone(state), request).modelConsumeSucceeded, true);
    // This counterexample is why the API reports inMemoryOnly/durable=false:
    // sharing a digest or GitHub concurrency group is not a shared CAS store.
    assert.equal(apply(state, request).durable, false);
  });
  for (const field of ['expectedEpoch', 'expectedGeneration']) {
    it(`rejects stale ${field}`, () => { const state = reserved(); assert.equal(apply(state, cas(state, 'consume-cas', 'main-a', { [field]: state[field === 'expectedEpoch' ? 'epoch' : 'generation'] - 1 })).reason, 'stale-cas'); });
  }
  it('rejects a mismatched full evidence digest without changing the CAS revision', () => {
    const state = reserved(); const result = apply(state, cas(state, 'consume-cas', 'main-a', { identityDigest: digest('a') }));
    assert.equal(result.reason, 'identity-mismatch'); assert.deepEqual(result.state, state);
  });
  it('rejects swapped or invented reservation IDs', () => {
    const state = reserved(); assert.equal(apply(state, cas(state, 'consume-cas', 'main-a', { reservationId: digest('a') })).reason, 'reservation-mismatch');
  });
  it('expires at the lease boundary and cannot refresh itself by a stale retry', () => {
    const state = reserved(); const request = cas(state, 'consume-cas', 'main-a', { now: state.reservation.expiresAt });
    const result = apply(state, request); assert.equal(result.reason, 'reservation-expired'); assert.equal(result.state.epoch, state.epoch + 1);
    assert.equal(apply(result.state, { ...request, now: result.state.now + 1 }).reason, 'stale-cas');
  });
  it('expired artifact cannot reserve or consume, even with a valid lease ID', () => {
    const state = ready(); const expiry = state.producers.smoke.receipt.artifacts[0].expiresAt;
    assert.equal(apply(state, cas(state, 'reserve', 'main-a', { now: expiry })).reason, 'artifact-expired');
    const leased = reserved(); const result = apply(leased, cas(leased, 'consume-cas', 'main-a', { now: leased.producers.smoke.receipt.artifacts[0].expiresAt }));
    assert.equal(result.reason, 'artifact-expired'); assert.equal(result.state.reservation, null);
  });
  it('lease is capped by the earliest artifact lifetime', () => {
    let state = start(initial(), 'smoke').state; state = start(state, 'backend').state;
    state = terminal(state, 'smoke', 0, 1, 'success', [{ id: 30, digest: digest('e'), expiresAt: 30 }]).state;
    state = terminal(state, 'backend').state; const result = apply(state, cas(state));
    assert.equal(result.state.reservation.expiresAt, 30);
  });
  it('clock regression invalidates a reservation rather than extending a lease', () => {
    const state = reserved(); const result = apply(state, cas(state, 'consume-cas', 'main-a', { now: state.now - 1 }));
    assert.equal(result.reason, 'clock-regression'); assert.equal(result.state.now, state.now); assert.equal(result.state.epoch, state.epoch + 1);
  });
  it('clock advancement is a revision; an outstanding reservation cannot survive it', () => {
    const state = reserved(); const result = apply(state, control('tick', 20));
    assert.equal(result.state.generation, state.generation + 1); assert.equal(result.state.reservation, null);
    assert.equal(apply(result.state, { ...cas(state, 'consume-cas'), now: 21 }).reason, 'stale-cas');
  });
  for (const stage of ['before-reserve', 'after-reserve', 'after-commit']) {
    it(`crash ${stage} needs fresh producers and cannot attest an actual reuse action`, () => {
      let state = ready();
      if (stage !== 'before-reserve') state = apply(state, cas(state)).state;
      let committed = null;
      if (stage === 'after-commit') { committed = apply(state, cas(state, 'consume-cas')); state = committed.state; assert.equal(committed.modelConsumeSucceeded, true); }
      const generation = state.generation; const epoch = state.epoch;
      state = apply(state, control('crash', state.now + 1)).state;
      assert.equal(state.generation, generation + 1); assert.equal(state.epoch, epoch + 1); assert.equal(state.reservation, null);
      state = apply(state, control('recover', state.now + 1)).state;
      assert.equal(state.generation, generation + 2); assert.equal(state.epoch, epoch + 2); assert.equal(inspectFenceModel(state).modelReady, false);
      assert.equal(start(state, 'smoke').reason, 'stale-producer-invocation');
      state = ready(1, state); const reservation = apply(state, cas(state)).state; const second = apply(reservation, cas(reservation, 'consume-cas'));
      assert.equal(second.modelConsumeSucceeded, true); assert.equal(second.actualReuseAtomic, false);
      // A committed model receipt cannot tell whether a later real effect ran
      // before the crash. A durable effect/outbox protocol is still required.
      if (committed) assert.equal(committed.actualReuseAtomic, false);
    });
  }
  it('permission loss fails closed; recovery has no authority or old receipts', () => {
    const state = reserved(); const lost = apply(state, control('permission-loss', 20));
    assert.equal(lost.state.epoch, state.epoch + 1); assert.deepEqual(lost.state.blocked, ['permission-unavailable']);
    const recovered = apply(lost.state, control('recover', 21)); assert.deepEqual(recovered.state.blocked, []);
    assert.equal(recovered.protectedVerified, false); assert.equal(inspectFenceModel(recovered.state).modelReady, false);
  });
});

describe('closed model catalog rejects bypass and self-reported authority', () => {
  const catalogDrifts = [
    ['controller', (s) => { s.config.controller = 'another-controller'; }],
    ['producer workflow', (s) => { s.config.producers[0].workflowId++; }],
    ['producer suite', (s) => { s.config.producers[0].suite = 'another-suite'; }],
    ['added UI start path', (s) => { s.config.producers[0].startPaths.push('uncoordinated_ui_rerun'); }],
    ['removed start path', (s) => { s.config.producers[0].startPaths.pop(); }],
    ['reordered start paths', (s) => { s.config.producers[0].startPaths.reverse(); }],
    ['added producer', (s) => {
      s.config.producers.push({ id: 'board', workflowId: 19, suite: 'board', startPaths: ['pull_request'] });
      s.producers.board = { lastExecution: null, active: null, receipt: null };
    }],
    ['removed producer', (s) => { s.config.producers.pop(); delete s.producers.backend; }],
    ['renamed producer', (s) => { s.config.producers[0].id = 'new-smoke'; s.producers['new-smoke'] = s.producers.smoke; delete s.producers.smoke; }],
    ['reordered producers', (s) => { s.config.producers.reverse(); }],
    ['added consumer', (s) => { s.config.consumers.push('main-c'); }],
    ['removed consumer', (s) => { s.config.consumers.pop(); }],
    ['reordered consumers', (s) => { s.config.consumers.reverse(); }],
    ['reservation TTL', (s) => { s.config.reservationTtlMs++; }],
    ['artifact TTL', (s) => { s.config.maxArtifactTtlMs++; }],
  ];
  for (const [name, drift] of catalogDrifts) {
    it(`old reservation cannot consume after same-revision catalog drift: ${name}`, () => {
      const state = reserved(); const request = cas(state, 'consume-cas'); const changed = clone(state); drift(changed);
      assert.equal(changed.epoch, state.epoch); assert.equal(changed.generation, state.generation);
      assert.equal(inspectFenceModel(changed).validModelState, false, 'reservation must bind full fixed config');
      const result = applyFenceModelEvent(changed, request); boundary(result);
      assert.equal(result.reason, 'invalid-state'); assert.equal(result.modelConsumeSucceeded, false);
      // The modified catalog is still only a hypothetical model. Removing its
      // old reservation may make it a consistent NEW scenario, never authority.
      changed.reservation = null;
      const view = inspectFenceModel(changed); boundary(view); assert.equal(view.validModelState, true);
      assert.notEqual(view.evidenceDigest, request.identityDigest);
      const noOldToken = apply(changed, request); assert.equal(noOldToken.modelConsumeSucceeded, false);
    });
  }
  const cases = [
    ['unknown producer', (state) => ({ type: 'producer-start', now: state.now + 1, producerId: 'omitted-suite', startPath: 'pull_request', execution: execution('smoke', 1) }), 'unknown-producer'],
    ['unknown manual path', (state) => ({ type: 'producer-start', now: state.now + 1, producerId: 'smoke', startPath: 'uncoordinated_ui_rerun', execution: execution('smoke', 1) }), 'unknown-start-path'],
    ['unknown consumer', (state) => cas(state, 'reserve', 'outsider'), 'unknown-participant'],
    ['unknown controller', (state) => control('crash', state.now + 1, { actor: 'candidate' }), 'unknown-participant'],
    ['explicit producer bypass', (state) => control('bypass', state.now + 1), 'catalog-bypass'],
    ['unknown event', (state) => ({ type: 'actual-reuse-completed', now: state.now + 1 }), 'unknown-event'],
    ['unknown revoked artifact', (state) => control('artifact-invalidate', state.now + 1, { artifactId: 999 }), 'unknown-artifact'],
  ];
  for (const [name, event, reason] of cases) {
    it(`${name} invalidates and stays blocked across recovery and successful new model jobs`, () => {
      const state = reserved(); const result = apply(state, event(state));
      assert.equal(result.reason, reason); assert.equal(result.state.epoch, state.epoch + 1); assert.equal(result.state.reservation, null);
      let next = apply(result.state, control('recover', result.state.now + 1)).state;
      for (const id of ['smoke', 'backend']) next = start(next, id, 1).state;
      for (const id of ['smoke', 'backend']) next = terminal(next, id, 1).state;
      assert.equal(inspectFenceModel(next).modelReady, false); assert.ok(next.blocked.includes(reason));
      assert.equal(apply(next, cas(next)).reason, 'model-not-ready');
    });
  }
  for (const field of ['complete', 'authority', 'realAuthority', 'protectedVerified', 'reuseAuthorized', 'skip', 'runFull']) {
    it(`does not accept caller ${field} as a lifecycle shortcut`, () => {
      const state = reserved(); const result = apply(state, { ...cas(state, 'consume-cas'), [field]: true });
      assert.equal(result.reason, 'invalid-event'); assert.equal(result.modelConsumeSucceeded, false); assert.equal(result.state.reservation, null);
    });
  }
  it('unknown catalog replacement event cannot remove a failing suite', () => {
    const state = ready(); const result = apply(state, { type: 'replace-config', now: 20, config: { ...config(), producers: [config().producers[0]] } });
    assert.equal(result.reason, 'unknown-event'); assert.equal(result.state.config.producers.length, 2);
  });
  it('success without a modeled start or with a swapped attempt/job fails closed', () => {
    assert.equal(terminal(initial(), 'smoke').reason, 'unmatched-producer-invocation');
    for (const field of ['runId', 'runAttempt', 'jobId']) {
      const state = start(initial(), 'smoke').state; const invocation = execution('smoke'); invocation[field]++;
      const result = apply(state, { type: 'producer-terminal', now: 3, producerId: 'smoke', execution: invocation, conclusion: 'success', artifacts: [{ id: 30, digest: digest('e'), expiresAt: 1000 }] });
      assert.equal(result.reason, 'unmatched-producer-invocation'); assert.equal(result.state.producers.smoke.receipt, null);
    }
  });
  it('rerun must advance an existing attempt and change job identity', () => {
    const state = ready();
    for (const invocation of [execution('smoke'), execution('smoke', 1, 2), { ...execution('smoke', 0, 2), jobId: execution('smoke').jobId }]) {
      const result = apply(state, { type: 'producer-rerun', now: 20, producerId: 'smoke', startPath: 're_run', execution: invocation });
      assert.equal(result.reason, 'stale-producer-invocation'); assert.equal(result.state.epoch, state.epoch + 1);
    }
  });
});

describe('strict bounded model inputs and fail-closed limits', () => {
  for (const artifacts of [[], [{ id: 30, digest: 'missing', expiresAt: 1000 }], [{ id: 30, digest: digest('e'), expiresAt: 2 }], [{ id: 30, digest: digest('e'), expiresAt: 10000 }], [{ id: 30, digest: digest('e'), expiresAt: 1000 }, { id: 30, digest: digest('f'), expiresAt: 1000 }]]) {
    it(`rejects incomplete/expired/duplicate artifact input ${JSON.stringify(artifacts)}`, () => {
      const state = start(initial(), 'smoke').state; const result = terminal(state, 'smoke', 0, 1, 'success', artifacts);
      assert.equal(result.reason, 'invalid-event'); assert.equal(inspectFenceModel(result.state).modelReady, false);
    });
  }
  it('does not permit two producers to share an artifact identity', () => {
    let state = start(initial(), 'smoke').state; state = start(state, 'backend').state; state = terminal(state, 'smoke').state;
    assert.equal(terminal(state, 'backend', 0, 1, 'success', [{ id: 30, digest: digest('e'), expiresAt: 1000 }]).reason, 'invalid-event');
  });
  for (const corrupt of [
    (s) => { s.generation = -1; }, (s) => { s.generation = 0.5; }, (s) => { s.generation = NaN; }, (s) => { s.epoch = s.generation + 1; },
    (s) => { s.complete = true; }, (s) => { delete s.producers.backend; }, (s) => { s.producers.smoke.receipt.epoch--; },
    (s) => { s.producers.smoke.receipt.execution.runAttempt++; }, (s) => { s.producers.smoke.receipt.candidateDigest = digest('a'); },
    (s) => { s.producers.smoke.receipt.artifacts[0].expiresAt = s.now + 100000; },
  ]) {
    it(`rejects corrupted state ${corrupt.toString()}`, () => {
      const state = clone(ready()); corrupt(state); const result = applyFenceModelEvent(state, {}); boundary(result);
      assert.equal(result.reason, 'invalid-state'); assert.equal(result.state, null); assert.equal(inspectFenceModel(state).modelReady, false);
    });
  }
  it('rejects malformed reservation/consumption binding', () => {
    const state = reserved(); const changed = clone(state); changed.reservation.consumerId = 'main-b';
    assert.equal(inspectFenceModel(changed).validModelState, false);
    const consumed = clone(apply(state, cas(state, 'consume-cas')).state); consumed.consumed.generation = String(consumed.generation);
    assert.equal(inspectFenceModel(consumed).validModelState, false);
  });
  for (const now of [Number.MAX_SAFE_INTEGER + 1, -1, Infinity, 0.2, '20', null]) {
    it(`rejects non-monotonic-safe event time ${String(now)}`, () => { const result = apply(initial(), control('tick', now)); assert.equal(result.reason, 'invalid-event'); });
  }
  it('safe integer exhaustion cannot wrap epoch/generation into an ABA token', () => {
    const state = clone(initial()); state.epoch = Number.MAX_SAFE_INTEGER; state.generation = Number.MAX_SAFE_INTEGER;
    const result = apply(state, control('recover', 1)); assert.equal(result.reason, 'counter-exhausted'); assert.deepEqual(result.state, state);
    assert.equal(inspectFenceModel(state).modelReady, false);
  });
  it('lease arithmetic overflow fails closed', () => {
    let state = createFenceModel(config(), candidate(), Number.MAX_SAFE_INTEGER - 50);
    for (const id of ['smoke', 'backend']) state = start(state, id).state;
    for (const id of ['smoke', 'backend']) state = terminal(state, id, 0, 1, 'success', [{ id: id === 'smoke' ? 30 : 40, digest: digest('e'), expiresAt: Number.MAX_SAFE_INTEGER }]).state;
    const result = apply(state, cas(state)); assert.equal(result.reason, 'invalid-event'); assert.equal(result.modelConsumeSucceeded, false);
  });
  it('invalid model objects cannot execute getters or toJSON hooks', () => {
    let called = 0; const event = {};
    Object.defineProperty(event, 'type', { enumerable: true, get() { called++; return 'tick'; } });
    assert.equal(apply(initial(), event).reason, 'invalid-event'); assert.equal(called, 0);
    assert.throws(() => createFenceModel({ ...config(), toJSON() { called++; return {}; } }, candidate()), TypeError);
    assert.equal(called, 0);
  });
  it('rejects Proxy inputs before executing any reflection or access trap', () => {
    let called = 0;
    const proxy = new Proxy({}, {
      get() { called++; throw new Error('get trap'); },
      getPrototypeOf() { called++; throw new Error('prototype trap'); },
      ownKeys() { called++; throw new Error('keys trap'); },
      getOwnPropertyDescriptor() { called++; throw new Error('descriptor trap'); },
    });
    assert.equal(applyFenceModelEvent(initial(), proxy).reason, 'invalid-event');
    assert.equal(applyFenceModelEvent(proxy, control('tick', 1)).reason, 'invalid-state');
    assert.throws(() => createFenceModel(proxy, candidate()), TypeError);
    assert.throws(() => createFenceModel(config(), proxy), TypeError);
    assert.equal(called, 0);
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    assert.equal(applyFenceModelEvent(initial(), revoked.proxy).reason, 'invalid-event');
  });
  it('rejects cyclic, oversized, deep, sparse and exotic inputs', () => {
    const cycle = { type: 'tick' }; cycle.self = cycle;
    let deep = {}; for (let n = 0; n < 18; n++) deep = { deep };
    for (const event of [cycle, deep, { type: 'x'.repeat(1025) }, new Date(), new Map(), { type: 'tick', array: new Array(3) }, { type: 'tick', array: Array.from({ length: 33 }, () => 1) }]) assert.equal(apply(initial(), event).reason, 'invalid-event');
  });
  for (const corrupt of [
    (c) => { c.producers = []; }, (c) => { c.producers.push(clone(c.producers[0])); }, (c) => { c.producers[0].startPaths = []; },
    (c) => { c.producers[0].startPaths.push('pull_request'); }, (c) => { c.consumers = []; }, (c) => { c.consumers.push(c.controller); },
    (c) => { c.producers[0].workflowId = 0; }, (c) => { c.reservationTtlMs = 0; }, (c) => { c.maxArtifactTtlMs = 1; },
    (c) => { c.authority = true; }, (c) => { c.producers = Array.from({ length: 17 }, (_, i) => ({ ...c.producers[0], id: `suite-${i}` })); },
  ]) {
    it(`rejects invalid catalog ${corrupt.toString()}`, () => { const changed = config(); corrupt(changed); assert.throws(() => createFenceModel(changed, candidate()), TypeError); });
  }
  it('strict candidate identity cannot omit a definition/runtime/source closure field', () => {
    for (const field of Object.keys(candidate())) { const changed = candidate(); delete changed[field]; assert.throws(() => createFenceModel(config(), changed), TypeError); }
    for (const field of ['headSha', 'definitionDigest', 'runtimeDigest', 'lockDigest', 'toolchainDigest', 'environmentDigest']) { const changed = candidate(); changed[field] = 'unknown'; assert.throws(() => createFenceModel(config(), changed), TypeError); }
  });
  it('receipt must bind the original allowed start path and cannot omit it', () => {
    const source = ready();
    for (const corrupt of [(s) => { delete s.producers.smoke.receipt.startPath; }, (s) => { s.producers.smoke.receipt.startPath = 'unknown-ui-path'; }]) {
      const changed = clone(source); corrupt(changed); assert.equal(inspectFenceModel(changed).validModelState, false);
    }
    assert.equal(source.producers.smoke.receipt.startPath, 'pull_request');
  });
});
