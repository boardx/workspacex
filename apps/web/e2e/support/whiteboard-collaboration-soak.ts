import { createHash, verify } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { WhiteboardObject } from '@repo/whiteboard-core';
import { WhiteboardSoakLedgerPayload, type WhiteboardSoakLedgerPayload as WhiteboardSoakLedgerPayloadType } from '@repo/contracts/whiteboard-sync';

export const ACCEPTANCE_SOAK = {
  clients: 50, writers: 20, durationMs: 30 * 60 * 1000, offlineMs: 30 * 1000,
  reconnectMs: 5 * 1000, remoteP95Ms: 300,
} as const;
export const SOAK_COVERAGE = { maxGlobalOperationGapMs: 10 * 1000 } as const;

export type SoakConfig = {
  clients: number; writers: number; durationMs: number; offlineMs: number;
  reconnectMs: number; remoteP95Ms: number; operationIntervalMs: number;
  profile: 'acceptance' | 'diagnostic';
};
export type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };
export type CanonicalWhiteboardObject = { [key: string]: CanonicalJson };
export type SoakParticipant = { client: string; connectionId: string; role: 'owner' | 'editor' | 'viewer'; writer: boolean };
export type SoakReceipt = { client: string; connectionId: string; role: SoakParticipant['role']; visibleAtMs: number };
export type SoakOperation = { id: string; writer: string; writerConnectionId: string; createdAtMs: number; disruption: boolean; receipts: SoakReceipt[] };
export type SoakClientResult = { client: string; connectionId: string; role: SoakParticipant['role']; seq:number;hash: string; document: CanonicalWhiteboardObject[] };
export type SoakReconnect = { client: string; previousConnectionId: string; connectionId: string; offlineAtMs: number; onlineAtMs: number; recoveredAtMs: number | null; elapsedMs: number; recovered: boolean };
export type SoakServerLedger = { payload: WhiteboardSoakLedgerPayloadType; signature: string };
export type LatencySummary = { samples: number; p50: number | null; p95: number | null; p99: number | null };
export type SoakAnalysis = {
  missing: string[]; duplicates: string[]; unexpected: string[];
  forkGroups: Array<{ hash: string; clients: string[] }>;
  propagationMissing: string[]; propagationDuplicates: string[];
  wallClockDurationMs: number | null;
  remoteLatencyMs: LatencySummary; perClientLatencyMs: Record<string, LatencySummary>;
  reconnectFailures: SoakReconnect[]; evidenceFailures: string[]; accepted: boolean;
};
export type SoakReport = {
  schemaVersion: 3; issue: 4144; status: 'accepted' | 'diagnostic-passed' | 'failed'; runId:string; exactSha: string;
  startedAt: string; finishedAt: string; collaborationStartedAt: string | null; collaborationFinishedAt: string | null; collaborationDurationMs: number;
  environment: { os: string; node: string; browser: string; ci: boolean };
  config: SoakConfig; initialClients: SoakParticipant[]; operations: SoakOperation[]; clients: SoakClientResult[];
  freshClient: SoakClientResult | null; server: SoakClientResult | null;
  reconnects: SoakReconnect[]; serverLedger: SoakServerLedger | null; analysis: SoakAnalysis; failure: string | null;
};

