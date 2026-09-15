// #3602 用户明确要求的只读展示样例；不作为真实能力目录或运行时默认配置。
//
// 2026-09-15 人类直接要求：
//   ① 左栏 Nav 入口名从「智能体」改为「海创汇」——名字的单一事实源是
//      `lib/navigation.ts` 的 `AGENTS_NAV_LABEL`（不放这里：导航属于真实路由图，
//      从 `lib/mock/` import 会让 `*-route-no-mock` 的残留 mock 边台账多一条）；
//   ② 卡片改为六个 team（Team1…Team6），分别对应六个 Agent 的项目；
//   ③ 每张 team 卡片点击都要有自己的路由 → `/agent/<slug>`（2026-09-15 人类追加：
//      路由要简单，形如 `www.boardx.com.cn/agent/team1`，所以是顶层 `/agent` 而不是
//      `/studio/agents`，slug 也不带连字符）；页面由 `app/agent/[teamId]/page.tsx` 承载，
//      slug 由下面机械派生，页面不另拼字符串；
//   ④ 该入口只对「Workspace」组织显示（判定见 `lib/navigation.ts` 的
//      `isAgentsNavVisibleForOrg`）。
//
// ⚠ 下面这行**故意写成单行字符串数组**：`apps/api/scripts/lint-no-builtin-capabilities.mjs`
//   是逐行匹配「list-shaped constant」的，本文件在
//   `apps/api/tests/kernel/no-builtin-capability-lists.test.ts` 的 `DECLARED_MOCK_DEBT`
//   里申报过原型 mock 债务。把它排版成多行会让门控扫不到，于是债务「在没人注意时消失」
//   ——那正是那条台账要拦的事（它同时禁止悄悄长出来和悄悄消失）。名单本身没变性质：
//   仍是手写的原型预览数据，偿还路径仍是改从 packages/contracts 生成。
export const PREVIEW_AGENTS = ["Team1", "Team2", "Team3", "Team4", "Team5", "Team6"] as const;

export type PreviewAgentTeam = {
  /** 路由段：`/agent/<slug>`，如 `/agent/team1` */
  slug: string;
  name: string;
  /** 卡片与详情页共用的一句话说明 */
  summary: string;
};

/** 六个 team 的展示数据，由上面那份唯一名单机械派生（不手抄第二份）。 */
export const PREVIEW_AGENT_TEAMS: readonly PreviewAgentTeam[] = PREVIEW_AGENTS.map((name, index) => ({
  slug: name.toLowerCase(),
  name,
  summary: `${name} 的 Agent 项目 · 仅供展示`,
}));

export function findPreviewAgentTeam(slug: string): PreviewAgentTeam | undefined {
  return PREVIEW_AGENT_TEAMS.find((t) => t.slug === slug);
}
