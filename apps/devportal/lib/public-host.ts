// 公开层拆域（backlog F1，人类决策 D13）——「哪个主机名是公开层」与「哪些路径属于公开层」
// 的唯一事实源。middleware.ts 只调这里的纯函数，测试也只测这里。
//
// 公开主机名只由一个 env 声明：DEVPORTAL_PUBLIC_HOST（wrangler.toml [vars]）。代码里
// 不写死任何域名——实际域名是人类/DNS 决策。未配置或仍是占位值时：
//   * 运行时：视为「尚未拆域」，公开页在协作主机上照旧可达（不 308 到不存在的域）；
//   * 部署时：scripts/assert-public-host.mjs 让 CD 大声失败（占位值不许上生产）。

/** wrangler.toml 里的占位值；部署门控与运行时都认它为「未配置」。 */
export const PUBLIC_HOST_PLACEHOLDER = "__SET_DEVPORTAL_PUBLIC_HOST__";

/** 公开层页面前缀（与 tests/public-layer-static.test.ts 的四个入口一一对应）。 */
export const PUBLIC_PAGE_PREFIXES = ["/explore", "/projects", "/u", "/a"] as const;

/** 公开主机上额外放行的静态资源（不含任何数据接口）。 */
const PUBLIC_ASSET_PREFIXES = ["/_next/", "/favicon.ico", "/robots.txt"] as const;

/** 需要会话的协作层页面（工作区 / 个人层 / 接入向导）。 */
const SESSION_GATED_PREFIXES = ["/me", "/p", "/onboard"] as const;

function hasPrefix(pathname: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicPagePath(pathname: string): boolean {
  return PUBLIC_PAGE_PREFIXES.some((p) => hasPrefix(pathname, p));
}

export function isSessionGatedPath(pathname: string): boolean {
  return SESSION_GATED_PREFIXES.some((p) => hasPrefix(pathname, p));
}

function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

/** 规范化 env 值；未配置或占位 → null（= 尚未拆域）。 */
export function configuredPublicHost(raw: string | undefined | null): string | null {
  const v = normalizeHost(raw);
  if (!v || v === PUBLIC_HOST_PLACEHOLDER.toLowerCase()) return null;
  return v;
}

/**
 * 公开页上「加入这个项目」指向协作层的链接。协作主机由 DEVPORTAL_COLLAB_HOST 声明（现有
 * 协作域，不是新决策）；未配置 = 尚未拆域 → 同主机相对路径，行为与拆域前一致。
 */
export function joinHrefFor(slug: string, rawCollabHost: string | undefined | null): string {
  const path = `/join/${encodeURIComponent(slug)}`;
  const host = normalizeHost(rawCollabHost);
  return host ? `https://${host}${path}` : path;
}

export type HostDecision =
  | { kind: "public-pass" } // 公开主机上的公开页/静态资源：零鉴权直通
  | { kind: "public-not-found" } // 公开主机上的一切非公开路径：404，永不暴露协作层
  | { kind: "redirect-public"; location: string } // 协作主机上的公开页：308 搬到公开主机
  | { kind: "require-session" } // 协作主机上的工作区/个人层/接入向导
  | { kind: "pass" }; // 协作主机上的其它路径（治理面等，Access 在边缘把门）

export function decideRoute(input: {
  host: string | null | undefined;
  pathname: string;
  search: string;
  publicHost: string | null;
}): HostDecision {
  const { pathname, search, publicHost } = input;
  if (publicHost !== null && normalizeHost(input.host) === publicHost) {
    if (isPublicPagePath(pathname) || PUBLIC_ASSET_PREFIXES.some((p) => hasPrefix(pathname, p))) {
      return { kind: "public-pass" };
    }
    return { kind: "public-not-found" };
  }
  if (publicHost !== null && isPublicPagePath(pathname)) {
    return { kind: "redirect-public", location: `https://${publicHost}${pathname}${search}` };
  }
  if (isSessionGatedPath(pathname)) return { kind: "require-session" };
  return { kind: "pass" };
}
