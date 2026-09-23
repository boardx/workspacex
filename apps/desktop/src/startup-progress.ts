/**
 * 启动屏的进度计算——从 `main.ts` 抽出来的**纯逻辑**，不碰 electron，所以能测。
 *
 * 抽出来的直接原因：给「拉模型进度」加的那一支是用户在首次启动最长的一段等待里
 * 唯一看得见的东西，而它原本住在一个 import 了 electron 的文件里，谁也测不了。
 * 没有测试的门在本仓等于不存在。
 */

/**
 * Startup screen: brand + a step progress bar driven by the runtime's log prefixes, the
 * current step in words, elapsed time; the raw log stays folded and only opens itself on
 * failure (人类反馈 2026-09-17: 每次启动先看一屏日志不像个正常 app).
 */
export const STARTUP_STEPS: readonly { readonly label: string; readonly match: RegExp }[] = [
  { label: "准备数据库", match: /^\[pglite\]|^\[src\/infrastructure\/db|^\[seeds\]|^\[scripts\// },
  { label: "检查本地模型", match: /^\[ollama\]/ },
  { label: "启动技能沙箱", match: /^\[skill-sandbox\]/ },
  { label: "启动语音转写", match: /^\[asr-gateway\]/ },
  { label: "启动服务", match: /^\[api\]/ },
  { label: "启动智能体", match: /^\[deep-agent\]/ },
  { label: "加载界面", match: /^\[web\]/ },
];

export function progressState(lines: string[], state: { startedAt: number; failed: boolean }) {
  let step = 0;
  for (const line of lines) {
    const i = STARTUP_STEPS.findIndex((st) => st.match.test(line));
    if (i > step) step = i;
  }
  const total = STARTUP_STEPS.length;
  const pct = state.failed ? 100 : Math.min(96, Math.round(((step + 0.5) / total) * 100));
  const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
  /**
   * 拉模型是首次启动最长的一段等待（聊天模型三个多 GB）。运行时现在会把
   * `[ollama] 拉取 <model> NN%（x/y GB）` 写进日志（`packages/local-runtime/src/pull-progress.ts`），
   * 这里把最近一条顶到台前——否则这几分钟里屏幕上只有「检查本地模型…」一动不动，
   * 用户看到的就是一个卡死的程序（2026-09-22 用户原话：「这个正常吗？」）。
   */
  const pulling = state.failed
    ? null
    : [...lines].reverse().find((l) => l.startsWith("[ollama] 拉取 ")) ?? null;
  const pullDone = lines.some((l) => /^\[ollama\] 拉取 .* 完成$/.test(l));
  const current = state.failed
    ? "启动失败"
    : pulling !== null && !pullDone
      ? pulling.slice("[ollama] ".length)
      : `${STARTUP_STEPS[step]!.label}…`;
  const firstRun = lines.some((l) => /database created|applied [1-9]/.test(l));
  const hint = state.failed
    ? "下面是启动日志，把它发给开发者即可定位。"
    : pulling !== null && !pullDone
      ? "首次启动要下载本地模型，取决于网速，通常几分钟。之后不再下载。"
      : firstRun ? "首次启动要初始化数据库，通常 1–2 分钟。" : "通常 15–30 秒。";
  return { step, pct, elapsed, current, hint, failed: state.failed, log: lines.slice(-200).join("\n") };
}

