/**
 * 「我有没有平台运营准入」的真实读路径（契约 `platformMembers.getPlatformAccess`，
 * permissions-review delta，2026-09-20 人类要求：只有平台管理员看得到平台管理菜单）。
 *
 * ⚠ 类型走 `z.infer`，不重新声明字段名（`lint-contract-source` 要求）。
 * ⚠ 这条答案只用来决定**画不画菜单入口**，不是权限本身（UC-0.3 R5）。服务端那道门
 *   （`PlatformOperatorGuard`）没有因此变松：藏起来的路由直接敲 URL 仍然 403。
 */
import { platformMembers } from "@repo/contracts";
import type { z } from "zod";
import * as React from "react";
import { apiRequest } from "./api-client";

export type PlatformAccess = z.infer<typeof platformMembers.operations.getPlatformAccess.out>;

export async function getPlatformAccess(): Promise<PlatformAccess> {
  return apiRequest<PlatformAccess>(platformMembers.operations.getPlatformAccess.path, { method: "GET" });
}

/**
 * 进程内缓存：壳层每次导航都会重挂一次左栏，「我是不是平台运维」在一次会话里不会变
 * （授予/撤销都要另一个人在名册屏上操作，那会走它自己的刷新），所以按 userId 缓存一份，
 * 不每次挂载都打一条请求。失败**不缓存**——下次挂载重试。
 */
const cache = new Map<string, PlatformAccess>();

/** 授予/撤销平台管理员之后让菜单跟着变（同 `invalidateOrgAvatar` 的先例）。 */
export function invalidatePlatformAccess(): void {
  cache.clear();
}

/**
 * `undefined` = 还没有答案（未登录，或请求在飞）。调用方据此**先不画**平台入口——
 * 见 `lib/navigation.ts` 的 `NavViewer.platformOperator` 注释。
 */
export function usePlatformAccess(userId: string | null): PlatformAccess | undefined {
  const [access, setAccess] = React.useState<PlatformAccess | undefined>(() =>
    userId ? cache.get(userId) : undefined,
  );

  React.useEffect(() => {
    if (!userId) {
      setAccess(undefined);
      return;
    }
    const cached = cache.get(userId);
    if (cached) {
      setAccess(cached);
      return;
    }
    let cancelled = false;
    void getPlatformAccess()
      .then((out) => {
        cache.set(userId, out);
        if (!cancelled) setAccess(out);
      })
      .catch(() => {
        // 拿不到答案不是错误态——按"不是平台运维"处理（不画入口），安静回落。
        // 缓存里不写，下次挂载会重试。
        if (!cancelled) setAccess(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return access;
}
