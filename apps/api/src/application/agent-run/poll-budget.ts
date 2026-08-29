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
 *
 * ## 2026-08-29 第二次真实证据 -- 320s 还是不够：漏算了模型调用之后的沙箱执行
 *
 * 上面那次修复只把预算提到刚好盖过 `KERNEL_DEEP_AGENT_TIMEOUT_MS`（一次模型调用的
 * 预算）。但真实的"生成 PDF"这类 run 不是"模型调用完就结束"——`execute-run.ts`
 * 在模型调用**之后**还会调 `maybeRunSkillScript`（`run-skill-script.ts`），真的在
 * 沙箱里跑模型写出来的脚本，失败会回喂 stderr 再问模型要一版、最多重试
 * `MAX_SCRIPT_ATTEMPTS`（3）次，每次沙箱执行自己的预算是 `CHAT_SCRIPT_TIMEOUT_MS`
 * （120_000ms）。这一段时间完全在 `KERNEL_DEEP_AGENT_TIMEOUT_MS` 之外——模型调用
 * 计时器早就停了，沙箱执行的时钟才刚开始走。人类实测：一次真实 PDF 生成，聊天里
 * 先看到 `call_skill` 工具结果里的脚本文本，紧接着就是"这次执行超时了"——run 仍在
 * 服务端老老实实跑沙箱，只是 320s 这层预算又一次先到期。
 *
 * ⇒ 预算改为覆盖"一次模型调用 + 完整一轮沙箱重试循环"：
 *   `KERNEL_DEEP_AGENT_TIMEOUT_MS`（300s）+ `MAX_SCRIPT_ATTEMPTS` × `CHAT_SCRIPT_
 *   TIMEOUT_MS`（3 × 120s = 360s）= 660s，再留安全余量到 900s（15 分钟）。
 *   ⚠ 刻意不计入失败回喂时的 `regenerate` 调用本身耗时（那也是一次模型调用，
 *   理论上限同样是 `KERNEL_DEEP_AGENT_TIMEOUT_MS`）——三次回喂全部卡满模型自己的
 *   最长预算是一种病理场景（同一个 provider 连续 3 次全部最慢），不是这里要为之
 *   设计的常规路径；把这类极端情况也吃进预算会把这一层的等待时间推到接近半小时，
 *   代价（一个 HTTP/SSE 连接占用更久）大于收益。900s 覆盖的是"模型正常响应 + 完整
 *   沙箱重试循环"这个更常见也更值得覆盖的情形。
 *   `tests/agent-runtime/poll-budget-covers-deep-agent-timeout.test.ts` 同步更新为
 *   读 `CHAT_SCRIPT_TIMEOUT_MS`/`MAX_SCRIPT_ATTEMPTS` 的真实值参与比较，不是只比
 *   模型调用那一段。
 */
export const DEFAULT_RUN_POLL_INTERVAL_MS = 400;

/** ~900s（15 分钟）bound at the default poll interval -- 见本文件 2026-08-29 第二次
 *  证据那节：必须覆盖"一次模型调用（300s）+ 完整一轮沙箱重试循环（3×120s=360s）"，
 *  不是只覆盖模型调用本身。 */
export const DEFAULT_RUN_MAX_POLLS = 2250;
