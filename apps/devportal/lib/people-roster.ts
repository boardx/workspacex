// people-roster.ts — W5 /p/:slug/people 花名册的真实数据源（替换 lib/mock/p30.ts 的 MOCK_ROSTER）。
//
// 数据来源（全部是已存在的真实端点，本文件不新增后端）：
//   - 成员：PlatformDirectory memberships（lib/directory.ts listProjectMemberships，按 slug 过滤，
//     只取 status=active）+ engineers（display_name / github_login）。
//   - 名下 agent：.harness/agents/registry.yaml（active，owner 归一成 GitHub login 后与成员的
//     github_login 匹配——join 键是认证锚点 github_login，绝不用 handle，同 workspace-authz 纪律）。
//     点号 id（parent.sub）挂到 parent 下作为 sub-agent。
//   - 在做什么 / 心跳：coord-gateway /claims 活跃租约（agent_id → resource_id + last_heartbeat_at）。
//
// 不存在真实来源、因此不再展示的 mock 字段：信任级（Core/Trusted/Probation）与成员「在做什么」
// 一行叙述——目录与网关都没有这两项数据，诚实省略而不是伪造。
//
// 诚实三态（ADR-006）：目录未配置 → unconfigured；已配置但读失败 → degraded；租约读失败只降级
// agent 心跳（degradedHeartbeat），不影响成员列表。
import { parse } from "yaml";
import { fetchActiveClaims, type CoordLease } from "@/lib/coord-gateway";
import {
  directoryReadConfigured,
  listEngineers,
  listProjectMemberships,
  type DirectoryEngineer,
  type DirectoryMembership,
} from "@/lib/directory";
import { readRepoFile } from "@/lib/repo-files";

export type RosterRole = "owner" | "maintainer" | "approver" | "contributor";

export interface RosterAgentNode {
  /** registry 里的 agent id（点号 = sub-agent） */
  id: string;
  /** 活跃租约的资源；无租约 = null（空闲） */
  resource: string | null;
  /** 距最后心跳分钟数；无租约 = null */
  heartbeatMin: number | null;
  subs: RosterAgentNode[];
}

export interface RosterMember {
  handle: string;
  name: string;
  role: RosterRole;
  agents: RosterAgentNode[];
}

export type RosterResult =
  | { state: "unconfigured" }
  | { state: "degraded" }
  | { state: "ok"; members: RosterMember[]; degradedHeartbeat: boolean };

export interface RosterRegistryAgent {
  id: string;
  owner?: string;
  active?: boolean;
}

const ROLES: readonly RosterRole[] = ["owner", "maintainer", "approver", "contributor"];

/** registry owner → GitHub login：`<id>+<login>@users.noreply.github.com` 或裸 login；其他邮箱无法可靠归一 → null。 */
export function ownerToGithubLogin(owner: string | undefined): string | null {
  if (!owner) return null;
  const noreply = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(owner);
  if (noreply) return noreply[1]!.toLowerCase();
  if (owner.includes("@")) return null;
  return owner.toLowerCase();
}

/** 纯函数：memberships + engineers + registry + 租约 → 花名册树。 */
export function buildRoster(input: {
  memberships: readonly DirectoryMembership[];
  engineers: readonly DirectoryEngineer[];
  registry: readonly RosterRegistryAgent[];
  leases: readonly CoordLease[];
  now: number;
}): RosterMember[] {
  const engineerById = new Map(input.engineers.map((e) => [e.engineer_id, e] as const));
  const leaseByAgent = new Map(input.leases.map((l) => [l.agent_id, l] as const));

  const toNode = (id: string): RosterAgentNode => {
    const lease = leaseByAgent.get(id);
    return {
      id,
      resource: lease?.resource_id ?? null,
      heartbeatMin: lease ? Math.max(0, (input.now - new Date(lease.last_heartbeat_at).getTime()) / 60_000) : null,
      subs: [],
    };
  };

  const agentsByLogin = new Map<string, RosterAgentNode[]>();
  const activeAgents = input.registry.filter((a) => a.active !== false);
  const ids = new Set(activeAgents.map((a) => a.id));
  for (const a of activeAgents) {
    const login = ownerToGithubLogin(a.owner);
    if (!login) continue;
    const parentId = a.id.includes(".") ? a.id.split(".")[0]! : null;
    if (parentId && ids.has(parentId)) continue; // 挂到 parent 下，见下一轮
    const node = toNode(a.id);
    node.subs = activeAgents.filter((s) => s.id.startsWith(`${a.id}.`)).map((s) => toNode(s.id));
    const list = agentsByLogin.get(login) ?? [];
    list.push(node);
    agentsByLogin.set(login, list);
  }

  return input.memberships
    .filter((m) => m.status === "active")
    .map((m): RosterMember => {
      const eng = engineerById.get(m.engineer_id);
      const handle = eng?.handle ?? m.engineer_handle ?? m.engineer_id;
      const login = eng?.github_login?.toLowerCase() ?? null;
      return {
        handle,
        name: eng?.display_name || handle,
        role: (ROLES as readonly string[]).includes(m.role) ? (m.role as RosterRole) : "contributor",
        agents: login ? agentsByLogin.get(login) ?? [] : [],
      };
    })
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.handle.localeCompare(b.handle));
}

/** 花名册 👤/🤖 分开计数（UC-03） */
export function rosterCounts(roster: readonly RosterMember[]): { humans: number; agents: number } {
  const countAgents = (nodes: readonly RosterAgentNode[]): number => nodes.reduce((sum, n) => sum + 1 + countAgents(n.subs), 0);
  return { humans: roster.length, agents: roster.reduce((sum, m) => sum + countAgents(m.agents), 0) };
}

async function loadRegistry(): Promise<RosterRegistryAgent[]> {
  const raw = await readRepoFile(".harness/agents/registry.yaml");
  if (!raw) return [];
  try {
    return (parse(raw) as { agents?: RosterRegistryAgent[] }).agents ?? [];
  } catch {
    return [];
  }
}

/** 服务端加载：/p/:slug/people 的 page.tsx 调用。 */
export async function loadProjectRoster(slug: string): Promise<RosterResult> {
  if (!directoryReadConfigured()) return { state: "unconfigured" };
  const [memberships, engineers, registry, claims] = await Promise.all([
    listProjectMemberships(slug),
    listEngineers(),
    loadRegistry(),
    fetchActiveClaims(),
  ]);
  if (memberships === null || engineers === null) return { state: "degraded" };
  const leases = claims.configured && "claims" in claims ? claims.claims : [];
  const degradedHeartbeat = claims.configured && "error" in claims;
  return { state: "ok", members: buildRoster({ memberships, engineers, registry, leases, now: Date.now() }), degradedHeartbeat };
}
