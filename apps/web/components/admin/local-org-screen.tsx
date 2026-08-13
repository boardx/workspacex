"use client";
import * as React from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { LocalExportPanel } from "./local-export-panel";
import { LocalOrgLive } from "./local-org-live";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LOCAL_ORG_GUARANTEES, LOCAL_RUNTIME_STARTUP_HINT } from "@/lib/identity";
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
 * ## 数据从哪来（#1172 之后边界很清楚）
 *
 *   **常量** —— 三条承诺、启动指引、云端禁用原因、「什么算本机端点」，
 *     来自 `packages/contracts` 导出的常量与函数。它们是产品承诺，不是数据，
 *     没有「读库读出来」这回事，所以留在本文件里。
 *   **数据** —— 成员数、可用模型、运行时状态、所有者名字，全部来自真端点，
 *     见 `local-org-live.tsx`。#1172 之前它们读 `identity.mock.ts`、
 *     本文件里写死的 `DEMO_MODELS`、以及 `mockIdentity()`，三处都已删除。
 *
 * ⚠ 不要把模型清单写回本文件。产品代码里不存在默认能力清单（F15 V1），
 *   `lint-no-builtin-capabilities` 把 `apps/web/lib/mock/` 之外的清单形状当违规，
 *   `tests/ui/local-org-live.test.tsx` 另有一条源码断言守着它。
 */
export function LocalOrgScreen({ state }: { state: UiState }) {
  return (
    <AdminScreen
      state={state}
      moduleLabel="本地组织"
      title="我的本地"
      intro="这个组织只有你一个人，且它的数据不出本机。以下三条是产品承诺，不是可配置项——任何接口都改不动它们。"
      emptyHint="本机还没有可用的本地模型，先在本机启动推理运行时"
      // #1172：三块数据都读真端点了，屏级「示例数据」提示不再适用。
      liveBacked
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

        {/* ── 导出豁口（F17）：三条承诺唯一被允许打开的口子，就放在承诺下面 ── */}
        <LocalExportPanel />

        {/* ── 成员 / 可用模型 / 本地运行时：真端点 ── */}
        <LocalOrgLive />
      </div>
    </AdminScreen>
  );
}
