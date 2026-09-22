// 派工面鉴权（#480）：把 tasks 派工从「只有 COORD_ADMIN_TOKEN 这把万能钥匙」
// 恢复成原 coord-service 的 COORDINATOR_KINDS 判定——迁移时被简化掉、一直没补回来
// 的那一条。独立成文件是刻意的（同 auth.ts / directory.ts）：index.ts 只加路由，
// 降低与并行改动的冲突面。
//
// 鉴权矩阵（在 auth.ts 既有矩阵之上叠加，不改写它）：
//   COORD_ADMIN_TOKEN            → 放行（devportal broker 既有通道，零变更）
//   缺 COORD_ADMIN_TOKEN 配置     → 503（fail-closed，放宽不得变成 fail-open）
//   ops 万能钥匙 COORD_API_TOKEN  → 401（运维钥匙不是派工方，语义不变）
//   scoped token：
//     Directory 查无此 agent            → 401（token 有效 ≠ 有派工资格）
//     kind ∉ 协调层 / lifecycle ≠ active → 401
//     协调层但 issue 不在本人 areas 内    → 403 issue_out_of_areas
//     协调层且 issue 在 areas 内          → 放行，created_by 强绑定为 token 身份
//   伪造/跨仓 token → 403、已吊销 → 401（authorizeRepoAccess 原样，见 auth.ts 头注）
//
// 两条判据都取自**权威记录**，不看请求里的自证字段：
//   「谁能派工」= PlatformDirectory 的 agents.kind / .areas / .lifecycle；
//   「这条 issue 属于哪个域」= 本仓 RepoHub mirror 上的 module:* 标签。
// 取不到判据（issue 未镜像 / 无 module 标签）一律拒——fail-closed，ADR-017 纪律。
//
// 刻意**不**放宽的面：/tasks/import（D1 割接导入）仍是 admin 独占；worker 的
// GET /tasks 收件箱私有语义（inbox_is_private）不变，只对协调层开 assignee=*。
import type { Env } from "./index";
import { authorizeRepoAccess, requireAdmin, type RepoPrincipal } from "./auth";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 协调层 kind（与 devportal lib/dispatch.ts 的 COORDINATOR_KINDS、
 *  coord-directory AGENT_KINDS 同一套名字；权威记录在 Directory）。 */
const COORDINATOR_KINDS = new Set(["coordinator", "architecture-coordinator", "module-coordinator"]);

/** Directory 的 agent_id 形态（agt_<ULID>）。不匹配的 agent_id 不去打目录 DO——
 *  目录路由本身就只认这个形状，早退一步省一次跨 DO 往返。 */
const AGENT_ID_RE = /^agt_[0-9A-Z]+$/;

const MODULE_LABEL_PREFIX = "module:";

export interface CoordinatorAgent {
  agentId: string;
  kind: string;
  areas: string[];
}

function repoStub(env: Env, repo: string): DurableObjectStub {
  return env.REPOHUB.get(env.REPOHUB.idFromName(repo));
}

/** 目录里这个 agent 是不是**现在**有效的协调者。不是（查无 / kind 不对 /
 *  已 paused|retired）一律返回 null——调用方按「不是派工方」处理。 */
export async function lookupCoordinator(env: Env, agentId: string): Promise<CoordinatorAgent | null> {
  if (!AGENT_ID_RE.test(agentId)) return null;
  const res = await env.DIRECTORY.get(env.DIRECTORY.idFromName("platform"))
    .fetch(`https://directory/directory/agents/${agentId}`);
  if (res.status !== 200) return null;
  const body = (await res.json()) as { agent?: Record<string, unknown> };
  const agent = body.agent;
  if (!agent) return null;
  const kind = typeof agent["kind"] === "string" ? (agent["kind"] as string) : "worker";
  if (!COORDINATOR_KINDS.has(kind)) return null;
  // lifecycle 也是权威记录的一部分：暂停/退役的协调者不再是派工方（p30/F07）
  const lifecycle = typeof agent["lifecycle"] === "string" ? (agent["lifecycle"] as string) : "active";
  if (lifecycle !== "active") return null;
  const areas = Array.isArray(agent["areas"]) ? (agent["areas"] as unknown[]).filter((a): a is string => typeof a === "string") : [];
  return { agentId, kind, areas };
}

/** 请求主体是不是协调层 scoped token（GET /tasks 列全队的判定共用本函数）。 */
export async function coordinatorOfPrincipal(
  env: Env,
  principal: RepoPrincipal,
): Promise<CoordinatorAgent | null> {
  if (principal.kind !== "scoped") return null;
  return lookupCoordinator(env, principal.agentId);
}

/** mirror 标签 → 模块名（"module:chat" → "chat"）。标签既可能是字符串也可能是
 *  GitHub 原始载荷的 { name } 对象（同 brain.ts 的归一）。 */
function moduleNamesOf(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : typeof (l as { name?: unknown })?.name === "string" ? ((l as { name: string }).name) : ""))
    .filter((l) => l.startsWith(MODULE_LABEL_PREFIX))
    .map((l) => l.slice(MODULE_LABEL_PREFIX.length).trim().toLowerCase())
    .filter((l) => l.length > 0);
}