const LatencySummarySchema = z.object({ samples: z.number().int().nonnegative(), p50: z.number().nonnegative().nullable(), p95: z.number().nonnegative().nullable(), p99: z.number().nonnegative().nullable() }).strict();
const SoakConfigSchema = z.object({ clients: z.number().int().positive(), writers: z.number().int().positive(), durationMs: z.number().int().positive(), offlineMs: z.number().int().positive(), reconnectMs: z.number().int().positive(), remoteP95Ms: z.number().int().positive(), operationIntervalMs: z.number().int().positive(), profile: z.enum(['acceptance', 'diagnostic']) }).strict();
const ConnectionIdSchema = z.string().uuid();
const ClientRoleSchema = z.enum(['owner', 'editor', 'viewer']);
const SoakParticipantSchema = z.object({ client: z.string().uuid(), connectionId: ConnectionIdSchema, role: ClientRoleSchema, writer: z.boolean() }).strict();
const SoakReceiptSchema = z.object({ client: z.string().uuid(), connectionId: ConnectionIdSchema, role: ClientRoleSchema, visibleAtMs: z.number().int().nonnegative() }).strict();
const SoakOperationSchema = z.object({ id: z.string().min(1), writer: z.string().uuid(), writerConnectionId: ConnectionIdSchema, createdAtMs: z.number().int().nonnegative(), disruption: z.boolean(), receipts: z.array(SoakReceiptSchema) }).strict();
const CanonicalDocumentSchema = z.array(z.record(z.unknown()));
const SoakClientResultSchema = z.object({ client: z.string().uuid(), connectionId: ConnectionIdSchema, role: ClientRoleSchema,seq:z.number().int().nonnegative(),hash: z.string().regex(/^[a-f0-9]{64}$/), document: CanonicalDocumentSchema }).strict();
const SoakReconnectSchema = z.object({ client: z.string().uuid(), previousConnectionId: ConnectionIdSchema, connectionId: ConnectionIdSchema, offlineAtMs: z.number().int().nonnegative(), onlineAtMs: z.number().int().nonnegative(), recoveredAtMs: z.number().int().nonnegative().nullable(), elapsedMs: z.number().int().nonnegative(), recovered: z.boolean() }).strict();
const SoakServerLedgerSchema = z.object({ payload: WhiteboardSoakLedgerPayload, signature: z.string().min(1) }).strict();
const SoakAnalysisSchema = z.object({ missing: z.array(z.string()), duplicates: z.array(z.string()), unexpected: z.array(z.string()), forkGroups: z.array(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), clients: z.array(z.string().min(1)) }).strict()), propagationMissing: z.array(z.string()), propagationDuplicates: z.array(z.string()), wallClockDurationMs: z.number().int().nonnegative().nullable(), remoteLatencyMs: LatencySummarySchema, perClientLatencyMs: z.record(LatencySummarySchema), reconnectFailures: z.array(SoakReconnectSchema), evidenceFailures: z.array(z.string()), accepted: z.boolean() }).strict();
export const SoakReportSchema = z.object({ schemaVersion: z.literal(3), issue: z.literal(4144), status: z.enum(['accepted', 'diagnostic-passed', 'failed']), runId:z.string().uuid(),exactSha: z.string().regex(/^[a-f0-9]{40}$/), startedAt: z.string().datetime(), finishedAt: z.string().datetime(), collaborationStartedAt: z.string().datetime().nullable(), collaborationFinishedAt: z.string().datetime().nullable(), collaborationDurationMs: z.number().int().nonnegative(), environment: z.object({ os: z.string().min(1), node: z.string().min(1), browser: z.string().min(1), ci: z.boolean() }).strict(), config: SoakConfigSchema, initialClients: z.array(SoakParticipantSchema), operations: z.array(SoakOperationSchema), clients: z.array(SoakClientResultSchema), freshClient: SoakClientResultSchema.nullable(), server: SoakClientResultSchema.nullable(), reconnects: z.array(SoakReconnectSchema), serverLedger: SoakServerLedgerSchema.nullable(), analysis: SoakAnalysisSchema, failure: z.string().nullable() }).strict();

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
export function readSoakConfig(env: Readonly<Record<string, string | undefined>> = process.env): SoakConfig {
  const profile = env.WHITEBOARD_SOAK_PROFILE === 'diagnostic' ? 'diagnostic' : 'acceptance';
  const config: SoakConfig = {
    clients: positiveInteger(env.WHITEBOARD_SOAK_CLIENTS, ACCEPTANCE_SOAK.clients, 'WHITEBOARD_SOAK_CLIENTS'),
    writers: positiveInteger(env.WHITEBOARD_SOAK_WRITERS, ACCEPTANCE_SOAK.writers, 'WHITEBOARD_SOAK_WRITERS'),
    durationMs: positiveInteger(env.WHITEBOARD_SOAK_DURATION_MS, ACCEPTANCE_SOAK.durationMs, 'WHITEBOARD_SOAK_DURATION_MS'),
    offlineMs: positiveInteger(env.WHITEBOARD_SOAK_OFFLINE_MS, ACCEPTANCE_SOAK.offlineMs, 'WHITEBOARD_SOAK_OFFLINE_MS'),
    reconnectMs: positiveInteger(env.WHITEBOARD_SOAK_RECONNECT_MS, ACCEPTANCE_SOAK.reconnectMs, 'WHITEBOARD_SOAK_RECONNECT_MS'),
    remoteP95Ms: positiveInteger(env.WHITEBOARD_SOAK_REMOTE_P95_MS, ACCEPTANCE_SOAK.remoteP95Ms, 'WHITEBOARD_SOAK_REMOTE_P95_MS'),
    operationIntervalMs: positiveInteger(env.WHITEBOARD_SOAK_OPERATION_INTERVAL_MS, 2000, 'WHITEBOARD_SOAK_OPERATION_INTERVAL_MS'), profile,
  };
  if (config.writers >= config.clients) throw new Error('WHITEBOARD_SOAK_WRITERS must leave at least one observer client');
  if (profile === 'acceptance' && !isAcceptanceConfig(config)) throw new Error('acceptance profile cannot lower the 50-client/20-writer/30-minute/30-second/5-second/300ms contract');
  return config;
}
export function isAcceptanceConfig(config: SoakConfig): boolean {
  return config.clients === ACCEPTANCE_SOAK.clients && config.writers >= ACCEPTANCE_SOAK.writers
    && config.durationMs >= ACCEPTANCE_SOAK.durationMs && config.offlineMs >= ACCEPTANCE_SOAK.offlineMs
    && config.reconnectMs <= ACCEPTANCE_SOAK.reconnectMs && config.remoteP95Ms <= ACCEPTANCE_SOAK.remoteP95Ms;
}

