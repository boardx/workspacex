import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WhiteboardObject, type WhiteboardObject as BoardObject } from '@repo/whiteboard-core';
import { ACCEPTANCE_SOAK, analyzeSoak, canonicalizeDocument, documentHash, readSoakConfig, recomputeReport, reportStatus, soakEnvironmentFingerprint, writeSoakReport, type SoakConfig, type SoakReport } from '../../e2e/support/whiteboard-collaboration-soak';

const dirs: string[] = [];
const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
process.env.WHITEBOARD_SOAK_LEDGER_PUBLIC_KEY=publicKey;
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

function config(clients = 50, writers = 20, profile: SoakConfig['profile'] = 'acceptance'): SoakConfig {
  return { clients, writers, durationMs: profile === 'acceptance' ? ACCEPTANCE_SOAK.durationMs : 1000, offlineMs: profile === 'acceptance' ? ACCEPTANCE_SOAK.offlineMs : 100, reconnectMs: 5000, remoteP95Ms: 300, operationIntervalMs: 10, profile };
}
function object(id: string, overrides: Partial<BoardObject> = {}): BoardObject {
  return WhiteboardObject.parse({ id: id.replace(/:/g, '_'), schemaVersion: 1, kind: 'sticky', geometry: { x: 10, y: 20, width: 180, height: 140, rotation: 0 }, text: id, style: { fill: '#fff', color: '#111', fontSize: 16 }, parentId: null, orderKey: id, extensionData: { path: [[0, 0], [1, 1]], locked: false }, ...overrides });
}
function uuid(index: number): string { return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`; }
function result(client: string, connectionId: string, role: 'owner' | 'editor' | 'viewer', objects: BoardObject[],seq:number) {
  const document = canonicalizeDocument(objects); return { client, connectionId, role,seq,document, hash: documentHash(document) };
}
function rawReport(options: { clients?: number; writers?: number; profile?: SoakConfig['profile'] } = {}): SoakReport {
  const cfg = config(options.clients, options.writers, options.profile);
  const offlineIds = Array.from({ length: Math.min(5, cfg.writers) }, (_, index) => `soak-4144:offline-${index}`);
  const collaborationStartedMs = 10_000, finishedMs = collaborationStartedMs + cfg.durationMs;
  const offlineAtMs = collaborationStartedMs + Math.floor(cfg.durationMs / 2), onlineAtMs = offlineAtMs + cfg.offlineMs;
  const recoveredAtMs = onlineAtMs + 100;
  const initialClients = Array.from({ length: cfg.clients }, (_, index) => ({ client: uuid(100 + index), connectionId: uuid(1000 + index), role: index < cfg.writers ? 'editor' as const : 'viewer' as const, writer: index < cfg.writers }));
  const reconnects = Array.from({ length: Math.min(5, cfg.writers) }, (_, index) => ({ client: initialClients[index]!.client, previousConnectionId: initialClients[index]!.connectionId, connectionId: uuid(2000 + index), offlineAtMs, onlineAtMs, recoveredAtMs, elapsedMs: 100, recovered: true }));
  const reconnectByClient = new Map(reconnects.map(item => [item.client, item]));
  const connectionAt = (client: string, timestamp: number) => timestamp >= (reconnectByClient.get(client)?.recoveredAtMs ?? Number.POSITIVE_INFINITY) ? reconnectByClient.get(client)!.connectionId : initialClients.find(item => item.client === client)!.connectionId;
  const step = Math.min(5000, Math.max(1, Math.floor(cfg.durationMs / (cfg.writers * 3 + 1))));
  const steadyTimes: number[] = []; for (let time = collaborationStartedMs + step; time + 100 <= finishedMs; time += step) steadyTimes.push(time);
  if(steadyTimes.at(-1)!<finishedMs-100)steadyTimes.push(finishedMs-100);
  const steadyIds = steadyTimes.map((_, index) => `soak-4144:${index}`);
  const allIds = [...steadyIds, ...offlineIds], objects = allIds.map(id => object(id));
  const finalConnection = (client: string) => reconnectByClient.get(client)?.connectionId ?? initialClients.find(item => item.client === client)!.connectionId;
  const finalSeq=allIds.length+50;
  const clients = initialClients.map(item => result(item.client, finalConnection(item.client), item.role, objects,finalSeq));
  const receipts = (visibleAtMs: number) => initialClients.map(item => ({ client: item.client, connectionId: connectionAt(item.client, visibleAtMs), role: item.role, visibleAtMs }));
  const operations = steadyIds.map((id, index) => { const writer = initialClients[index % cfg.writers]!, createdAtMs = steadyTimes[index]!; return { id, writer: writer.client, writerConnectionId: connectionAt(writer.client, createdAtMs), createdAtMs, disruption: false, receipts: receipts(createdAtMs + 100) }; });
  operations.push(...offlineIds.map((id, index) => { const writer = initialClients[index]!, createdAtMs = offlineAtMs + 1; return { id, writer: writer.client, writerConnectionId: writer.connectionId, createdAtMs, disruption: true, receipts: receipts(recoveredAtMs) }; }));
  const exactSha='a'.repeat(40),environment={ os: 'test', node: process.version, browser: 'test', ci: false };
  const freshClient=result(uuid(3000),uuid(3001),'viewer',objects,finalSeq),server=result(uuid(4000),uuid(4001),'owner',objects,finalSeq);
  const reconnecting=new Set(reconnects.map(item=>item.client));
  const connections=[...initialClients.map(item=>({clientNonce:item.client,connectionId:item.connectionId,role:item.role,purpose:'initial' as const,connectedAtMs:collaborationStartedMs-200,disconnectedAtMs:reconnecting.has(item.client)?offlineAtMs+1:finishedMs+100})),...reconnects.map(item=>({clientNonce:item.client,connectionId:item.connectionId,role:'editor' as const,purpose:'reconnect' as const,connectedAtMs:item.onlineAtMs,disconnectedAtMs:finishedMs+100})),{clientNonce:freshClient.client,connectionId:freshClient.connectionId,role:freshClient.role,purpose:'fresh' as const,connectedAtMs:finishedMs,disconnectedAtMs:finishedMs+100},{clientNonce:server.client,connectionId:server.connectionId,role:server.role,purpose:'server' as const,connectedAtMs:finishedMs+100,disconnectedAtMs:null}];
  const signedOperations=operations.map((item,index)=>({id:item.id,writer:item.writer,connectionId:item.writerConnectionId,seq:index+1,committedAtMs:item.createdAtMs+50})),signedStartedAtMs=collaborationStartedMs-100,signedFinishedAtMs=Math.max(...signedOperations.map(item=>item.committedAtMs)),finalDocument=canonicalizeDocument(objects);
  const payload={schemaVersion:1 as const,runId:uuid(9000),challenge:uuid(9001),boardId:uuid(9002),exactSha,environmentFingerprint:soakEnvironmentFingerprint(environment),requiredDurationMs:cfg.durationMs,expectedClients:cfg.clients,expectedWriters:cfg.writers,startedAtMs:signedStartedAtMs,finishedAtMs:signedFinishedAtMs,connections,operations:signedOperations,finalSeq,finalDocument,finalHash:documentHash(finalDocument),finalizedAtMs:finishedMs+200};
  const serverLedger={payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),keys.privateKey).toString('base64')};
  const partial = { runId:payload.runId,exactSha,environment,startedAt: new Date(0).toISOString(), finishedAt: new Date(finishedMs + 1000).toISOString(), collaborationStartedAt: new Date(collaborationStartedMs).toISOString(), collaborationFinishedAt: new Date(finishedMs).toISOString(), collaborationDurationMs: cfg.durationMs, config: cfg, initialClients, operations, clients, freshClient, server, reconnects,serverLedger };
  const analysis = analyzeSoak(partial);
  return { schemaVersion: 3, issue: 4144, status: reportStatus(cfg, analysis, null), ...partial, analysis, failure: null };
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
    const writer0 = report.initialClients[0]!.client, viewer = report.initialClients[2]!.client;
    report.clients[1]!.document = canonicalizeDocument([object('soak-4144:0'), object('soak-4144:0', { id: 'duplicate' })]);
    report.clients[1]!.hash = documentHash(report.clients[1]!.document);
    report.operations[0]!.receipts = report.operations[0]!.receipts.filter(receipt => receipt.client !== viewer);
    report.operations[1]!.receipts.find(receipt => receipt.client === writer0)!.visibleAtMs += 600;
    report.reconnects[0] = { ...report.reconnects[0]!, recoveredAtMs: report.reconnects[0]!.onlineAtMs + 6000, elapsedMs: 6000 };
    const analysis = analyzeSoak(report);
    expect(analysis.missing).toContain('soak-4144:1');
    expect(analysis.duplicates).toContain('soak-4144:0');
    expect(analysis.forkGroups.length).toBeGreaterThan(1);
    expect(analysis.propagationMissing).toContain(`soak-4144:0:${viewer}`);
    expect(analysis.perClientLatencyMs[writer0]?.p95).toBe(700);
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

  it('runs the real verifier command and rejects forged identities plus a one-second wall clock with fake duration', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'board-soak-command-')); dirs.push(dir);
    const valid = path.join(dir, 'valid.json'), spoof = path.join(dir, 'spoof.json'), forgedFile = path.join(dir, 'forged.json'), sparseFile = path.join(dir, 'sparse.json'), reorderedFile = path.join(dir, 'reordered.json');
    const report = rawReport(); await writeFile(valid, JSON.stringify(report));
    const invalid = { ...report, operations: [], clients: [], freshClient: null, server: null, reconnects: [] };
    await writeFile(spoof, JSON.stringify(invalid));
    const renamed = new Map(report.clients.map((client, index) => [client.client, uuid(5000 + index)]));
    const forged: SoakReport = { ...structuredClone(report), collaborationStartedAt: null, collaborationFinishedAt: null, finishedAt: new Date(Date.parse(report.startedAt) + 1000).toISOString(), collaborationDurationMs: ACCEPTANCE_SOAK.durationMs };
    forged.clients = forged.clients.map(client => ({ ...client, client: renamed.get(client.client)! }));
    forged.operations = forged.operations.map(operation => ({ ...operation, writer: renamed.get(operation.writer) ?? operation.writer, receipts: operation.receipts.map(receipt => ({ ...receipt, client: renamed.get(receipt.client) ?? receipt.client })) }));
    forged.reconnects = forged.reconnects.map(reconnect => ({ ...reconnect, client: renamed.get(reconnect.client) ?? reconnect.client }));
    await expect(writeSoakReport(forgedFile, forged)).rejects.toThrow(/raw evidence/);
    await writeFile(forgedFile, JSON.stringify(forged));
    const sparse = structuredClone(report), kept = [...sparse.operations.filter(item => !item.disruption).slice(0, 20), ...sparse.operations.filter(item => item.disruption)];
    const keptIds = new Set(kept.map(item => item.id)); sparse.operations = kept;
    for (const client of [...sparse.clients, sparse.freshClient!, sparse.server!]) { client.document = client.document.filter(item => typeof item.text === 'string' && keptIds.has(item.text)); client.hash = documentHash(client.document); }
    expect(analyzeSoak(sparse).evidenceFailures).toEqual(expect.arrayContaining([expect.stringMatching(/operation gap|activity gap|before and after/)]));
    await expect(writeSoakReport(sparseFile, sparse)).rejects.toThrow(/raw evidence/); await writeFile(sparseFile, JSON.stringify(sparse));
    const reordered = structuredClone(report); reordered.reconnects[0]!.recoveredAtMs = reordered.reconnects[0]!.onlineAtMs - 1; reordered.reconnects[0]!.elapsedMs = 0;
    await expect(writeSoakReport(reorderedFile, reordered)).rejects.toThrow(/raw evidence/); await writeFile(reorderedFile, JSON.stringify(reordered));
    const run = (file: string) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-whiteboard-soak-report.ts'], { cwd: process.cwd(), env: { ...process.env, WHITEBOARD_SOAK_REPORT: file, GITHUB_SHA: report.exactSha }, encoding: 'utf8' });
    const accepted = run(valid); expect(accepted.status, accepted.stderr).toBe(0); expect(accepted.stdout).toContain(report.exactSha);
    const rejected = run(spoof); expect(rejected.status).not.toBe(0); expect(rejected.stderr).toMatch(/raw evidence|operation ledger|browser clients/);
    const forgedResult = run(forgedFile); expect(forgedResult.status).not.toBe(0); expect(forgedResult.stderr).toMatch(/raw evidence|manifest|timestamp|wall-clock/);
    expect(run(sparseFile).status).not.toBe(0);
    expect(run(reorderedFile).status).not.toBe(0);
  }, 20_000);

  it('rejects self-signed no-WebSocket evidence, ledger tampering, and wrong run metadata', () => {
    const dir=path.join(tmpdir(),`board-soak-signature-${Date.now()}`);dirs.push(dir);mkdirSync(dir,{recursive:true});
    const report=rawReport(),attacker=generateKeyPairSync('ed25519');
    const forged=structuredClone(report);forged.serverLedger!.signature=sign(null,Buffer.from(JSON.stringify(forged.serverLedger!.payload)),attacker.privateKey).toString('base64');
    const tampered=structuredClone(report);tampered.serverLedger!.payload.finalizedAtMs+=1;
    const wrongRun=structuredClone(report);wrongRun.runId=uuid(9990);
    const wrongSha=structuredClone(report);wrongSha.exactSha='b'.repeat(40);
    const wrongEnvironment=structuredClone(report);wrongEnvironment.environment={...wrongEnvironment.environment,os:'forged'};
    const run=(name:string,value:SoakReport)=>{const file=path.join(dir,`${name}.json`);writeFileSync(file,JSON.stringify(value));return spawnSync(process.execPath,['--import','tsx','scripts/verify-whiteboard-soak-report.ts'],{cwd:process.cwd(),env:{...process.env,WHITEBOARD_SOAK_REPORT:file,GITHUB_SHA:value.exactSha},encoding:'utf8'});};
    expect(run('no-ws-self-signed',forged).status).not.toBe(0);
    expect(run('tampered-ledger',tampered).status).not.toBe(0);
    expect(run('wrong-run',wrongRun).status).not.toBe(0);
    expect(run('wrong-sha',wrongSha).status).not.toBe(0);
    expect(run('wrong-environment',wrongEnvironment).status).not.toBe(0);
  },20_000);

  it('requires every initial, reconnect, fresh, and server connection ID to be globally unique',()=>{
    const report=rawReport();report.freshClient!.connectionId=report.reconnects[0]!.connectionId;
    expect(analyzeSoak(report).evidenceFailures).toContain('initial, reconnect, fresh, and server connection IDs are not globally unique');
  });

  it('rejects a validly signed ledger whose server-observed run is shorter than the required duration',()=>{
    const report=rawReport();report.serverLedger!.payload.startedAtMs=report.serverLedger!.payload.finishedAtMs-140_100;report.serverLedger!.signature=sign(null,Buffer.from(JSON.stringify(report.serverLedger!.payload)),keys.privateKey).toString('base64');
    expect(analyzeSoak(report).evidenceFailures).toContain('server-signed collaboration duration is below the required duration');
  });

  it('rejects caller-rehashed geometry when every reported snapshot differs from the signed server snapshot',()=>{
    const report=rawReport();
    for(const client of [...report.clients,report.freshClient!,report.server!]){client.document=client.document.map(item=>({...item,geometry:{...(item.geometry as Record<string,unknown>),x:999}}));client.hash=documentHash(client.document);}
    expect(analyzeSoak(report).evidenceFailures).toEqual(expect.arrayContaining([expect.stringMatching(/does not match the signed final snapshot/)]));
  });

  it('rejects a legal writer/viewer role swap against browser and server bindings', async () => {
    const report = rawReport(), swapped = structuredClone(report), writer = swapped.initialClients[0]!, viewer = swapped.initialClients.at(-1)!;
    [writer.role, viewer.role] = [viewer.role, writer.role]; [writer.writer, viewer.writer] = [viewer.writer, writer.writer];
    expect(analyzeSoak(swapped).evidenceFailures).toEqual(expect.arrayContaining([expect.stringMatching(/runtime role|writer identity/)]));
    const dir = await mkdtemp(path.join(tmpdir(), 'board-soak-role-')); dirs.push(dir);
    await expect(writeSoakReport(path.join(dir, 'role.json'), swapped)).rejects.toThrow(/raw evidence/);
  });

  it('allows shortened algorithm verification but cannot label it acceptance evidence', async () => {
    const report = rawReport({ clients: 3, writers: 2, profile: 'diagnostic' });
    expect(report.analysis.evidenceFailures).toEqual([]); expect(report.analysis.accepted).toBe(true); expect(report.status).toBe('diagnostic-passed');
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
    expect(manifest.scripts['verify:whiteboard-collaboration-soak:raw']).toContain('run-whiteboard-soak.ts');
  });
});
