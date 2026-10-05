/**
 * Deterministic, in-memory protocol model. No I/O, persistence, clock, GitHub,
 * coordinator, or production skip function is provided here. The catalog and
 * lifecycle inputs describe a simulated world; they do not attest that world.
 * A digest is a binding/checksum, never a signature or source of authority.
 *
 * Model CAS and a later real reuse action are NOT one atomic effect. In
 * particular, a crash between the two cannot be resolved by this model. Real
 * reuse additionally needs a protected, complete producer catalog and an epoch
 * service covering EVERY UI/manual/rerun/start path, with durable transactions
 * and recovery. That integration needs separate approval; GitHub concurrency
 * alone cannot authorize reuse. Keep full verification running meanwhile.
 */
import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

const MAX = Number.MAX_SAFE_INTEGER;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}$/;
const BLOCKERS = new Set(['unknown-producer', 'unknown-start-path', 'catalog-bypass', 'unknown-event', 'invalid-event', 'unknown-artifact', 'unknown-participant', 'permission-unavailable', 'crashed']);
const BOUNDARY = Object.freeze({
  inMemoryOnly: true,
  simulationInputsOnly: true,
  durable: false,
  actualReuseAtomic: false,
  coordinatorCoverageVerified: false,
  realAuthority: false,
  protectedVerified: false,
  reuseAuthorized: false,
  skip: false,
  runFull: true,
});

function requireThat(ok, message) { if (!ok) throw new TypeError(message); }
function keys(value, expected) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'object required');
  requireThat(Object.keys(value).sort().join('\0') === [...expected].sort().join('\0'), 'unexpected/missing fields');
}
function integer(value, minimum = 1, maximum = MAX) { requireThat(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'bounded safe integer required'); }
function identifier(value) { requireThat(typeof value === 'string' && ID.test(value), 'bounded identifier required'); }
function digest(value) { requireThat(typeof value === 'string' && DIGEST.test(value), 'sha256 digest required'); }
function sha(value) { requireThat(typeof value === 'string' && SHA.test(value), 'Git object SHA required'); }

