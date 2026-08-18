/**
 * `instantiateForSegment`（#1493 / UC-7.3 第一块）—— 现场切议程环节，为每个分组各出一张画布。
 *
 * ## 语义整段来自 domain，本文件不发明
 *
 * `domain/canvas/segment-binding.ts` 的 `instantiateForSegment` 自 F102 起钉死了两条：
 * **幂等重放**（同 `idempotencyKey` 返回同一批，不产生第二批）与**反向断言**（新建实例
 * 只读绑定冻结的 `boundTemplateVersion`，从不看模板注册表「现在」的版本/状态——归档模板
 * 的存量绑定照常实例化，O-10 ②）。本文件对每条绑定调用那个纯函数，一条判定都不复述。
 *
 * ## 鉴权：复用 `agendaSegment.advance`，不新增矩阵行
 *
 * 契约 `err` 只有 `ROLE_INSUFFICIENT`。「现场切议程环节」正是 `advanceAgendaSegment`
 * 描述的那个时刻——实例化是切环节的画布侧动作，判「谁能做」用的是同一条既有矩阵行
 * `agendaSegment.advance`（facilitator only），而不是发明 `agendaSegment.instantiate`：
 * uc-7-3 的 R5 没有为实例化单列权限行，没有行可转录时延伸最近的既有惯例
 * （`project-role-matrix.ts` `agendaSegment.create` 那条注释的同型判断，不是裁决）。
 *
 * ## 初始源码
 *
 * 从模板 sections 生成初始 markdown：`# <模板显示名>` + 每个分区一个 `## <分区名>` 空段落
 * ——这是 fabric-markdown 的 canvas 围栏模板与 `## 段落` 导出约定的既有形状（契约
 * `exportSource` 的「几何归区到 `##` 段落」、模板管理台「分区（导出为 ## 段落）」文案）。
 *
 * ## 环节没有绑定模板时返回空数组
 *
 * 契约 `err` 里没有「环节未绑定模板」的码，而空数组是诚实的：这个环节实例化出零张画布。
 * 编一个最像的码（如 `TEMPLATE_NOT_FOUND`）会让前端按契约里含义不同的码分支。
 */
import { createHash } from "node:crypto";
import {
  instantiateForSegment as domainInstantiate,
  type GroupInstance,
} from "../../domain/canvas/segment-binding";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { CanvasError } from "./errors";
import { CanvasSegmentNotFoundError } from "./segment-binding-errors";
import type { CanvasInstanceRepository, CanvasInstanceRow } from "./instance-ports";
import type { CanvasTemplateRepository } from "./template-ports";

/** 引用矩阵里实际存在的字面量（见文件头「不新增矩阵行」）。 */
export const INSTANTIATE_FOR_SEGMENT_ACTION = "agendaSegment.advance" as const;

export interface InstantiateForSegmentDeps {
  readonly auth: AuthorizeDeps;
  readonly templates: CanvasTemplateRepository;
  readonly instances: CanvasInstanceRepository;
  readonly newId: (prefix: string) => string;
}

export interface InstantiateForSegmentInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly agendaSegmentId: string;
  readonly groupIds: readonly string[];
  readonly idempotencyKey: string;
}

export interface InstantiateForSegmentOutput {
  readonly instances: readonly CanvasInstanceRow[];
}

/** 初始 markdown 的唯一产地（测试直接引用它对账，不复制第二份模板字符串）。 */
export function initialMarkdownFor(
  displayName: string,
  sections: ReadonlyArray<{ readonly name: string; readonly order: number }>,
): string {
  const ordered = [...sections].sort((a, b) => a.order - b.order);
  return [`# ${displayName}`, ...ordered.map((s) => `## ${s.name}`)].join("\n\n") + "\n";
}

