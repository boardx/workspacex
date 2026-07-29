"use client";
import * as React from "react";
import { Lock, ServerCog, ShieldCheck, User, CloudOff } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LOCAL_ORG_GUARANTEES, LOCAL_RUNTIME_STARTUP_HINT, isLocalModelEndpoint,
  localOrgCloudDisabledReason, mockIdentity,
} from "@/lib/identity";
import { getLocalOrgMock, getLocalRuntimeStatusMock } from "@/lib/generated/identity.mock";
import type { UiState } from "@/lib/ui-state";

/**
 * 「我的本地」组织屏（F16）
 *
 * ## 这一屏的每一块都对应 user_visible_behavior 的一句
 *
 *   三条承诺常驻          「最隐私的数据不出本机」不是一句宣传语，要逐条摆出来
 *   成员列表只有自己       本地组织恒为单人（2026-07-28 裁决）
 *   **没有邀请入口**       不是禁用一个按钮——按钮根本不存在（契约 `canInvite: z.literal(false)`）
 *   云端模型整行禁用+原因   不是隐藏。藏起来读作「产品做不到」，真相是「这个组织不允许」
 *   运行时依赖失败态       给启动指引，而不是「稍后重试」——绝不改用云端
 *
 * ## 数据从哪来
 *
 * 全部来自**契约**：`lib/generated/identity.mock.ts` 是从 `packages/contracts` 生成的，
 * 三条承诺、启动指引、云端禁用原因、「什么算本机端点」也都是契约导出的常量与函数。
 * 这一屏刻意**不碰** `lib/mock/admin.ts` —— 那份手写 mock 正是 F15 记在账上的债务，
 * 从它取数会让本屏成为第 21 处硬编码。
 */

/**
 * 示例条目：**结构**来自契约类型，值在这里给。
 *
 * ⚠ 它不是「内置清单」（F15 V1 禁止的那种）：产品代码里不存在默认能力清单，
 * 这是一屏 mock 的展示样本，且 `lint-no-builtin-capabilities` 把 `apps/web/lib/mock/` 之外的
 * 清单形状当违规——所以这里只放两条、且明确标注为演示数据。
 */
const DEMO_MODELS: { id: string; name: string; endpoint: string }[] = [
  { id: "m-local", name: "qwen3-8b（本机）", endpoint: "http://127.0.0.1:11434" },
  { id: "m-cloud", name: "vendor-cloud-pro", endpoint: "https://api.vendor.example/v1" },
];

export function LocalOrgScreen({ state }: { state: UiState }) {
  const identity = mockIdentity("org-local", null);
  const runtimeDown = state === "dep-failed";
  const runtime = runtimeDown
    ? { ...getLocalRuntimeStatusMock, available: false }
    : { ...getLocalRuntimeStatusMock, available: true, failure: null };

  return (
    <AdminScreen
      state={state}
      moduleLabel="本地组织"
      title="我的本地"
      intro="这个组织只有你一个人，且它的数据不出本机。以下三条是产品承诺，不是可配置项——任何接口都改不动它们。"
      emptyHint="本机还没有可用的本地模型，先在本机启动推理运行时"
      // 依赖失败态 = 本地运行时没起来。文案取自契约常量，不在这里另写一句。
      depFailure={LOCAL_RUNTIME_STARTUP_HINT}
      denialReason="本地组织只对它的所有者可见——组织管理员与平台运营都看不到，这比「个人层对管理员封闭」更强：数据根本不在他们的组织里。"
      successMessage="本地模型调用完成，本次未产生任何出网流量"
    >
      <div className="flex flex-col gap-5">
        {/* ── 三条硬隔离：常驻，逐条 ── */}
        <section className="flex flex-col gap-2" data-testid="local-org-guarantees">
          <div className="flex items-center gap-1.5">
            <ShieldCheck aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">三条硬隔离</h2>
            <Badge tone="outline">产品承诺 · 不可关闭</Badge>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-3">
              {LOCAL_ORG_GUARANTEES.map((g) => (
                <div key={g.id} className="flex items-start gap-2" data-testid={`local-org-guarantee-${g.id}`}>
                  <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ai-tint-foreground" />
                  <p className="text-13">{g.statement}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* ── 成员：只有自己，且没有邀请入口 ── */}
        <section className="flex flex-col gap-2" data-testid="local-org-members">
          <div className="flex items-center gap-1.5">
            <User aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">成员</h2>
            <span className="text-11 text-muted-foreground">· 共 {getLocalOrgMock.memberCount} 人</span>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-3">
              <div className="flex items-center gap-2">
                <span className="text-13 font-medium">{identity.displayName}</span>
                <Badge tone="outline">所有者</Badge>
              </div>
              {/* 没有「邀请成员」按钮，而且这里说清楚为什么——空着会读作「功能还没做」 */}
              <p className="text-12 text-muted-foreground" data-testid="local-org-no-invite">
                本地组织恒为单人，因此没有邀请入口。需要多人协作又要求不出网的场景，
                请用私有部署的正式组织并把模型策略设为「只用自托管模型」——那是可配置策略，与这里的承诺不同。
              </p>
            </CardContent>
          </Card>
        </section>

        {/* ── 模型：云端整行禁用并注明原因，不是隐藏 ── */}
        <section className="flex flex-col gap-2" data-testid="local-org-models">
          <div className="flex items-center gap-1.5">
            <ServerCog aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">可用模型</h2>
            <span className="text-11 text-muted-foreground">· 端点不在本机的整行禁用（示例数据）</span>
          </div>
          <Card>
            <CardContent className="flex flex-col pt-2">
              {DEMO_MODELS.map((m) => {
                // 判定用契约的函数，界面不自己认「什么是云端」
                const local = isLocalModelEndpoint(m.endpoint);
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
                    <code className="text-11 text-muted-foreground">{m.endpoint}</code>
                    {local ? (
                      <Badge tone="outline">本机</Badge>
                    ) : (
                      <>
                        <Badge tone="outline">
                          <CloudOff aria-hidden className="mr-1 h-3 w-3" />
                          已禁用
                        </Badge>
                        {/* 原因就摆在行上——「禁用但不说为什么」和隐藏一样让人误解 */}
                        <p className="w-full text-11 text-muted-foreground" data-testid={`local-org-model-reason-${m.id}`}>
                          {localOrgCloudDisabledReason(m.endpoint)}
                        </p>
                      </>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>

        {/* ── 本地运行时状态 ── */}
        <section className="flex flex-col gap-2" data-testid="local-org-runtime">
          <div className="flex items-center gap-1.5">
            <ServerCog aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">本地运行时</h2>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-1.5 pt-3">
              <div className="flex items-center gap-2">
                <Badge tone="outline">{runtime.available ? "已就绪" : "未就绪"}</Badge>
                <code className="text-11 text-muted-foreground">{runtime.endpoint}</code>
              </div>
              {!runtime.available && (
                <p className="text-12 text-muted-foreground" data-testid="local-org-runtime-hint">
                  {LOCAL_RUNTIME_STARTUP_HINT}
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </AdminScreen>
  );
}
