import { translate, type MessageKey } from "./i18n/messages";
import type { Locale } from "./i18n/locale";

const categoryKeys: Readonly<Record<string, MessageKey>> = {
  "技术专家": "itv.category.0",
  "商业专家": "itv.category.1",
  "行业专家": "itv.category.2",
  "投资专家": "itv.category.3",
  "创业导师": "itv.category.4",
  "学术专家": "itv.category.5",
  "法务专家": "itv.category.6",
  "财务专家": "itv.category.7",
  "人力资源专家": "itv.category.8",
  "政策专家": "itv.category.9",
  "战略创新大师": "itv.category.10",
  "心理与行为大师": "itv.category.11",
  "趋势洞察大师": "itv.category.12",
  "管理大师": "itv.category.13",
  "组织与领导力大师": "itv.category.14",
  "战略执行大师": "itv.category.15",
  "营销与增长大师": "itv.category.16"
};

/** Display labels only: callers keep the canonical category as the filter value. */
export function interviewCategoryText(category: string, locale: Locale): string {
  const key = Object.hasOwn(categoryKeys, category) ? categoryKeys[category] : undefined;
  return key ? translate(locale, key) : category;
}
