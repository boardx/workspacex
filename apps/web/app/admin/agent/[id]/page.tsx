"use client";

/**
 * 人类反馈（2026-08-17）：点击「编辑」应该打开一个新的界面，而不是在当前列表页里
 * 展开编辑区块。`agent`/`skill` 两个 kind 各自一个字面量路由段（不是共用一个
 * `[module]/[id]` 动态路由），理由与 `capability-catalog-screen.tsx` 原来把
 * `renderEditExtra` 做成**调用方注入**同一条：`agent-admin-route-no-mock.test.ts`
 * 机械断言 `/admin/agent` 的整棵依赖树不含任何 `lib/mock/**` 边——如果这个文件
 * 和 skill 的编辑页共用一个文件、无条件 `import` `SkillContentEditorSection`
 * （它传递性依赖 `lib/mock/asset-governance.ts`），那条边会**静态存在**于这个
 * 文件的依赖图里，哪怕运行时 `kind === "agent"` 分支永远不渲染它——
 * `walk()` 走的是 import 语句，不是运行时分支，见该测试文件与
 * `capability-catalog-screen.tsx` 旧版头注的同一条教训。本文件因此**不** import
 * 任何 skill 专属模块。
 */
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { CapabilityEditPage } from "@/components/admin/capability-edit-page";
import { AgentCapabilityGraph } from "@/components/admin/agent-capability-graph";
import { resolvePreviewRole } from "@/lib/identity";
import { safeRelativePath } from "@/lib/safe-relative-path";

export default function AgentEditRoutePage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { as?: string; from?: string };
}) {
  const previewRole = resolvePreviewRole(searchParams.as);
  // 同 `admin/skill/[id]/page.tsx` 的 `?from=` 纪律——见那边的头注。
  const backHref = safeRelativePath(searchParams.from) ?? undefined;
  return (
    <AppShell previewRole={previewRole} left={<AdminNav active="agent" />}>
      <CapabilityEditPage
        kind="agent"
        id={params.id}
        renderEditExtra={(row) => <AgentCapabilityGraph orgId={row.orgId} agentId={row.id} />}
        backHref={backHref}
      />
    </AppShell>
  );
}
