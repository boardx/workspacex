#!/usr/bin/env -S npx tsx
/**
 * 一次性把「上会材料智能审阅助手」（/agent/team1）发布成真实 Agent，打印 agentId。
 *
 * 对应 docs/agents/team1-ic-review-mvp.md 的 B8：这不是脚手架，是把 2026-09-15
 * 在开发沙箱里手工跑通过一次的真实流程（POST /agents → PATCH 设置 instructions
 * → POST self-publish）固化成脚本，供任何一个真实部署环境的运维一条命令跑完，
 * 不用再逐条敲 curl。**幂等**：按 name 查已有 Agent，存在则直接复用并刷新
 * instructions，不会每次都建一个新的。
 *
 * 用法：
 *   API_BASE_URL=https://<真实部署域名> \
 *   API_LOGIN_EMAIL=<有 admin 角色的账号> \
 *   API_LOGIN_PASSWORD=<密码> \
 *   npx tsx scripts/publish-team1-agent.ts
 *
 * 跑完把打印出的 agentId 填进
 * apps/web/lib/ic-review/agent-directory.ts 的 `agentId` 字段（或设置
 * NEXT_PUBLIC_TEAM1_AGENT_ID 环境变量，见该文件头注——二选一，不需要都做）。
 */
import { buildReviewPrompt } from "../../web/lib/ic-review/review-prompt";

const BASE = process.env.API_BASE_URL ?? "http://127.0.0.1:3200";
const EMAIL = required("API_LOGIN_EMAIL");
const PASSWORD = required("API_LOGIN_PASSWORD");
const AGENT_NAME = "上会材料智能审阅助手";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}`);
  return v;
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  return body ? (JSON.parse(body) as T) : (undefined as T);
}

async function main() {
  const login = await call<{ sessionToken: string }>("/auth/login", {
    method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const token = login.sessionToken;

  const existing = await call<Array<{ agentId: string; name: string; publishState: string }>>(
    `/agents?tag=&publishState=&visibility=`, { token },
  ).catch(() => [] as Array<{ agentId: string; name: string; publishState: string }>);
  let agentId = existing.find((a) => a.name === AGENT_NAME)?.agentId;

  if (!agentId) {
    const created = await call<{ agentId: string }>("/agents", {
      method: "POST", token,
      body: JSON.stringify({
        name: AGENT_NAME, initials: "IC",
        role: "上会材料智能审阅助手，读材料、对照上会标准查缺、跨文档交叉验证找矛盾，只出事实与追问不给投资结论",
        roleLabel: "审阅助手", visibility: "全组织可用", cloneFrom: null, source: "self",
      }),
    });
    agentId = created.agentId;
    console.log(`created agent ${agentId}`);
  } else {
    console.log(`reusing existing agent ${agentId}`);
  }

  await call(`/agents/${agentId}`, {
    method: "PATCH", token,
    body: JSON.stringify({ agentId, patch: { instructions: buildReviewPrompt([]) }, expectedVersion: "0" }),
  });
  console.log("instructions set");

  const published = await call<{ publishState: string }>(`/agents/${agentId}/self-publish`, {
    method: "POST", token, body: JSON.stringify({ agentId }),
  }).catch((e: Error) => {
    // 已经发布过 ⇒ AGENT_NOT_DRAFT，这是幂等重跑的正常路径，不是失败。
    if (String(e).includes("422")) return { publishState: "运行中（已发布，跳过）" };
    throw e;
  });

  console.log(`\nagentId: ${agentId}`);
  console.log(`publishState: ${published.publishState}`);
  console.log(`\n把上面这个 agentId 填进 apps/web/lib/ic-review/agent-directory.ts 的 agentId 字段，`);
  console.log(`或设置环境变量 NEXT_PUBLIC_TEAM1_AGENT_ID=${agentId}（二选一）。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
