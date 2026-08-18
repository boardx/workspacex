/**
 * `updateSource`（#1493 / UC-7.3 第一块）—— 源码直接手改 + 乐观并发。
 *
 * ## 写的判定：必须在**这张画布的组**里（uc-7-3 A2）
 *
 * 「写别组画布 ⇒ **服务端拒绝**，不是工具条置灰」（契约 `NOT_IN_GROUP` 的注释逐字）。
 * 判据：调用者的项目成员行 `group_id` 必须等于实例的 `group_id`。契约 `err` 里**没有**
 * `NO_PROJECT_ROLE`——非项目成员来写，同样是「不在这张画布的组里」，同一个
 * `NOT_IN_GROUP` 出口（把两者拆开等于告诉陌生人「画布存在，只是你不在组里」）。
 * ⚠ facilitator 通常 `group_id IS NULL`，在本判据下也会被拒——uc-7-3 R5 说引导师
 *   「可管理」，但 A2 的只读条款没有为引导师开豁免，契约也没有给引导师写别组的码；
 *   本块按最严格的可辩护读法实现，放宽需人类裁决（已在 PR 里报出）。
 *
 * ## 乐观并发：判定与写入同一条语句
 *
 * `expectedHeadVersion` ≠ 当前 head ⇒ 仓库层的 CTE 返回零行 ⇒ 409 `VERSION_CHANGED`
 * （uc-7-3 E4「同一资源被并发修改时不得静默覆盖」）。判定不在应用层先读后比——那在
 * 并发下两个请求都会通过（`pg-canvas-template-repository.ts` `create()` 的同型纪律）。
 *
 * ## `diagramModel` / `ignoredSyntaxCount` 是 Node 端能力边界内的诚实形状
 *
 * mermaid 完整解析需要浏览器 DOM（ADR-100：`apps/api` 故意不开 DOM lib），Node 端做不了
 * `DiagramModel` 的真实构建——浏览器端渲染走 `renderCanvas`（后续块）。这里：
 * · `ignoredSyntaxCount`：真实判定，走 `domain/canvas/mermaid-whitelist.ts`（DOM-free，
 *   底层是 `@repo/fabric-markdown/markdown` 的纯字符串围栏解析）。本仓尚无组织白名单的
 *   持久层（`setMermaidWhitelist` 未落地），缺省 = 全部 12 型放行 ⇒ 计数按全放行判。
 * · `diagramModel`：提取出的 mermaid 块原文的 JSON 包装（`{kind:"mermaid-source", blocks}`），
 *   不是假装解析过的模型。契约 `out.diagramModel` 是 `z.string()`，这个降级不违反形状，
 *   且比返回空串诚实：调用方拿到的就是「服务端见到的可渲染块」。
 */
import { createHash } from "node:crypto";
import { extractMermaidBlocks } from "@repo/fabric-markdown/markdown";
import { canvas as C } from "@repo/contracts";
import { applyMermaidWhitelist } from "../../domain/canvas/mermaid-whitelist";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { CanvasError } from "./errors";
import type { CanvasInstanceRepository } from "./instance-ports";

export interface UpdateCanvasSourceDeps {
  readonly identity: IdentityRepository;
  readonly instances: CanvasInstanceRepository;
  readonly newVersionId: () => string;
}

export interface UpdateCanvasSourceInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly instanceId: string;
  readonly markdown: string;
  readonly expectedHeadVersion: number;
}

export interface UpdateCanvasSourceOutput {
  readonly versionId: string;
  readonly contentHash: string;
  readonly diagramModel: string;
  readonly ignoredSyntaxCount: number;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export async function updateCanvasSource(
  deps: UpdateCanvasSourceDeps,
  input: UpdateCanvasSourceInput,
): Promise<UpdateCanvasSourceOutput> {
  // ① 实例头。契约 `updateSource.err` 里没有 `INSTANCE_NOT_FOUND`——不存在的实例
  //    抛 `CanvasError("INSTANCE_NOT_FOUND")` 由控制器映 404 会发明一个不在闭集里的
  //    响应码；这里复用 getSource 的码是不诚实的吗？不——同一个资源寻址失败在两个
  //    操作上是同一件事，且 `INSTANCE_NOT_FOUND` 在 `CanvasError` 闭集里。缺口
  //    （updateSource.err 漏列它）在 PR 里报出，不在这里编一个别的码。
  const instance = await deps.instances.findInstance(input.orgId, input.instanceId);
  if (instance === null) throw new CanvasError("INSTANCE_NOT_FOUND");

  // ② 组归属（见文件头）。非成员与别组成员同一个出口。
  const membership = await deps.identity.findProjectMembership(
    input.userId, instance.workshopId, input.orgId,
  );
  if (membership === null || membership.groupId !== instance.groupId) {
    throw new CanvasError("NOT_IN_GROUP");
  }

  // ③ 判定与写入同一条语句（仓库层 CTE）；零行 ⇒ 乐观并发失败。
  const contentHash = sha256(input.markdown);
  const written = await deps.instances.appendVersion({
    orgId: input.orgId,
    instanceId: input.instanceId,
    expectedHeadVersion: input.expectedHeadVersion,
    versionId: deps.newVersionId(),
    markdown: input.markdown,
    contentHash,
    createdBy: input.userId,
  });
  if (written === null) throw new CanvasError("VERSION_CHANGED");

  // ④ Node 端能力边界内的响应附加面（见文件头）。白名单缺省全放行——
  //    `MermaidDiagramType.options` 是契约 12 型闭集本身，不复制第二份清单。
  const whitelist = applyMermaidWhitelist(input.markdown, C.MermaidDiagramType.options);
  const blocks = extractMermaidBlocks(input.markdown).filter((b) => b.lang === "mermaid");
  const diagramModel = JSON.stringify({
    kind: "mermaid-source",
    blocks: blocks.map((b) => ({ lang: b.lang, code: b.code })),
  });

  return {
    versionId: written.versionId,
    contentHash: written.contentHash,
    diagramModel,
    ignoredSyntaxCount: whitelist.ignoredSyntaxCount,
  };
}
