import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCEPTANCE_SOAK, analyzeSoak, operationHash, readSoakConfig, reportStatus, writeSoakReport, type SoakConfig, type SoakReport } from '../../e2e/support/whiteboard-collaboration-soak';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const diagnostic = (): SoakConfig => ({ clients: 2, writers: 1, durationMs: 1000, offlineMs: 100, reconnectMs: 5000, remoteP95Ms: 300, operationIntervalMs: 10, profile: 'diagnostic' });

describe('Board collaboration soak evidence', () => {
  it('keeps the acceptance profile pinned to the 50-browser contract', () => {
    expect(readSoakConfig({})).toMatchObject(ACCEPTANCE_SOAK);
    expect(() => readSoakConfig({ WHITEBOARD_SOAK_CLIENTS: '2' })).toThrow(/observer|cannot lower/);
    expect(readSoakConfig({ WHITEBOARD_SOAK_PROFILE: 'diagnostic', WHITEBOARD_SOAK_CLIENTS: '2', WHITEBOARD_SOAK_WRITERS: '1', WHITEBOARD_SOAK_DURATION_MS: '1000', WHITEBOARD_SOAK_OFFLINE_MS: '100' })).toMatchObject({ profile: 'diagnostic', clients: 2, writers: 1 });
  });

  it('detects missing operations, duplicates, forks, latency and reconnect failures', () => {
    const config = diagnostic(), ids = ['op-a', 'op-b'];
    const analysis = analyzeSoak({ config, expectedIds: ids,
      operations: [{ id: 'op-a', writer: 0, createdAtMs: 0, visibleAtMs: 100, disruption: false }, { id: 'op-b', writer: 0, createdAtMs: 0, visibleAtMs: 700, disruption: false }],
      clients: [{ client: '0', hash: operationHash(ids), operationIds: ids }, { client: '1', hash: operationHash(['op-a']), operationIds: ['op-a', 'op-a'] }],
      freshClient: { client: 'fresh', hash: operationHash(ids), operationIds: ids }, server: { client: 'server', hash: operationHash(ids), operationIds: ids },
      reconnects: [{ client: '0', elapsedMs: 6000, recovered: true }],
    });
    expect(analysis).toMatchObject({ missing: ['op-b'], duplicates: ['op-a'], remoteLatencyMs: { p95: 700 }, accepted: false });
    expect(analysis.forkGroups).toHaveLength(2); expect(analysis.reconnectFailures).toHaveLength(1);
  });

  it('allows shortened algorithm verification but cannot label it acceptance evidence', async () => {
    const config = diagnostic(), ids = ['op-a'];
    const clients = [{ client: '0', hash: operationHash(ids), operationIds: ids }, { client: '1', hash: operationHash(ids), operationIds: ids }];
    const analysis = analyzeSoak({ config, expectedIds: ids, operations: [{ id: 'op-a', writer: 0, createdAtMs: 0, visibleAtMs: 25, disruption: false }], clients,
      freshClient: { client: 'fresh', hash: operationHash(ids), operationIds: ids }, server: { client: 'server', hash: operationHash(ids), operationIds: ids }, reconnects: [] });
    expect(analysis.accepted).toBe(true); expect(reportStatus(config, analysis, null)).toBe('diagnostic-passed');
    const dir = await mkdtemp(path.join(tmpdir(), 'board-soak-')); dirs.push(dir); const file = path.join(dir, 'report.json');
    const report = { schemaVersion: 1, issue: 4144, status: 'accepted', exactSha: 'a'.repeat(40), startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), collaborationStartedAt: new Date(0).toISOString(), collaborationDurationMs: 1000, environment: { os: 'test', node: 'test', browser: 'test', ci: false }, config, operations: [], clients, freshClient: null, server: null, reconnects: [], analysis, failure: null } satisfies SoakReport;
    await expect(writeSoakReport(file, report)).rejects.toThrow(/false acceptance/);
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('keeps the 30-minute lane explicit and out of ordinary CI', () => {
    const workflow = readFileSync(new URL('../../../../.github/workflows/harness-verify.yml', import.meta.url), 'utf8');
    const manifest = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && inputs.run_board_collaboration_soak");
    expect(workflow).toMatch(/run_board_collaboration_soak:[\s\S]*?default: false/);
    expect(workflow).toContain('timeout-minutes: 50');
    expect(workflow).toContain('apps/web/test-results/whiteboard-collaboration-soak/');
    expect(manifest.scripts['verify:whiteboard-collaboration-soak']).toContain('with-test-isolation.ts');
    expect(manifest.scripts['verify:whiteboard-collaboration-soak:raw']).toContain('verify-whiteboard-soak-report.ts');
  });
});
