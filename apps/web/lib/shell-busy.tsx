"use client";

/**
 * 「现在有活在跑吗」——壳层要在切换组织之前回答这个问题，但壳层自己不知道。
 *
 * ## 为什么不新开一个接口去问服务端
 * 壳层挂在 47 个页面上，加一个「本组织在途 run 数」的轮询就是给每一页加一条常驻请求，
 * 而真正要告诉用户的只是**他眼前这件事**会怎样。知道这件事的是聊天那层
 * （`agent.isRunning`）。所以方向反过来：跑着的那一方向壳层登记一句，壳层只读。
 * 零新请求，且数字与用户屏幕上看到的一致。
 *
 * ## 这个数字的边界：**它只统计挂载着的那一方**
 * 用户不在聊天页时，`CopilotKitV2Shell` 已经卸载、销了账，这里就是 0——哪怕服务端
 * 确实还有 run 在跑。所以：
 * - **说出来的时候一定是真的**（有登记 = 确实有活在跑），
 * - 但**没说 ≠ 没有**。任何读这个数的地方都不能把 0 当成「组织里没有任务在跑」。
 *
 * 要让它在任何页面上都准，得有一个组织级的「在跑的 run 数」接口，而那要动
 * `packages/contracts`——本轮任务的硬约束里不许动。不硬凑一个半真的数字：
 * 一个有时候撒谎的指示器比没有指示器更糟。
 *
 * ## 为什么是 Map 不是计数器
 * 计数器会因为重复登记 / 漏销账漂移，而漂移出来的数字会被写进「N 个任务正在运行」
 * 这句话里——宁可让每个登记方自带 key，重复登记覆盖，卸载即删。
 */

import * as React from "react";

interface ShellBusyValue {
  readonly count: number;
  readonly register: (key: string, busy: boolean) => void;
}

const ShellBusyContext = React.createContext<ShellBusyValue | null>(null);

export function ShellBusyProvider({ children }: { children: React.ReactNode }) {
  const [keys, setKeys] = React.useState<ReadonlySet<string>>(() => new Set());
  const register = React.useCallback((key: string, busy: boolean) => {
    setKeys((prev) => {
      const has = prev.has(key);
      if (busy === has) return prev;               // 同值不重渲染
      const next = new Set(prev);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const value = React.useMemo(() => ({ count: keys.size, register }), [keys, register]);
  return <ShellBusyContext.Provider value={value}>{children}</ShellBusyContext.Provider>;
}

/** 壳层读：现在有几件活在跑。Provider 不在时为 0——壳层不因为缺 Provider 而崩。 */
export function useShellBusyCount(): number {
  return React.useContext(ShellBusyContext)?.count ?? 0;
}

/**
 * 跑着的那一方用：`useReportShellBusy("chat:" + threadId, agent.isRunning)`。
 * 卸载时自动销账，所以关掉页面/切走路由都不会留下幽灵计数。
 */
export function useReportShellBusy(key: string, busy: boolean): void {
  const ctx = React.useContext(ShellBusyContext);
  const register = ctx?.register;
  React.useEffect(() => {
    if (!register) return;
    register(key, busy);
    return () => register(key, false);
  }, [register, key, busy]);
}
