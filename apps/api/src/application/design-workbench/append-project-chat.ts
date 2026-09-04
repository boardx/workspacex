/**
 * `appendProjectChat`（UC-17.8 B4.3）—— 详情页左侧「设计协作」面板发送。仅 owner。
 *
 * ⚠ D7：固定回执，不接真模型（同 `feedback-loop` 草稿"继续完善"的纪律）。服务端在同一次
 *   调用里追加两条：`{role:"user", text}` 与 `{role:"ai", text: DESIGN_WORKBENCH_CHAT_REPLY}`
 *   ——契约 `appendProjectChat` 头注逐字。
 * ⚠ 首次引导语**不**在这里插入——展示层文案，见契约【待确认点 2】。
 */
import { designWorkbench } from "@repo/contracts";
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  projectDesignProject,
  type DesignProjectDeps,
  type DesignProjectView,
} from "./project-shared";
import { ownerNamesFor } from "./project-shared";

export async function appendProjectChat(
  deps: DesignProjectDeps,
  input: { readonly projectId: string; readonly ownerId: string; readonly text: string },
): Promise<{ readonly project: DesignProjectView }> {
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();

  const updated = await deps.projects.appendChat(input.projectId, input.ownerId, [
    { role: "user", text: input.text },
    { role: "ai", text: designWorkbench.DESIGN_WORKBENCH_CHAT_REPLY },
  ]);
  if (updated === null) throw new DesignProjectNotOwnerError();

  const names = await ownerNamesFor(deps, [updated.ownerId]);
  return { project: projectDesignProject(updated, names.get(updated.ownerId) ?? null) };
}
