/**
 * 子进程意外退出之后怎么办——**纯策略，不碰进程**，所以能被直接取证。
 *
 * ## 为什么需要这个
 * 2026-09-23 实测：`startManaged` 启动的每一个本地服务（API / deep-agent / 技能沙箱 /
 * 语音网关 / Ollama）**挂掉之后既不会被拉起，也不会告诉任何人**，只往日志里写一行。
 * 用户看到的是界面永远停在「正在思考」——这正是离线应用十大缺陷里的第 3 条，
 * 也是本地大模型应用这一类里最常见的形状（「下载说成功了、加载什么都不说、应用现在卡住了」）。
 *
 * ## 为什么不是「无脑重启」
 * 一个起不来的服务被无限重启，症状会从「卡住」变成「一边卡住一边烧 CPU」，更难诊断。
 * 所以：**窗口内有限次重启 + 退避，超了就停手并如实说**。
 * 「停手」比「继续试」更重要——用户需要知道这台机器上有个东西是坏的。
 *
 * ## 为什么退避是确定的而不是随机的
 * 单机上没有惊群问题，随机退避只会让「它到底会不会再试一次」变得不可预测。
 * 诊断一个本地应用时，可预测比分散负载重要。
 */

export interface RestartWindow {
  /** 窗口长度：超过这个时间的历史退出不算数。 */
  readonly windowMs: number;
  /** 窗口内最多重启几次。 */
  readonly maxRestarts: number;
  /** 第 n 次重启前等多久（n 从 1 开始）。 */
  readonly backoffMs: readonly number[];
}

/**
 * 默认策略：60 秒窗口内最多 3 次，间隔 1s / 3s / 8s。
 *
 * 三次是有理由的：本地服务起不来的常见原因是端口被占、数据目录被锁、依赖还没就绪，
 * 前两者重启一次就会再撞一次，第三种等几秒就好了。三次之后还不行，就不是等能解决的。
 */
export const DEFAULT_RESTART_WINDOW: RestartWindow = {
  windowMs: 60_000,
  maxRestarts: 3,
  backoffMs: [1_000, 3_000, 8_000],
};

export interface ExitRecord {
  readonly at: number;
  readonly code: number | null;
}

export type RestartDecision =
  | { readonly action: "restart"; readonly delayMs: number; readonly attempt: number }
  | { readonly action: "give-up"; readonly reason: string };

/**
 * 决定这次意外退出之后做什么。
 *
 * `history` 是**含本次**的退出记录，调用方负责把本次也加进去——这样这个函数没有隐藏状态。
 */
export function decideRestart(
  history: readonly ExitRecord[],
  now: number,
  w: RestartWindow = DEFAULT_RESTART_WINDOW,
): RestartDecision {
  const recent = history.filter((e) => now - e.at <= w.windowMs);
  const attempt = recent.length;                       // 本次已在 history 里
  if (attempt > w.maxRestarts) {
    return {
      action: "give-up",
      reason: `${Math.round(w.windowMs / 1000)} 秒内退出了 ${attempt} 次，不再自动重启`,
    };
  }
  const delayMs = w.backoffMs[Math.min(attempt - 1, w.backoffMs.length - 1)] ?? 0;
  return { action: "restart", delayMs, attempt };
}

/**
 * 说给用户听的那句话。**三段：发生了什么、对你意味着什么、你现在能做什么。**
 *
 * 不出现 exit code、ECONNREFUSED、EOF 这类词——它们对用户不构成信息，
 * 只会让人觉得自己没资格用这个软件。技术细节在日志里，日志可以一键导出。
 */
export function describeServiceFailure(
  service: string,
  decision: RestartDecision,
  impact: string,
): { readonly title: string; readonly body: string; readonly transient: boolean } {
  const label = SERVICE_LABELS[service] ?? service;
  if (decision.action === "restart") {
    return {
      title: `${label}刚刚停了，正在重新启动`,
      body: `${impact}\n正在第 ${decision.attempt} 次重试，请稍候。`,
      transient: true,
    };
  }
  return {
    title: `${label}起不来`,
    body: `${impact}\n已经连续试过几次都没成功，不再自动重试，以免一直占着这台机器。\n`
      + `重开一次应用通常能解决；如果还是不行，用「帮助 → 打开数据目录」里的日志联系我们。`,
    transient: false,
  };
}

/** 服务名要说人话——用户不认得 `deep-agent`。 */
export const SERVICE_LABELS: Readonly<Record<string, string>> = {
  api: "本地服务",
  "deep-agent": "智能体运行时",
  "skill-sandbox": "技能沙箱",
  "asr-gateway": "语音转写",
  ollama: "本地模型",
  model: "本地模型的装载",
  web: "界面服务",
};

/** 某个服务挂了，用户具体会看到什么失效——这句话决定了他要不要现在处理。 */
export const SERVICE_IMPACT: Readonly<Record<string, string>> = {
  api: "在这期间，打开的页面会读不到数据。",
  "deep-agent": "在这期间，发给 AI 的消息不会有回复。",
  "skill-sandbox": "在这期间，需要跑脚本的技能（生成文档、表格等）用不了。",
  model: "在这期间，发给 AI 的消息会等在那里——模型没能装进内存。其余功能不受影响。",
  "asr-gateway": "在这期间，录音转写用不了。已经录好的内容不受影响。",
  ollama: "在这期间，AI 不会回复。你的对话记录都还在。",
  web: "在这期间，界面可能打不开。",
};
