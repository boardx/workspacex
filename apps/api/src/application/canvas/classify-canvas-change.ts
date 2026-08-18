/**
 * `classifyChange`（#1493 / UC-7.3 第三块）—— 判定表的路由暴露，**一条判定不复述**。
 *
 * 判定表的唯一实现在 `domain/canvas/change-classification.ts`（I-15 全函数，七行
 * 覆盖全部改动类型；O-32：跨区移动归便签级）。本用例只做两件事：确认实例存在
 * （契约 err 唯一的码 `INSTANCE_NOT_FOUND`），然后把 domain 的结果原样吐回。
 *
 * ## 鉴权为什么只有「实例可见」
 *
 * 契约 `classifyChange.err` 闭集**只有** `INSTANCE_NOT_FOUND`——没有 NO_PROJECT_ROLE /
 * NOT_IN_GROUP。归类是纯判定、零内容披露（响应里只有一个枚举值，改动本身是调用方
 * 自己发来的），契约据此不设权限出口。RLS 下别组织的实例 `findInstance` 返回 null
 * ⇒ 同一个 404——「不存在」与「不是你的组织」不可区分（契约文件头的通则）。
 */
import { classifyChange as classifyChangeTable } from "../../domain/canvas/change-classification";
import type { OrgId } from "../../domain/org-id";
import { CanvasError } from "./errors";
import type { CanvasInstanceRepository } from "./instance-ports";

export interface ClassifyCanvasChangeDeps {
  readonly instances: CanvasInstanceRepository;
}

export interface ClassifyCanvasChangeInput {
  readonly orgId: OrgId;
  readonly instanceId: string;
  readonly changeKind: string;
}

export interface ClassifyCanvasChangeOutput {
  readonly classification: "sticky-level" | "structural";
}

export async function classifyCanvasChange(
  deps: ClassifyCanvasChangeDeps,
  input: ClassifyCanvasChangeInput,
): Promise<ClassifyCanvasChangeOutput> {
  const instance = await deps.instances.findInstance(input.orgId, input.instanceId);
  const result = classifyChangeTable({
    instanceExists: instance !== null,
    kind: input.changeKind,
  });
  if (!result.ok) throw new CanvasError(result.reason);
  return { classification: result.classification };
}
