"use client";
import * as React from "react";
import { HomeView } from "@/components/home/home-screen";
import { BasicFieldsSection } from "@/components/org-admin/home-config-appearance-section";
import { RecommendedAgentsSection } from "@/components/org-admin/home-config-recommend-sections";
import { toFormState, formToPreviewConfig } from "@/components/org-admin/home-config-form-model";
import { Button } from "@/components/ui/button";

import { orgHomeFixture as fixture } from "@/tests/fixtures/org-home-redesign";

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
