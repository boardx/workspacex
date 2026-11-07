import { PROJECT_RESOURCE_KIND_LABEL_ZH, type ProjectResourceKind } from "@repo/contracts/project";
import type { z } from "zod";
import type { Locale } from "./locale";
import { projectResourceKindEn } from "./namespaces/project-resources";

export function projectResourceTypeLabel(kind: z.infer<typeof ProjectResourceKind>, locale: Locale = "zh-CN"): string {
  const labels = locale === "zh-CN" ? PROJECT_RESOURCE_KIND_LABEL_ZH : projectResourceKindEn;
  return labels[kind] ?? kind;
}
