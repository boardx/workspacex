import type { ProjectResearchSub } from "@/components/project/project-links";

export type ContentFilter = "all" | "conv" | ProjectResearchSub;

/** 筛选 chip 的顺序与文案（唯一一份）。 */
export const CONTENT_FILTERS: ReadonlyArray<{ key: ContentFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "conv", label: "对话" },
  { key: "whiteboard", label: "白板" },
  { key: "itv", label: "访谈" },
  { key: "survey", label: "问卷" },
  { key: "research", label: "研究" },
  { key: "transcript", label: "转写" },
  { key: "design", label: "设计" },
];
