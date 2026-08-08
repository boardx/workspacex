"use client";

import { useSession } from "@/components/session/session-provider";
import { CapabilityCatalogScreen } from "./capability-catalog-screen";
import { AgentDefinitionCreatePanel } from "./agent-definition-create-panel";
import type { UiState } from "@/lib/ui-state";

/**
 * #617：在 F15 能力目录（`CapabilityCatalogScreen`，目录项，粗粒度）之上补一个独立的
 * "新建 Agent" 入口，打真实的 F55 `POST /agents`（`createAgent`）——这条路径此前在
 * 全仓没有任何 controller 挂载，`grep -rln "createAgent" apps/web` 曾经零命中。
 *
 * 两块刻意分开渲染（不是合并成一个表单）：它们写的是两张不同的表，
 * 混在一起会让用户以为"新增"和"新建 Agent"是同一次操作的两种叫法。
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
      <CapabilityCatalogScreen kind="agent" />
    </div>
  );
}
