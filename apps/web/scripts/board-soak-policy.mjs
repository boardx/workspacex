import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
const hash = value => createHash('sha256').update(value).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const time = value => Date.parse(value);
/** Signed synthetic fixtures test this validator; only the browser producer supplies acceptance. */
export async function validateBoardSoakArtifact(report, sha, key = process.env.BOARD_ACCEPTANCE_LEDGER_KEY) {
  const failures = [];
  try {
    if (!key || key.length < 32) throw new Error('LEDGER_KEY_REQUIRED');
    if (report?.version !== 1 || report.kind !== 'board-collaboration-soak') throw new Error('SOAK_REPORT_SCHEMA');
    const artifacts = {};
    for (const name of ['ledger', 'runtime']) {
      const ref = report[name];
      if (!ref?.path || !hex.test(ref.sha256 ?? '')) throw new Error(`SOAK_${name}_REFERENCE`);
      const bytes = await readFile(ref.path);
      if (hash(bytes) !== ref.sha256) throw new Error(`SOAK_${name}_HASH`);
      artifacts[name] = JSON.parse(bytes.toString());
    }
    const {ledger, runtime} = artifacts;
    const {verifyBoardSoakLedger, BOARD_SOAK_REQUIREMENTS: policy} = await tsImport(new URL('../../api/scripts/board-acceptance-ledger.ts', import.meta.url).href, import.meta.url);
    if (!verifyBoardSoakLedger(ledger, key) || ledger.sha !== sha || ledger.buildSha !== sha) failures.push('SOAK_SIGNED_LEDGER');
    const identities = [runtime.runtimeBefore, runtime.runtimeAfter, report.runtimeIdentity];
    for (const identity of identities) {
      if (!identity || identity.sha !== sha || identity.buildSha !== sha || identity.dirty !== false
        || identity.method !== 'fresh-server-marker-and-built-chunk-hashes' || !identity.deploymentMarker || !identity.buildId
        || !identity.chunks?.length || identity.chunks.some(chunk => !hex.test(chunk.sha256 ?? '') || chunk.sha256 !== chunk.localSha256 || !chunk.url)
        || !Number.isFinite(time(identity.runStartedAt)) || !Number.isFinite(time(identity.buildCreatedAt))
        || time(identity.buildCreatedAt) < time(identity.runStartedAt) || time(identity.buildCreatedAt) > time(ledger.startedAt)) failures.push('SOAK_RUNTIME_IDENTITY');
    }
    if (identities.some(identity => identity?.deploymentMarker !== identities[0]?.deploymentMarker || identity?.buildId !== identities[0]?.buildId)
      || JSON.stringify(report.runtimeIdentity) !== JSON.stringify(runtime.runtimeAfter)) failures.push('SOAK_RUNTIME_CHANGED');
    if (!Number.isFinite(runtime.elapsedMonotonicMs) || runtime.elapsedMonotonicMs < policy.durationMs
      || Math.abs(runtime.elapsedMonotonicMs - ledger.durationMs) > 2000) failures.push('SOAK_WALL_MONOTONIC_DURATION');
    const actors = runtime.identities ?? [], byId = new Map(actors.map(actor => [actor.userId, actor.role]));
    if (actors.length !== policy.clients || byId.size !== policy.clients || actors.some(actor => !actor.userId || !['owner','editor','viewer'].includes(actor.role))
      || actors.filter(actor => actor.role === 'owner').length !== 1 || actors.filter(actor => actor.role !== 'viewer').length !== policy.writers) failures.push('SOAK_DISTINCT_IDENTITIES');
    if (ledger.samples.some(sample => !byId.has(sample.clientId) || sample.writer !== (byId.get(sample.clientId) !== 'viewer'))) failures.push('SOAK_CLIENT_ROLE');
    const raw = runtime.acknowledgementTimings ?? [], ackById = new Map(raw.map(ack => [ack.operationId, ack]));
    if (raw.length !== ledger.acknowledgements.length || ackById.size !== raw.length) failures.push('SOAK_RAW_ACK_COUNT');
    for (const ack of ledger.acknowledgements) {
      const actual = ackById.get(ack.operationId);
      if (!actual || ['actorId','revision','sentAt','acknowledgedAt'].some(field => actual[field] !== ack[field])
        || !Number.isFinite(actual.sentMonotonicMs) || !Number.isFinite(actual.acknowledgedMonotonicMs)
        || actual.acknowledgedMonotonicMs < actual.sentMonotonicMs) {failures.push('SOAK_RAW_ACK_MISMATCH'); break;}
    }
    const projections = runtime.projectionEvidence ?? [], projectionByKey = new Map(projections.map(entry => [`${entry.clientId}:${entry.at}`, entry]));
    const groups = new Map();
    if (projections.length !== ledger.samples.length || projectionByKey.size !== projections.length) failures.push('SOAK_PROJECTION_COUNT');
    for (const sample of ledger.samples) {
      const projection = projectionByKey.get(`${sample.clientId}:${sample.at}`);
      if (!projection || projection.revision !== sample.revision || !hex.test(projection.projectionHash ?? '')
        || !Number.isFinite(time(projection.observedAt)) || time(projection.observedAt) > time(sample.at)
        || time(projection.observedAt) < time(ledger.startedAt)) {failures.push('SOAK_PROJECTION_MISMATCH'); break;}
      const group = groups.get(sample.revision) ?? []; group.push({sample, projection}); groups.set(sample.revision, group);
    }
    if (runtime.round !== groups.size || !Number.isInteger(runtime.round)) failures.push('SOAK_ROUND_COUNT');
    for (const group of groups.values()) if (group.length !== policy.clients || new Set(group.map(item => item.sample.clientId)).size !== policy.clients
      || new Set(group.map(item => item.projection.projectionHash)).size !== 1) {failures.push('SOAK_PEER_PROJECTION_DIVERGENCE'); break;}
    let previousRevision = Math.min(...ledger.acknowledgements.map(ack => ack.revision)) - 1;
    for (const [revision, group] of [...groups].sort(([a], [b]) => a-b)) {
      const roundAcks = ledger.acknowledgements.filter(ack => ack.revision > previousRevision && ack.revision <= revision);
      const firstSend = Math.min(...roundAcks.map(ack => time(ack.sentAt)));
      if (new Set(roundAcks.map(ack => ack.actorId)).size !== policy.writers
        || group.some(({sample, projection}) => Math.abs(sample.latencyMs - Math.max(0, time(projection.observedAt) - firstSend)) > 1)) failures.push('SOAK_MEASURED_CONVERGENCE');
      previousRevision = revision;
    }
    const recoveries = runtime.recoveries ?? [], events = runtime.transport ?? [];
    const inWindow = event => time(event.at) >= time(ledger.startedAt) && time(event.at) <= time(ledger.finishedAt);
    const disconnects = events.filter(event => event.type === 'disconnect' && inWindow(event));
    if (recoveries.length !== 3 || new Set(recoveries.map(item => item.clientId)).size !== 3 || disconnects.length !== 3
      || events.some(event => event.type === 'error' && inWindow(event))) failures.push('SOAK_RECOVERY_COUNT');
    for (const recovery of recoveries) {
      if (byId.get(recovery.clientId) !== 'viewer' || !(time(recovery.disconnectedAt) >= time(ledger.startedAt))
        || !(time(recovery.reconnectedAt) > time(recovery.disconnectedAt)) || !(time(recovery.reconnectedAt) <= time(ledger.finishedAt))
        || !(recovery.afterRevision > recovery.beforeRevision)
        || !ledger.samples.some(sample => sample.clientId === recovery.clientId && sample.revision >= recovery.afterRevision && time(sample.at) >= time(recovery.reconnectedAt) && time(sample.at) - time(recovery.reconnectedAt) <= policy.maxSampleGapMs)
        || !disconnects.some(event => event.clientId === recovery.clientId && time(event.at) >= time(recovery.disconnectedAt) && time(event.at) <= time(recovery.reconnectedAt))
        || !events.some(event => event.type === 'sync' && event.clientId === recovery.clientId && event.revision >= recovery.afterRevision
          && time(event.at) >= time(recovery.disconnectedAt) && time(event.at) <= time(recovery.reconnectedAt))) failures.push('SOAK_RECOVERY_EVIDENCE');
    }
  } catch (error) { failures.push(error instanceof Error ? error.message : 'SOAK_ARTIFACT_INVALID'); }
  return {valid: failures.length === 0, failures, score: null, budgetStatus: 'engineering-targets'};
}
