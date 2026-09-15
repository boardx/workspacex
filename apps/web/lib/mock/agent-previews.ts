// #3602 用户明确要求的只读展示样例；不作为真实能力目录或运行时默认配置。
//
// 2026-09-15 人类直接要求：
//   ① 左栏 Nav 入口名从「智能体」改为「海创汇」——名字的单一事实源是
//      `lib/navigation.ts` 的 `AGENTS_NAV_LABEL`（不放这里：导航属于真实路由图，
//      从 `lib/mock/` import 会让 `*-route-no-mock` 的残留 mock 边台账多一条）；
//   ② 卡片改为六个 team（Team1…Team6），分别对应六个 Agent 的项目；
//   ③ 每张 team 卡片点击都要有自己的路由 → `/studio/agents/<slug>`
//      （`app/studio/agents/[teamId]/page.tsx`，路由参数由下面的 `slug` 生成，
//      不在页面里另拼字符串）；
//   ④ 该入口只对「Workspace」组织显示（判定见 `lib/navigation.ts` 的
//      `isAgentsNavVisibleForOrg`）。
export type PreviewAgentTeam = {
  /** 路由段：`/studio/agents/<slug>` */
  slug: string;
  name: string;
  /** 卡片与详情页共用的一句话说明 */
  summary: string;
};

export const PREVIEW_AGENT_TEAMS: readonly PreviewAgentTeam[] = [
  { slug: "team-1", name: "Team1", summary: "Team1 的 Agent 项目 · 仅供展示" },
  { slug: "team-2", name: "Team2", summary: "Team2 的 Agent 项目 · 仅供展示" },
  { slug: "team-3", name: "Team3", summary: "Team3 的 Agent 项目 · 仅供展示" },
  { slug: "team-4", name: "Team4", summary: "Team4 的 Agent 项目 · 仅供展示" },
  { slug: "team-5", name: "Team5", summary: "Team5 的 Agent 项目 · 仅供展示" },
  { slug: "team-6", name: "Team6", summary: "Team6 的 Agent 项目 · 仅供展示" },
] as const;

export function findPreviewAgentTeam(slug: string): PreviewAgentTeam | undefined {
  return PREVIEW_AGENT_TEAMS.find((t) => t.slug === slug);
}
