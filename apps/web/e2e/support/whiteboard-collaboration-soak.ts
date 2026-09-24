import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const ACCEPTANCE_SOAK = {
  clients: 50,
  writers: 20,
  durationMs: 30 * 60 * 1000,
  offlineMs: 30 * 1000,
  reconnectMs: 5 * 1000,
  remoteP95Ms: 300,
} as const;

export type SoakConfig = {
  clients: number;
  writers: number;
  durationMs: number;
  offlineMs: number;
  reconnectMs: number;
  remoteP95Ms: number;
  operationIntervalMs: number;
  profile: 'acceptance' | 'diagnostic';
};

export type SoakOperation = {
  id: string;
  writer: number;
  createdAtMs: number;
  visibleAtMs: number | null;
  disruption: boolean;
};

export type SoakClientResult = { client: string; hash: string; operationIds: string[] };
export type SoakReconnect = { client: string; elapsedMs: number; recovered: boolean };

export type SoakAnalysis = {
  missing: string[];
  duplicates: string[];
  unexpected: string[];
  forkGroups: Array<{ hash: string; clients: string[] }>;
  remoteLatencyMs: { samples: number; p50: number | null; p95: number | null; p99: number | null };
  reconnectFailures: SoakReconnect[];
  accepted: boolean;
};

export type SoakReport = {
  schemaVersion: 1;
  issue: 4144;
  status: 'accepted' | 'diagnostic-passed' | 'failed';
  exactSha: string;
  startedAt: string;
  finishedAt: string;
  collaborationStartedAt: string | null;
  collaborationDurationMs: number;
  environment: { os: string; node: string; browser: string; ci: boolean };
  config: SoakConfig;
  operations: SoakOperation[];
  clients: SoakClientResult[];
  freshClient: SoakClientResult | null;
  server: SoakClientResult | null;
  reconnects: SoakReconnect[];
  analysis: SoakAnalysis;
  failure: string | null;
};

const SoakConfigSchema = z.object({ clients: z.number().int().positive(), writers: z.number().int().positive(), durationMs: z.number().int().positive(), offlineMs: z.number().int().positive(), reconnectMs: z.number().int().positive(), remoteP95Ms: z.number().int().positive(), operationIntervalMs: z.number().int().positive(), profile: z.enum(['acceptance', 'diagnostic']) }).strict();
const SoakOperationSchema = z.object({ id: z.string().min(1), writer: z.number().int().nonnegative(), createdAtMs: z.number().int().nonnegative(), visibleAtMs: z.number().int().nonnegative().nullable(), disruption: z.boolean() }).strict();
const SoakClientResultSchema = z.object({ client: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/), operationIds: z.array(z.string().min(1)) }).strict();
const SoakReconnectSchema = z.object({ client: z.string().min(1), elapsedMs: z.number().int().nonnegative(), recovered: z.boolean() }).strict();
const SoakAnalysisSchema = z.object({ missing: z.array(z.string()), duplicates: z.array(z.string()), unexpected: z.array(z.string()), forkGroups: z.array(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), clients: z.array(z.string().min(1)) }).strict()), remoteLatencyMs: z.object({ samples: z.number().int().nonnegative(), p50: z.number().nonnegative().nullable(), p95: z.number().nonnegative().nullable(), p99: z.number().nonnegative().nullable() }).strict(), reconnectFailures: z.array(SoakReconnectSchema), accepted: z.boolean() }).strict();
export const SoakReportSchema = z.object({ schemaVersion: z.literal(1), issue: z.literal(4144), status: z.enum(['accepted', 'diagnostic-passed', 'failed']), exactSha: z.string().regex(/^[a-f0-9]{40}$/), startedAt: z.string().datetime(), finishedAt: z.string().datetime(), collaborationStartedAt: z.string().datetime().nullable(), collaborationDurationMs: z.number().int().nonnegative(), environment: z.object({ os: z.string().min(1), node: z.string().min(1), browser: z.string().min(1), ci: z.boolean() }).strict(), config: SoakConfigSchema, operations: z.array(SoakOperationSchema), clients: z.array(SoakClientResultSchema), freshClient: SoakClientResultSchema.nullable(), server: SoakClientResultSchema.nullable(), reconnects: z.array(SoakReconnectSchema), analysis: SoakAnalysisSchema, failure: z.string().nullable() }).strict();

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
    operationIntervalMs: positiveInteger(env.WHITEBOARD_SOAK_OPERATION_INTERVAL_MS, 2000, 'WHITEBOARD_SOAK_OPERATION_INTERVAL_MS'),
    profile,
  };
  if (config.writers >= config.clients) throw new Error('WHITEBOARD_SOAK_WRITERS must leave at least one observer client');
  if (profile === 'acceptance' && !isAcceptanceConfig(config)) {
    throw new Error('acceptance profile cannot lower the 50-client/20-writer/30-minute/30-second/5-second/300ms contract');
  }
  return config;
}

