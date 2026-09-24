import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WhiteboardObject, type WhiteboardObject as BoardObject } from '@repo/whiteboard-core';
import { ACCEPTANCE_SOAK, analyzeSoak, canonicalizeDocument, documentHash, readSoakConfig, recomputeReport, reportStatus, writeSoakReport, type SoakConfig, type SoakReport } from '../../e2e/support/whiteboard-collaboration-soak';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

function config(clients = 50, writers = 20, profile: SoakConfig['profile'] = 'acceptance'): SoakConfig {
  return { clients, writers, durationMs: profile === 'acceptance' ? ACCEPTANCE_SOAK.durationMs : 1000, offlineMs: profile === 'acceptance' ? ACCEPTANCE_SOAK.offlineMs : 100, reconnectMs: 5000, remoteP95Ms: 300, operationIntervalMs: 10, profile };
}
function object(id: string, overrides: Partial<BoardObject> = {}): BoardObject {
  return WhiteboardObject.parse({ id: id.replace(/:/g, '_'), schemaVersion: 1, kind: 'sticky', geometry: { x: 10, y: 20, width: 180, height: 140, rotation: 0 }, text: id, style: { fill: '#fff', color: '#111', fontSize: 16 }, parentId: null, orderKey: id, extensionData: { path: [[0, 0], [1, 1]], locked: false }, ...overrides });
}
function result(client: string, objects: BoardObject[]) {
  const document = canonicalizeDocument(objects); return { client, document, hash: documentHash(document) };
}
function rawReport(options: { clients?: number; writers?: number; profile?: SoakConfig['profile'] } = {}): SoakReport {
  const cfg = config(options.clients, options.writers, options.profile), steadyIds = Array.from({ length: cfg.writers }, (_, index) => `soak-4144:${index}`);
  const offlineIds = Array.from({ length: Math.min(5, cfg.writers) }, (_, index) => `soak-4144:offline-${index}`);
  const objects = [...steadyIds, ...offlineIds].map(id => object(id)), clients = Array.from({ length: cfg.clients }, (_, index) => result(String(index), objects));
  const operations = steadyIds.map((id, writer) => ({ id, writer, createdAtMs: 1000, disruption: false, receipts: clients.map(client => ({ client: client.client, visibleAtMs: 1100 })) }));
  operations.push(...offlineIds.map((id, writer) => ({ id, writer, createdAtMs: 2000, disruption: true, receipts: clients.map(client => ({ client: client.client, visibleAtMs: 2000 + cfg.offlineMs + 100 })) })));
  const reconnects = Array.from({ length: Math.min(5, cfg.writers) }, (_, index) => ({ client: String(index), elapsedMs: 100, recovered: true }));
  const partial = { config: cfg, operations, clients, freshClient: result('fresh', objects), server: result('server', objects), reconnects };
  const analysis = analyzeSoak(partial);
  return { schemaVersion: 2, issue: 4144, status: reportStatus(cfg, analysis, null), exactSha: 'a'.repeat(40), startedAt: new Date(0).toISOString(), finishedAt: new Date(cfg.durationMs).toISOString(), collaborationStartedAt: new Date(0).toISOString(), collaborationDurationMs: cfg.durationMs, environment: { os: 'test', node: process.version, browser: 'test', ci: false }, ...partial, analysis, failure: null };
}

