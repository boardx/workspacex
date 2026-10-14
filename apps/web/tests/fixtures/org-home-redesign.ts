import { homeConfig } from "@repo/contracts";
import type { HomeConfig } from "@/lib/live-home-config";

/** Explicit offline test data; never a product fallback or organization seed. */
export const orgHomeFixture: HomeConfig = {
  orgId: "fixture-only", title: "星河创新工作室", tagline: "测试组织", bannerHeadline: "让想法成为下一步行动", bannerTagline: "与数字人协作，让团队的经验与创造力在这里汇聚。",
  bannerPreset: "slate", bannerColor: null, bannerImageUrl: null, themeColors: homeConfig.DEFAULT_HOME_THEME,
  quickActions: ["chat", "projects", "research", "interview", "survey", "recording", "design", "brain"].map((key, order) => ({key, order, enabled:true})) as HomeConfig["quickActions"],
  recommendedAgents: [
    {agentId:"fixture-strategy", name:"林知远", roleLabel:"战略顾问", avatarKey:"person-1", note:"梳理复杂问题，与你一起找到清晰的方向。"},
    {agentId:"fixture-research", name:"苏予", roleLabel:"用户研究伙伴", avatarKey:"person-10", note:"从访谈与证据中发现真正值得解决的问题。"},
    {agentId:"fixture-design", name:"陈墨", roleLabel:"创新设计伙伴", avatarKey:"person-20", note:"把想法转化为可讨论、可验证的设计方案。"},
  ], recommendedCapabilities: [{kind:"skill",refId:"fixture-skill",name:"会议纪要",note:"沉淀讨论中的决定与下一步行动"}],
  sections: {recentWork:false,currentTasks:false}, updatedAt:"2026-10-14T00:00:00Z",updatedBy:null,
};
