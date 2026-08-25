/**
 * `suggestTemplateSections` —— AI 提议一个模板该有哪些分区（2026-08-23，设计增量、
 * 待人类补签，先例见 `packages/contracts/src/canvas.ts` 该操作文件头）。
 *
 * ## 只读，不落库——模式照抄 `guided-outline-generator.ts`
 *
 * prompt → `ModelCallPort.complete()` → `extractJson` → zod 解析。失败分两段但对外
 * 是**同一个** reasonCode（`TEMPLATE_SUGGESTION_UNAVAILABLE`）：模型调用本身失败，
 * 与模型回了解析不出来的东西，用户看到的都是「这次没建议出来，手动填或再试一次」。
 *
 * ## 权限判定与 `createTemplate` 同一个函数
 *
 * `requireTemplateAdmin`——这条操作虽然不写库，但只有能建模板的人才有理由花一次模型调用
 * 去"起草"一个模板；给非管理员开放会让这条只读端口变成一个不需要权限就能白嫖模型调用的口子。
 */
import { canvas } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { ModelCallPort } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";
import type { IdentityRepository } from "../identity/ports";
import { extractJson } from "../research/guided-structured-json";
import { CanvasError } from "./errors";
import { requireTemplateAdmin } from "./template-admin";

export const SUGGEST_TEMPLATE_SECTIONS_MODEL_ID = "qwen3.7-plus";

type ModelResponse = z.infer<typeof canvas.TemplateSectionSuggestionModelResponse>;

export interface SuggestTemplateSectionsDeps {
  readonly identity: IdentityRepository;
  readonly model: ModelCallPort;
  readonly modelProvider?: string;
}

export interface SuggestTemplateSectionsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly prompt: string;
}

export interface SuggestedTemplateSections {
  readonly suggestedDisplayName: string;
  readonly sections: readonly {
    readonly name: string;
    readonly type: z.infer<typeof canvas.SectionFieldType>;
    readonly why?: string;
  }[];
  readonly modelProvider: string;
  readonly modelId: typeof SUGGEST_TEMPLATE_SECTIONS_MODEL_ID;
}

export async function suggestTemplateSections(
  deps: SuggestTemplateSectionsDeps,
  input: SuggestTemplateSectionsInput,
): Promise<SuggestedTemplateSections> {
  // 与其余五个 canvas 模板写操作同一个判定函数——见 `template-admin.ts` 文件头。
  await requireTemplateAdmin({ identity: deps.identity }, input);

  const modelProvider = deps.modelProvider
    ?? process.env.KERNEL_CANVAS_TEMPLATE_MODEL_PROVIDER
    ?? process.env.KERNEL_MODEL_PROVIDER
    ?? "";

  let completion: { readonly text: string };
  try {
    completion = await deps.model.complete({
      modelProvider,
      modelId: SUGGEST_TEMPLATE_SECTIONS_MODEL_ID,
      system: [
        "You help draft workshop canvas templates (like Business Model Canvas, SWOT, PESTEL).",
        "The user names a commonly known template or framework, possibly in Chinese.",
        "Propose a displayName and an ordered list of sections for that template.",
        "Each section needs: name (Chinese section label), type (one of \"便利贴列表\" for",
        "a repeatable list of short notes / \"短文本\" for a single short value / \"长文本\"",
        "for a paragraph), and why (one short sentence explaining what in the prompt implies",
        "this section, e.g. \"要求记录原话\").",
        "Return JSON only. Do not include markdown, prose, or comments.",
        "The response schema is exactly:",
        "{\"displayName\":string,\"sections\":[{\"name\":string,\"type\":string,\"why\":string}]}",
        "Generate 2 to 9 sections. Use the same language as the user's prompt.",
        "If the prompt names a well-known framework (e.g. Business Model Canvas / SWOT / PESTEL),",
        "use that framework's standard sections. Otherwise propose a reasonable generic structure.",
      ].join("\n"),
      user: JSON.stringify({ prompt: input.prompt }),
    });
  } catch (error) {
    if (error instanceof ModelCallError) {
      throw new CanvasError("TEMPLATE_SUGGESTION_UNAVAILABLE");
    }
    throw error;
  }

  let parsed: ModelResponse;
  try {
    parsed = canvas.TemplateSectionSuggestionModelResponse.parse(extractJson(completion.text));
  } catch {
    throw new CanvasError("TEMPLATE_SUGGESTION_UNAVAILABLE");
  }

  return {
    suggestedDisplayName: parsed.displayName,
    sections: parsed.sections,
    modelProvider,
    modelId: SUGGEST_TEMPLATE_SECTIONS_MODEL_ID,
  };
}
