"use client";
import { HomeView } from "@/components/home/home-screen";
import { orgHomeFixture } from "@/tests/fixtures/org-home-redesign";

/** Presentation-only preview. No admin editor, save action or authentication override. */
export function OrgHomeFixture() {
  return <main className="min-h-screen bg-background text-background-foreground">
    <div className="border-b border-border px-4 py-3">
      <p className="text-sm">仅本地开发 · fixture 测试数据 · 前台展示预览（未连接真实组织数据）</p>
    </div>
    <HomeView config={orgHomeFixture} orgId={null} displayName="测试成员" />
  </main>;
}
