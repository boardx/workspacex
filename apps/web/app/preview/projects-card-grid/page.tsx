import * as React from "react";
import { ProjectsCardGridScreen } from "@/components/preview/projects-card-grid-screen";
import { resolvePreviewState } from "@/lib/ui-state";

/**
 * 「项目」首页卡片网格 + 标签过滤 —— UI 先行原型入口（ADR-023 签核第 ① 件材料）。
 *
 * ⚠ **纯前端 mock，不接后端，也不改任何生产屏**。生产实现仍是接了真实 `GET /projects`
 *   的 `components/projects/projects-screen.tsx`（纯列表）。这里只是把「卡片网格 + 标签过滤」
 *   的呈现形态做出来给人类点、看七态，供束级 `contracts/project/design-signoff.md`
 *   第 ① 件裁决要不要接线。
 *
 * ## 与生产屏的字段完整度差异（签核请重点核对）
 *  · 生产屏契约 `ProjectListItem` 只有五字段：id/name/kind/status/readOnlyReason。
 *  · 本原型的筛选维度：kind / status 两组**有契约出处**、可直接接真；
 *    tags（标签）一组是**探索性 mock、无契约出处**——UI 上已显式打「探索性」标记，
 *    采纳与否要人类 + API 契约一起裁（若采纳则需新增 tags 面，走 delta 重签）。
 *  · 生产屏文件头点名「没有出处、故意不补」的 owner/priority/readiness/stageProgress/
 *    schedule，本原型**一个都没画**——不借标签之名复活被否掉的编字段。
 *
 * query 参数（预览手段，生产构建不可达）：?state= default|loading|empty|invalid|dep-failed|denied|success
 */
export default function ProjectsCardGridPreviewPage({
  searchParams,
}: {
  searchParams: { state?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  return (
    <main className="min-h-screen bg-background text-foreground">
      <ProjectsCardGridScreen uiState={uiState} />
    </main>
  );
}
