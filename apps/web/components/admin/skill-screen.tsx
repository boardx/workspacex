"use client";

import { CapabilityCatalogScreen } from "./capability-catalog-screen";
import type { UiState } from "@/lib/ui-state";

/**
 * 人类反馈（2026-08-17）：点击「编辑」现在打开独立页面（`/admin/skill/[id]`，
 * `CapabilityEditPage`），不再是这个列表屏自己内联展开——`renderEditExtra`
 * （挂 `SkillContentEditorSection`）因此搬去那个页面自己传，本屏不再需要它。
 */
export function SkillScreen({ state }: { state: UiState }) {
  void state;
  return <CapabilityCatalogScreen kind="skill" />;
}
