"use client";

import { CapabilityCatalogScreen } from "./capability-catalog-screen";
import { SkillContentEditorSection } from "./skill-content-editor";
import type { UiState } from "@/lib/ui-state";

export function SkillScreen({ state }: { state: UiState }) {
  void state;
  return (
    <CapabilityCatalogScreen
      kind="skill"
      renderEditExtra={(row) => (
        <SkillContentEditorSection id={`admin-skill-row-${row.id}`} row={row} />
      )}
    />
  );
}
