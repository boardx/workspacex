/**
 * F91 —— AI 副驾驶四类建议：生成端来源门禁 + 受访者不下发 (`uc-6-4` R3 步骤6, E7/O-05,
 * R5, I-5, I-34; `packages/contracts/src/interview.ts` `CopilotSuggestion` /
 * `listCopilotSuggestions`).
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74）。
 *
 * ## 两件事，两个函数，不合并
 *
 * `assembleCopilotSuggestion`（I-5）与 `suggestionsForViewer`（I-34）是**两道独立的门**，
 * 分别对应 uc-6-4 domain.md 的两条不变量：I-5 管"这条建议本身有没有资格被生成/落库"，
 * I-34 管"已经落库的建议，这次读的人有没有资格看见它"。把两者合并成一个函数会让"来源
 * 不足"和"读者是受访者"变成同一个判定分支的两个 if，测试只要覆盖了其中一支就会误以为
 * 另一支也测过了——这正是 O-05 那次教训（合规判定分散在多处、其中一处漏判）的同构风险。
 *
 * ## `suggestionsForViewer` 为什么返回 `undefined` 而不是 `[]`
 *
 * I-34 逐字「响应体中不含任何建议字段」——空数组 `items: []` 仍然是"这个字段存在，
 * 只是恰好没有内容"，而受访者不该知道"这一栏本来是有内容的、只是被清空了"这件事本身。
 * `interface` 层据此决定要不要把 `suggestions` 键写进响应体：`undefined` ⇒ 不写这个键，
 * `[]` ⇒ 写一个空数组——两者在 JSON 序列化后是不同的事实，契约 `listCopilotSuggestions.out`
 * 因此不是 `.strict()` 意义上"总有 items 字段"的形状（interface 层按需要省略该键）。
 *
 * ## 为什么"受访者看不到这一屏"本身不够，还需要这道服务端门
 *
 * R5 原文「受访者：看不到这一屏」——前端确实不会渲染这个组件给受访者。但 `contract-design.
 * md` 的纪律是响应体本身不能依赖"前端不画"来保证合规（那是界面隐藏，不是服务端不下发，
 * I-34 逐字区分了这两者）；`showAiSuggestionsToSubjects` 关闭时，即便有人绕过前端直接调
 * 这个读接口（例如用受访者门户令牌），响应体也不能含建议字段——`suggestionsForViewer`
 * 就是这道门的落点。
 */
import { interview as C } from "@repo/contracts";
import type { z } from "zod";

export type CopilotSuggestionT = z.infer<typeof C.CopilotSuggestion>;
export type SuggestionOriginT = z.infer<typeof C.SuggestionOrigin>;
export type AiSuggestionKindT = z.infer<typeof C.AiSuggestionKind>;

/** `assembleCopilotSuggestion` 的最小输入——生成端在写入前必须已经有的东西。 */
export interface CopilotSuggestionDraft {
  readonly suggestionId: string;
  readonly origin: SuggestionOriginT;
  /** `origin: "human_observer"` 时必须是 `null`——见契约 `AiSuggestionKind` 头注。 */
  readonly aiSuggestionKind: AiSuggestionKindT | null;
  readonly text: string;
  readonly reason: string;
  readonly sourceSegmentId: string | null;
  readonly sourceTimecode: string | null;
  readonly rqId?: string | null;
  readonly priority?: "high" | "normal" | null;
  readonly proposedBy?: string | null;
}

export type AssembleSuggestionResult =
  | { readonly ok: true; readonly suggestion: CopilotSuggestionT }
  | { readonly ok: false; readonly reason: "SUGGESTION_NO_SOURCE" };

/**
 * assembleCopilotSuggestion —— 生成端来源门禁（I-5）。
 *
 * ⚠ `sourceSegmentId` 或 `sourceTimecode` 任一缺失（`null`/空串）⇒ 拒绝落库，
 *   不是"落库但界面不展示来源"——契约的 `listCopilotSuggestions` 错误集里
 *   `SUGGESTION_NO_SOURCE` 就是这个拒绝的落点。
 * ⚠ `reason` 空串同样拒绝——notes 原文「每条建议无来源不得给出」与"无理由"是同一类失败：
 *   一条没有理由的建议和一条没有来源时间码的建议对研究员同样不可信。
 */
export function assembleCopilotSuggestion(draft: CopilotSuggestionDraft): AssembleSuggestionResult {
  const hasSource =
    draft.sourceSegmentId !== null &&
    draft.sourceSegmentId.length > 0 &&
    draft.sourceTimecode !== null &&
    draft.sourceTimecode.length > 0;
  const hasReason = draft.reason.length > 0;

  if (!hasSource || !hasReason) {
    return { ok: false, reason: "SUGGESTION_NO_SOURCE" };
  }

  return {
    ok: true,
    suggestion: {
      suggestionId: draft.suggestionId,
      origin: draft.origin,
      aiSuggestionKind: draft.aiSuggestionKind,
      text: draft.text,
      reason: draft.reason,
      // hasSource 保证了这两者非空字符串——见上方判定。
      sourceSegmentId: draft.sourceSegmentId as string,
      sourceTimecode: draft.sourceTimecode as string,
      rqId: draft.rqId ?? null,
      priority: draft.priority ?? null,
      proposedBy: draft.proposedBy ?? null,
    },
  };
}

/** 调用 `listCopilotSuggestions` 的人是谁——只有这个决定"这次读能不能看见建议"。 */
export type CopilotSuggestionViewerKind = "researcher" | "co_host" | "observer" | "agent" | "interviewee";

export interface SuggestionVisibilityInput {
  readonly viewerKind: CopilotSuggestionViewerKind;
  /** 本场 `SevenSwitches.showAiSuggestionsToSubjects`——R5 原文默认关。 */
  readonly showAiSuggestionsToSubjects: boolean;
  readonly suggestions: readonly CopilotSuggestionT[];
}

/**
 * suggestionsForViewer —— 受访者不下发门（I-34）。
 *
 * ⚠ 返回 `undefined` 而不是 `[]`——见文件头「为什么返回 undefined」一节；
 *   `interface` 层据此决定该不该把 `suggestions` 键写进响应体。
 * ⚠ 非受访者角色（研究员/联合主持/观察员/记录 agent）**不受本开关影响**——这个开关
 *   管的是"要不要下发给受访者"，不是"要不要生成/展示建议"，其余角色一律看见全部建议
 *   （各自角色内部的读写权限是 R5 的其他条目，不是本函数的职责）。
 */
export function suggestionsForViewer(
  input: SuggestionVisibilityInput,
): readonly CopilotSuggestionT[] | undefined {
  if (input.viewerKind !== "interviewee") return input.suggestions;
  return input.showAiSuggestionsToSubjects ? input.suggestions : undefined;
}