// Reject accessors, unusual prototypes, holes, cycles and unbounded JSON before
// reading fields. Do not invoke candidate-supplied getters or toJSON methods.
function boundedCopy(input) {
  let count = 0;
  const ancestors = new Set();
  const copy = (value, depth) => {
    requireThat(++count <= 4096 && depth <= 16, 'input too large/deep');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { requireThat(value.length <= 1024, 'string too long'); return value; }
    if (typeof value === 'number') { integer(value, 0); return value; }
    requireThat(typeof value === 'object' && !ancestors.has(value), 'non-JSON/cyclic input');
    requireThat(!utilTypes.isProxy(value), 'proxy input');
    const array = Array.isArray(value);
    requireThat(array ? Object.getPrototypeOf(value) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'non-plain input');
    requireThat(Object.getOwnPropertySymbols(value).length === 0, 'symbol input');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.keys(descriptors);
    if (array) {
      requireThat(value.length <= 32 && names.length === value.length + 1, 'bounded dense array required');
      requireThat(names.every((name) => name === 'length' || /^(0|[1-9][0-9]*)$/.test(name)), 'extra array field');
    } else requireThat(names.length <= 64, 'too many fields');
    ancestors.add(value);
    const output = array ? [] : {};
    for (const name of names.sort()) {
      if (array && name === 'length') continue;
      const descriptor = descriptors[name];
      requireThat('value' in descriptor && descriptor.enumerable && name !== '__proto__', 'accessor/non-enumerable input');
      output[name] = copy(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return output;
  };
  const result = copy(input, 0);
  requireThat(JSON.stringify(result).length <= 128 * 1024, 'input bytes exceeded');
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`; }
function equal(left, right) { return canonical(left) === canonical(right); }
function frozen(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
function validateCandidate(candidate) {
  keys(candidate, ['repositoryId', 'kind', 'id', 'baseSha', 'headSha', 'checkoutSha', 'sourceTree', 'definitionDigest', 'runtimeDigest', 'lockDigest', 'toolchainDigest', 'environmentDigest']);
  integer(candidate.repositoryId);
  requireThat(['pull_request', 'merge_group', 'main'].includes(candidate.kind), 'candidate kind');
  identifier(candidate.id);
  for (const name of ['baseSha', 'headSha', 'checkoutSha', 'sourceTree']) sha(candidate[name]);
  for (const name of ['definitionDigest', 'runtimeDigest', 'lockDigest', 'toolchainDigest', 'environmentDigest']) digest(candidate[name]);
}
function validateConfig(config) {
  keys(config, ['controller', 'producers', 'consumers', 'reservationTtlMs', 'maxArtifactTtlMs']);
  identifier(config.controller);
  requireThat(Array.isArray(config.producers) && config.producers.length >= 1 && config.producers.length <= 16, 'producer catalog bounds');
  const names = new Set([config.controller]);
  for (const producer of config.producers) {
    keys(producer, ['id', 'workflowId', 'suite', 'startPaths']);
    identifier(producer.id); identifier(producer.suite); integer(producer.workflowId);
    requireThat(!names.has(producer.id), 'duplicate participant'); names.add(producer.id);
    requireThat(Array.isArray(producer.startPaths) && producer.startPaths.length >= 1 && producer.startPaths.length <= 8, 'start path bounds');
    producer.startPaths.forEach(identifier);
    requireThat(new Set(producer.startPaths).size === producer.startPaths.length, 'duplicate path');
  }
  requireThat(Array.isArray(config.consumers) && config.consumers.length >= 1 && config.consumers.length <= 8, 'consumer bounds');
  for (const consumer of config.consumers) { identifier(consumer); requireThat(!names.has(consumer), 'duplicate participant'); names.add(consumer); }
  integer(config.reservationTtlMs, 1, 3600000);
  integer(config.maxArtifactTtlMs, config.reservationTtlMs, 86400000);
}
function validateExecution(execution) {
  keys(execution, ['runId', 'runAttempt', 'jobId']);
  for (const value of Object.values(execution)) integer(value);
}
function validateArtifacts(artifacts, now, maxTtl, requireFresh = false) {
  requireThat(Array.isArray(artifacts) && artifacts.length >= 1 && artifacts.length <= 8, 'artifact bounds');
  const ids = new Set();
  for (const artifact of artifacts) {
    keys(artifact, ['id', 'digest', 'expiresAt']); integer(artifact.id); digest(artifact.digest); integer(artifact.expiresAt, 0);
    requireThat(!ids.has(artifact.id), 'duplicate artifact'); ids.add(artifact.id);
    if (requireFresh) requireThat(artifact.expiresAt > now && artifact.expiresAt - now <= maxTtl, 'artifact expiry outside bounds');
  }
}
function bundle(state) {
  return {
    modelCatalog: state.config,
    candidate: state.candidate,
    producers: state.config.producers.map((producer) => ({
      producerId: producer.id, workflowId: producer.workflowId, suite: producer.suite,
      receipt: state.producers[producer.id].receipt,
    })),
  };
}
function blockers(state, now = state.now) {
  const reasons = [...state.blocked];
  if (state.generation === MAX || state.epoch === MAX) reasons.push('counter-exhausted');
  if (state.consumed) reasons.push('already-consumed');
  for (const { id } of state.config.producers) {
    const producer = state.producers[id];
    if (producer.active) reasons.push(`active:${id}`);
    if (!producer.receipt) reasons.push(`missing:${id}`);
    else if (producer.receipt.artifacts.some((artifact) => artifact.expiresAt <= now)) reasons.push(`expired:${id}`);
  }
  return reasons;
}
function validateState(state) {
  keys(state, ['schemaVersion', 'config', 'candidate', 'epoch', 'generation', 'now', 'producers', 'reservation', 'consumed', 'blocked']);
  requireThat(state.schemaVersion === 1, 'state version'); validateConfig(state.config); validateCandidate(state.candidate);
  integer(state.epoch); integer(state.generation, state.epoch); integer(state.now, 0);
  requireThat(Array.isArray(state.blocked) && new Set(state.blocked).size === state.blocked.length && state.blocked.every((reason) => BLOCKERS.has(reason)), 'blocker schema');
  keys(state.producers, state.config.producers.map(({ id }) => id));
  const candidateDigest = hash(state.candidate);
  const artifactIds = new Set();
  for (const [producerId, record] of Object.entries(state.producers)) {
    keys(record, ['lastExecution', 'active', 'receipt']);
    if (record.lastExecution !== null) validateExecution(record.lastExecution);
    requireThat(!(record.active && record.receipt), 'active receipt impossible');
    if (record.active !== null) {
      keys(record.active, ['execution', 'startPath', 'candidateDigest', 'startedAt']);
      validateExecution(record.active.execution); identifier(record.active.startPath); digest(record.active.candidateDigest); integer(record.active.startedAt, 0, state.now);
      requireThat(state.config.producers.find(({ id }) => id === producerId).startPaths.includes(record.active.startPath), 'unlisted active start path');
      requireThat(equal(record.active.execution, record.lastExecution) && record.active.candidateDigest === candidateDigest, 'active invocation/input mismatch');
    }
    if (record.receipt !== null) {
      keys(record.receipt, ['execution', 'startPath', 'epoch', 'candidateDigest', 'artifacts', 'completedAt']);
      validateExecution(record.receipt.execution); integer(record.receipt.completedAt, 0, state.now);
      requireThat(state.config.producers.find(({ id }) => id === producerId).startPaths.includes(record.receipt.startPath), 'unlisted receipt start path');
      requireThat(record.receipt.epoch === state.epoch && record.receipt.candidateDigest === candidateDigest && equal(record.receipt.execution, record.lastExecution), 'receipt binding mismatch');
      validateArtifacts(record.receipt.artifacts, state.now, state.config.maxArtifactTtlMs);
      requireThat(record.receipt.artifacts.every(({ expiresAt }) => expiresAt > record.receipt.completedAt && expiresAt - record.receipt.completedAt <= state.config.maxArtifactTtlMs), 'receipt artifact lifetime');
      for (const artifact of record.receipt.artifacts) { requireThat(!artifactIds.has(artifact.id), 'cross-producer artifact collision'); artifactIds.add(artifact.id); }
    }
  }
  if (state.reservation !== null) {
    const reservation = state.reservation;
    keys(reservation, ['id', 'consumerId', 'epoch', 'generation', 'evidenceDigest', 'expiresAt']);
    digest(reservation.id); digest(reservation.evidenceDigest); identifier(reservation.consumerId); integer(reservation.expiresAt, 0);
    requireThat(state.config.consumers.includes(reservation.consumerId) && reservation.epoch === state.epoch && reservation.generation === state.generation && !state.consumed, 'reservation binding mismatch');
    requireThat(reservation.evidenceDigest === hash(bundle(state)), 'reservation evidence mismatch');
    requireThat(reservation.id === hash({ ...reservation, id: null }), 'reservation ID mismatch');
  }
  if (state.consumed !== null) {
    const consumed = state.consumed;
    keys(consumed, ['reservationId', 'consumerId', 'epoch', 'generation', 'evidenceDigest', 'committedAt']);
    digest(consumed.reservationId); digest(consumed.evidenceDigest); integer(consumed.committedAt, 0, state.now);
    integer(consumed.generation); integer(consumed.epoch);
    requireThat(state.config.consumers.includes(consumed.consumerId) && consumed.epoch === state.epoch && consumed.generation <= state.generation && consumed.generation >= state.epoch && !state.reservation, 'consumed binding mismatch');
    requireThat(consumed.evidenceDigest === hash(bundle(state)), 'consumed evidence mismatch');
  }
}

/** Model config is fixed for this state's lifetime; it is not protected policy. */
export function createFenceModel(configInput, candidateInput, now = 0) {
  const config = boundedCopy(configInput); const candidate = boundedCopy(candidateInput);
  validateConfig(config); validateCandidate(candidate); integer(now, 0);
  const producers = Object.fromEntries(config.producers.map(({ id }) => [id, { lastExecution: null, active: null, receipt: null }]));
  return frozen({ schemaVersion: 1, config, candidate, epoch: 1, generation: 1, now, producers, reservation: null, consumed: null, blocked: [] });
}

/** Inspect simulated readiness and binding for constructing a model CAS event. */
export function inspectFenceModel(input) {
  try {
    const state = boundedCopy(input); validateState(state);
    const reasons = blockers(state);
    return frozen({ ...BOUNDARY, validModelState: true, modelReady: reasons.length === 0, reasons, epoch: state.epoch, generation: state.generation, candidateDigest: hash(state.candidate), evidenceDigest: hash(bundle(state)), reservation: state.reservation });
  } catch { return frozen({ ...BOUNDARY, validModelState: false, modelReady: false, reasons: ['invalid-state'] }); }
}

function response(state, accepted, reason, modelConsumeSucceeded = false) {
  return frozen({ ...BOUNDARY, state, accepted, reason, modelConsumeSucceeded });
}
function invalidate(state, blocker = null, clearActive = false) {
  requireThat(state.generation < MAX && state.epoch < MAX, 'counter exhausted');
  state.generation++; state.epoch++;
  state.reservation = null; state.consumed = null;
  for (const record of Object.values(state.producers)) { record.receipt = null; if (clearActive) record.active = null; }
  if (blocker && !state.blocked.includes(blocker)) state.blocked.push(blocker);
}
function mutate(state) { requireThat(state.generation < MAX, 'counter exhausted'); state.generation++; state.reservation = null; }
function rejectInvalid(state, reason) {
  invalidate(state, reason, true);
  return response(state, false, reason);
}
const EVENT_FIELDS = {
  'producer-start': ['producerId', 'startPath', 'execution'],
  'producer-rerun': ['producerId', 'startPath', 'execution'],
  'producer-terminal': ['producerId', 'execution', 'conclusion', 'artifacts'],
  'producer-cancel': ['producerId', 'execution'],
  'candidate-change': ['actor', 'candidate'],
  'artifact-invalidate': ['actor', 'artifactId'],
  'permission-loss': ['actor'], crash: ['actor'], recover: ['actor'], bypass: ['actor'], tick: ['actor'],
  reserve: ['consumerId', 'expectedEpoch', 'expectedGeneration', 'identityDigest'],
  'consume-cas': ['consumerId', 'expectedEpoch', 'expectedGeneration', 'identityDigest', 'reservationId'],
};

/**
 * Each input is an untrusted model event, NOT an API attestation. Valid starts
 * increment epoch before work; all catalog producers must be started before
 * terminal receipts are completed in a common epoch. A known start can leave
 * other running invocations alive only while their full candidate is identical.
 * Terminal events derive completeness, so caller complete/authority booleans
 * are never accepted. Returned state is immutable; caller must serialize CAS
 * operations against the latest state. No real store does so on its behalf.
 */
export function applyFenceModelEvent(input, eventInput) {
  let state;
  try { state = boundedCopy(input); validateState(state); }
  catch { return response(null, false, 'invalid-state'); }
  if (state.generation === MAX || state.epoch === MAX) return response(state, false, 'counter-exhausted');
  let event;
  try {
    event = boundedCopy(eventInput);
    requireThat(event && typeof event.type === 'string', 'event type');
    if (!Object.hasOwn(EVENT_FIELDS, event.type)) return rejectInvalid(state, 'unknown-event');
    keys(event, ['type', 'now', ...EVENT_FIELDS[event.type]]); integer(event.now, 0);
  } catch { return rejectInvalid(state, 'invalid-event'); }
  if (event.now < state.now) { invalidate(state, null, true); return response(state, false, 'clock-regression'); }
  const previousNow = state.now;
  state.now = event.now;
  // A failed CAS does not advance the model's clock or revision. Its caller may
  // retry using the latest snapshot; it cannot keep an expired lease alive.
  const rejectCas = (reason) => { state.now = previousNow; return response(state, false, reason); };
  try {
    if (event.type.startsWith('producer-')) {
      identifier(event.producerId); validateExecution(event.execution);
      const definition = state.config.producers.find(({ id }) => id === event.producerId);
      if (!definition) return rejectInvalid(state, 'unknown-producer');
      const record = state.producers[event.producerId];
      if (['producer-start', 'producer-rerun'].includes(event.type)) {
        identifier(event.startPath);
        if (!definition.startPaths.includes(event.startPath)) return rejectInvalid(state, 'unknown-start-path');
        const last = record.lastExecution;
        const fresh = event.type === 'producer-rerun'
          ? last && event.execution.runId === last.runId && event.execution.runAttempt > last.runAttempt && event.execution.jobId !== last.jobId
          : !last || event.execution.runId > last.runId;
        invalidate(state);
        if (!fresh) { record.active = null; return response(state, false, 'stale-producer-invocation'); }
        record.lastExecution = event.execution;
        record.active = { execution: event.execution, startPath: event.startPath, candidateDigest: hash(state.candidate), startedAt: state.now };
        return response(state, true, 'producer-started');
      }
      if (!record.active || !equal(record.active.execution, event.execution)) {
        invalidate(state, null, true);
        return response(state, false, 'unmatched-producer-invocation');
      }
      if (event.type === 'producer-cancel') {
        record.active = null; invalidate(state);
        return response(state, true, 'producer-cancelled');
      }
      requireThat(['success', 'failure', 'cancelled', 'timed_out', 'unknown'].includes(event.conclusion), 'terminal conclusion');
      if (event.conclusion !== 'success') {
        requireThat(Array.isArray(event.artifacts) && event.artifacts.length === 0, 'non-success artifacts');
        record.active = null; invalidate(state);
        return response(state, true, `producer-${event.conclusion}`);
      }
      validateArtifacts(event.artifacts, state.now, state.config.maxArtifactTtlMs, true);
      const otherIds = new Set(Object.values(state.producers).flatMap(({ receipt }) => receipt?.artifacts.map(({ id }) => id) ?? []));
      requireThat(event.artifacts.every(({ id }) => !otherIds.has(id)), 'artifact collision');
      const startPath = record.active.startPath;
      mutate(state); record.active = null;
      record.receipt = { execution: event.execution, startPath, epoch: state.epoch, candidateDigest: hash(state.candidate), artifacts: event.artifacts, completedAt: state.now };
      return response(state, true, 'producer-receipt-modeled');
    }
    if (['reserve', 'consume-cas'].includes(event.type)) {
      identifier(event.consumerId); integer(event.expectedEpoch); integer(event.expectedGeneration); digest(event.identityDigest);
      if (!state.config.consumers.includes(event.consumerId)) return rejectInvalid(state, 'unknown-participant');
      if (event.type === 'consume-cas') digest(event.reservationId);
      if (event.expectedEpoch !== state.epoch || event.expectedGeneration !== state.generation) return rejectCas('stale-cas');
      if (state.consumed) return rejectCas('already-consumed');
      const reasons = blockers(state);
      if (reasons.some((reason) => reason.startsWith('expired:'))) { invalidate(state); return response(state, false, 'artifact-expired'); }
      if (reasons.length) return rejectCas('model-not-ready');
      if (event.identityDigest !== hash(bundle(state))) return rejectCas('identity-mismatch');
      if (event.type === 'reserve') {
        if (state.reservation) return rejectCas('reservation-exists');
        requireThat(state.now <= MAX - state.config.reservationTtlMs, 'lease overflow');
        mutate(state);
        const reservation = { id: null, consumerId: event.consumerId, epoch: state.epoch, generation: state.generation, evidenceDigest: event.identityDigest, expiresAt: Math.min(state.now + state.config.reservationTtlMs, ...Object.values(state.producers).flatMap(({ receipt }) => receipt.artifacts.map(({ expiresAt }) => expiresAt))) };
        reservation.id = hash(reservation); state.reservation = reservation;
        return response(state, true, 'model-reserved');
      }
      const reservation = state.reservation;
      if (!reservation || reservation.id !== event.reservationId || reservation.consumerId !== event.consumerId) return rejectCas('reservation-mismatch');
      if (reservation.expiresAt <= state.now) { invalidate(state); return response(state, false, 'reservation-expired'); }
      mutate(state);
      state.consumed = { reservationId: reservation.id, consumerId: reservation.consumerId, epoch: state.epoch, generation: state.generation, evidenceDigest: reservation.evidenceDigest, committedAt: state.now };
      return response(state, true, 'model-cas-committed', true);
    }
    identifier(event.actor);
    if (event.actor !== state.config.controller) return rejectInvalid(state, 'unknown-participant');
    if (event.type === 'candidate-change') {
      validateCandidate(event.candidate); invalidate(state, null, true); state.candidate = event.candidate;
      return response(state, true, 'candidate-changed');
    }
    if (event.type === 'artifact-invalidate') {
      integer(event.artifactId);
      const known = Object.values(state.producers).some(({ receipt }) => receipt?.artifacts.some(({ id }) => id === event.artifactId));
      invalidate(state, known ? null : 'unknown-artifact', true);
      return response(state, known, known ? 'artifact-invalidated' : 'unknown-artifact');
    }
    if (event.type === 'recover') {
      invalidate(state, null, true);
      state.blocked = state.blocked.filter((reason) => !['permission-unavailable', 'crashed'].includes(reason));
      return response(state, true, 'model-recovered-needs-fresh-producers');
    }
    if (event.type === 'tick') {
      if (blockers(state).some((reason) => reason.startsWith('expired:')) || state.reservation?.expiresAt <= state.now) invalidate(state);
      else mutate(state);
      return response(state, true, 'model-clock-advanced');
    }
    const blocker = { 'permission-loss': 'permission-unavailable', crash: 'crashed', bypass: 'catalog-bypass' }[event.type];
    invalidate(state, blocker, true);
    return response(state, true, blocker);
  } catch { return rejectInvalid(state, 'invalid-event'); }
}
