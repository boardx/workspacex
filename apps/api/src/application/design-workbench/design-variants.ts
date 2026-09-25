/**
 * 对标 R9（#3954）—— **变体**：让模型对某一页出几个结构不同的方案，人并排看、挑一个。
 *
 * 候选**不落库**。人挑中之后，前端用既有 `replace` patch 把它换进这一页——版本历史、撤销、
 * 属性面板都走已有的那条路（I-11「只经契约 patch 写回」），不另开一套「方案」存储。
 *
 * ⚠ **没有兜底方案**：模型没给出至少两个合法且互不相同的方案 ⇒ 抛
 *   `DesignVariantsUnavailableError`（503 `DEPENDENCY_UNAVAILABLE`）。拿当前页改几个字冒充
 *   「方案 B」，正是本仓反复在修的「界面声称的事情没有真的发生」。
 */
import { designPrototype, designWorkbench } from "@repo/contracts";
import type { ModelCallPort } from "../agent-run/ports";
import type { FeedbackStructureModelConfig } from "../feedback/structure-feedback-draft";
import { DESIGN_CHAT_REPLY_TIMEOUT_MS, DESIGN_PRINCIPLES, MODEL_TIMEOUT_MESSAGE, extractJsonObject } from "./design-chat-model";
import { DesignProjectNotFoundError, DesignProjectNotOwnerError, type DesignProjectDeps } from "./project-shared";
import { PrototypePatchRejectedError } from "./patch-prototype";

export interface DesignVariantContext {
  readonly title: string;
  readonly problem: string;
  readonly frame: string;
  readonly root: designPrototype.PrototypeNode;
  readonly count: number;
  readonly instruction?: string;
}

export interface DesignVariantModel {
  propose(ctx: DesignVariantContext): Promise<readonly designWorkbench.PrototypeVariant[]>;
}

export class DesignVariantsUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "DesignVariantsUnavailableError";
  }
}

export const DESIGN_VARIANTS_SYSTEM_PROMPT =
  "你是 PM 设计工作台里的设计协作助手。用户想看**同一页**的几个不同方案，好并排比较、挑一个。" +
  "只输出一个 JSON 对象，不要解释、不要 markdown 代码块标记，形如 " +
  '{"variants":[{"summary":"一句话说清这个方案的取舍","root":{组件树}}]}。' +
  "每个方案都要保留这一页的**目的与关键内容**（同样的主操作、同样的核心信息），但在**布局结构**上真的不同" +
  "（信息的先后、分组方式、视觉重点放在哪），不是只换文案或颜色。summary 说的是取舍，不是复述页名。" +
  designPrototype.PROTOTYPE_SCHEMA_GUIDE +
  DESIGN_PRINCIPLES;

/** 序列化成同一串 ⇒ 同一个方案。模型偶尔会把同一棵树抄两遍，那不是「两个方案」。 */
function signature(root: designPrototype.PrototypeNode): string {
  // id 不算差异：同一棵树换一套 id 还是同一个方案。
  return JSON.stringify(root, (k, v: unknown) => (k === "id" ? undefined : v));
}

/** 模型原始输出 → 合法且互不相同的方案（最多 `count` 个）。不合法的逐个丢掉，不修。 */
export function parseVariants(raw: unknown, count: number): designWorkbench.PrototypeVariant[] {
  const list = (raw as { variants?: unknown } | null)?.variants;
  if (!Array.isArray(list)) return [];
  const out: designWorkbench.PrototypeVariant[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const parsed = designWorkbench.PrototypeVariant.safeParse({
      summary: typeof (v as { summary?: unknown })?.summary === "string" ? (v as { summary: string }).summary.trim().slice(0, 120) : "",
      root: (v as { root?: unknown })?.root,
    });
    if (!parsed.success) continue;
    const sig = signature(parsed.data.root);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(parsed.data);
    if (out.length >= count) break;
  }
  return out;
}

export interface ModelDesignVariantProposerDeps {
  readonly model: ModelCallPort;
  readonly chatModel: FeedbackStructureModelConfig;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

export class ModelDesignVariantProposer implements DesignVariantModel {
  constructor(private readonly deps: ModelDesignVariantProposerDeps) {}

  async propose(ctx: DesignVariantContext): Promise<readonly designWorkbench.PrototypeVariant[]> {
    const user =
      `项目：${ctx.title}\n要解决的问题：${ctx.problem}\n\n` +
      `要出方案的页：「${ctx.frame}」。它现在的组件树：\n${JSON.stringify(ctx.root).slice(0, 12_000)}\n\n` +
      `请给出 ${ctx.count} 个布局结构互不相同的方案。` +
      (ctx.instruction !== undefined && ctx.instruction.trim() !== "" ? `\n用户对方案的要求：${ctx.instruction.trim()}` : "");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let text: string;
    try {
      const completion = await Promise.race([
        this.deps.model.complete({
          modelProvider: this.deps.chatModel.provider,
          modelId: this.deps.chatModel.modelId,
          system: DESIGN_VARIANTS_SYSTEM_PROMPT,
          user,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(MODEL_TIMEOUT_MESSAGE)), DESIGN_CHAT_REPLY_TIMEOUT_MS);
        }),
      ]);
      text = completion.text;
    } catch (e) {
      throw new DesignVariantsUnavailableError(e instanceof Error ? e.message : "model call failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    let raw: unknown;
    try {
      raw = extractJsonObject(text);
    } catch {
      throw new DesignVariantsUnavailableError("model output was not parseable JSON");
    }
    const variants = parseVariants(raw, ctx.count);
    this.deps.log("design variants: model round finished", { asked: ctx.count, usable: variants.length });
    return variants;
  }
}

export async function proposeVariants(
  deps: DesignProjectDeps & { readonly ai: DesignVariantModel },
  input: { readonly projectId: string; readonly ownerId: string; readonly screen: number; readonly count?: number; readonly instruction?: string },
): Promise<{ readonly variants: readonly designWorkbench.PrototypeVariant[] }> {
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();
  const root = current.prototype[input.screen];
  if (root === undefined || root === null) throw new PrototypePatchRejectedError("NO_PROTOTYPE", `screen ${input.screen} has no tree`);
  const count = input.count ?? designWorkbench.PROTOTYPE_VARIANTS_DEFAULT;
  const variants = await deps.ai.propose({
    title: current.name,
    problem: current.problem,
    frame: current.frames[input.screen] ?? "",
    root: designPrototype.withoutImageSources(root), // 深度 S10：上传的图不进模型
    count,
    ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
  });
  // 合法的不足下限 ⇒ 如实说做不出来，不凑数。
  if (variants.length < designWorkbench.PROTOTYPE_VARIANTS_MIN) {
    throw new DesignVariantsUnavailableError(`only ${variants.length} usable variant(s)`);
  }
  return { variants };
}
