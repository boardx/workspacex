import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { WhiteboardObject } from '@repo/whiteboard-core';

export const ACCEPTANCE_SOAK = {
  clients: 50, writers: 20, durationMs: 30 * 60 * 1000, offlineMs: 30 * 1000,
  reconnectMs: 5 * 1000, remoteP95Ms: 300,
} as const;

export type SoakConfig = {
  clients: number; writers: number; durationMs: number; offlineMs: number;
  reconnectMs: number; remoteP95Ms: number; operationIntervalMs: number;
  profile: 'acceptance' | 'diagnostic';
};
export type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };
export type CanonicalWhiteboardObject = { [key: string]: CanonicalJson };
export type SoakReceipt = { client: string; visibleAtMs: number };
export type SoakOperation = { id: string; writer: number; createdAtMs: number; disruption: boolean; receipts: SoakReceipt[] };
export type SoakClientResult = { client: string; hash: string; document: CanonicalWhiteboardObject[] };
export type SoakReconnect = { client: string; elapsedMs: number; recovered: boolean };
export type LatencySummary = { samples: number; p50: number | null; p95: number | null; p99: number | null };
export type SoakAnalysis = {
  missing: string[]; duplicates: string[]; unexpected: string[];
  forkGroups: Array<{ hash: string; clients: string[] }>;
  propagationMissing: string[]; propagationDuplicates: string[];
  remoteLatencyMs: LatencySummary; perClientLatencyMs: Record<string, LatencySummary>;
  reconnectFailures: SoakReconnect[]; evidenceFailures: string[]; accepted: boolean;
};
export type SoakReport = {
  schemaVersion: 2; issue: 4144; status: 'accepted' | 'diagnostic-passed' | 'failed'; exactSha: string;
  startedAt: string; finishedAt: string; collaborationStartedAt: string | null; collaborationDurationMs: number;
  environment: { os: string; node: string; browser: string; ci: boolean };
  config: SoakConfig; operations: SoakOperation[]; clients: SoakClientResult[];
  freshClient: SoakClientResult | null; server: SoakClientResult | null;
  reconnects: SoakReconnect[]; analysis: SoakAnalysis; failure: string | null;
};

const LatencySummarySchema = z.object({ samples: z.number().int().nonnegative(), p50: z.number().nonnegative().nullable(), p95: z.number().nonnegative().nullable(), p99: z.number().nonnegative().nullable() }).strict();
const SoakConfigSchema = z.object({ clients: z.number().int().positive(), writers: z.number().int().positive(), durationMs: z.number().int().positive(), offlineMs: z.number().int().positive(), reconnectMs: z.number().int().positive(), remoteP95Ms: z.number().int().positive(), operationIntervalMs: z.number().int().positive(), profile: z.enum(['acceptance', 'diagnostic']) }).strict();
const SoakReceiptSchema = z.object({ client: z.string().min(1), visibleAtMs: z.number().int().nonnegative() }).strict();
const SoakOperationSchema = z.object({ id: z.string().min(1), writer: z.number().int().nonnegative(), createdAtMs: z.number().int().nonnegative(), disruption: z.boolean(), receipts: z.array(SoakReceiptSchema) }).strict();
const CanonicalDocumentSchema = z.array(z.record(z.unknown()));
const SoakClientResultSchema = z.object({ client: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/), document: CanonicalDocumentSchema }).strict();
const SoakReconnectSchema = z.object({ client: z.string().min(1), elapsedMs: z.number().int().nonnegative(), recovered: z.boolean() }).strict();
const SoakAnalysisSchema = z.object({ missing: z.array(z.string()), duplicates: z.array(z.string()), unexpected: z.array(z.string()), forkGroups: z.array(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), clients: z.array(z.string().min(1)) }).strict()), propagationMissing: z.array(z.string()), propagationDuplicates: z.array(z.string()), remoteLatencyMs: LatencySummarySchema, perClientLatencyMs: z.record(LatencySummarySchema), reconnectFailures: z.array(SoakReconnectSchema), evidenceFailures: z.array(z.string()), accepted: z.boolean() }).strict();
export const SoakReportSchema = z.object({ schemaVersion: z.literal(2), issue: z.literal(4144), status: z.enum(['accepted', 'diagnostic-passed', 'failed']), exactSha: z.string().regex(/^[a-f0-9]{40}$/), startedAt: z.string().datetime(), finishedAt: z.string().datetime(), collaborationStartedAt: z.string().datetime().nullable(), collaborationDurationMs: z.number().int().nonnegative(), environment: z.object({ os: z.string().min(1), node: z.string().min(1), browser: z.string().min(1), ci: z.boolean() }).strict(), config: SoakConfigSchema, operations: z.array(SoakOperationSchema), clients: z.array(SoakClientResultSchema), freshClient: SoakClientResultSchema.nullable(), server: SoakClientResultSchema.nullable(), reconnects: z.array(SoakReconnectSchema), analysis: SoakAnalysisSchema, failure: z.string().nullable() }).strict();

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
export function documentHash(document: readonly CanonicalWhiteboardObject[]): string {
  return createHash('sha256').update(JSON.stringify(normalizeDocument(document))).digest('hex');
}
function canonicalStrings(values: readonly string[]): string[] { return [...values].sort((a, b) => a.localeCompare(b)); }
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

