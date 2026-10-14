"use client";
import * as React from "react";
import { homeConfig } from "@repo/contracts";
import { HomeView } from "@/components/home/home-screen";
import { BasicFieldsSection } from "@/components/org-admin/home-config-appearance-section";
import { RecommendedAgentsSection } from "@/components/org-admin/home-config-recommend-sections";
import { toFormState, formToPreviewConfig } from "@/components/org-admin/home-config-form-model";
import { Button } from "@/components/ui/button";
import type { HomeConfig } from "@/lib/live-home-config";

const fixture: HomeConfig = {
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
export function OrgHomeFixture() {
  const [form, setForm] = React.useState(() => toFormState(fixture));
  const [editing, setEditing] = React.useState(false);
  return <main className="min-h-screen bg-background text-foreground">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <p className="text-sm">仅本地开发 · 测试数据 · 真实组件预览（未连接真实组织数据）</p>
      <Button variant="outline" onClick={() => setEditing(!editing)}>{editing ? "查看首页" : "配置预览"}</Button>
    </div>
    {editing ? <div className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-2">
      <div className="space-y-4"><BasicFieldsSection form={form} onChange={setForm} /><RecommendedAgentsSection form={form} onChange={setForm} /></div>
      <div className="min-w-0"><p className="text-xl font-semibold">成员所见 · 未保存配置预览</p><HomeView config={formToPreviewConfig(form,"fixture-only")} orgId={null} displayName="测试成员" /></div>
    </div> : <HomeView config={formToPreviewConfig(form,"fixture-only")} orgId={null} displayName="测试成员" />}
  </main>;
}
