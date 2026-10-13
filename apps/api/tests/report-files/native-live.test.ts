// @global-scope-fixture seeder:ensurePlatformSkillCatalogSeeded: The required with-test-isolation runner drops its owned database, including platform seed rows, after this opted-in native lane.
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { interviewMarkdown, research } from '@repo/contracts';
import { ReportFileJob, ReportFileSourceInfo, REPORT_FILE_FORMATS } from '@repo/contracts/report-files';
import { ensureDatabase, migrateOnce, seedOrg, addOrgMember, asApp, resetOrgs } from '../support/db';
import { ensureRedis, seedCredential, resetCredentials } from '../support/auth';
import { ensurePlatformSkillCatalogSeeded } from '../../src/infrastructure/skill/ensure-platform-skill-catalog';
import { ReportFileErrorCode } from '@repo/contracts/report-files';
import { createNativeSessionTransport } from '../../src/infrastructure/agent-run/native-session-transport';
import { migrationConfig } from '../../src/infrastructure/db/pg-config';
import { toOrgId } from '../../src/domain/org-id';
import { ENSURE_DEFAULT_AGENT_REPOSITORY, ensureDefaultAgent } from '../../src/application/agent/ensure-default-agent';
import { NATIVE_OUTPUT_STAGING, type NativeOutputStaging } from '../../src/application/agent-run/native-output-staging';
import { OBJECT_STORE, type ObjectStore } from '../../src/application/artifact/ports';
import { AGENT_RUN_EXECUTOR, type AgentRunExecutorPort } from '../../src/application/agent-run/ports';
import { TOOL_PERMISSION_GRANT_STORE, type ToolPermissionGrantStore } from '../../src/application/agent-run/tool-permission-grants';
const org = toOrgId(`report-native-${randomUUID()}`), userId = `report-actor-${randomUUID()}`;
const evidence = process.env.WX_REPORT_FILES_REAL_EVIDENCE!;
const repoRoot = join(process.cwd(), '../..');
let app: NestExpressApplication | undefined, relay: Server | undefined, deepAgent: ChildProcess | undefined, root = '', base = '';
let deepOutput = '';
let headers: Record<string, string>;
const bindings: { kind: 'research' | 'interview'; id: string }[] = [];
const receipts: unknown[] = [];
const acceptedRunIds: string[] = [];
const longBody = Array.from({ length: 18 }, (_, index) => `验收段落 ${index + 1}：核验采购预算授权、决策责任、现有系统使用情况与决策时间安排。本段是已保存材料的导出测试数据，尚需通过真实访谈及原始记录逐项确认，不能将模拟推断作为事实。`).join('\n\n');
const sourceLink = '来源链接（验收样本）：https://example.com/procurement-proof';
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function runProcess(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args); let stdout = '', stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { if (stderr.length < 4000) stderr += c; });
    child.on('error', reject); child.on('close', code => { clearTimeout(timeout); if (code === 0) resolve(stdout); else { void writeFile(join(evidence, command === 'docker' ? 'relay-process-failure.log' : 'native-probe-failure.log'), `${command}: ${stderr}
${stdout.slice(0, 2000)}`, { mode: 0o600 }); reject(new Error('owned sandbox relay failed; private diagnostic recorded')); } });
    child.stdin.end(input);
  });
}
async function json(path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) { const error = await response.json().catch(() => ({})) as { reasonCode?: unknown }; const code = ReportFileErrorCode.safeParse(error.reasonCode); throw new Error(`local API ${response.status} ${code.success ? code.data : 'unclassified'} at ${path.split('/').slice(0, 3).join('/')}`); }
  return response.json();
}
beforeAll(async () => {
  ensureDatabase(); ensureRedis(); await migrateOnce(); await ensurePlatformSkillCatalogSeeded();
  root = await mkdtemp(join(tmpdir(), 'wx-report-native-'));
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const fixture = await readFile(join(repoRoot, 'apps/deep-agent-service/tests/native_sandbox_fixture.py'), 'utf8');
  const relayCode = fixture.split('_UDS_RELAY = r"""')[1]?.split('"""')[0];
  if (!relayCode) throw new Error('existing UDS relay source missing');
  const socket = join(root, 'sandbox.sock');
  relay = createServer(async (request, response) => {
    try {
      let body = ''; for await (const chunk of request) body += chunk;
      const result = JSON.parse(await runProcess('docker', ['exec', '-i', process.env.WX_NATIVE_SANDBOX_CONTAINER!, 'node', '-e', relayCode], JSON.stringify({ method: request.method, path: request.url, headers: request.headers, body })));
      response.writeHead(result.status, { 'content-type': 'application/json' }); response.end(result.body);
    } catch (error) { await writeFile(join(evidence, 'relay-failure.json'), JSON.stringify({ name: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : 'unknown' }), { mode: 0o600 }); response.writeHead(503); response.end('{}'); }
  });
  await new Promise<void>(resolve => relay!.listen(socket, resolve));
  // Verify the exact existing native read/execute protocol before making any model request.
  process.env.PYTHONPATH = join(repoRoot, 'apps/deep-agent-service/src');
  const transport = createNativeSessionTransport(socket);
  const probe = await transport.create([], [{ path: '/inputs/probe/saved-report.md', contentBase64: Buffer.from('NATIVE_INPUT_PROBE_OK').toString('base64') }]);
  try {
    const script = `import sys,json,httpx,shlex
from deep_agent_service.sandbox_backend import HttpSessionSandbox
p=json.load(sys.stdin)
with httpx.Client(transport=httpx.HTTPTransport(uds=p['socket']),base_url='http://sandbox') as c:
 s=HttpSessionSandbox(p['sessionId'],p['token'],c)
 assert 'NATIVE_INPUT_PROBE_OK' in str(s.read('/inputs/probe/saved-report.md'))
 result=s.execute('node -e '+shlex.quote("process.stdout.write('NATIVE_EXECUTE_PROBE_OK')"))
 assert result.exit_code==0 and 'NATIVE_EXECUTE_PROBE_OK' in result.output
 print('NATIVE_PROTOCOL_PROBE_OK')`;
    expect(await runProcess(join(repoRoot, 'apps/deep-agent-service/.venv/bin/python'), ['-c', script], JSON.stringify({ ...probe, socket }))).toContain('NATIVE_PROTOCOL_PROBE_OK');
  } finally { await transport.destroy(probe.sessionId, probe.token); }
  const apiPort = Number(process.env.WORKSPACEX_API_PORT), deepPort = Number(process.env.WORKSPACEX_DEEP_AGENT_PROVIDER_PORT);
  if (!apiPort || !deepPort) throw new Error('isolated ports missing');
  Object.assign(process.env, { KERNEL_QUIET: '1', KERNEL_AGENT_RUN_AUTOSTART: '0', KERNEL_NATIVE_RUNTIME: '1',
    KERNEL_DEEP_AGENT_BASE_URL: `http://127.0.0.1:${deepPort}`, KERNEL_DEEP_AGENT_STREAM_ENABLED: '1', KERNEL_DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED: '1',
    KERNEL_SUBTASK_CALLBACK_BASE_URL: `http://127.0.0.1:${apiPort}`, NATIVE_SESSION_SOCKET: socket,
    NATIVE_SESSION_BINDING_KEY: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    DEEP_AGENT_SERVICE_INTERNAL_KEY: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    WORKSPACEX_OBJECT_ROOT: join(root, 'objects'), KERNEL_DEFAULT_AGENT_MODEL_ID: process.env.KERNEL_MODEL_ID,
    KERNEL_DEEP_AGENT_MODEL_ID: process.env.KERNEL_MODEL_ID,
  });
  const config = migrationConfig();
  const dsn = `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}`;
  const deepEnv = { ...process.env, DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED: '1', DEEP_AGENT_USAGE_SPOOL_DIR: join(root, 'usage-spool'), NATIVE_SESSION_SERVICE_BASE_URL: `http://127.0.0.1:${apiPort}`, NATIVE_SESSION_SERVICE_KEY: process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY, PYTHONPATH: join(repoRoot, 'apps/deep-agent-service/src'), DEEP_AGENT_CHECKPOINT_DB: dsn };
  deepAgent = spawn(join(repoRoot, 'apps/deep-agent-service/.venv/bin/python'), ['-m', 'uvicorn', 'deep_agent_service.http_app:app', '--host', '127.0.0.1', '--port', String(deepPort), '--workers', '1'], { cwd: repoRoot, env: deepEnv });
  deepOutput = ''; deepAgent.stdout!.on('data', c => { deepOutput += c; }); deepAgent.stderr!.on('data', c => { deepOutput += c; });
  const deadline = Date.now() + 90000; let ready = false;
  while (Date.now() < deadline) {
    if (deepAgent.exitCode !== null) break;
    try { ready = (await fetch(`http://127.0.0.1:${deepPort}/healthz`)).ok; if (ready) break; } catch { /* bounded startup */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) { await writeFile(join(evidence, 'deep-service-startup.log'), deepOutput, { mode: 0o600 }); throw new Error('existing DeepAgent service did not become ready'); }
  await seedOrg({ orgId: org, projectId: `project-${org}` }); await addOrgMember(org, userId, 'consultant', null);
  const email = `${userId}@example.com`, password = `native-fixture-${randomUUID()}`;
  await seedCredential({ userId, email, password, emailVerified: true });
  const { createApp } = await import('../../src/main'); app = await createApp(); await app.listen(apiPort, '127.0.0.1'); base = await app.getUrl();
  await ensureDefaultAgent({ repo: app.get(ENSURE_DEFAULT_AGENT_REPOSITORY) }, { orgId: org, actorId: userId });
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200); const auth = await login.json() as { sessionToken: string };
  headers = { authorization: `Bearer ${auth.sessionToken}`, 'content-type': 'application/json' };
  const created = await json('/interviews/digital', { name: '中文采购决策报告', tags: ['本地验收'], scope: { kind: 'none', projectId: null, researchProjectId: null }, requestId: randomUUID() }) as { interviewId: string };
  const path = `/interviews/digital/${created.interviewId}/markdown`;
  let interview = interviewMarkdown.InterviewMarkdownEnvelope.parse(await json(path));
  interview = interviewMarkdown.InterviewMarkdownEnvelope.parse(await json(`${path}/initialize`, { expectedVersion: interview.version }));
  await json(`${path}/report`, { markdown: `# 中文采购决策报告\n\n## 核心发现\n应追访真实采购负责人，当前为模拟材料，不作为实地证据。\n\n${longBody}\n\n${sourceLink}\n\n## 下一步\n对预算、采购周期与决策责任开展验证。`, expectedVersion: interview.version, expectedDocumentVersion: 0 });
  bindings.push({ kind: 'interview', id: created.interviewId });
  const session = research.GuidedResearchSession.parse(await json('/research/guided-sessions', { title: '中文研究报告', tags: [], idempotencyKey: randomUUID(), collaboratorUserIds: [], brief: { topic: '采购证据', goal: '核验采购流程', timeRange: '', region: '中国', focus: '决策责任' } }));
  const state = research.GuidedResearchRuntime.parse(await json(`/research/guided-sessions/${session.sessionId}/runtime`));
  const saved = research.GuidedResearchRuntime.parse({ ...state, version: 1, currentNode: 'report', completed: true,
    availableNodes: ['brief', 'directions', 'outline', 'research', 'report'],
    outline: [{ id: 'sec-1', title: '核心发现', questions: ['如何核验采购责任？'], enabled: true, order: 0 }],
    report: { title: '中文研究报告', summary: '当前研究发现应先核验预算与采购责任。', introduction: '本报告依据已保存内容形成，尚有证据缺口。',
      sections: [{ sectionId: 'sec-1', body: `采购责任与预算授权仍需真实材料核验，不能将推断视为事实。\n\n${longBody}\n\n${sourceLink}`, sourceIds: [] }], conclusion: '下一步追访采购负责人并核对预算授权。' } });
  // A saved report fixture, not a mocked model result or fabricated AgentRun/receipt.
  await asApp(org, c => c.query('UPDATE guided_research_runtime SET state=$3::jsonb WHERE org_id=$1 AND session_id=$2', [org, session.sessionId, JSON.stringify(saved)]));
  bindings.push({ kind: 'research', id: session.sessionId });
}, 180000);
afterAll(async () => {
  // Preserve real terminal/journal evidence even when a budget or quality assertion fails.
  if (base && headers) for (const runId of acceptedRunIds) {
    for (const [suffix, endpoint] of [['run', `/agent-runs/${runId}`], ['journal', `/agent-runs/${runId}/execution-events`]] as const) {
      try { await writeFile(join(evidence, `${runId}-${suffix}.json`), JSON.stringify(await json(endpoint), null, 2), { mode: 0o600 }); } catch { /* failure stays failed; cleanup still runs */ }
    }
    try {
      const staged = await app!.get<NativeOutputStaging>(NATIVE_OUTPUT_STAGING).listFiles(org, runId);
      for (const file of staged) {
        const bytes = await app!.get<ObjectStore>(OBJECT_STORE).get(file.objectKey);
        if (bytes) await writeFile(join(evidence, `${runId}-diagnostic-${file.name}`), bytes, { mode: 0o600 });
      }
    } catch { /* Diagnostic staged bytes never imply successful report delivery. */ }
  }

  await writeFile(join(evidence, 'receipts.json'), JSON.stringify(receipts, null, 2), { mode: 0o600 }).catch(() => undefined);
  let redacted = deepOutput; for (const key of ['KERNEL_MODEL_API_KEY', 'DASHSCOPE_API_KEY', 'DEEP_AGENT_SERVICE_INTERNAL_KEY', 'NATIVE_SESSION_BINDING_KEY']) { const value = process.env[key]; if (value) redacted = redacted.replaceAll(value, '[redacted]'); }
  await writeFile(join(evidence, 'deep-service.log'), redacted, { mode: 0o600 }).catch(() => undefined);
  await app?.close();
  if (deepAgent && deepAgent.exitCode === null) { deepAgent.kill('SIGTERM'); await new Promise<void>(resolve => { const timeout = setTimeout(() => { deepAgent?.kill('SIGKILL'); resolve(); }, 5000); deepAgent!.once('close', () => { clearTimeout(timeout); resolve(); }); }); }
  if (relay) await new Promise<void>(resolve => relay!.close(() => resolve()));
  await resetOrgs(org); await resetCredentials([userId], [`${userId}@example.com`]);
  if (root) await rm(root, { recursive: true, force: true });
});
type ReportFileFormat = keyof typeof REPORT_FILE_FORMATS;
const formats = (process.env.WX_REPORT_FILES_FORMATS ?? 'pdf,docx,pptx').split(',') as ReportFileFormat[];
// Test-only budget; product admission/accounting remains unchanged.
const requestBudget = Number(process.env.WX_REPORT_FILES_REQUEST_BUDGET ?? '20');
if (!Number.isInteger(requestBudget) || requestBudget < 1 || requestBudget > 24) throw new Error('native evidence request budget must be an integer from 1 to 24');
for (const format of formats) for (const kind of ['interview', 'research'] as const) it(`${kind} current report produces a real ${format} via genuine AgentRun native Skill execution and authenticated attachment download`, async () => {
  const binding = bindings.find(item => item.kind === kind)!;
  const source = ReportFileSourceInfo.parse(await json(`/report-files/sources/${kind}/${binding.id}`));
  let job = ReportFileJob.parse(await json('/report-files', { source: { kind, id: binding.id, reportVersion: source.reportVersion, reportHash: source.reportHash }, format, requestId: randomUUID() }));
  expect(job.status).toBe('running'); expect(job.execution?.runId).toBeTruthy();
  const runId = job.execution!.runId; acceptedRunIds.push(runId);
  const grant = app!.get<ToolPermissionGrantStore>(TOOL_PERMISSION_GRANT_STORE);
  for (const tool of ['call_skill', 'list_org_skills', 'write_todos', 'read_file', 'write_file', 'edit_file', 'ls', 'glob', 'execute', 'wx_artifact_publish']) await grant.grantForRun(org, runId, tool);
  // Test-only call budget, enforced through the existing authorized cancellation API.
  let cancelling = false, exceeded = false;
  const budget = setInterval(() => {
    if (cancelling) return;
    cancelling = true;
    void asApp(org, c => c.query<{ count: string }>('SELECT count(*) FROM model_request_starts WHERE org_id=$1 AND run_id=$2', [org, runId])).then(async result => {
      if (Number(result.rows[0]!.count) >= requestBudget) { exceeded = true; await fetch(`${base}/agent-runs/${runId}/cancel`, { method: 'POST', headers }); }
    }).catch(() => { exceeded = true; }).finally(() => { cancelling = false; });
  }, 2000);
  try { await app!.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(org); }
  finally { clearInterval(budget); }
  expect(exceeded, 'native evidence call budget exceeded').toBe(false);
  job = ReportFileJob.parse(await json(`/report-files/${job.id}`));
  const runResponse = await fetch(`${base}/agent-runs/${runId}`, { headers }); expect(runResponse.status).toBe(200);
  const run = await runResponse.json() as { status: string; steps: { toolName: string | null; status: string; toolArgsSummary: string | null }[]; resultMessageId: string | null; skillVersionIds: string[] };
  await writeFile(join(evidence, `${kind}-${format}-run.json`), JSON.stringify(run, null, 2), { mode: 0o600 });
  const journal = await json(`/agent-runs/${runId}/execution-events`) as { events: { kind: string; fact?: { stage: string; skillStableName: string; skillVersion: string } }[] };
  await writeFile(join(evidence, `${kind}-${format}-journal.json`), JSON.stringify(journal, null, 2), { mode: 0o600 });
  expect(journal.events.some(event => event.kind === 'skill_activity' && event.fact?.stage === 'body_read' && event.fact.skillStableName === REPORT_FILE_FORMATS[format].skillStableName && event.fact.skillVersion === run.skillVersionIds[0])).toBe(true);
  expect(run.steps.some(step => step.toolName === 'execute' && step.status === 'succeeded')).toBe(true);
  expect(run.steps.some(step => step.toolName === 'wx_artifact_publish' && step.status === 'succeeded')).toBe(true);
  await writeFile(join(evidence, `${kind}-${format}-job.json`), JSON.stringify(job, null, 2), { mode: 0o600 });
  const produced = await json(`/chat/threads/${job.execution!.threadId}/attachments`) as { items: { id: string; messageId: string; mime: string }[] };
  const actualOutput = produced.items.find(item => item.messageId === run.resultMessageId && item.mime === REPORT_FILE_FORMATS[format].mediaType);
  if (actualOutput) {
    const original = await fetch(`${base}/chat/threads/${job.execution!.threadId}/attachments/${actualOutput.id}/content?download=1`, { headers });
    await writeFile(join(evidence, `${kind}-${format}-produced${REPORT_FILE_FORMATS[format].extension}`), new Uint8Array(await original.arrayBuffer()), { mode: 0o600 });
  }
  expect(job.status).toBe('succeeded'); if (job.status !== 'succeeded') return;
  const downloaded = await fetch(`${base}/report-files/${job.id}/download`, { headers }); expect(downloaded.status).toBe(200);
  const bytes = new Uint8Array(await downloaded.arrayBuffer()); expect(sha(bytes)).toBe(job.file.sha256); expect(bytes.byteLength).toBe(job.file.sizeBytes);
  const attached = await json(`/chat/threads/${job.execution!.threadId}/attachments`) as { items: { id: string; messageId: string; mime: string; filename: string }[] };
  const output = attached.items.filter(item => item.messageId === run.resultMessageId && item.mime === job.file.mediaType); expect(output).toHaveLength(1);
  const content = await fetch(`${base}/chat/threads/${job.execution!.threadId}/attachments/${output[0]!.id}/content?download=1`, { headers }); expect(content.status).toBe(200); expect(sha(new Uint8Array(await content.arrayBuffer()))).toBe(job.file.sha256);
  await writeFile(join(evidence, `${kind}-${format}${REPORT_FILE_FORMATS[format].extension}`), bytes, { mode: 0o600 });
  const starts = await asApp(org, c => c.query<{ count: string }>('SELECT count(*) FROM model_request_starts WHERE org_id=$1 AND run_id=$2', [org, runId]));
  expect(Number(starts.rows[0]!.count)).toBeGreaterThan(0);
  receipts.push({ sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), kind, format, requestBudget, source, job, attachmentId: output[0]!.id, actualModelRequests: Number(starts.rows[0]!.count) });
}, 600000);
