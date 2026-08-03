"use client";

import { CapabilityCatalogScreen } from "./capability-catalog-screen";
import type { UiState } from "@/lib/ui-state";

export function SkillScreen({ state }: { state: UiState }) {
  void state;
  return <CapabilityCatalogScreen kind="skill" />;
}
