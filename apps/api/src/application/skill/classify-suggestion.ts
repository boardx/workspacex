/**
 * `classifySuggestion` —— 聚合建议的人工归类（F68；UC-3.6 R3 阶段二步骤 4，R7）。
 *
 * 只做一件事：把结构键与归类落库。归类决定的路由/按钮可见性由
 * `domain/skill/suggestion-aggregation.ts` 的 `canGenerateProposal` / `routeFor`
 * 纯函数回答，本用例不重复判断，只负责持久化侧。
 */
import {
  canGenerateProposal,
  routeFor,
  type SuggestionCategory,
  type SuggestionRoute,
} from "../../domain/skill/suggestion-aggregation";
import type { SuggestionCategoryStorePort } from "./ports";

export interface ClassifySuggestionInput {
  readonly structuralKey: string;
  readonly category: SuggestionCategory;
}

export interface ClassifySuggestionResult {
  readonly ok: true;
  readonly category: SuggestionCategory;
  readonly canGenerateProposal: boolean;
  readonly route: SuggestionRoute;
}

export async function classifySuggestion(
  input: ClassifySuggestionInput,
  deps: { readonly store: SuggestionCategoryStorePort },
): Promise<ClassifySuggestionResult> {
  await deps.store.setCategory(input.structuralKey, input.category);
  return {
    ok: true,
    category: input.category,
    canGenerateProposal: canGenerateProposal(input.category),
    route: routeFor(input.category),
  };
}
