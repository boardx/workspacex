/**
 * Single source of truth for "how long is a relay/bridge willing to keep polling a run
 * before giving up and reporting a timeout to the client".
 *
 * This value used to be declared independently in `stream-run.ts` (225 polls / ~90s) and
 * `agui-bridge.ts` (75 polls / ~30s). The two drifted apart: `stream-run.ts`'s REST relay
 * was deliberately set to ~90s to match the legacy `chat-live-message-panel.tsx` client's
 * own wait budget, but the newer copilotkit-v2 AG-UI bridge (`agui-bridge.ts`) kept the
 * ~30s default it was scaffolded with (#1963 DA-19a) and nobody re-aligned it. The result:
 * a slower agent run (e.g. a multi-block canvas template like a journey map, versus a
 * simpler one like a persona) reliably finished under the legacy panel's 90s budget but
 * timed out under copilotkit-v2's tighter 30s budget -- the client gave up polling well
 * before the run itself was done (the run keeps executing server-side either way; nothing
 * here cancels it -- giving up on polling only stops the client from ever hearing the
 * result).
 *
 * Both relays should use the same budget unless a caller has a specific reason to override
 * it (both `runAguiBridgeTurn`/`resumeAguiBridgeTurn` and `streamAgentRunDeltas` accept an
 * explicit `maxPolls`/`pollIntervalMs` on their input for that case). Change this constant,
 * not the call sites, if the shared budget itself needs to move.
 *
 * ## 2026-08-29 real devapp evidence -- 90s was STILL too short, again
 *
 * 人类在真实 devapp 报告：挂了平台级 skill 的"通用助手"对话，`list_org_skills`
 * 工具调用（`apps/deep-agent-service`，真实模型编排，不是即时回复）之后，前端出现
 * "这次执行超时了，还没有等到结果"——run 本身没有失败，只是没等到。
 *
 * 根因与这份文件自己记录过的那次（30s→90s）同一个模式，只是这次的"更慢的 run"是
 * 多了至少一次 `list_org_skills`/`call_skill` 真实工具调用往返的深度助手 run，
 * 不是"多几个画布块"。真正的服务端预算是 `KERNEL_DEEP_AGENT_TIMEOUT_MS`
 * （`readDeepAgentProviderConfig`，默认 300_000ms = 5 分钟——那个默认值自己的
 * 注释写着"a starting placeholder, not a measured figure"，即便如此也已经是
 * 这里 90s 预算的 3 倍多）：`DeepAgentModelProvider.completeWithProgress` 会
 * 老老实实等到那个预算耗尽才诚实报 `MODEL_CALL_FAILED`，但**这个中继层的 90s
 * 预算永远先到期**——用户看到的"超时"文案，测的从来不是 run 有没有真的挂，
 * 是"我们愿不愿意继续等它"，而这个数字比后端自己的耐心还短。
 *
 * ⇒ 提到能覆盖后端已知最长预算（deep-agent 的 300s）再留一点余量，让后端自己
 *   的诚实失败（真的挂了）有机会先到达，而不是被这一层更短的通用超时文案抢先
 *   盖住。`tests/agent-runtime/poll-budget-covers-deep-agent-timeout.test.ts`
 *   把这条关系钉成一条真实读值比较的断言（读 `readDeepAgentProviderConfig()`
 *   的真实默认值，不是重复抄一遍这段注释里的数字），下次两边任何一个改动导致
 *   再次不够长，这条测试会先变红，不必等下一次真实用户在 devapp 撞见。
 */
export const DEFAULT_RUN_POLL_INTERVAL_MS = 400;

/** ~320s bound at the default poll interval -- see this file's 2026-08-29 note above for
 *  why 90s (225 polls) was raised: it must exceed `KERNEL_DEEP_AGENT_TIMEOUT_MS`'s own
 *  300s default, not just "feel like enough". */
export const DEFAULT_RUN_MAX_POLLS = 800;
