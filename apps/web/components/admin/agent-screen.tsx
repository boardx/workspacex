"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { CapabilityCatalogScreen } from "./capability-catalog-screen";
import { AgentDefinitionCreatePanel } from "./agent-definition-create-panel";
import { AgentUrlImportPanel } from "./agent-url-import-panel";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/files/overlay";
import type { UiState } from "@/lib/ui-state";

/**
 * 后台「Agent 目录」（`/admin/agent`）。
 *
 * 2026-09-02（人类原话：「简化…Agent目录…参考画布模板的首页，简化为一个卡片的列表，
 * 通过一个侧边面板来展示当前的实体的内容，可以增加删除修改，并通过 tag 来过滤和搜索」）：
 * 本屏从「新建按钮 + Agent 列表面板 + 运行时预览链接卡 + 消歧提示 + 常驻新增表单 +
 * 分页目录」五段式，收成**一个卡片网格**——`CapabilityCatalogScreen` 现在同时把 F15
 * 目录条目与 F55 可执行定义画成两种卡片（标签「目录条目 / 可执行」区分），搜索、
 * 标签筛选、侧边面板都在那里；本文件只剩「新建 / 导入 Agent」这个弹窗入口。
 *
 * #617：「新建 Agent」打真实的 F55 `POST /agents`（`createAgent`）。
 * 人类反馈（2026-08-17）："新建/导入不能摆在主界面顶部"——一个触发按钮 + 一个弹层，
 * 弹层内用 tab 切"新建 Agent" / "从 URL 导入"。两个 tab 刻意分开渲染：它们写的是
 * 两张不同的表，混在一起会让用户以为"新建"和"导入"是同一次操作的两种叫法。
 *
 * 原「智能体运行时」的工具白名单 / 行为审计预览（`/preview/agent-runtime`）是签核用
 * 原型屏，不再占目录首页一块卡片；仍可从 `lib/navigation.ts` `ADMIN_SECOND_LEVEL`
 * 声明的路由直达。
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
  /**
   * #1915 —— 建成/发布后递增，让目录重新拉取 `listAgents`（父级 state 变化驱动 refetch，
   * 不是组件间事件耦合）。
   */
  const [agentListRefreshKey, setAgentListRefreshKey] = React.useState(0);
  return (
    <div className="p-6">
      <CapabilityCatalogScreen
        kind="agent"
        definitionsRefreshKey={agentListRefreshKey}
        headerActions={
          canMutate ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setCreating(true)}
              data-testid="agent-create-open"
            >
              <Plus aria-hidden className="h-3.5 w-3.5" /> 新建 / 导入 Agent
            </Button>
          ) : null
        }
      />
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
              <AgentDefinitionCreatePanel
                prefix="admin-agent-definition"
                onCreated={() => setAgentListRefreshKey((k) => k + 1)}
              />
            ) : null}
            {createMode === "import" ? <AgentUrlImportPanel /> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