export function analyzeSoak(input: Pick<SoakReport, 'operations' | 'clients' | 'freshClient' | 'server' | 'reconnects' | 'config'>): SoakAnalysis {
  const expectedIds = input.operations.map(operation => operation.id), expected = new Set(expectedIds);
  const all = [...input.clients, ...(input.freshClient ? [input.freshClient] : []), ...(input.server ? [input.server] : [])];
  const evidenceFailures: string[] = [];
  if (!input.operations.length) evidenceFailures.push('operation ledger is empty');
  if (input.clients.length !== input.config.clients) evidenceFailures.push(`expected ${input.config.clients} browser clients, got ${input.clients.length}`);
  if (!input.freshClient) evidenceFailures.push('fresh client evidence is missing');
  if (!input.server) evidenceFailures.push('server evidence is missing');
  if (new Set(expectedIds).size !== expectedIds.length) evidenceFailures.push('operation ledger IDs are not unique');
  if (input.operations.some(operation => operation.writer >= input.config.writers)) evidenceFailures.push('operation ledger contains an out-of-range writer');
  for (const client of all) {
    if (JSON.stringify(client.document) !== JSON.stringify(normalizeDocument(client.document))) evidenceFailures.push(`${client.client} document is not canonical`);
    if (documentHash(client.document) !== client.hash) evidenceFailures.push(`${client.client} document hash does not match raw document`);
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

  const browserNames = input.clients.map(client => client.client), browserSet = new Set(browserNames);
  if (browserSet.size !== browserNames.length) evidenceFailures.push('browser client names are not unique');
  const propagationMissing: string[] = [], propagationDuplicates: string[] = [];
  const perClientSamples = new Map(browserNames.map(client => [client, [] as number[]]));
  for (const operation of input.operations) {
    const counts = new Map<string, number>();
    for (const receipt of operation.receipts) {
      counts.set(receipt.client, (counts.get(receipt.client) ?? 0) + 1);
      if (!browserSet.has(receipt.client)) { propagationDuplicates.push(`${operation.id}:${receipt.client}:unexpected-client`); continue; }
      if (receipt.visibleAtMs < operation.createdAtMs) { evidenceFailures.push(`${operation.id}:${receipt.client} receipt predates operation`); continue; }
      if (!operation.disruption && receipt.client !== String(operation.writer)) perClientSamples.get(receipt.client)!.push(receipt.visibleAtMs - operation.createdAtMs);
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
    const firstRemoteReceipt = Math.min(...operation.receipts.filter(receipt => receipt.client !== String(operation.writer)).map(receipt => receipt.visibleAtMs));
    if (!Number.isFinite(firstRemoteReceipt) || firstRemoteReceipt - operation.createdAtMs < input.config.offlineMs) evidenceFailures.push(`${operation.id} did not prove the declared offline duration`);
  }
  if (input.reconnects.length !== expectedReconnects) evidenceFailures.push(`expected ${expectedReconnects} reconnect samples, got ${input.reconnects.length}`);
  if (new Set(input.reconnects.map(item => item.client)).size !== input.reconnects.length) evidenceFailures.push('reconnect clients are not unique');
  if (canonicalStrings(disruptions.map(item => String(item.writer))).join() !== canonicalStrings(input.reconnects.map(item => item.client)).join()) evidenceFailures.push('offline writers do not match reconnect evidence');
  const reconnectFailures = input.reconnects.filter(item => !item.recovered || item.elapsedMs > input.config.reconnectMs);
  const steadyWriterCount = new Set(input.operations.filter(item => !item.disruption).map(operation => operation.writer)).size;
  if (steadyWriterCount < input.config.writers) evidenceFailures.push(`expected ${input.config.writers} steady-state writers, got ${steadyWriterCount}`);
  const accepted = evidenceFailures.length === 0 && missing.length === 0 && duplicates.length === 0 && unexpected.length === 0
    && propagationMissing.length === 0 && propagationDuplicates.length === 0 && forkGroups.length === 1
    && reconnectFailures.length === 0 && remoteLatencyMs.p95 !== null && remoteLatencyMs.p95 <= input.config.remoteP95Ms;
  return { missing, duplicates, unexpected, forkGroups, propagationMissing: canonicalStrings(propagationMissing), propagationDuplicates: canonicalStrings(propagationDuplicates), remoteLatencyMs, perClientLatencyMs, reconnectFailures, evidenceFailures: canonicalStrings(evidenceFailures), accepted };
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
  if (JSON.stringify(report.analysis) !== JSON.stringify(recomputed.analysis) || report.status !== recomputed.status) throw new Error('report verdict does not match recomputed raw evidence');
  if (report.status === 'accepted' && (!isAcceptanceConfig(report.config) || report.collaborationDurationMs < report.config.durationMs)) throw new Error('refusing to write false acceptance evidence');
  await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); await rename(temporary, file);
}
