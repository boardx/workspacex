import * as React from "react";

/**
 * 个人设置："每次都先给我看计划"（issue #2667）——纯前端持久化投影，与
 * `lib/theme.ts` 同一套模式（`localStorage` + 无后端概念的运行期读写）。
 *
 * ## 背景：这个开关到底关掉了什么
 *
 * `deep-agent-service` 的 `TaskClassifierMiddleware`（issue #2662）在灰度
 * `DEEP_AGENT_TASK_AUTO_CLASSIFY=1` 打开后，会自动判断一条消息是不是"多步任务"，
 * 命中就把 `tool_choice` 钉成 `write_todos`——不再要求用户手动点开「任务模式」
 * 开关（`apps/web/lib/copilotkit-v2-task-mode.ts`）才会先出计划。
 *
 * 自动判类是默认行为，但不能是唯一选项：坚持要手动控制的用户（这个开关打开）
 * 会让**这一次 run** 透传 `disable_task_auto_classify: true`（见
 * `apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts` 的
 * `configurable` 透传、`harness.py` 的 `_run_disables_auto_classify`），行为
 * 回退到改造前——完全依赖现有的手动「任务模式」开关决定要不要先出计划。
 *
 * ## 默认值：关闭
 *
 * 默认关闭 = 默认启用自动判类这个新行为（issue #2667 验收标准②）。只有用户
 * 主动打开过这个设置，`localStorage` 才会出现这个键；键不存在与显式写 `"false"`
 * 是同一个含义（关闭），不需要区分"从未设置过"和"设置过但关闭"。
 */
export const ALWAYS_PLAN_FIRST_STORAGE_KEY = "wsx.chat.alwaysPlanFirst";

export function getStoredAlwaysPlanFirst(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ALWAYS_PLAN_FIRST_STORAGE_KEY) === "true";
  } catch {
    // 隐私模式/站点数据被禁：读不到就按默认关闭处理，不让一次存储异常变成运行时报错。
    return false;
  }
}

export function setStoredAlwaysPlanFirst(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ALWAYS_PLAN_FIRST_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // 同上——写失败（配额满/隐私模式）不应该让开关本身的点击操作抛错。
  }
}

/**
 * React 绑定——组件挂载时从 `localStorage` 读一次初始值（SSR/首屏渲染期
 * `window` 不存在，退回 `false`，与 `getStoredAlwaysPlanFirst` 的 SSR 分支
 * 同一个值，不会出现"服务端渲染成关、客户端 hydrate 后突然变开"的闪烁——
 * 用户上一次真正打开过这个设置时，仍然是在客户端点的，本来就只有客户端
 * 挂载后才读得到，与 `lib/theme.ts` 的 `THEME_BOOTSTRAP_SCRIPT` 需要在
 * hydration 之前跑是同一类问题，但这个开关不影响首屏视觉，不需要那套
 * 阻塞脚本）。`toggle`/`setValue` 同时更新 state 与 `localStorage`，两者
 * 不会不同步。
 */
export function useAlwaysPlanFirstSetting(): {
  readonly alwaysPlanFirst: boolean;
  readonly setAlwaysPlanFirst: (value: boolean) => void;
  readonly toggleAlwaysPlanFirst: () => void;
} {
  const [alwaysPlanFirst, setAlwaysPlanFirstState] = React.useState(false);

  React.useEffect(() => {
    setAlwaysPlanFirstState(getStoredAlwaysPlanFirst());
  }, []);

  const setAlwaysPlanFirst = React.useCallback((value: boolean) => {
    setAlwaysPlanFirstState(value);
    setStoredAlwaysPlanFirst(value);
  }, []);

  const toggleAlwaysPlanFirst = React.useCallback(() => {
    setAlwaysPlanFirstState((prev) => {
      const next = !prev;
      setStoredAlwaysPlanFirst(next);
      return next;
    });
  }, []);

  return { alwaysPlanFirst, setAlwaysPlanFirst, toggleAlwaysPlanFirst };
}
