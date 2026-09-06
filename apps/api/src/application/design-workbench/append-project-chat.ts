/**
 * `appendProjectChat`（UC-17.8 B4.3 → B5.2）—— 详情页左侧「设计协作」面板发送。仅 owner。
 *
 * ## B5.2：模型回复 + 写回 `problem/criteria/frames`；B5.3：+ `prototype`（整页重生成）
 *
 * `writeback.prototype` 是 `{frame, root}[]`——服务端拆成 `frames`（标签）+ `prototype`（树）
 * **同一次** `projects.update`，`applied` 同时列出 `frames` 与 `prototype`（两者都真的变了）。
 * `prototype` 与 `frames` 同时给出时以 `prototype` 为准（它自带标签），契约头注逐字。
 *
 * ## 迭代 1：`writeback.patch`（局部修改）
 *
 * 按节点 id 顺序应用到当前 `prototype`（`applyPrototypePatch`，纯函数）；任一条失败 ⇒ 整批不生效、
 * 记日志、`applied` 不含 `prototype`（字段级拒绝，同 I-10）。还没生成过原型时 patch 无处可打，同样拒。
 * 落库前 `ensurePrototypeIds`：整页写回里模型没写 id 的节点补上，模型下一轮看到的每个节点都可寻址。
 *
 *   ① owner 校验（非 owner 不调模型、不写任何东西——契约头注逐字）。
 *   ② `deps.ai.reply`（`DesignChatModel`，唯一实现 `ModelDesignChatReplier`）按**本项目**五个字段
 *      + 本项目完整 `chat`（含这次用户消息）生成回复与可选写回；模型失败时端口自己退回
 *      `DESIGN_WORKBENCH_CHAT_REPLY` 并标 `source: "fallback"`，本用例不区分。
 *   ③ 写回非空 ⇒ `projects.update`（与 `updateProject` 同一条 owner 谓词）；`applied` 只列真的写了的。
 *   ④ `projects.appendChat` 原子追加 `[user, ai(source)]` 两条，返回写回后的完整行。
 *
 * ## 事务边界（诚实版，同 `submit-feedback-draft.ts` 的写法）
 *
 * ③ 与 ④ 是两次独立的仓储调用。顺序选「先写回、后追加」：④ 失败 ⇒ 字段已更新、这轮对话没落
 * 库，用户看到 503 重发一次即可（重发时模型看到的是已更新的字段，不会重复写回同一改动）；
 * 反过来「先追加、后写回」失败 ⇒ 对话里已经写着「已更新验收标准」而字段没变——那是对用户撒谎。
 * ⚠ 首次引导语**不**在这里插入——展示层文案，见契约【待确认点 2】。
 */
import type { z } from "zod";
import { designPrototype, type designAiCollab } from "@repo/contracts";
import type { DesignChatModel } from "./design-chat-model";
import type { DesignProjectPatch } from "./project-ports";
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  projectDesignProject,
  type DesignProjectDeps,
  type DesignProjectView,
} from "./project-shared";
import { ownerNamesFor } from "./project-shared";

type DesignChatReply = z.infer<typeof designAiCollab.DesignChatReply>;
type DesignWritebackField = z.infer<typeof designAiCollab.DesignWritebackField>;

export interface AppendProjectChatDeps extends DesignProjectDeps {
  readonly ai: DesignChatModel;
}

/** 迭代 2：把前端传来的 `focusNodeId` 解析成给模型看的焦点描述；找不到（已被删）⇒ 当没选。 */
function focusFor(row: { readonly frames: readonly string[]; readonly prototype: readonly designPrototype.PrototypeNode[] }, id: string | undefined) {
  if (id === undefined) return {};
  const hit = designPrototype.findPrototypeNodePath(row.prototype, id);
  if (hit === null) return {};
  const node = hit.path[hit.path.length - 1]!;
  return { focus: { id, frame: row.frames[hit.frameIndex] ?? "", path: hit.path.map(designPrototype.prototypeNodeLabel), node } };
}

export async function appendProjectChat(
  deps: AppendProjectChatDeps,
  input: { readonly projectId: string; readonly ownerId: string; readonly text: string; readonly focusNodeId?: string },
): Promise<{ readonly project: DesignProjectView; readonly reply: DesignChatReply }> {
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();

  const ai = await deps.ai.reply({
    name: current.name,
    template: current.template,
    problem: current.problem,
    criteria: current.criteria,
    frames: current.frames,
    prototype: current.prototype,
    ...focusFor(current, input.focusNodeId),
    chat: [...current.chat, { role: "user", text: input.text, at: new Date().toISOString() }],
  });

  const screens = ai.writeback.prototype;
  let patched: readonly designPrototype.PrototypeNode[] | undefined;
  if (screens === undefined && ai.writeback.patch !== undefined) {
    if (current.prototype.length === 0) {
      deps.logger?.info("design chat: patch rejected, project has no prototype yet", { projectId: input.projectId, traceId: deps.traceId ?? "" });
    } else {
      try {
        patched = designPrototype.applyPrototypePatch(current.prototype, ai.writeback.patch);
      } catch (e) {
        deps.logger?.info("design chat: patch rejected", { projectId: input.projectId, traceId: deps.traceId ?? "", detail: e instanceof Error ? e.message : "unknown" });
      }
    }
  }
  const patch: DesignProjectPatch = {
    ...(ai.writeback.problem !== undefined ? { problem: ai.writeback.problem } : {}),
    ...(ai.writeback.criteria !== undefined ? { criteria: ai.writeback.criteria } : {}),
    ...(screens !== undefined
      ? { frames: screens.map((s) => s.frame), prototype: designPrototype.ensurePrototypeIds(screens.map((s) => s.root)) }
      : patched !== undefined ? { prototype: patched }
      : ai.writeback.frames !== undefined ? { frames: ai.writeback.frames } : {}),
  };
  const applied = Object.keys(patch) as DesignWritebackField[];
  if (applied.length > 0) {
    const written = await deps.projects.update(input.projectId, input.ownerId, patch);
    if (written === null) throw new DesignProjectNotOwnerError();
    // 迭代 3：原型真的变了（整页 / patch）⇒ 追加一条版本快照。只改标签（树被清空）不记——那不是一版原型。
    if (patch.prototype !== undefined) {
      await deps.projects.recordVersion(input.projectId, input.ownerId, {
        source: "model",
        summary: ai.text.replace(/\s+/g, " ").trim().slice(0, 120),
        frames: written.frames,
        prototype: written.prototype,
      });
    }
  }

  const updated = await deps.projects.appendChat(input.projectId, input.ownerId, [
    { role: "user", text: input.text },
    { role: "ai", text: ai.text, source: ai.source },
  ]);
  if (updated === null) throw new DesignProjectNotOwnerError();

  const names = await ownerNamesFor(deps, [updated.ownerId]);
  return {
    project: projectDesignProject(updated, names.get(updated.ownerId) ?? null),
    reply: { source: ai.source, applied },
  };
}
