import { PROJECT_EVIDENCE_SOURCE_LABEL_ZH, type ProjectEvidenceSourceKind } from "@repo/contracts/project-evidence";
import type { Locale } from "./locale";
import { projectEvidenceKindEn } from "./namespaces/project-brain";
export function projectEvidenceKindLabel(kind: ProjectEvidenceSourceKind, locale: Locale = "zh-CN"): string {
  const labels = locale === "zh-CN" ? PROJECT_EVIDENCE_SOURCE_LABEL_ZH : projectEvidenceKindEn;
  return labels[kind] ?? kind;
}
