/**
 * 2026-09-15 人类直接要求的三条，机械钉住：
 *   ① 左栏 Nav 入口名 = 「海创汇」；
 *   ② 只有 Workspace 组织能看到这个入口（别的组织连条目都没有，不是 CSS 隐藏）；
 *   ③ 六个 team 各有自己的路由 `/studio/agents/<slug>`。
 */
import { describe, expect, it } from "vitest";
import { NAV_SEGMENTS, navSegmentsForOrg, isAgentsNavVisibleForOrg } from "@/lib/navigation";
import { AGENTS_NAV_LABEL, PREVIEW_AGENT_TEAMS, findPreviewAgentTeam } from "@/lib/mock/agent-previews";

const keys = (orgName: string | null) => navSegmentsForOrg(orgName).flatMap((s) => s.items.map((i) => i.key));

describe("海创汇入口", () => {
  it("导航条目用的就是 AGENTS_NAV_LABEL，没有第二份文案", () => {
    const item = NAV_SEGMENTS.flatMap((s) => s.items).find((i) => i.key === "agents");
    expect(item?.label).toBe(AGENTS_NAV_LABEL);
    expect(AGENTS_NAV_LABEL).toBe("海创汇");
  });

  it("只有 Workspace 组织显示（大小写/空格不敏感）", () => {
    expect(isAgentsNavVisibleForOrg("Workspace")).toBe(true);
    expect(isAgentsNavVisibleForOrg(" workspace ")).toBe(true);
    expect(isAgentsNavVisibleForOrg("boardx")).toBe(false);
    expect(isAgentsNavVisibleForOrg(null)).toBe(false);
  });

  it("非 Workspace 组织的一级导航里压根没有这条，其余入口一个不少", () => {
    expect(keys("Workspace")).toContain("agents");
    expect(keys("boardx")).not.toContain("agents");
    expect(keys("boardx").length).toBe(keys("Workspace").length - 1);
  });
});

describe("六个 team 的路由", () => {
  it("Team1…Team6，slug 唯一且可反查", () => {
    expect(PREVIEW_AGENT_TEAMS.map((t) => t.name)).toEqual(["Team1", "Team2", "Team3", "Team4", "Team5", "Team6"]);
    expect(new Set(PREVIEW_AGENT_TEAMS.map((t) => t.slug)).size).toBe(6);
    for (const team of PREVIEW_AGENT_TEAMS) expect(findPreviewAgentTeam(team.slug)).toEqual(team);
    expect(findPreviewAgentTeam("team-7")).toBeUndefined();
  });
});