function canonicalJson(value: unknown): CanonicalJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical whiteboard document contains a non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalJson(item)]));
  throw new Error(`canonical whiteboard document contains unsupported ${typeof value}`);
}
function normalizeDocument(objects: readonly unknown[]): CanonicalWhiteboardObject[] {
  return objects.map(object => canonicalJson(object) as CanonicalWhiteboardObject).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
export function canonicalizeDocument(objects: readonly WhiteboardObject[]): CanonicalWhiteboardObject[] {
  return normalizeDocument(objects);
}
export function documentHash(document: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(normalizeDocument(document))).digest('hex');
}
export function soakEnvironmentFingerprint(environment: SoakReport['environment']): string {
  return createHash('sha256').update(JSON.stringify(environment)).digest('hex');
}
export function verifySoakLedgerSignature(report: SoakReport, publicKey = process.env.WHITEBOARD_SOAK_LEDGER_PUBLIC_KEY): void {
  if (!report.serverLedger) throw new Error('server-signed soak ledger is missing');
  if (!publicKey) throw new Error('WHITEBOARD_SOAK_LEDGER_PUBLIC_KEY is required');
  if (!verify(null, Buffer.from(JSON.stringify(report.serverLedger.payload)), publicKey, Buffer.from(report.serverLedger.signature, 'base64'))) throw new Error('server-signed soak ledger signature is invalid');
}
function canonicalStrings(values: readonly string[]): string[] { return [...values].sort((a, b) => a.localeCompare(b)); }
function sameIdentitySet(left: readonly string[], right: readonly string[]): boolean {
  const expected = new Set(left); return expected.size === left.length && right.length === left.length && right.every(value => expected.has(value));
}
function operationIds(result: SoakClientResult): string[] {
  return result.document.map(item => item.text).filter((value): value is string => typeof value === 'string' && value.startsWith('soak-4144:'));
}
function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}
function latencySummary(values: readonly number[]): LatencySummary {
  return { samples: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) };
}

