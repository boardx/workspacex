#!/usr/bin/env node
/**
 * Local evaluation lane for WorkspaceX Local (#3749 B0).
 *
 * Measures the INSTALLED stack (or any running stack) from the outside, the way a user hits it:
 * real chat runs through the API, then the deep-agent ledger for token timing. No source-stack
 * shortcuts: the numbers are about the build under test.
 *
 * Per chat run: wall time, first-chunk latency, output chunks (≈ tokens) and chunks/s, tool
 * calls, canvas-fence / JSON validity, system-prompt size (when DEEP_AGENT_URL+KEY are given).
 * JSON sites: followup-suggestions and feedback structure-draft latency + validity.
 *
 * Env: API (http://127.0.0.1:3200) EMAIL PASSWORD AGENT_ID ORG_ID PG_PORT (55432)
 *      DEEP_AGENT_URL (http://127.0.0.1:2024) DEEP_AGENT_KEY  OUT (json path)  SUITE (all|chat|url|canvas|json)
 *      REPS (per prompt, default 1)
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
// `pg` lives in apps/api, not at the repo root
const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const pg = require("pg");

const API = process.env.API ?? "http://127.0.0.1:3200";
const PG_PORT = Number(process.env.PG_PORT ?? 55432);
const SUITE = process.env.SUITE ?? "all";
const REPS = Number(process.env.REPS ?? 1);
const OUT = process.env.OUT ?? `eval-local-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const AGENT_ID = process.env.AGENT_ID;
const ORG_ID = process.env.ORG_ID;
if (!AGENT_ID || !ORG_ID) { console.error("AGENT_ID and ORG_ID are required"); process.exit(2); }

const H = { "content-type": "application/json" };
async function login() {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: H, body: JSON.stringify({ email: process.env.EMAIL ?? "me@local.workspacex", password: process.env.PASSWORD }) });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const j = await r.json(); H.Authorization = `Bearer ${j.sessionToken}`;
}
async function j(m, p, b, attempts = m === "GET" ? 4 : 1) {
  for (let i = 1; ; i++) {
    const r = await fetch(API + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : null;
    // a transient 5xx on a read (PGlite backend busy) is retried; it is recorded, not fatal
    if (r.status >= 500 && i < attempts) { transient5xx++; await sleep(2000 * i); continue; }
    throw new Error(`${m} ${p} -> ${r.status} ${t.slice(0, 160)}`);
  }
}
let transient5xx = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPTS = {
  chat: ["用一句话介绍你自己", "把下面这句话改得更正式：我们明天再聊吧", "列出三个提高会议效率的办法", "解释一下什么是用户画像，两句话", "把 1234 乘以 56 算出来，只给结果"],
  url: ["读取 https://www.ruanyifeng.com/blog/index.html 这个页面，用两句话说明它是什么", "分析网址：https://www.baidu.com/ 的内容是什么网站", "读取 https://www.ruanyifeng.com/blog/index.html，列出其中提到的一个文章标题", "https://www.baidu.com/ 这个页面的标题是什么", "读取 https://www.ruanyifeng.com/blog/index.html 并总结三点"],
  canvas: ["生成一个用户画像：AI 转型时代的传媒大学教授", "生成一个高等教育创新者的画像", "为一家社区咖啡店做一张 SWOT 画布", "为一款面向高校的 AI 助教产品做商业模式画布", "为大学生求职者做一张 JTBD 画布"],
  feedback: ["我觉得画布生成太慢了，等了四分钟才出来，而且中间没有任何进度提示", "登录页在本地版还要输密码，应该直接进去", "技能列表是空的，点了没反应，不知道是不是坏了", "语音识别中文夹英文时经常把英文单词写错", "导出的 PDF 太大了，一张画布 30 MB"],
};

async function ledgerTiming(client, remoteRunId) {
  if (!client || !remoteRunId) return {};
  // `modelCalls` is the low-variance measure of agent-loop efficiency: wall time on a busy
  // laptop swings 3x for the same prompt, the number of model round trips does not.
  const nodes = await client.query("select data from wsx_agent_events where run_id=$1 and event='updates'", [remoteRunId]);
  const modelCalls = nodes.rows.filter((x) => Object.keys(x.data ?? {}).includes("model")).length;
  const toolNodes = nodes.rows.filter((x) => Object.keys(x.data ?? {}).includes("tools")).length;
  const r = await client.query("select event, created_at from wsx_agent_events where run_id=$1 order by sequence", [remoteRunId]);
  const rows = r.rows; if (!rows.length) return {};
  const chunks = rows.filter((x) => x.event === "messages");
  const first = rows[0].created_at, firstChunk = chunks[0]?.created_at, lastChunk = chunks.at(-1)?.created_at;
  const genMs = firstChunk && lastChunk ? lastChunk - firstChunk : null;
  return { modelCalls, toolNodes, firstChunkMs: firstChunk ? firstChunk - first : null, chunks: chunks.length, chunksPerSec: genMs ? +(chunks.length / (genMs / 1000)).toFixed(1) : null, lastEventMs: rows.at(-1).created_at - first };
}
async function systemPromptChars(remoteThreadId) {
  if (!process.env.DEEP_AGENT_URL || !process.env.DEEP_AGENT_KEY || !remoteThreadId) return null;
  try {
    const r = await fetch(`${process.env.DEEP_AGENT_URL}/threads/${remoteThreadId}/state`, { headers: { Authorization: `Bearer ${process.env.DEEP_AGENT_KEY}` } });
    const s = await r.json(); const m = (s.values?.messages ?? [])[0];
    return m?.type === "system" ? (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length) : null;
  } catch { return null; }
}

async function chatRun(client, category, text) {
  // an explicit title is never replaced by auto-titling; try an untitled thread first so the title metric is real
  const mk = (title) => j("POST", "/chat/threads/mutate", { op: "create", projectId: null, threadId: null, groupId: null, title, visibilityScope: null, expectedVersion: null, reason: null });
  const th = await mk(null).catch(() => mk(`eval ${category}`));
  const t0 = Date.now();
  const m = await j("POST", `/chat/threads/${th.threadId}/messages`, { text, agentId: AGENT_ID, clientMessageId: crypto.randomUUID() });
  let run;
  for (let i = 0; i < 180; i++) {
    await sleep(2000); run = await j("GET", `/agent-runs/${m.agentRunId}`);
    if (run.status === "awaiting_tool_permission" && run.pendingApproval?.permissionRequestId) { await j("POST", `/agent-runs/${m.agentRunId}/decision`, { decision: "approve", permissionRequestId: run.pendingApproval.permissionRequestId }); continue; }
    if (/^(succeeded|failed|cancelled)$/.test(run.status)) break;
  }
  const wallMs = Date.now() - t0;
  const msgs = await j("GET", `/chat/threads/${th.threadId}/messages?limit=20`);
  const agent = msgs.messages.filter((x) => x.authorKind === "agent").map((x) => x.text ?? "").join("\n");
  let remote = {};
  if (client) { const r = await client.query("select remote_run_id, remote_thread_id from agent_runs where id=$1", [m.agentRunId]).catch(() => ({ rows: [] })); remote = r.rows[0] ?? {}; }
  const timing = await ledgerTiming(client, remote.remote_run_id);
  const tools = (run.steps ?? []).filter((s) => s.kind === "tool_call").map((s) => s.toolName);
  return { category, text, threadId: th.threadId, runId: m.agentRunId, status: run.status, wallMs, ...timing, systemPromptChars: await systemPromptChars(remote.remote_thread_id), tools, outputChars: agent.length, canvasFence: /```canvas\n模板: /.test(agent), mermaid: /```mermaid/.test(agent) };
}

async function followup(threadId) {
  const t0 = Date.now();
  try { const r = await j("POST", `/chat/threads/${threadId}/followup-suggestions`, { threadId, agentId: AGENT_ID }); return { ms: Date.now() - t0, ok: Array.isArray(r.suggestions) && r.suggestions.length >= 1, n: r.suggestions?.length ?? 0, suggestions: r.suggestions }; }
  catch (e) { return { ms: Date.now() - t0, ok: false, error: String(e.message).slice(0, 120) }; }
}
async function feedbackDraft(transcript) {
  const t0 = Date.now();
  try { const r = await j("POST", "/feedback/structure-draft", { transcript }); return { ms: Date.now() - t0, ok: !!(r?.title && r?.detail), title: r?.title }; }
  catch (e) { return { ms: Date.now() - t0, ok: false, error: String(e.message).slice(0, 120) }; }
}
async function titleAfter(threadId, sentText) {
  for (let i = 0; i < 30; i++) {
    const t = await j("GET", `/chat/threads?orgId=${ORG_ID}`);
    const card = t.groups.flatMap((g) => g.cards).find((c) => c.id === threadId);
    if (card && card.title && !card.title.startsWith("eval ") && card.title !== sentText) return { ok: true, title: card.title, waitedS: i * 2 };
    await sleep(2000);
  }
  return { ok: false };
}

function summarize(runs, jsons) {
  const by = {}; for (const r of runs) (by[r.category] ??= []).push(r);
  const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const lines = ["| 类别 | n | 成功 | 模型调用中位 | wall 中位 s | 首块中位 s | 块/s 中位 | 提示 chars | 用工具的 run | 画布围栏 |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const [c, rs] of Object.entries(by)) lines.push(`| ${c} | ${rs.length} | ${rs.filter((r) => r.status === "succeeded").length} | ${med(rs.map((r) => r.modelCalls)) ?? "-"} | ${(med(rs.map((r) => r.wallMs)) / 1000).toFixed(0)} | ${med(rs.map((r) => r.firstChunkMs)) != null ? (med(rs.map((r) => r.firstChunkMs)) / 1000).toFixed(1) : "-"} | ${med(rs.map((r) => r.chunksPerSec)) ?? "-"} | ${med(rs.map((r) => r.systemPromptChars)) ?? "-"} | ${rs.filter((r) => r.tools.length).length} | ${rs.filter((r) => r.canvasFence).length} |`);
  for (const [name, xs] of Object.entries(jsons)) if (xs.length) lines.push(`| ${name} | ${xs.length} | ${xs.filter((x) => x.ok).length} | - | ${(med(xs.map((x) => x.ms)) / 1000).toFixed(1)} | - | - | - | - | - |`);
  return lines.join("\n");
}

await login();
const client = new pg.Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: "local", database: "workspacex" });
await client.connect().then(() => client.query("select set_config('app.current_org',$1,false)", [ORG_ID])).catch((e) => { console.error("pg connect failed, ledger timing disabled:", e.message); });
const runs = [], jsons = { followup: [], feedback: [], title: [] };
// `json` needs the chat threads for title / follow-up, so it runs the chat prompts too
const want = (c) => SUITE === "all" || SUITE === c || (SUITE === "json" && c === "chat");
for (const category of ["chat", "url", "canvas"]) {
  if (!want(category)) continue;
  for (const text of PROMPTS[category]) for (let i = 0; i < REPS; i++) {
    const r = await chatRun(client, category, text); runs.push(r);
    console.log(`[${category}] ${r.status} wall=${(r.wallMs / 1000).toFixed(0)}s calls=${r.modelCalls ?? "-"} first=${r.firstChunkMs ?? "-"}ms chunks=${r.chunks ?? "-"} cps=${r.chunksPerSec ?? "-"} sys=${r.systemPromptChars ?? "-"} tools=${r.tools.join(",") || "-"} fence=${r.canvasFence} :: ${text.slice(0, 30)}`);
    if (category === "chat" && (SUITE === "all" || SUITE === "json")) { jsons.title.push(await titleAfter(r.threadId, text)); jsons.followup.push(await followup(r.threadId)); }
  }
}
if (want("json")) for (const t of PROMPTS.feedback) { const r = await feedbackDraft(t); jsons.feedback.push(r); console.log(`[feedback] ok=${r.ok} ${r.ms}ms ${r.title ?? r.error ?? ""}`); }
for (const f of jsons.followup) console.log(`[followup] ok=${f.ok} ${f.ms}ms n=${f.n ?? 0}`);
for (const t of jsons.title) console.log(`[title] ok=${t.ok} ${t.title ?? ""}`);
const summary = summarize(runs, jsons);
console.log("\n" + summary);
console.log(`transient 5xx on reads: ${transient5xx}`);
writeFileSync(OUT, JSON.stringify({ api: API, at: new Date().toISOString(), transient5xx, runs, jsons, summary }, null, 2));
console.log(`\nwritten ${OUT}`);
await client.end().catch(() => {});
