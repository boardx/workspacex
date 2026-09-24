/**
 * ops-console —— 内部运营平面骨架（backlog D1）：发布控制台 + 事故面板。
 *
 * 路由（除 healthz 外全部要求有效的 Cloudflare Access JWT）：
 *   GET   /api/ops/healthz                 配置是否就绪（只报布尔，不回显值）
 *   GET   /api/ops/releases                只读；现取 GitHub Releases + 部署 workflow 运行
 *   GET   /api/ops/incidents               事故列表
 *   POST  /api/ops/incidents               新建（severity / components / affectedInstanceHashes / internalSummary）
 *   GET   /api/ops/incidents/:id
 *   PATCH /api/ops/incidents/:id           改 severity / status / components / summary，状态变化进时间线
 *   POST  /api/ops/incidents/:id/resolve   关闭（不可再改）
 *   GET/POST/PATCH /api/ops/gtm/...          GTM 活动与漏斗（D2，只存聚合与不透明 ID，见 gtm.ts）
 *
 * 下一步（骨架之外，未做）：
 *   1. 人类建 Access 应用 + 路由，填 ACCESS_TEAM_DOMAIN / ACCESS_AUD，put GITHUB_READ_TOKEN；
 *   2. 部署 workflow（仿 deploy-coord-gateway.yml）——本骨架先不自动部署，等设计签核；
 *   3. 发布清单（packages/cloud-deploy release manifest）目前只落在 CN 主机
 *      /etc/workspacex-cn/releases，未发布到 GitHub；若要在控制台显示镜像 digest，
 *      应让流水线把清单作为 Release asset 上传，控制台再按 releaseManifestSchema 校验读取；
 *   4. 最小 UI（目前只有 JSON API）；事故时间线的操作人（Access 身份）要不要记，需另议——
 *      那是员工 PII，当前刻意不存。
 */
import { certsResolver, verifyAccessJwt, type KeyResolver } from "./access";
import { githubClient, listReleases } from "./releases";

export { IncidentLog } from "./incidents";
export { GtmLog } from "./gtm";

export interface Env {
  INCIDENTS: DurableObjectNamespace;
  GTM: DurableObjectNamespace;
  RELEASE_REPO: string;
  DEPLOY_WORKFLOWS: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  GITHUB_READ_TOKEN?: string;
}

export interface Deps { resolveKey?: KeyResolver; gh?: (path: string) => Promise<unknown> }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/ops/")) return json(404, { error: "NOT_FOUND" });
  const route = url.pathname.slice("/api/ops".length);

  if (route === "/healthz") {
    return json(200, { ok: true, access_configured: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD), github_configured: Boolean(env.GITHUB_READ_TOKEN) });
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return json(503, { error: "ACCESS_NOT_CONFIGURED" });
  const jwt = request.headers.get("cf-access-jwt-assertion");
  if (!jwt) return json(401, { error: "ACCESS_JWT_REQUIRED" });
  const cfg = { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD };
  if (!(await verifyAccessJwt(jwt, cfg, deps.resolveKey ?? certsResolver(cfg.teamDomain)))) return json(403, { error: "ACCESS_JWT_INVALID" });

  if (route === "/releases" && request.method === "GET") {
    const gh = deps.gh ?? (env.GITHUB_READ_TOKEN ? githubClient(env.GITHUB_READ_TOKEN) : null);
    if (!gh) return json(503, { error: "GITHUB_NOT_CONFIGURED" });
    const workflows = env.DEPLOY_WORKFLOWS.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      return json(200, { releases: await listReleases(gh, env.RELEASE_REPO, workflows) });
    } catch (e) {
      return json(502, { error: "GITHUB_UNAVAILABLE", detail: e instanceof Error ? e.message : "unknown" });
    }
  }

  if (route === "/incidents" || route.startsWith("/incidents/")) {
    const stub = env.INCIDENTS.get(env.INCIDENTS.idFromName("global"));
    return stub.fetch(new Request(`https://incidents${route}`, request));
  }
  if (route.startsWith("/gtm/")) {
    const stub = env.GTM.get(env.GTM.idFromName("global"));
    return stub.fetch(new Request(`https://gtm${route}${url.search}`, request));
  }
  return json(404, { error: "NOT_FOUND" });
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
} satisfies ExportedHandler<Env>;
