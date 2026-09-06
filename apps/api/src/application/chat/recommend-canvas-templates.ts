/**
 * `recommendCanvasTemplates` —— chat 建议行里那排**画布模板推荐**的服务端
 * （issue #2825，契约面见 `packages/contracts/src/chat.ts` 同名操作——设计增量待补签，
 * 材料在 `phases/phase-01-run-a-project/design-deltas/canvas-template-recommendations/`）。
 *
 * ## 这个文件自己只做取数与判权，判定全在纯函数里
 *
 * 「推荐哪几个」的全部规则在 `domain/canvas/template-recommendation.ts`
 * （`recommendTemplates`）——那是一个不碰 I/O 的纯函数，「画完画像该推荐旅程图」
 * 这类断言不需要起数据库。本文件负责的是三件取数：
 *
 * ① **判权 + 读线程正文**——与 `getThread` 逐字同一条守卫读路径
 *   （`resolveVisibility` → `findMessages` → `discloseDecided`，见 `get-thread.ts`
 *   文件头）。不复用 `summarizePersonaFromThread` 的 `findMessageLocation` 起手式：
 *   那条路径要一个锚点 `messageId`（它接着要拿去做出处回链），而本操作是纯读、
 *   没有锚点概念，为了凑一个 messageId 让前端先读一次消息列表，是给一个只读端点
 *   加一次它并不需要的往返。
 * ② **读已发布模板**——`listTemplates` 用例（`filter: "published"`），与
 *   template-admin 展示、`canvas-template-guidance.ts` 注入 system prompt、
 *   `summarize-persona-from-thread.ts` 取 persona 字段的**同一个**用例、同一份
 *   可见性判定。这里绝不自己拼一条 `WHERE status='published'`（`list-templates.ts`
 *   头注那条「共用是为了避免第二处过滤声明」）。
 * ③ **拼点击后要发的那句话**——同样在纯函数里（`buildRecommendationPrompt`），
 *   因为它依赖的是 `buildCanvasTemplateGuidance` 那套围栏格式约定，属于后端事实。
 *
 * ## 模板库读不到时返回空列表，不报错
 *
 * 同 `canvas-template-guidance.ts` / `summarize-persona-from-thread.ts` 的既有纪律：
 * 模板表抖一下，用户可见的后果应该是"这次没有推荐 chip"，而不是聊天面板上多一条
 * 红色报错——建议行是锦上添花，不是这条线程能不能用的前提。
 *
 * ⚠ 线程不可见/不存在仍然照抛 `ThreadNotVisibleError`（同一个出口，同 `getThread`）：
 *   那不是"降级",那是判权失败,吞掉它等于让一个不该看到这条线程的人拿到它的推荐。
 */
import type { OrgId } from "../../domain/org-id";
import { chat as C } from "@repo/contracts";
import {
  buildRecommendationPrompt,
  detectCanvasTemplateKeys,
  recommendTemplates,
  type RecommendableTemplate,
} from "../../domain/canvas/template-recommendation";
import { listTemplates, type ListTemplatesDeps } from "../canvas/list-templates";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ChatRepository } from "./ports";
import { ThreadNotVisibleError } from "./get-thread";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";

export interface RecommendCanvasTemplatesDeps
  extends ResolveVisibilityDeps, ListTemplatesDeps {
  readonly chat: ChatRepository;
}

export interface RecommendCanvasTemplatesInput {
  readonly userId: string;
  readonly orgId: OrgId;
  /** 🔴 #594：`null` = 个人线程分支（不是「未提供」的占位），同 `getThread`。 */
  readonly projectId: string | null;
  readonly threadId: string;
}

export interface RecommendedCanvasTemplate {
  readonly key: string;
  readonly displayName: string;
  readonly prompt: string;
}

/**
 * 一排 chip 最多几条。契约 `out.items` 是 `.max(4)`，这里取 3——建议行里还有
 * CopilotKit 的模型追问建议（2-4 条）并排渲染，两边加起来超过一行会把 composer
 * 顶下去。契约上限比这个值宽是刻意的：那是"响应体不许超过"的硬边界，这里是
 * "现在渲染几条好看"的产品判断，两者不该是同一个数字。
 */
const MAX_RECOMMENDATIONS = 3;

export async function recommendCanvasTemplates(
  deps: RecommendCanvasTemplatesDeps,
  input: RecommendCanvasTemplatesInput,
): Promise<{ readonly items: readonly RecommendedCanvasTemplate[] }> {
  const outcome = await resolveVisibility(deps, input);
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const guarded = await deps.chat.findMessages(input.orgId, input.threadId);
  if (guarded === null) throw new ThreadNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new ThreadNotVisibleError();

  // 只需要"这条线程里出现过哪些 canvas 围栏"，顺序无关紧要（`detectCanvasTemplateKeys`
  // 去重后只保留出现过与否）——所以不排序，直接拼。
  const threadText = disclosed.payload.map((m) => m.body).join("\n\n");

  /*
   * 「已经画过 persona」有**第二个**来源，不认它就会推荐一件已经做过的事：
   * `summarizePersonaFromThread` 的产出正文是 ```mermaid mindmap 围栏，不是
   * canvas 围栏——`detectCanvasTemplateKeys` 扫不出来（它扫的是 issue #1493 那套
   * `模板: <key>` 语法，而 persona 汇总走的是另一条更早的落地路径）。判据用那条
   * 产出消息的 `authorId === PERSONA_SUMMARY_AUTHOR_ID`：这正是前端
   * `copilotkit-v2-panel-body.tsx` 的 `personaAlreadyGenerated` 已经在用的同一个
   * 常量、同一件事实（契约包 `chat.PERSONA_SUMMARY_AUTHOR_ID` 是两侧唯一的交点）。
   */
  const drawnKeys = [
    ...detectCanvasTemplateKeys(threadText),
    ...(disclosed.payload.some((m) => m.authorId === C.PERSONA_SUMMARY_AUTHOR_ID)
      ? ["persona"]
      : []),
  ];

  let published: readonly RecommendableTemplate[] = [];
  try {
    const listed = await listTemplates(deps, {
      userId: input.userId,
      orgId: input.orgId,
      filter: "published",
    });
    published = listed.templates.map((t) => ({
      key: t.key,
      displayName: t.displayName,
      recommendAfter: t.recommendAfter,
    }));
  } catch {
    // 见文件头：模板库读不到 ⇒ 这次没有推荐 chip，不是一次报错。
    return { items: [] };
  }

  return {
    items: recommendTemplates({ drawnKeys, published, limit: MAX_RECOMMENDATIONS })
      .map((t) => ({ ...t, prompt: buildRecommendationPrompt(t) })),
  };
}
