"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { CapabilityCatalogScreen } from "./capability-catalog-screen";
import { AgentDefinitionCreatePanel } from "./agent-definition-create-panel";
import { AgentUrlImportPanel } from "./agent-url-import-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/files/overlay";
import type { UiState } from "@/lib/ui-state";

/**
 * #617：在 F15 能力目录（`CapabilityCatalogScreen`，目录项，粗粒度）之上补一个独立的
 * "新建 Agent" 入口，打真实的 F55 `POST /agents`（`createAgent`）——这条路径此前在
 * 全仓没有任何 controller 挂载，`grep -rln "createAgent" apps/web` 曾经零命中。
 *
 * 人类反馈（2026-08-17）："新建/导入不能摆在主界面顶部"——与 Skill 侧
 * （`skill-catalog-live.tsx` 的 `Modal` + `CreateModeTabs`）统一成同一种体验：
 * 一个触发按钮 + 一个弹层，弹层内用 tab 切"新建 Agent" / "从 URL 导入"，
 * 而不是把两块表单常驻展开在目录上方、把真正想看的「Agent 目录」挤到折叠线以下。
 *
 * 两个 tab 内容刻意保持分开渲染（不合并成一个表单）：它们写的是两张不同的表，
 * 混在一起会让用户以为"新建"和"导入"是同一次操作的两种叫法。
 *
 * 2026-08-11（人类直接裁决，真合并）：原「智能体运行时」的三层权限·工具白名单
 * （含越权申请）与 agent 行为审计两个子屏（`agent-runtime/permission-screen.tsx`、
 * `audit-screen.tsx`）折入本屏下方——后台左栏不再有独立的「智能体运行时」入口。
 * 见 `lib/navigation.ts` `ADMIN_SECOND_LEVEL` 里 `agent-runtime` 项的注释。
 */

type CreateMode = "definition" | "import";

const CREATE_MODE_TABS: readonly { id: CreateMode; label: string }[] = [
  { id: "definition", label: "新建 Agent" },
  { id: "import", label: "从 URL 导入" },
];

function CreateModeTabs({
  mode,
  onChange,
}: {
  mode: CreateMode;
  onChange: (mode: CreateMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="agent-create-mode-tabs">
      {CREATE_MODE_TABS.map((tab) => (
        <Button
          key={tab.id}
          size="xs"
          variant={mode === tab.id ? "primary" : "outline"}
          aria-pressed={mode === tab.id}
          onClick={() => onChange(tab.id)}
          data-testid={`agent-create-mode-${tab.id}`}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}

export function AgentScreen({ state }: { state: UiState }) {
  void state;
  const { identity } = useSession();
  const canMutate = identity?.orgRole === "admin";
  const [creating, setCreating] = React.useState(false);
  const [createMode, setCreateMode] = React.useState<CreateMode>("definition");
  return (
    <div className="flex flex-col gap-5">
      {canMutate ? (
        <div className="px-6 pt-6 flex justify-end">
          <Button
            size="sm"
            variant="primary"
            onClick={() => setCreating(true)}
            data-testid="agent-create-open"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建 / 导入 Agent
          </Button>
        </div>
      ) : null}
      {creating ? (
        <Modal
          title="新建 / 导入 Agent"
          subtitle="两条路径：从零新建／从 URL 导入"
          onClose={() => setCreating(false)}
          testid="agent-create-modal"
          width="lg"
        >
          <div className="flex flex-col gap-3" data-testid="agent-create-launcher">
            <CreateModeTabs mode={createMode} onChange={setCreateMode} />
            {createMode === "definition" ? (
              <AgentDefinitionCreatePanel prefix="admin-agent-definition" />
            ) : null}
            {createMode === "import" ? <AgentUrlImportPanel /> : null}
          </div>
        </Modal>
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
