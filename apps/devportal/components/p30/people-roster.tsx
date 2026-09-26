// W5 /p/:slug/people 花名册（UC-03 / UC-05③）——真实数据：服务端 lib/people-roster.ts
// 聚合 PlatformDirectory memberships + registry.yaml + coord-gateway 租约后以 props 注入
// （已脱离 lib/mock/p30.ts）。👤→🤖 两段式缩进树：成员行 → 名下 agents 缩进 → 点号 sub 再缩进。
// 👤/🤖 计数分开；行悬停卡显示完整标识与归属链（D6）。
import { Badge } from "@/components/ui/badge";
import { HeartbeatDot } from "@/components/portal/heartbeat-dot";
import { EmptyState, IdentityChip } from "@/components/p30/shared";
import { rosterCounts, type RosterAgentNode, type RosterMember, type RosterResult } from "@/lib/people-roster";

const ROLE_BADGE: Record<RosterMember["role"], "default" | "secondary" | "outline"> = {
  owner: "default",
  maintainer: "secondary",
  approver: "secondary",
  contributor: "outline",
};

/** 行悬停卡：完整标识 + 归属链。group-hover 展现（含 focus-within 键盘可达）。 */
function HoverCard({ lines }: { lines: readonly string[] }) {
  return (
    <span
      data-testid="roster-hovercard"
      role="tooltip"
      className="pointer-events-none absolute left-8 top-full z-10 mt-1 hidden w-max max-w-brand rounded-10 border border-border bg-surface-dark px-3 py-2 text-12 leading-relaxed text-surface-dark-foreground shadow-lg transition-opacity group-hover:block group-focus-within:block"
    >
      {lines.map((l) => (
        <span key={l} className="block font-mono">
          {l}
        </span>
      ))}
    </span>
  );
}

function AgentRow({ node, depth, ownerHandle }: { node: RosterAgentNode; depth: 1 | 2; ownerHandle: string }) {
  return (
    <>
      <li
        data-testid={depth === 1 ? "roster-agent-row" : "roster-subagent-row"}
        tabIndex={0}
        className={`group relative flex flex-wrap items-center gap-2 rounded-8 border-l-2 border-l-tag-purple py-1.5 pr-2 transition-colors hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${depth === 1 ? "ml-8 pl-3" : "ml-16 pl-3"}`}
      >
        {node.heartbeatMin !== null && <HeartbeatDot minutes={node.heartbeatMin} />}
        <IdentityChip kind="agent" className="font-mono">
          {node.id}
        </IdentityChip>
        {depth === 2 && <span className="text-11 text-muted-foreground">sub</span>}
        <span className="min-w-0 flex-1 truncate text-12 text-muted-foreground">{node.resource ? `租约 ${node.resource}` : "空闲（无活跃租约）"}</span>
        <HoverCard lines={[node.id, `owner：@${ownerHandle}${depth === 2 ? ` · parent：${node.id.split(".")[0] ?? ""}` : ""}`]} />
      </li>
      {node.subs.map((s) => (
        <AgentRow key={s.id} node={s} depth={2} ownerHandle={ownerHandle} />
      ))}
    </>
  );
}

function MemberBlock({ m }: { m: RosterMember }) {
  return (
    <li className="py-2">
      <div
        data-testid="roster-member-row"
        tabIndex={0}
        className="group relative flex flex-wrap items-center gap-2 rounded-10 border-l-2 border-l-tag-blue bg-surface-1 py-2 pl-3 pr-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IdentityChip kind="human">@{m.handle}</IdentityChip>
        <span className="text-13 font-medium text-foreground">{m.name}</span>
        <Badge variant={ROLE_BADGE[m.role]} className="text-11">{m.role}</Badge>
        <span className="min-w-0 flex-1" />
        <span className="shrink-0 text-11 text-muted-foreground">🤖 ×{rosterCounts([m]).agents}</span>
        <HoverCard lines={[`@${m.handle} · ${m.name}`, m.role]} />
      </div>
      <ul className="mt-1 space-y-1">
        {m.agents.map((a) => (
          <AgentRow key={a.id} node={a} depth={1} ownerHandle={m.handle} />
        ))}
      </ul>
    </li>
  );
}

export function PeopleRoster({ slug, result }: { slug: string; result: RosterResult }) {
  const roster = result.state === "ok" ? result.members : [];
  const counts = rosterCounts(roster);

  return (
    <div className="mx-auto max-w-content space-y-4 px-6 pb-14 pt-7 md:px-9">
      <div>
        <h1 className="text-21 font-bold text-foreground">花名册</h1>
        <p className="mt-1 text-13 text-muted-foreground">项目工作区 /p/{slug} · 人类是一等实体：👤 与 🤖 严格区分，owner 与 parent 两条关系并存</p>
      </div>

      <div className="flex items-center gap-2">
        <IdentityChip kind="project">{slug}</IdentityChip>
        <span data-testid="roster-count-humans" className="rounded-full bg-tag-blue px-2.5 py-0.5 text-12 font-medium tabular-nums text-foreground">
          👤 成员 {counts.humans}
        </span>
        <span data-testid="roster-count-agents" className="rounded-full bg-tag-purple px-2.5 py-0.5 text-12 font-medium tabular-nums text-foreground">
          🤖 agent {counts.agents}
        </span>
        <span className="text-11 text-muted-foreground">（分开计数，UC-03；悬停任一行看完整标识）</span>
      </div>

      {result.state === "ok" && result.degradedHeartbeat && (
        <p data-testid="roster-heartbeat-degraded" className="text-12 text-destructive">coord-gateway 租约暂不可读——agent 心跳与在做什么暂缺。</p>
      )}

      {result.state === "unconfigured" ? (
        <EmptyState testid="roster-unconfigured">平台目录未配置（COORD_GATEWAY_URL / COORD_API_TOKEN），暂无花名册数据。</EmptyState>
      ) : result.state === "degraded" ? (
        <EmptyState testid="roster-degraded">平台目录暂时不可达，花名册读取失败——稍后刷新重试。</EmptyState>
      ) : roster.length === 0 ? (
        <EmptyState testid="roster-empty">这个项目还没有成员——从公开主页（P2）招募，或用接入向导邀请。</EmptyState>
      ) : (
        <ul data-testid="people-roster" className="divide-y divide-border rounded-12 border border-border bg-background px-3">
          {roster.map((m) => (
            <MemberBlock key={m.handle} m={m} />
          ))}
        </ul>
      )}

      <p className="text-11 text-muted-foreground">
        缩进语义：👤 成员（蓝）→ 名下 🤖 agent（紫，缩进一级）→ 点号 sub-agent（紫，缩进两级）；归属沿 parent 追溯到 owner。
      </p>
    </div>
  );
}