export async function instantiateCanvasesForSegment(
  deps: InstantiateForSegmentDeps,
  input: InstantiateForSegmentInput,
): Promise<InstantiateForSegmentOutput> {
  // ① 环节在哪个工作坊——同 `bind-template-to-segment.ts` ①：先解析环节再鉴权，
  //    项目角色挂在工作坊上；RLS 保证这个 404 不泄露跨组织存在性。
  const workshopId = await deps.templates.findSegmentWorkshopId(input.orgId, input.agendaSegmentId);
  if (workshopId === null) throw new CanvasSegmentNotFoundError(input.agendaSegmentId);

  // ② 引导师判定，同 `advanceAgendaSegment` 的那条矩阵行（见文件头）。
  const decision = await authorize(deps.auth, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: workshopId,
    object: { kind: "project", id: workshopId },
    action: INSTANTIATE_FOR_SEGMENT_ACTION,
  });
  if (!decision.allowed) throw new CanvasError("ROLE_INSUFFICIENT");

  // ③ 幂等重放：既有那一批直接返回。domain 的 `existingByIdempotencyKey` 语义在
  //    存储层兑现（唯一约束），这里的先读是快路径，真正的防线是 ⑤ 的 conflict 分支。
  const replayed = await deps.instances.listByIdempotencyKey(
    input.orgId, input.agendaSegmentId, input.idempotencyKey,
  );
  if (replayed.length > 0) return { instances: replayed };

  // ④ 逐条绑定 × 逐个分组，冻结语义整段来自 domain 纯函数。
  const bindings = await deps.templates.listSegmentBindings(input.orgId, input.agendaSegmentId);
  const planned: Array<GroupInstance & { initialMarkdown: string }> = [];
  for (const binding of bindings) {
    const content = await deps.instances.findTemplateContent(
      input.orgId, binding.templateKey, binding.boundTemplateVersion,
    );
    // 绑定行有 FK 指向模板行，这里查不到只能是并发删表级事故——如实炸，不静默跳过。
    if (content === null) {
      throw new Error(
        `canvas template ${binding.templateKey}@${binding.boundTemplateVersion} 不存在，但绑定 ${binding.bindingId} 指向它`,
      );
    }
    const markdown = initialMarkdownFor(content.displayName, content.sections);
    const created = domainInstantiate({
      binding,
      groupIds: input.groupIds,
      idempotencyKey: input.idempotencyKey,
      // 本层的重放快路径在 ③ 已经短路返回，走到这里 map 必为空——真正的幂等由
      // 存储层唯一约束兜底（⑤），不在内存里维护第二份「已见过的 key」事实。
      existingByIdempotencyKey: new Map(),
      makeInstanceId: () => deps.newId("cvinst"),
    });
    for (const inst of created) planned.push({ ...inst, initialMarkdown: markdown });
  }
  if (planned.length === 0) return { instances: [] };

  // ⑤ 一个事务写入；并发重试撞唯一约束 ⇒ 回读既有那一批（契约的「同一批 instanceId」）。
  const outcome = await deps.instances.createInstances({
    orgId: input.orgId,
    agendaSegmentId: input.agendaSegmentId,
    workshopId,
    idempotencyKey: input.idempotencyKey,
    createdBy: input.userId,
    instances: planned.map((p) => ({
      instanceId: p.instanceId,
      groupId: p.groupId,
      templateKey: p.templateKey,
      templateVersion: p.templateVersion,
      initialVersionId: deps.newId("cvver"),
      initialMarkdown: p.initialMarkdown,
      contentHash: createHash("sha256").update(p.initialMarkdown, "utf8").digest("hex"),
    })),
  });
  if (outcome === "conflict") {
    const existing = await deps.instances.listByIdempotencyKey(
      input.orgId, input.agendaSegmentId, input.idempotencyKey,
    );
    return { instances: existing };
  }
  return {
    instances: await deps.instances.listByIdempotencyKey(
      input.orgId, input.agendaSegmentId, input.idempotencyKey,
    ),
  };
}
