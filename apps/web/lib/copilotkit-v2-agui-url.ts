/**
 * issue #2318 —— `route.ts` 给 AG-UI `HttpAgent` 拼出站地址的纯函数本体。
 *
 * 拆出来是因为 `apps/web/app/api/copilotkit/[[...slug]]/route.ts` 是 Next.js route
 * handler，只允许导出 HTTP 方法名（同文件头注里 `resolveAgentQuery` 已经点过这条
 * 限制），拼 URL 这段纯逻辑要能被单测直接钉住，就不能留在那个文件里。
 *
 * 两个分支对应两种真实拓扑（`route.ts` 头注有完整事故记录，这里只留函数签名说明）：
 * - `internalPort` 有值（部署侧 `APP_API_PORT`）：直连 apps/api 的内网回环地址，
 *   这本身就是 apps/api 的真实 origin，不经过任何同源代理，不需要 path prefix。
 * - `internalPort` 为空：落到 `apiBaseUrl`（可能是真实 API 源，也可能像
 *   `playwright.fullstack-smoke.config.ts` 那样是 Next 自己的 origin，靠
 *   `NEXT_PUBLIC_API_PATH_PREFIX` 的 rewrite 转发）——必须像 `api-client.ts` 的
 *   `buildUrl()` 一样带上 `pathPrefix`，否则同源代理这条路是断的：请求会落在 Next
 *   自己身上，拿到一个字面 404 HTML 页面而不是 apps/api 的响应（真实事故，
 *   fullstack-smoke 2/2 稳定复现）。
 */
export function buildAguiUrl(
  path: string,
  env: {
    readonly internalPort: string | undefined;
    readonly apiBaseUrl: string;
    readonly pathPrefix: string | undefined;
  },
): string {
  const internalPort = env.internalPort?.trim();
  if (internalPort) return `http://127.0.0.1:${internalPort}${path}`;
  const prefix = (env.pathPrefix ?? "").replace(/\/$/, "");
  return `${env.apiBaseUrl}${prefix}${path}`;
}
