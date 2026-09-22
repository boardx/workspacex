"use client";
import { useRouter } from "next/navigation";
import type { UiState } from "@/lib/ui-state";
import { DesignWorkbenchHome } from "./workbench-screen";

/**
 * Studio 一级导航「设计」入口的专用包装（2026-09-05 人类直接反馈，见
 * `app/studio/design-workbench/page.tsx` 头注）——底层组件与平台后台的
 * `DesignWorkbenchAdminScreen`（`components/admin/design-loop-screens.tsx`）
 * 完全相同（都是真栈的 `DesignWorkbenchHome`），唯一差异是跳转目标：
 * 这里进项目走本路由下的 `/studio/design-workbench/[id]`，不是
 * `/platform-admin/design-workbench/[id]`——两个入口各自独立，不共用 URL 前缀。
 */
export function StudioDesignWorkbenchScreen({ state }: { state: UiState }) {
  const router = useRouter();
  return (
    <DesignWorkbenchHome
      state={state}
      /*
       * 迭代 16（#3773 R7）：`?new=1` 只由**创建**这条路带上——详情页据它决定要不要
       * 照背景自动画第一版。列表里点开一个老项目不带它，不会替用户花掉一次生成。
       */
      onOpenProject={(id, justCreated) => router.push(`/studio/design-workbench/${id}${justCreated === true ? "?new=1" : ""}`)}
    />
  );
}