describe('Board collaboration soak evidence', () => {
  it('keeps the acceptance profile pinned to the 50-browser contract', () => {
    expect(readSoakConfig({})).toMatchObject(ACCEPTANCE_SOAK);
    expect(() => readSoakConfig({ WHITEBOARD_SOAK_CLIENTS: '2' })).toThrow(/observer|cannot lower/);
    expect(readSoakConfig({ WHITEBOARD_SOAK_PROFILE: 'diagnostic', WHITEBOARD_SOAK_CLIENTS: '2', WHITEBOARD_SOAK_WRITERS: '1', WHITEBOARD_SOAK_DURATION_MS: '1000', WHITEBOARD_SOAK_OFFLINE_MS: '100' })).toMatchObject({ profile: 'diagnostic', clients: 2, writers: 1 });
  });

  it('hashes the complete canonical document semantics rather than only sticky text', () => {
    const base = object('soak-4144:0');
    const moved = object('soak-4144:0', { geometry: { ...base.geometry, x: 99 } });
    const styled = object('soak-4144:0', { style: { ...base.style, fill: '#000' } });
    const parented = object('soak-4144:0', { parentId: 'frame_1', orderKey: 'z-9' });
    const grouped = object('soak-4144:0', { kind: 'group', containerState: 'active' });
    const connector = object('soak-4144:0', { kind: 'connector', connector: { from: 'from_1', to: 'to_1' } });
    const pathChanged = object('soak-4144:0', { extensionData: { path: [[0, 0], [9, 9]], locked: true } });
    const textChanged = object('soak-4144:changed');
    expect(new Set([base, moved, styled, parented, grouped, connector, pathChanged, textChanged].map(item => documentHash(canonicalizeDocument([item]))))).toHaveLength(8);
    expect(documentHash(canonicalizeDocument([base, object('other')]))).toBe(documentHash(canonicalizeDocument([object('other'), base])));
  });

  it('recomputes loss, duplicates, forks, all-client propagation, latency and reconnect failures from raw evidence', () => {
    const report = rawReport({ clients: 3, writers: 2, profile: 'diagnostic' });
    report.clients[1]!.document = canonicalizeDocument([object('soak-4144:0'), object('soak-4144:0', { id: 'duplicate' })]);
    report.clients[1]!.hash = documentHash(report.clients[1]!.document);
    report.operations[0]!.receipts = report.operations[0]!.receipts.filter(receipt => receipt.client !== '2');
    report.operations[1]!.receipts.find(receipt => receipt.client === '0')!.visibleAtMs = 1700;
    report.reconnects[0] = { client: '0', elapsedMs: 6000, recovered: true };
    const analysis = analyzeSoak(report);
    expect(analysis.missing).toContain('soak-4144:1');
    expect(analysis.duplicates).toContain('soak-4144:0');
    expect(analysis.forkGroups.length).toBeGreaterThan(1);
    expect(analysis.propagationMissing).toContain('soak-4144:0:2');
    expect(analysis.perClientLatencyMs['0']?.p95).toBe(700);
    expect(analysis.reconnectFailures).toHaveLength(1);
    expect(analysis.accepted).toBe(false);
  });

  it('rejects a reviewer counterproof with accepted labels over empty raw evidence', async () => {
    const report = rawReport();
    report.operations = []; report.clients = []; report.freshClient = null; report.server = null; report.reconnects = [];
    expect(recomputeReport(report).analysis).toMatchObject({ accepted: false, evidenceFailures: expect.arrayContaining(['operation ledger is empty', 'fresh client evidence is missing', 'server evidence is missing']) });
    const dir = await mkdtemp(path.join(tmpdir(), 'board-soak-')); dirs.push(dir); const file = path.join(dir, 'empty.json');
    await expect(writeSoakReport(file, report)).rejects.toThrow(/raw evidence/);
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('runs the real verifier command without CJS top-level-await and rejects empty spoof evidence', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'board-soak-command-')); dirs.push(dir);
    const valid = path.join(dir, 'valid.json'), spoof = path.join(dir, 'spoof.json');
    const report = rawReport(); await writeFile(valid, JSON.stringify(report));
    const invalid = { ...report, operations: [], clients: [], freshClient: null, server: null, reconnects: [] };
    await writeFile(spoof, JSON.stringify(invalid));
    const run = (file: string) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-whiteboard-soak-report.ts'], { cwd: process.cwd(), env: { ...process.env, WHITEBOARD_SOAK_REPORT: file, GITHUB_SHA: report.exactSha }, encoding: 'utf8' });
    const accepted = run(valid); expect(accepted.status, accepted.stderr).toBe(0); expect(accepted.stdout).toContain(report.exactSha);
    const rejected = run(spoof); expect(rejected.status).not.toBe(0); expect(rejected.stderr).toMatch(/raw evidence|operation ledger|browser clients/);
  }, 20_000);

  it('allows shortened algorithm verification but cannot label it acceptance evidence', async () => {
    const report = rawReport({ clients: 3, writers: 2, profile: 'diagnostic' });
    expect(report.analysis.accepted).toBe(true); expect(report.status).toBe('diagnostic-passed');
    report.status = 'accepted';
    const dir = await mkdtemp(path.join(tmpdir(), 'board-soak-')); dirs.push(dir); const file = path.join(dir, 'report.json');
    await expect(writeSoakReport(file, report)).rejects.toThrow(/verdict|false acceptance/);
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
