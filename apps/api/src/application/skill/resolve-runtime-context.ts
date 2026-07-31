/**
 * **skill 运行时取上下文 —— 唯一通路**（F61；`contracts/skills/domain.md` I-24 / I-25）。
 *
 * I-25 逐字：「skill 运行时**不存在直连业务库 / 对象存储 / 向量库的代码路径**（只经 Context API）」。
 * 那是一条**结构**约束，不是一条运行时约束，所以它有两半，两半都必须在：
 *
 *   ① 契约上唯一：本文件只持有 `ContextApiPort`，没有第二个取数端口（见 `ports.ts`）；
 *   ② 结构上唯一：`apps/api/scripts/lint-skill-context-api-only.mjs` 扫 skill 模块的
 *      import 图，命中 pg / ioredis / 向量库客户端 / `infrastructure/` 直连即红。
 *
 * 只有 ① 时，加一行 `import { Pool } from "pg"` 就绕过了；
 * 只有 ② 时，某个模块可以老老实实不 import pg，而把取数藏在一个「工具函数」端口后面。
 *
 * ⚠ D-06 之下 phase-1 的「运行时」只做「模板渲染 → 模型调用 → 输出按 schema 校验」，
 *   **没有沙箱、不执行任意代码**。所以这里没有 execute / spawn / eval 的踪迹。
 */
import { authorizeScopeRead, effectiveDataScope, type DataScopeKey } from "../../domain/skill/data-scope";
import type { ContextApiPort } from "./ports";

export interface ResolveRuntimeContextInput {
  readonly runId: string;
  readonly orgId: string;
  readonly principalId: string;
  readonly query: string;
  /** 该 skill 生效版本契约里声明的数据范围 */
  readonly declaredScope: readonly DataScopeKey[];
}

export interface RuntimeContext {
  /** ⚠ I-24：每次运行留一条可重放的 `context_packs` 记录，这是它的句柄 */
  readonly packId: string;
  /** 有效数据范围 ＝ 声明范围 ∩ Context Pack 实际返回项 */
  readonly effectiveScope: readonly DataScopeKey[];
  /**
   * 取数守卫。**越出有效范围的请求被拒且说得出理由**（F61 验收判据）。
   * 返回函数而不是让调用方自己比集合：自己比的那一份会漏掉「说得出理由」。
   */
  readonly authorizeRead: (requested: DataScopeKey) => {
    readonly allowed: boolean;
    readonly reason: string;
  };
}

export async function resolveRuntimeContext(
  input: ResolveRuntimeContextInput,
  deps: { readonly contextApi: ContextApiPort },
): Promise<RuntimeContext> {
  const pack = await deps.contextApi.requestContextPack({
    runId: input.runId,
    orgId: input.orgId,
    principalId: input.principalId,
    query: input.query,
  });

  const effective = effectiveDataScope(input.declaredScope, pack.returnedScopes);

  return {
    packId: pack.packId,
    effectiveScope: effective,
    authorizeRead: (requested) =>
      authorizeScopeRead({
        requested,
        declared: input.declaredScope,
        contextPackReturned: pack.returnedScopes,
      }),
  };
}
