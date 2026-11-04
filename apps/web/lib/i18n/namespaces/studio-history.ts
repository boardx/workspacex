import { researchZhCN, researchEn } from "./research";

// Shared history display copy reuses the existing sort source; it carries no query values.
export const studioHistoryZhCN = {
  "studio.history.search": "搜索{business}",
  "studio.history.title": "历史{business}",
  "studio.history.create": "新建{business}",
  "studio.history.recent": researchZhCN["research.home.recent"],
  "studio.history.oldest": researchZhCN["research.home.oldest"],
  "studio.history.sort": researchZhCN["research.home.sort"],
} as const;
export const studioHistoryEn = {
  "studio.history.search": "Search {business}",
  "studio.history.title": "{business} history",
  "studio.history.create": "New {business}",
  "studio.history.recent": researchEn["research.home.recent"],
  "studio.history.oldest": researchEn["research.home.oldest"],
  "studio.history.sort": researchEn["research.home.sort"],
} satisfies Record<keyof typeof studioHistoryZhCN, string>;
