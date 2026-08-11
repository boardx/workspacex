"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { CapabilityCatalogScreen } from "./capability-catalog-screen";
import { AgentDefinitionCreatePanel } from "./agent-definition-create-panel";
import { Card, CardContent } from "@/components/ui/card";
import type { UiState } from "@/lib/ui-state";

/**
 * #617：在 F15 能力目录（`CapabilityCatalogScreen`，目录项，粗粒度）之上补一个独立的
 * "新建 Agent" 入口，打真实的 F55 `POST /agents`（`createAgent`）——这条路径此前在
 * 全仓没有任何 controller 挂载，`grep -rln "createAgent" apps/web` 曾经零命中。
 *
 * 两块刻意分开渲染（不是合并成一个表单）：它们写的是两张不同的表，
 * 混在一起会让用户以为"新增"和"新建 Agent"是同一次操作的两种叫法。
 *
 * 2026-08-11（人类直接裁决，真合并）：原「智能体运行时」的三层权限·工具白名单
 * （含越权申请）与 agent 行为审计两个子屏（`agent-runtime/permission-screen.tsx`、
 * `audit-screen.tsx`）折入本屏下方——后台左栏不再有独立的「智能体运行时」入口。
 * 见 `lib/navigation.ts` `ADMIN_SECOND_LEVEL` 里 `agent-runtime` 项的注释。
 */
export function AgentScreen({ state }: { state: UiState }) {
  void state;
  const { identity } = useSession();
  const canMutate = identity?.orgRole === "admin";
  return (
    <div className="flex flex-col gap-5">
      {canMutate ? (
        <div className="px-6 pt-6">
          <AgentDefinitionCreatePanel prefix="admin-agent-definition" />
        </div>
      ) : null}
      <div className="px-6">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="text-12 text-muted-foreground">
              三层权限·工具白名单（含越权申请）与 agent 行为审计的运行时预览
              （原「智能体运行时」子屏，已并入此处）。
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/preview/agent-runtime?screen=permission"
                data-testid="admin-agent-open-runtime-permission"
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-12 transition-colors duration-200 hover:bg-muted"
              >
                工具白名单 · 越权申请预览
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/preview/agent-runtime?screen=audit"
                data-testid="admin-agent-open-runtime-audit"
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-12 transition-colors duration-200 hover:bg-muted"
              >
                行为审计预览
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
      <CapabilityCatalogScreen kind="agent" />
    </div>
  );
}
