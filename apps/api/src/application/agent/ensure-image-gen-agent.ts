/**
 * `ensureImageGenAgent` -- 第三个系统预置 agent（2026-08-07，人类直接指令："这里要
 * 可以直接看到图片，不是只是文字"）。同一条产品裁决（#661/#662）延伸到"图片生成"这个
 * 第三种能力上，落库形状与 `ensure-default-agent.ts`/`ensure-deep-research-agent.ts`
 * 完全一致，复用 `pg-system-agent-repository.ts` 的 `ensureSystemAgent`。
 *
 * 独立 agent，不是"通用助手"的一个 skill：执行路径是"提交异步任务到阿里云百炼、
 * 轮询到终态"，不是一次 chat completion——见 `bailian-image-provider.ts` 头注。
 */
export const IMAGE_GEN_AGENT_STABLE_NAME = "image-gen-agent";
export const IMAGE_GEN_AGENT_NAME = "图片生成";
export const IMAGE_GEN_AGENT_PROVIDER = "bailian-image";
/** `model_id` 一列没有外键校验，这里只是给日志/审计一个可读标签；真正生效的模型名
 *  在 `bailian-image-provider.ts` 的 `KERNEL_BAILIAN_IMAGE_MODEL_ID`（默认已实测的
 *  `wanx2.1-t2i-plus`）。 */
export const IMAGE_GEN_AGENT_MODEL_ID = "wanx2.1-t2i-plus";
export const IMAGE_GEN_AGENT_INSTRUCTIONS =
  "你是本组织的图片生成 agent（由阿里云百炼「通义万相」驱动，系统预置）。" +
  "把用户的描述原样当作生图 prompt 提交，返回一张真实生成的图片——不写文字说明，" +
  "图片本身就是回复。";

export interface EnsureImageGenAgentResult {
  readonly agentId: string;
  readonly created: boolean;
}

export interface EnsureImageGenAgentRepository {
  ensure(input: {
    readonly orgId: string;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<EnsureImageGenAgentResult>;
}

export const ENSURE_IMAGE_GEN_AGENT_REPOSITORY = Symbol("EnsureImageGenAgentRepository");

export async function ensureImageGenAgent(
  deps: { readonly repo: EnsureImageGenAgentRepository },
  input: { readonly orgId: string; readonly actorId: string; readonly now?: () => Date },
): Promise<EnsureImageGenAgentResult> {
  return deps.repo.ensure({
    orgId: input.orgId,
    actorId: input.actorId,
    now: (input.now ?? (() => new Date()))(),
  });
}