export function analyzeSoak(input: Pick<SoakReport, 'runId'|'exactSha' | 'environment' | 'startedAt' | 'finishedAt' | 'collaborationStartedAt' | 'collaborationFinishedAt' | 'collaborationDurationMs' | 'initialClients' | 'operations' | 'clients' | 'freshClient' | 'server' | 'reconnects' | 'serverLedger' | 'config'>): SoakAnalysis {
  const expectedIds = input.operations.map(operation => operation.id), expected = new Set(expectedIds);
  const all = [...input.clients, ...(input.freshClient ? [input.freshClient] : []), ...(input.server ? [input.server] : [])];
  const evidenceFailures: string[] = [];
  const runStartedMs = Date.parse(input.startedAt), reportFinishedMs = Date.parse(input.finishedAt);
  const collaborationStartedMs = input.collaborationStartedAt ? Date.parse(input.collaborationStartedAt) : Number.NaN;
  const collaborationFinishedMs = input.collaborationFinishedAt ? Date.parse(input.collaborationFinishedAt) : Number.NaN;
  const wallClockDurationMs = collaborationFinishedMs - collaborationStartedMs;
  if (!Number.isFinite(collaborationStartedMs) || !Number.isFinite(collaborationFinishedMs)) evidenceFailures.push('collaboration timestamps are missing or invalid');
  else {
    if (collaborationStartedMs < runStartedMs || collaborationFinishedMs < collaborationStartedMs || reportFinishedMs < collaborationFinishedMs) evidenceFailures.push('collaboration timestamps are outside the report window');
    if (wallClockDurationMs < input.config.durationMs) evidenceFailures.push(`collaboration wall-clock duration is below ${input.config.durationMs}ms`);
    if (Math.abs(input.collaborationDurationMs - wallClockDurationMs) > 1000) evidenceFailures.push('claimed collaboration duration does not match timestamps');
  }
  const manifestNames = input.initialClients.map(item => item.client), manifestSet = new Set(manifestNames);
  const manifestByClient = new Map(input.initialClients.map(item => [item.client, item]));
  const manifestWriters = input.initialClients.filter(item => item.writer).map(item => item.client), writerSet = new Set(manifestWriters);
  const reconnectByClient = new Map(input.reconnects.map(item => [item.client, item]));
  const initialConnectionIds = input.initialClients.map(item => item.connectionId), initialConnectionSet = new Set(initialConnectionIds);
  const connectionAt = (client: string, timestamp: number): string | undefined => {
    const manifest = manifestByClient.get(client), reconnect = reconnectByClient.get(client);
    return reconnect?.recoveredAtMs !== null && reconnect?.recoveredAtMs !== undefined && timestamp >= reconnect.recoveredAtMs ? reconnect.connectionId : manifest?.connectionId;
  };
  if (input.initialClients.length !== input.config.clients) evidenceFailures.push(`expected ${input.config.clients} manifest clients, got ${input.initialClients.length}`);
  if (manifestSet.size !== manifestNames.length) evidenceFailures.push('initial client manifest IDs are not unique');
  if (initialConnectionSet.size !== initialConnectionIds.length) evidenceFailures.push('initial server connection IDs are not unique');
  if (input.initialClients.some(item => item.writer !== (item.role !== 'viewer'))) evidenceFailures.push('initial client manifest role and writer flag disagree');
  if (manifestWriters.length !== input.config.writers) evidenceFailures.push(`expected ${input.config.writers} manifest writers, got ${manifestWriters.length}`);
  if (!input.operations.length) evidenceFailures.push('operation ledger is empty');
  if (input.clients.length !== input.config.clients) evidenceFailures.push(`expected ${input.config.clients} browser clients, got ${input.clients.length}`);
  if (!sameIdentitySet(manifestNames, input.clients.map(item => item.client))) evidenceFailures.push('browser evidence identity set does not match the initial manifest');
  if (!input.freshClient) evidenceFailures.push('fresh client evidence is missing');
  if (!input.server) evidenceFailures.push('server evidence is missing');
  if (input.freshClient && (manifestSet.has(input.freshClient.client) || input.freshClient.client === input.server?.client)) evidenceFailures.push('fresh client identity overlaps initial or server evidence');
  if (input.server && manifestSet.has(input.server.client)) evidenceFailures.push('server identity overlaps initial client evidence');
  if (input.freshClient && (initialConnectionSet.has(input.freshClient.connectionId) || input.freshClient.connectionId === input.server?.connectionId)) evidenceFailures.push('fresh client connection overlaps initial or server evidence');
  if (input.server && initialConnectionSet.has(input.server.connectionId)) evidenceFailures.push('server connection overlaps initial client evidence');
  const allConnectionIds=[...initialConnectionIds,...input.reconnects.map(item=>item.connectionId),...(input.freshClient?[input.freshClient.connectionId]:[]),...(input.server?[input.server.connectionId]:[])];
  if(new Set(allConnectionIds).size!==allConnectionIds.length)evidenceFailures.push('initial, reconnect, fresh, and server connection IDs are not globally unique');
  if (new Set(expectedIds).size !== expectedIds.length) evidenceFailures.push('operation ledger IDs are not unique');
  if (input.operations.some(operation => !writerSet.has(operation.writer))) evidenceFailures.push('operation ledger contains a writer outside the initial manifest');
  for (const client of all) {
    if (JSON.stringify(client.document) !== JSON.stringify(normalizeDocument(client.document))) evidenceFailures.push(`${client.client} document is not canonical`);
    if (documentHash(client.document) !== client.hash) evidenceFailures.push(`${client.client} document hash does not match raw document`);
  }
  for (const client of input.clients) {
    const manifest = manifestByClient.get(client.client), reconnect = reconnectByClient.get(client.client);
    if (!manifest || client.role !== manifest.role) evidenceFailures.push(`${client.client} browser runtime role does not match its server-bound manifest`);
    if (manifest && client.connectionId !== (reconnect?.connectionId ?? manifest.connectionId)) evidenceFailures.push(`${client.client} browser runtime connection does not match server acknowledgement`);
  }
  const observedByClient = new Map(all.map(client => [client.client, operationIds(client)]));
  const missing = canonicalStrings([...expected].filter(id => all.some(client => !observedByClient.get(client.client)!.includes(id))));
  const duplicates = canonicalStrings([...new Set(all.flatMap(client => {
    const ids = observedByClient.get(client.client)!, counts = new Map<string, number>();
    ids.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
    return [...counts].filter(([id, count]) => expected.has(id) && count > 1).map(([id]) => id);
  }))]);
  const unexpected = canonicalStrings([...new Set(all.flatMap(client => observedByClient.get(client.client)!.filter(id => !expected.has(id))))]);
  const byHash = new Map<string, string[]>();
  for (const client of all) byHash.set(client.hash, [...(byHash.get(client.hash) ?? []), client.client]);
  const forkGroups = [...byHash].map(([hash, clients]) => ({ hash, clients: clients.sort() })).sort((a, b) => a.hash.localeCompare(b.hash));

  const browserNames = manifestNames, browserSet = manifestSet;
  if (new Set(input.clients.map(client => client.client)).size !== input.clients.length) evidenceFailures.push('browser evidence client names are not unique');
  const propagationMissing: string[] = [], propagationDuplicates: string[] = [];
  const perClientSamples = new Map(browserNames.map(client => [client, [] as number[]]));
  for (const operation of input.operations) {
    if (Number.isFinite(collaborationStartedMs) && (operation.createdAtMs < collaborationStartedMs || operation.createdAtMs > collaborationFinishedMs)) evidenceFailures.push(`${operation.id} is outside the collaboration window`);
    if (operation.writerConnectionId !== connectionAt(operation.writer, operation.createdAtMs)) evidenceFailures.push(`${operation.id} writer connection is not server-bound`);
    const counts = new Map<string, number>();
    for (const receipt of operation.receipts) {
      counts.set(receipt.client, (counts.get(receipt.client) ?? 0) + 1);
      if (!browserSet.has(receipt.client)) { propagationDuplicates.push(`${operation.id}:${receipt.client}:unexpected-client`); continue; }
      const manifest = manifestByClient.get(receipt.client);
      if (!manifest || receipt.role !== manifest.role || receipt.connectionId !== connectionAt(receipt.client, receipt.visibleAtMs)) evidenceFailures.push(`${operation.id}:${receipt.client} receipt identity is not server-bound`);
      if (receipt.visibleAtMs < operation.createdAtMs) { evidenceFailures.push(`${operation.id}:${receipt.client} receipt predates operation`); continue; }
      if (Number.isFinite(collaborationStartedMs) && receipt.visibleAtMs > collaborationFinishedMs) evidenceFailures.push(`${operation.id}:${receipt.client} receipt is outside the collaboration window`);
      if (!operation.disruption && receipt.client !== operation.writer) perClientSamples.get(receipt.client)!.push(receipt.visibleAtMs - operation.createdAtMs);
    }
    for (const client of browserNames) {
      const count = counts.get(client) ?? 0;
      if (count === 0) propagationMissing.push(`${operation.id}:${client}`);
      if (count > 1) propagationDuplicates.push(`${operation.id}:${client}`);
    }
  }
  const perClientLatencyMs = Object.fromEntries([...perClientSamples].map(([client, values]) => [client, latencySummary(values)]));
  const remoteLatencyMs = latencySummary([...perClientSamples.values()].flat());
  for (const [client, summary] of Object.entries(perClientLatencyMs)) {
    if (summary.samples === 0) evidenceFailures.push(`${client} has no propagation samples`);
    if (summary.p95 === null || summary.p95 > input.config.remoteP95Ms) evidenceFailures.push(`${client} propagation p95 exceeds ${input.config.remoteP95Ms}ms`);
  }
  const expectedReconnects = Math.min(5, input.config.writers);
  const disruptions = input.operations.filter(operation => operation.disruption);
  if (disruptions.length !== expectedReconnects) evidenceFailures.push(`expected ${expectedReconnects} offline operations, got ${disruptions.length}`);
  for (const operation of disruptions) {
    const firstRemoteReceipt = Math.min(...operation.receipts.filter(receipt => receipt.client !== operation.writer).map(receipt => receipt.visibleAtMs));
    if (!Number.isFinite(firstRemoteReceipt) || firstRemoteReceipt - operation.createdAtMs < input.config.offlineMs) evidenceFailures.push(`${operation.id} did not prove the declared offline duration`);
  }
  if (input.reconnects.length !== expectedReconnects) evidenceFailures.push(`expected ${expectedReconnects} reconnect samples, got ${input.reconnects.length}`);
  if (new Set(input.reconnects.map(item => item.client)).size !== input.reconnects.length) evidenceFailures.push('reconnect clients are not unique');
  if (new Set(input.reconnects.map(item => item.connectionId)).size !== input.reconnects.length) evidenceFailures.push('reconnect server connection IDs are not unique');
  if (!sameIdentitySet(disruptions.map(item => item.writer), input.reconnects.map(item => item.client))) evidenceFailures.push('offline writers do not match reconnect evidence');
  for (const reconnect of input.reconnects) {
    if (!writerSet.has(reconnect.client)) evidenceFailures.push(`${reconnect.client} reconnect is not a manifest writer`);
    if (reconnect.previousConnectionId !== manifestByClient.get(reconnect.client)?.connectionId || reconnect.connectionId === reconnect.previousConnectionId || initialConnectionSet.has(reconnect.connectionId)) evidenceFailures.push(`${reconnect.client} reconnect connection IDs are not server-bound`);
    if (reconnect.onlineAtMs - reconnect.offlineAtMs < input.config.offlineMs) evidenceFailures.push(`${reconnect.client} did not remain offline for the required duration`);
    if (!(reconnect.offlineAtMs < reconnect.onlineAtMs && reconnect.recoveredAtMs !== null && reconnect.onlineAtMs <= reconnect.recoveredAtMs)) evidenceFailures.push(`${reconnect.client} reconnect timestamps are not strictly ordered`);
    if (Number.isFinite(collaborationStartedMs) && (reconnect.offlineAtMs < collaborationStartedMs || reconnect.onlineAtMs > collaborationFinishedMs || (reconnect.recoveredAtMs ?? collaborationFinishedMs + 1) > collaborationFinishedMs)) evidenceFailures.push(`${reconnect.client} reconnect timestamps are outside the collaboration window`);
    if (reconnect.recovered !== (reconnect.recoveredAtMs !== null)) evidenceFailures.push(`${reconnect.client} reconnect recovery flag disagrees with timestamp`);
    if (reconnect.recoveredAtMs !== null && Math.abs(reconnect.elapsedMs - (reconnect.recoveredAtMs - reconnect.onlineAtMs)) > 10) evidenceFailures.push(`${reconnect.client} reconnect elapsed time does not match timestamps`);
    const disrupted = disruptions.find(operation => operation.writer === reconnect.client);
    if (!disrupted || disrupted.createdAtMs < reconnect.offlineAtMs || disrupted.createdAtMs > reconnect.onlineAtMs) evidenceFailures.push(`${reconnect.client} offline operation is outside its outage window`);
  }
  const ledger=input.serverLedger?.payload;
  if(!ledger)evidenceFailures.push('server-signed soak ledger is missing');
  else {
    if(ledger.runId!==input.runId)evidenceFailures.push('server ledger run ID does not match report');
    if(ledger.exactSha!==input.exactSha)evidenceFailures.push('server ledger SHA does not match report');
    if(ledger.environmentFingerprint!==soakEnvironmentFingerprint(input.environment))evidenceFailures.push('server ledger environment does not match report');
    if(ledger.requiredDurationMs!==input.config.durationMs||ledger.expectedClients!==input.config.clients||ledger.expectedWriters!==input.config.writers)evidenceFailures.push('server ledger acceptance thresholds do not match report');
    if(ledger.finishedAtMs-ledger.startedAtMs<input.config.durationMs||ledger.finalizedAtMs<ledger.finishedAtMs)evidenceFailures.push('server-signed collaboration duration is below the required duration');
    const signedInitialConnections=ledger.connections.filter(item=>item.purpose==='initial');
    if(signedInitialConnections.length!==input.config.clients||signedInitialConnections.some(item=>item.connectedAtMs>ledger.startedAtMs)||Number.isFinite(collaborationStartedMs)&&(ledger.startedAtMs>collaborationStartedMs||signedInitialConnections.some(item=>item.connectedAtMs>collaborationStartedMs)))evidenceFailures.push('initial connections were not established before collaboration started');
    const ledgerConnections=new Map(ledger.connections.map(item=>[item.connectionId,item]));
    const expectedConnections=[...input.initialClients.map(item=>({client:item.client,connectionId:item.connectionId,role:item.role,purpose:'initial'})),...input.reconnects.map(item=>({client:item.client,connectionId:item.connectionId,role:manifestByClient.get(item.client)?.role,purpose:'reconnect'})),...(input.freshClient?[{client:input.freshClient.client,connectionId:input.freshClient.connectionId,role:input.freshClient.role,purpose:'fresh'}]:[]),...(input.server?[{client:input.server.client,connectionId:input.server.connectionId,role:input.server.role,purpose:'server'}]:[])];
    for(const expectedConnection of expectedConnections){const signed=ledgerConnections.get(expectedConnection.connectionId);if(!signed||signed.clientNonce!==expectedConnection.client||signed.role!==expectedConnection.role||signed.purpose!==expectedConnection.purpose)evidenceFailures.push(`${expectedConnection.connectionId} is not authenticated by the server ledger`);}
    if(ledger.connections.length!==expectedConnections.length)evidenceFailures.push('server ledger connection count does not match raw evidence');
    for(const reconnect of input.reconnects){const oldConnection=ledgerConnections.get(reconnect.previousConnectionId),newConnection=ledgerConnections.get(reconnect.connectionId);if(!oldConnection?.disconnectedAtMs||oldConnection.disconnectedAtMs<reconnect.offlineAtMs||oldConnection.disconnectedAtMs>reconnect.onlineAtMs)evidenceFailures.push(`${reconnect.client} signed disconnect is outside its outage window`);if(!newConnection||newConnection.connectedAtMs<reconnect.onlineAtMs||newConnection.connectedAtMs>(reconnect.recoveredAtMs??Number.NEGATIVE_INFINITY))evidenceFailures.push(`${reconnect.client} signed reconnect is outside its recovery window`);}
    const ledgerOps=new Map(ledger.operations.map(item=>[item.id,item]));
    for(const operation of input.operations){const signed=ledgerOps.get(operation.id),firstReceipt=Math.min(...operation.receipts.map(item=>item.visibleAtMs));if(!signed||signed.writer!==operation.writer||signed.connectionId!==operation.writerConnectionId||signed.committedAtMs<operation.createdAtMs||signed.committedAtMs>collaborationFinishedMs||!Number.isFinite(firstReceipt)||firstReceipt<signed.committedAtMs)evidenceFailures.push(`${operation.id} is not authenticated by the server ledger`);}
    if(ledger.operations.length!==input.operations.length)evidenceFailures.push('server ledger operation count does not match raw evidence');
    if(new Set(ledger.operations.map(item=>item.seq)).size!==ledger.operations.length)evidenceFailures.push('server ledger operation sequences are not unique');
    const signedTimes=ledger.operations.map(item=>item.committedAtMs).sort((a,b)=>a-b),signedTimeline=[ledger.startedAtMs,...signedTimes,ledger.finishedAtMs];
    if(signedTimeline.some((timestamp,index)=>index>0&&timestamp-signedTimeline[index-1]!>SOAK_COVERAGE.maxGlobalOperationGapMs))evidenceFailures.push('server ledger has a sustained operation gap');
    const signedWriters=new Set(ledger.operations.map(item=>item.writer));
    if(!sameIdentitySet(manifestWriters,[...signedWriters]))evidenceFailures.push('server ledger writer set does not match manifest');
    const signedWriterGap=SOAK_COVERAGE.maxGlobalOperationGapMs*input.config.writers;
    for(const writer of manifestWriters){const times=ledger.operations.filter(item=>item.writer===writer).map(item=>item.committedAtMs).sort((a,b)=>a-b),timeline=[ledger.startedAtMs,...times,ledger.finishedAtMs];if(timeline.some((timestamp,index)=>index>0&&timestamp-timeline[index-1]!>signedWriterGap))evidenceFailures.push(`${writer} server-signed activity gap exceeds ${signedWriterGap}ms`);}
    if(JSON.stringify(ledger.finalDocument)!==JSON.stringify(normalizeDocument(ledger.finalDocument))||documentHash(ledger.finalDocument)!==ledger.finalHash)evidenceFailures.push('server final snapshot is not canonical or its hash is invalid');
    for(const client of all)if(client.hash!==ledger.finalHash||client.seq!==ledger.finalSeq||JSON.stringify(client.document)!==JSON.stringify(ledger.finalDocument))evidenceFailures.push(`${client.client} does not match the signed final snapshot and sequence`);
    if(ledger.operations.some(item=>item.seq>ledger.finalSeq))evidenceFailures.push('server ledger operation sequence exceeds final sequence');
  }
  const reconnectFailures = input.reconnects.filter(item => !item.recovered || item.elapsedMs > input.config.reconnectMs);
  const steadyWriters = new Set(input.operations.filter(item => !item.disruption).map(operation => operation.writer));
  if (!sameIdentitySet(manifestWriters, [...steadyWriters])) evidenceFailures.push('steady-state writer identity set does not match the manifest');
  const operationTimes = input.operations.map(item => item.createdAtMs).sort((a, b) => a - b);
  const globalTimeline = [collaborationStartedMs, ...operationTimes, collaborationFinishedMs];
  if (globalTimeline.some((timestamp, index) => index > 0 && timestamp - globalTimeline[index - 1]! > SOAK_COVERAGE.maxGlobalOperationGapMs)) evidenceFailures.push(`global operation gap exceeds ${SOAK_COVERAGE.maxGlobalOperationGapMs}ms`);
  const writerGapMs = SOAK_COVERAGE.maxGlobalOperationGapMs * input.config.writers;
  const outageStart = Math.min(...input.reconnects.map(item => item.offlineAtMs)), outageEnd = Math.max(...input.reconnects.map(item => item.recoveredAtMs ?? Number.POSITIVE_INFINITY));
  for (const writer of manifestWriters) {
    const times = input.operations.filter(item => item.writer === writer && !item.disruption).map(item => item.createdAtMs).sort((a, b) => a - b);
    const timeline = [collaborationStartedMs, ...times, collaborationFinishedMs];
    if (timeline.some((timestamp, index) => index > 0 && timestamp - timeline[index - 1]! > writerGapMs)) evidenceFailures.push(`${writer} activity gap exceeds ${writerGapMs}ms`);
    if (!times.some(timestamp => timestamp < outageStart) || !times.some(timestamp => timestamp > outageEnd)) evidenceFailures.push(`${writer} lacks activity before and after the disruption`);
  }
  const accepted = evidenceFailures.length === 0 && missing.length === 0 && duplicates.length === 0 && unexpected.length === 0
    && propagationMissing.length === 0 && propagationDuplicates.length === 0 && forkGroups.length === 1
    && reconnectFailures.length === 0 && remoteLatencyMs.p95 !== null && remoteLatencyMs.p95 <= input.config.remoteP95Ms;
  return { missing, duplicates, unexpected, forkGroups, propagationMissing: canonicalStrings(propagationMissing), propagationDuplicates: canonicalStrings(propagationDuplicates), wallClockDurationMs: Number.isFinite(wallClockDurationMs) && wallClockDurationMs >= 0 ? wallClockDurationMs : null, remoteLatencyMs, perClientLatencyMs, reconnectFailures, evidenceFailures: canonicalStrings(evidenceFailures), accepted };
}
export function reportStatus(config: SoakConfig, analysis: SoakAnalysis, failure: string | null): SoakReport['status'] {
  if (failure || !analysis.accepted) return 'failed';
  return config.profile === 'acceptance' && isAcceptanceConfig(config) ? 'accepted' : 'diagnostic-passed';
}
export function recomputeReport(report: SoakReport): { analysis: SoakAnalysis; status: SoakReport['status'] } {
  const analysis = analyzeSoak(report), status = reportStatus(report.config, analysis, report.failure);
  return { analysis, status };
}
export async function writeSoakReport(file: string, report: SoakReport): Promise<void> {
  SoakReportSchema.parse(report); const recomputed = recomputeReport(report);
  if (report.status !== 'failed') verifySoakLedgerSignature(report);
  if (JSON.stringify(report.analysis) !== JSON.stringify(recomputed.analysis) || report.status !== recomputed.status) throw new Error('report verdict does not match recomputed raw evidence');
  if (report.status === 'accepted' && !isAcceptanceConfig(report.config)) throw new Error('refusing to write false acceptance evidence');
  await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); await rename(temporary, file);
}