/** areas 覆盖判定：["*"] = 全仓；否则要与 issue 的 module:* 标签有交集。 */
export function areasCover(areas: string[], modules: string[]): boolean {
  if (areas.some((a) => a.trim() === "*")) return true;
  const owned = new Set(areas.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0));
  return modules.some((m) => owned.has(m));
}

/** 这条 issue 是否落在该协调者的 areas 内。放行返回 null，否则返回 403。
 *  未镜像 / 无 module 标签 → 取不到归属判据 → 拒（fail-closed）。 */
async function assertIssueInAreas(
  env: Env,
  repo: string,
  issue: number,
  agent: CoordinatorAgent,
): Promise<Response | null> {
  if (areasCover(agent.areas, [])) return null; // areas 含 "*"：不需要查 issue
  const res = await repoStub(env, repo).fetch(`https://repohub/realtime/issues/${issue}`);
  const modules = res.status === 200
    ? moduleNamesOf(((await res.json()) as Record<string, unknown>)["labels"])
    : [];
  if (areasCover(agent.areas, modules)) return null;
  return json(403, {
    error: "issue_out_of_areas",
    token_agent_id: agent.agentId,
    issue,
    agent_areas: agent.areas,
    issue_modules: modules,
    reason: res.status === 200
      ? (modules.length === 0 ? "issue_has_no_module_label" : "module_not_in_agent_areas")
      : "issue_not_mirrored",
  });
}

/** created_by / agent_id 强绑定（同 auth.ts bindScopedAgentArgs 的纪律）：自证他人
 *  一律 403，缺省注入 token 身份——审计链里的派工方必须是真实决策者（#480 的核心）。 */
function bindCreatedBy(body: Record<string, unknown>, agentId: string, field: string): Record<string, unknown> | Response {
  const claimed = body[field];
  if (claimed !== undefined && claimed !== null && claimed !== agentId)
    return json(403, { error: "token_agent_mismatch", token_agent_id: agentId, field });
  return { ...body, [field]: agentId };
}

async function parseJsonObject(text: string): Promise<Record<string, unknown> | null> {
  if (text.length === 0) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function forward(env: Env, repo: string, subpath: string, body: string): Promise<Response> {
  return repoStub(env, repo).fetch(new Request(`https://repohub${subpath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }));
}

/** tasks 写面（POST /tasks、/tasks/:id/recall、/tasks/import）的统一入口。
 *  admin 通道与既有行为逐字节一致；scoped 通道是 #480 新增的协调层派工面。 */
export async function handleTasksWrite(
  req: Request,
  env: Env,
  repo: string,
  subpath: string,
): Promise<Response> {
  // ① admin 面优先：既有 devportal broker 通道零变更。
  //    缺 COORD_ADMIN_TOKEN 配置时 requireAdmin 给 503——原样透传，放宽不得 fail-open。
  const adminDenied = requireAdmin(req, env);
  if (!adminDenied) {
    return repoStub(env, repo).fetch(new Request(`https://repohub${subpath}`, req));
  }
  if (adminDenied.status !== 401) return adminDenied; // 503 fail-closed

  // ② /tasks/import 是 D1 割接导入，不在 #480 的放宽范围内——仍是 admin 独占面
  if (subpath === "/tasks/import") return adminDenied;

  // ③ scoped 面：先按既有矩阵验 token（伪造 403 / 吊销 401 / 无 token 401）
  const access = await authorizeRepoAccess(req, env, repo);
  if (!access.granted) return access.response;
  if (access.principal.kind !== "scoped") return adminDenied; // ops 万能钥匙不是派工方 → 401

  const agent = await lookupCoordinator(env, access.principal.agentId);
  if (!agent)
    return json(401, {
      error: "dispatch_requires_coordinator",
      token_agent_id: access.principal.agentId,
    });

  const recall = subpath.match(/^\/tasks\/(\d+)\/recall$/);
  const rawBody = await req.text();
  const body = await parseJsonObject(rawBody);
  if (!body) return json(400, { error: "invalid_json" });

  if (recall) {
    // 撤回的范围判据挂在被撤回任务的 issue 上——先读回那条任务
    const taskRes = await repoStub(env, repo).fetch(`https://repohub/tasks/${recall[1]}`);
    if (taskRes.status !== 200) return taskRes;
    const task = ((await taskRes.json()) as { task?: { issue?: unknown } }).task;
    const issue = typeof task?.issue === "number" ? task.issue : null;
    if (issue === null) return json(404, { error: "task_not_found" });
    const outOfAreas = await assertIssueInAreas(env, repo, issue, agent);
    if (outOfAreas) return outOfAreas;
    // 撤回方身份进事件流（DO 的 recall actor 取 body.agent_id，缺省 "admin"）
    const bound = bindCreatedBy(body, agent.agentId, "agent_id");
    if (bound instanceof Response) return bound;
    return forward(env, repo, subpath, JSON.stringify(bound));
  }

  // POST /tasks：issue 字段本身的合法性交给 DO 判（400 单一出口），
  // 但只要它是个能判范围的 issue 号，范围门就必须先过
  const issue = body["issue"];
  if (typeof issue === "number" && Number.isInteger(issue) && issue > 0) {
    const outOfAreas = await assertIssueInAreas(env, repo, issue, agent);
    if (outOfAreas) return outOfAreas;
  }
  const bound = bindCreatedBy(body, agent.agentId, "created_by");
  if (bound instanceof Response) return bound;
  return forward(env, repo, subpath, JSON.stringify(bound));
}