export function isAcceptanceConfig(config: SoakConfig): boolean {
  return config.clients === ACCEPTANCE_SOAK.clients
    && config.writers >= ACCEPTANCE_SOAK.writers
    && config.durationMs >= ACCEPTANCE_SOAK.durationMs
    && config.offlineMs >= ACCEPTANCE_SOAK.offlineMs
    && config.reconnectMs <= ACCEPTANCE_SOAK.reconnectMs
    && config.remoteP95Ms <= ACCEPTANCE_SOAK.remoteP95Ms;
}

export function canonicalOperationIds(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function operationHash(values: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(canonicalOperationIds(values))).digest('hex');
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

export function analyzeSoak(input: {
  expectedIds: readonly string[];
  operations: readonly SoakOperation[];
  clients: readonly SoakClientResult[];
  freshClient: SoakClientResult | null;
  server: SoakClientResult | null;
  reconnects: readonly SoakReconnect[];
  config: SoakConfig;
}): SoakAnalysis {
  const expected = new Set(input.expectedIds);
  const all = [...input.clients, ...(input.freshClient ? [input.freshClient] : []), ...(input.server ? [input.server] : [])];
  const observed = all.flatMap(client => client.operationIds);
  const counts = new Map<string, number>();
  for (const id of observed) counts.set(id, (counts.get(id) ?? 0) + 1);
  const missing = canonicalOperationIds([...expected].filter(id => all.some(client => !client.operationIds.includes(id))));
  const duplicates = canonicalOperationIds([...counts].filter(([id, count]) => expected.has(id) && count > all.length).map(([id]) => id));
  const unexpected = canonicalOperationIds([...counts.keys()].filter(id => !expected.has(id)));
  const byHash = new Map<string, string[]>();
  for (const client of all) byHash.set(client.hash, [...(byHash.get(client.hash) ?? []), client.client]);
  const forkGroups = [...byHash].map(([hash, clients]) => ({ hash, clients: clients.sort() })).sort((a, b) => a.hash.localeCompare(b.hash));
  const steadyLatencies = input.operations.filter(operation => !operation.disruption && operation.visibleAtMs !== null)
    .map(operation => operation.visibleAtMs! - operation.createdAtMs);
  const remoteLatencyMs = { samples: steadyLatencies.length, p50: percentile(steadyLatencies, 0.5), p95: percentile(steadyLatencies, 0.95), p99: percentile(steadyLatencies, 0.99) };
  const reconnectFailures = input.reconnects.filter(item => !item.recovered || item.elapsedMs > input.config.reconnectMs);
  const accepted = all.length === input.config.clients + 2
    && input.operations.length > 0
    && new Set(input.operations.map(operation => operation.writer)).size >= input.config.writers
    && missing.length === 0 && duplicates.length === 0 && unexpected.length === 0
    && forkGroups.length === 1 && reconnectFailures.length === 0
    && remoteLatencyMs.p95 !== null && remoteLatencyMs.p95 <= input.config.remoteP95Ms;
  return { missing, duplicates, unexpected, forkGroups, remoteLatencyMs, reconnectFailures, accepted };
}

export function reportStatus(config: SoakConfig, analysis: SoakAnalysis, failure: string | null): SoakReport['status'] {
  if (failure || !analysis.accepted) return 'failed';
  return config.profile === 'acceptance' && isAcceptanceConfig(config) ? 'accepted' : 'diagnostic-passed';
}

export async function writeSoakReport(file: string, report: SoakReport): Promise<void> {
  SoakReportSchema.parse(report);
  if (report.status === 'accepted' && (!isAcceptanceConfig(report.config) || report.failure || !report.analysis.accepted || report.collaborationDurationMs < report.config.durationMs)) {
    throw new Error('refusing to write false acceptance evidence');
  }
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}
