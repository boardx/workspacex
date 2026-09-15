#!/usr/bin/env -S npx tsx
/**
 * 一次性把「投后财务项目评级 Agent」（/agent/team2）发布成真实 Agent，打印 agentId。
 *
 * 对应 docs/agents/team2-postinvest-rating-mvp.md 的 B6。仿
 * `publish-team1-agent.ts` 的已验证流程（POST /agents → PATCH 设置 instructions
 * → POST self-publish）。**幂等**：按 name 查已有 Agent，存在则直接复用并刷新
 * instructions，不会每次都建一个新的。
 *
 * 用法：
 *   API_BASE_URL=https://<真实部署域名> \
 *   API_LOGIN_EMAIL=<有 admin 角色的账号> \
 *   API_LOGIN_PASSWORD=<密码> \
 *   npx tsx scripts/publish-team2-agent.ts
 *
 * 跑完把打印出的 agentId 填进
 * apps/web/lib/postinvest-rating/agent-directory.ts 的 `agentId` 字段（或设置
 * NEXT_PUBLIC_TEAM2_AGENT_ID 环境变量，见该文件头注——二选一，不需要都做）。
 *
 * ⚠ skill 挂载：`document-understanding`/`data-analysis`/`pdf-create`/`xlsx-create`
 * 均为 Phase 13 起的平台级 skill，按其规则"对所有组织默认可见、可挂载、可执行，
 * 不需要任何组织的 admin 手动导入"，预期该 Agent 发布后不挂载也能直接使用；
 * 如果在真实环境验收时发现模型报"没有这个工具"，下一步是调用
 * `agentRuntime.operations.setAgentSkillPins`（`POST /admin/agents/:agentId/skill-pins`，
 * 需要先查到这四个 skill 当前的 `skillVersionId`）显式挂载——本脚本不做这一步，
 * 因为本会话没有真实部署环境可以验证"平台级默认可见"对已发布 Agent 是否同样生效，
 * 不替它假装验证过。
 */
import { buildRatingPrompt } from "../../web/lib/postinvest-rating/rating-prompt";

const BASE = process.env.API_BASE_URL ?? "http://127.0.0.1:3200";
const EMAIL = required("API_LOGIN_EMAIL");
const PASSWORD = required("API_LOGIN_PASSWORD");
const AGENT_NAME = "投后财务项目评级 Agent";

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
        name: AGENT_NAME, initials: "PI",
        role: "读投后项目的财务报表/审计报告/访谈录音，用沙箱确定性脚本按固定公式算 A-E 评级，出依据表与不确定性标注，不做投资结论",
        roleLabel: "投后评级助手", visibility: "全组织可用", cloneFrom: null, source: "self",
      }),
    });
    agentId = created.agentId;
    console.log(`created agent ${agentId}`);
  } else {
    console.log(`reusing existing agent ${agentId}`);
  }

  await call(`/agents/${agentId}`, {
    method: "PATCH", token,
    body: JSON.stringify({ agentId, patch: { instructions: buildRatingPrompt([]) }, expectedVersion: "0" }),
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
  console.log(`\n把上面这个 agentId 填进 apps/web/lib/postinvest-rating/agent-directory.ts 的 agentId 字段，`);
  console.log(`或设置环境变量 NEXT_PUBLIC_TEAM2_AGENT_ID=${agentId}（二选一）。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
