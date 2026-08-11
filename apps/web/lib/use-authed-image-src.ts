"use client";
import * as React from "react";
import { getStoredSessionToken } from "@/lib/api-client";

/**
 * 受鉴权图片的拉取 hook —— 从 `components/org-admin/org-admin-screen.tsx` 提出来共享
 * （2026-08-11 左上角组织菜单也要拉组织头像，同一份实现不许出现第二份副本）。
 *
 * 头像类文件走**受鉴权**的 `GET /organizations/:orgId/avatar-file/:id` 等路由
 * （`@CurrentPrincipal` 门控）——裸 `<img src>` 发不出 `Authorization` 头，直接指向
 * 这类路由会永远拿到 401、图裂掉（D9 实测：curl 不带 Authorization → 401；带 → 200）。
 * 与本仓其余真实请求同一条纪律（`api-client.ts`：Bearer token 不是 cookie）——手动
 * `fetch` 带上头，拉 blob，`URL.createObjectURL()` 出一个本地 blob URL 再喂给 `<img>`。
 */
export function useAuthedImageSrc(url: string | null): { src: string | null; failed: boolean } {
  const [src, setSrc] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!url) {
      setSrc(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    (async () => {
      try {
        // 鉴权是 Bearer token，不是 cookie（同 `api-client.ts` 文件头那条纪律）——
        // 不需要 `credentials: "include"`，`Authorization` 头本身就带着身份。
        const token = getStoredSessionToken();
        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error(`http_${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) {
          setSrc(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return { src, failed };
}
