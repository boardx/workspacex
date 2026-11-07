"use client";
import * as React from "react";
import { ServerCog, User, CloudOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOptionalSession } from "@/components/session/session-provider";
import { useI18n } from "@/lib/i18n/provider";
import { httpFailureText } from "@/lib/http-failure-text";
import { localOrgGuaranteeKey, localOrgStartupHint } from "@/lib/i18n/namespaces/local-org";
import { ApiError } from "@/lib/api-client";
import { listCapabilities, type CapabilityListing } from "@/lib/live-capabilities";
import {
  getLocalOrg, getLocalRuntimeStatus,
  type GetLocalOrgOut, type GetLocalRuntimeStatusOut,
} from "@/lib/live-identity";
import { LOCAL_ORG_GUARANTEES, LOCAL_RUNTIME_STARTUP_HINT, isLocalModelEndpoint, localOrgCloudDisabledReason } from "@/lib/identity";

/**
 * #1172 —— 「我的本地」屏的三块数据接 **F16 / F15 的既有真端点**。
 *
 * ## 本组件不新增任何后端
 *
 * `GET /identity/local-org`（F16）、`GET /capabilities`（F15）、
 * `GET /identity/local-org/runtime`（F16）三条都已实现并 passing，只是前端一直读
 * `identity.mock.ts` 与组件里写死的 `DEMO_MODELS`。所以这是纯接线。
 *
 * ## orgId 从 `getLocalOrg()` 拿，不从会话拿
 *
 * 会话的 `currentOrgId` 是**当前正在用的**组织，可能是任意一个正式组织；
 * 拿它去查本地运行时会问错组织。本地组织的 id 只有 `getLocalOrg()` 知道——
 * 而它无参数（契约刻意如此：接受 org id 的端点就是可以被指向别人本地组织的端点）。
 *
 * ## 云端与否仍然只有一处判定
 *
 * `isLocalModelEndpoint(endpoint)`。契约里 `CapabilityListing` **故意没有**
 * `endpointKind: "cloud" | "self-hosted"` 这种标签字段，理由逐字写在契约注释里：
 * 一条写着 self-hosted 却指向 api.example.com 的记录会让承诺静默失效而无人发现。
 * 端点是事实，云端与否是推导——所以这里不读任何分类字段，也不自己认「什么是云端」。
 */

type Loaded = {
  readonly org: GetLocalOrgOut;
  readonly models: readonly CapabilityListing[];
  readonly runtime: GetLocalRuntimeStatusOut;
};

