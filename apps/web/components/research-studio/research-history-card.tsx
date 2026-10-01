import type { ComponentProps } from "react";
import { StudioHistoryCard } from "@/components/studio/studio-history";

/**
 * 研究列表卡片。2026-09-30 起不再有自己的版式（此前是左侧 stock 封面图 + 大号标题的专属布局）：
 * 人类要求所有卡片统一成标准项目卡片，所以这里只是 `StudioHistoryCard` → `ResourceCard` 的别名，
 * 保留导出名给既有调用方。
 */
export function ResearchHistoryCard(props: ComponentProps<typeof StudioHistoryCard>) {
  return <StudioHistoryCard {...props} />;
}
