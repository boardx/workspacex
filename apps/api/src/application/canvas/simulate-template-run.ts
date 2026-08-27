/**
 * `simulateTemplateRun` —— 2026-08-26，**设计增量、待人类补签**（同 #496/#988 的先例，
 * 见契约操作文件头）。
 *
 * 人类原话：「需要有一个 chat 界面模拟，输出过程，可以输入一段提示词，需要出来实际
 * 的结果」「你需要在前端的 chat 来测试，看如何基于上下文生成可视化」。
 *
 * ## 走**真实 chat 生成会走的那条系统提示**，不是另编一份
 *
 * 复用 `buildCanvasTemplateGuidance`——`execute-run.ts` 注入 chat system prompt 用的
 * 那个**同一个**函数。传入的是**编辑器当前正在改的分区草稿**（不是库里已存的版本，
 * 见契约文件头），使用者验证的是"我现在这版结构，AI 认得吗"，不是"上一次保存的版本"。
 *
 * ⚠ 不复用 `suggestTemplateSections` 的实现（虽然两者都是 `model.complete` + 权限判定
 *   同一个模式）——那条操作的输出是结构化 JSON（提议分区），这条的输出是**自由文本**
 *   （可能含 canvas 围栏，也可能模型没照格式写）。硬塞进同一个函数会让"提议分区"与
 *   "模拟对话"两件不同的事共用一份错误处理与一份 system prompt，读起来像同一件事，
 *   实际语义完全不同。
 *
 * ## 只读，不产生任何副作用
 *
 * 不写库、不产版本、不动 `promptText`。使用者满意了要不要把这段提示词存下来，
 * 走既有的 `updateTemplateMetadata`，是使用者自己的下一步。
 */
import type { OrgId } from "../../domain/org-id";
import type { ModelCallPort } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";
import type { IdentityRepository } from "../identity/ports";
import { buildCanvasTemplateGuidance, type CanvasTemplateGuidanceInfo } from "../agent-run/canvas-template-guidance";
import { CanvasError } from "./errors";
import { requireTemplateAdmin } from "./template-admin";

export const SIMULATE_TEMPLATE_RUN_MODEL_ID = "qwen3.7-plus";

export interface SimulateTemplateRunDeps {
  readonly identity: IdentityRepository;
  readonly model: ModelCallPort;
  readonly modelProvider?: string;
}

export interface SimulateTemplateRunInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly key: string;
  readonly prompt: string;
  readonly sections: readonly {
    readonly name: string;
    readonly type?: string;
  }[];
}

export interface SimulatedTemplateRun {
  readonly text: string;
  readonly modelProvider: string;
  readonly modelId: typeof SIMULATE_TEMPLATE_RUN_MODEL_ID;
}

export async function simulateTemplateRun(
  deps: SimulateTemplateRunDeps,
  input: SimulateTemplateRunInput,
): Promise<SimulatedTemplateRun> {
  // 与其余六个 canvas 模板操作同一个判定函数——见 `template-admin.ts` 文件头。
  await requireTemplateAdmin({ identity: deps.identity }, input);

  const guidanceInfo: CanvasTemplateGuidanceInfo = {
    key: input.key,
    displayName: input.key,
    sections: input.sections,
  };
  // 单模板指引：`buildCanvasTemplateGuidance` 接受数组是为了「本组织全部已发布模板」
  // 这个真实调用场景（execute-run.ts），这里只给它当前正在编辑的这一个——模拟的是
  // 「AI 认不认得这一个模板」，不是「chat 里所有模板混在一起选哪个」。
  const guidance = buildCanvasTemplateGuidance([guidanceInfo]);
  // ⚠ 空分区时 `guidance` 是 null（`buildCanvasTemplateGuidance` 的既有行为：没有
  //   可注入的模板就不注入）。此时如实退化成「没有可参照的分区结构」，不是报错——
  //   使用者在①栏还没拖任何字段到画布上也该能试一次提示词本身写得怎么样。
  const system = guidance
    ?? "You are a workshop facilitator assistant. The user is testing a prompt for a " +
      "canvas template that has no sections placed yet, so there is no structure to follow.";

  const modelProvider = deps.modelProvider
    ?? process.env.KERNEL_CANVAS_TEMPLATE_MODEL_PROVIDER
    ?? process.env.KERNEL_MODEL_PROVIDER
    ?? "";

  try {
    const completion = await deps.model.complete({
      modelProvider,
      modelId: SIMULATE_TEMPLATE_RUN_MODEL_ID,
      system,
      user: input.prompt,
    });
    return { text: completion.text, modelProvider, modelId: SIMULATE_TEMPLATE_RUN_MODEL_ID };
  } catch (error) {
    if (error instanceof ModelCallError) {
      throw new CanvasError("TEMPLATE_SIMULATION_UNAVAILABLE");
    }
    throw error;
  }
}