export function LocalOrgLive() {
  const { locale, t } = useI18n();
  // 所有者就是当前登录的人（本地组织恒为单人）。名字读会话里已解析的 identity，
  // 不用 `mockIdentity()`——那是这一屏最后一处 mock 读点。
  const ownerDisplayName = useOptionalSession()?.identity?.displayName ?? t("localOrg.self");
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const org = await getLocalOrg();
        // 运行时状态刻意**不**包在自己的 try 里：它挂了会返回 200 + available:false，
        // 真读不到就是真读不到，兜成「就绪」会让依赖失败态永远显示不出来。
        const [models, runtime] = await Promise.all([
          listCapabilities(org.org.id, "model"),
          getLocalRuntimeStatus(org.org.id),
        ]);
        if (!cancelled) setData({ org, models, runtime });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const errorText = error === "NO_ORG_MEMBERSHIP"
    ? t("localOrg.membershipError")
    : error === "LOCAL_ORG_ONLY"
      ? t("localOrg.localOnlyError")
      : error?.match(/^http_(\d+)$/)
        ? httpFailureText(Number(error.slice(5)), locale)
        : error;

  return (
    <>
      {/* ── 成员：只有自己，且没有邀请入口 ── */}
      <section className="flex flex-col gap-2" data-testid="local-org-members">
        <div className="flex items-center gap-1.5">
          <User aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-14 font-semibold">{t("localOrg.members")}</h2>
          {data && (
            <span className="text-11 text-muted-foreground" data-testid="local-org-member-count">
              {t("localOrg.memberCount", { count: data.org.memberCount })}
            </span>
          )}
        </div>
        <Card>
          <CardContent className="flex flex-col gap-2 pt-3">
            <div className="flex items-center gap-2">
              <span className="text-13 font-medium">{ownerDisplayName}</span>
              <Badge tone="outline">{t("localOrg.owner")}</Badge>
            </div>
            {/* 没有「邀请成员」按钮，而且这里说清楚为什么——空着会读作「功能还没做」 */}
            <p className="text-12 text-muted-foreground" data-testid="local-org-no-invite">
              {t("localOrg.noInvite")}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ── 模型：云端整行禁用并注明原因，不是隐藏 ── */}
      <section className="flex flex-col gap-2" data-testid="local-org-models">
        <div className="flex items-center gap-1.5">
          <ServerCog aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-14 font-semibold">{t("localOrg.models")}</h2>
          <span className="text-11 text-muted-foreground">{t("localOrg.endpointRule")}</span>
        </div>
        <Card>
          <CardContent className="flex flex-col pt-2">
            {error && (
              <p className="py-2 text-12 text-muted-foreground" data-testid="local-org-load-failed">
                {t("localOrg.loadFailed", { error: errorText ?? error })}
              </p>
            )}
            {data?.models.length === 0 && (
              // ⚠ F15 V1：组织没配模型就是空的。产品代码里不存在内置默认清单，
              //   `lint-no-builtin-capabilities` 把 `lib/mock/` 之外的清单形状当违规。
              <p className="py-2 text-12 text-muted-foreground" data-testid="local-org-models-empty">
                {t("localOrg.modelsEmpty")}
              </p>
            )}
            {(data?.models ?? []).map((m) => {
              // 判定用契约的函数，界面不自己认「什么是云端」；endpoint 为 null 的能力不是模型，按非本机处理
              const local = m.endpoint !== null && isLocalModelEndpoint(m.endpoint);
              return (
                <div
                  key={m.id}
                  data-testid={`local-org-model-${m.id}`}
                  data-disabled={local ? undefined : "true"}
                  className="flex flex-wrap items-center gap-2 border-b border-border-subtle py-2.5 last:border-0"
                >
                  <span className={local ? "text-13 font-medium" : "text-13 font-medium text-disabled-foreground"}>
                    {m.name}
                  </span>
                  <code className="text-11 text-muted-foreground">{m.endpoint ?? "—"}</code>
                  {local ? (
                    <Badge tone="outline">{t("localOrg.onDevice")}</Badge>
                  ) : (
                    <>
                      <Badge tone="outline">
                        <CloudOff aria-hidden className="mr-1 h-3 w-3" />
                        {t("localOrg.disabled")}
                      </Badge>
                      {/* 原因就摆在行上——「禁用但不说为什么」和隐藏一样让人误解 */}
                      <p className="w-full text-11 text-muted-foreground" data-testid={`local-org-model-reason-${m.id}`}>
                        {m.endpoint === null
                          ? t("localOrg.noEndpoint")
                          : locale === "zh-CN"
                            ? localOrgCloudDisabledReason(m.endpoint)
                            : t("localOrg.cloudDisabledReason", {
                                endpoint: m.endpoint,
                                guarantee: t(localOrgGuaranteeKey(LOCAL_ORG_GUARANTEES[0].id)),
                              })}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      {/* ── 本地运行时 ── */}
      <section className="flex flex-col gap-2" data-testid="local-org-runtime">
        <div className="flex items-center gap-1.5">
          <ServerCog aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-14 font-semibold">{t("localOrg.runtime")}</h2>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-3">
            {data ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge tone="outline">{data.runtime.available ? t("localOrg.ready") : t("localOrg.notReady")}</Badge>
                  <code className="text-11 text-muted-foreground">{data.runtime.endpoint}</code>
                </div>
                {!data.runtime.available && (
                  // ⚠ 启动指引，不是「稍后重试」，也没有任何切换到云端的入口。
                  //   文案取契约常量：服务端在 200 body 里也带一份 startupHint，
                  //   已知契约指引只做显示翻译；未知服务端指引保持原样，不改写。
                  <p className="text-12 text-muted-foreground" data-testid="local-org-runtime-hint">
                    {localOrgStartupHint(t, data.runtime.failure?.startupHint ?? LOCAL_RUNTIME_STARTUP_HINT)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-12 text-muted-foreground">{t("localOrg.loading")}</p>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
