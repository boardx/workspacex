/**
 * `RoutingModelCallPort` -- lets more than one `ModelCallPort` coexist without loosening
 * `ConfiguredModelProvider`'s "no fallback, structurally" invariant (see that file's own
 * header: "There is no list, no map, no 'default'").
 *
 * That invariant is still true INSIDE each individual port. What changed 2026-08-07 is
 * that this deployment now runs TWO distinct execution paths -- one-shot chat completion
 * (`dashscope`) and a separate long-running LangGraph service (`open-deep-research`) --
 * and an Agent's pinned `model_provider` decides which one a run belongs to. Routing by
 * that exact string, with an explicit, closed map and a hard failure for anything not in
 * it, is the same "no fallback" discipline lifted one level up: a run naming a provider
 * nobody registered here fails `MODEL_PROVIDER_NOT_CONFIGURED`, it does not fall through
 * to whichever port happens to be first.
 */
import {
  ModelCallError, type ModelCallInput, type ModelCallPort, type ModelCallProgressEvent,
} from "../../application/agent-run/ports";

export class RoutingModelCallPort implements ModelCallPort {
  constructor(private readonly ports: ReadonlyMap<string, ModelCallPort>) {}

  async complete(input: ModelCallInput): Promise<
    { readonly text: string; readonly tokens?: number }
  > {
    return this.resolve(input.modelProvider).complete(input);
  }

  /**
   * 2026-08-09 hotfix (#798) -- before this method existed, `execute-run.ts`'s
   * `deps.model.completeWithProgress` presence check saw the ROUTER (which never had this
   * method), not the underlying `DeepAgentModelProvider` that actually implements it -- so
   * no run ever took the progress-event branch in production, regardless of which provider
   * it was pinned to. Every deep-agent run silently downgraded to plain `complete()`, and
   * the AG-UI tool-call visibility this method exists to feed (#789) never fired outside
   * unit tests that call `execute-run.ts` directly with a fake port.
   *
   * Unlike `completeStream` above, this is NOT unconditionally safe to expose: `complete
   * WithProgress`'s mere presence make `execute-run.ts` skip its `completeStream` branch
   * entirely (see that file's own header -- presence is a hard opt-in, checked FIRST). The
   * chat provider (`ConfiguredModelProvider`, gated by `KERNEL_MODEL_STREAM_ENABLED`) has
   * real token-level `completeStream` and no `completeWithProgress` -- if this router
   * exposed `completeWithProgress` unconditionally, EVERY run would take this branch,
   * including chat runs, silently discarding their real streaming deltas. `supportsProgress`
   * below is `execute-run.ts`'s per-run gate: it calls this method only for a run whose
   * PINNED provider itself implements `completeWithProgress`, so this delegation never has
   * to fall back to anything -- a resolved port lacking the method here is a caller bug.
   */
  async completeWithProgress(
    input: ModelCallInput,
    onProgress: (event: ModelCallProgressEvent) => Promise<void>,
  ): Promise<{ readonly text: string; readonly tokens?: number }> {
    const port = this.resolve(input.modelProvider);
    if (!port.completeWithProgress) {
      throw new ModelCallError(
        "MODEL_CALL_FAILED",
        `provider "${input.modelProvider}" does not implement completeWithProgress -- ` +
          "caller must gate on supportsProgress(modelProvider) before calling this",
      );
    }
    return port.completeWithProgress(input, onProgress);
  }

  /** Per-run capability query so `execute-run.ts` can decide the branch by what the run's
   * OWN pinned provider supports, not by whether the router object itself has the method
   * (the router always does, once any registered provider needs it -- see this class'
   * `completeWithProgress` doc comment for why that would otherwise be unsafe). */
  supportsProgress(modelProvider: string): boolean {
    return this.ports.get(modelProvider)?.completeWithProgress !== undefined;
  }

  /**
   * P2（#1561）—— 同 `supportsProgress` 的 per-run 能力查询，但**默认方向相反**：路由到的
   * port 自己没有实现 `supportsVision` 时，这里回 `false`（看不到），而不是"存在即支持"。
   * 理由逐字见 `ModelCallPort.supportsVision` 的文档——视觉输入没有一个专属方法可以当作
   * 存在性证据，一个 provider 收下 `images` 却什么都不做，在类型上与真的看到了完全一样，
   * 所以只能 fail closed。注册表里没有这个 provider 时同样回 `false`：那次调用本来就会
   * 在 `complete` 里以 `MODEL_PROVIDER_NOT_CONFIGURED` 失败，能力查询不该先替它抛。
   */
  supportsVision(modelProvider: string, modelId: string): boolean {
    const port = this.ports.get(modelProvider);
    return port?.supportsVision?.(modelProvider, modelId) ?? false;
  }

  /**
   * #654 阶段2a — ALWAYS defined on the router itself (unlike an individual port, where
   * absence means "cannot stream"). The router's job is dispatch, and dispatch always
   * succeeds; whether the ROUTED-TO port can stream is decided per-call, by checking that
   * port's own `completeStream`. A provider that cannot stream (today:
   * `open-deep-research`, image generation) falls back to `complete()` here -- `onDelta`
   * simply never fires for it, and the returned text is identical to calling `complete()`
   * directly. This keeps `execute-run.ts`'s presence check meaningful without the router
   * having to mirror "does ANY registered port stream" at construction time.
   */
  async completeStream(
    input: ModelCallInput,
    onDelta: (delta: string) => Promise<void>,
  ): Promise<{ readonly text: string; readonly tokens?: number }> {
    const port = this.resolve(input.modelProvider);
    if (port.completeStream) return port.completeStream(input, onDelta);
    return port.complete(input);
  }

  private resolve(modelProvider: string): ModelCallPort {
    const port = this.ports.get(modelProvider);
    if (!port) {
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        `no ModelCallPort registered for provider "${modelProvider}"`,
      );
    }
    return port;
  }
}
