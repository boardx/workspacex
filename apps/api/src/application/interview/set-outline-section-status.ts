/**
 * `setOutlineSectionStatus` —— 提纲逐段人工[标完成]/[延后]（F90，uc-6-4 R3，AC2）。
 *
 * ## 服务端拒绝 origin: ai 的完成态写入——判据不是请求体里的自称
 *
 * 契约 `setOutlineSectionStatus.in` 里根本没有 `origin`/`writerOrigin` 字段——不是疏漏，
 * 是故意的：一个愿意写代码的客户端可以在请求体里填任何它想要的值，所以「谁在写」不能
 * 由请求体决定。判据是 `viewerActorKind`，一个只能由**调用方**（HTTP 层身份中间件，
 * 或记录 agent Echo 的服务端适配层）设置的字段，与 `reveal-contact.ts` 的
 * `viewerActorKind` 同一立场：agent 主体恒 `"agent"`，不接受它自称 `"human"`。
 *
 * ## 与 `updateOutlineSection`（F85）的分工
 *
 * 那个用例改段落**内容**（`objective`/`openers`/`minutes`），手改后会把大纲打回
 * `pending_confirm`（内容变了，需要重新确认）。这里只改**完成态**标记
 * （`done`/`deferred`），不是内容编辑，不触发那条副作用——见 `outline-ports.ts`
 * `markSectionStatus` 的头注。
 *
 * ## AI 只能提示，不能写
 *
 * issue 原文「AI 只能提示『这一段可能已覆盖』但不得自动置为完成」——AI 侧的提示是
 * 一个纯展示态（前端渲染,不经过这个用例的任何写路径）；本用例是唯一的写入口，
 * 且这个写入口对 `viewerActorKind === "agent"` 恒拒绝。没有第二个写路径能绕开它，
 * 因为 `OutlineRepository.markSectionStatus` 除了这个用例没有别的调用方。
 */
import type { OrgId } from "../../domain/org-id";
import { AiWriteForbiddenError, OutlineSectionConcurrentModificationError } from "./errors";
import type { OutlineRepository } from "./outline-ports";

export type OutlineSectionStatusValue = "done" | "deferred";

export interface SetOutlineSectionStatusDeps {
  readonly outlines: OutlineRepository;
}

export interface SetOutlineSectionStatusCommand {
  readonly orgId: OrgId;
  readonly outlineId: string;
  readonly sectionId: string;
  readonly status: OutlineSectionStatusValue;
  /**
   * ⚠ 由调用方（HTTP 层身份中间件 / 记录 agent 适配层）判定，不接受请求体自称。
   * 见文件头「服务端拒绝 origin: ai 的完成态写入」一节。
   */
  readonly viewerActorKind: "human" | "agent";
}

export interface SetOutlineSectionStatusResult {
  readonly outlineId: string;
  readonly sectionId: string;
  readonly status: OutlineSectionStatusValue;
  /** 契约里这个字段恒为字面量 `"human"`——走到这里说明门禁已经通过。 */
  readonly writerOrigin: "human";
}

export async function setOutlineSectionStatus(
  deps: SetOutlineSectionStatusDeps,
  cmd: SetOutlineSectionStatusCommand,
): Promise<SetOutlineSectionStatusResult> {
  // 门禁在任何存在性查询之前——一个 agent 主体不该能靠「这段存不存在」的两种
  // 不同拒绝，反推出这份提纲长什么样（与 `advance-agenda-segment.ts` 权限先于
  // 存在性判断同一条纪律）。
  if (cmd.viewerActorKind === "agent") {
    throw new AiWriteForbiddenError(cmd.sectionId);
  }

  const current = await deps.outlines.getById(cmd.orgId, cmd.outlineId);
  if (current === null) {
    throw new OutlineSectionConcurrentModificationError(cmd.outlineId, cmd.sectionId);
  }
  const exists = current.sections.some((s) => s.sectionId === cmd.sectionId);
  if (!exists) {
    throw new OutlineSectionConcurrentModificationError(cmd.outlineId, cmd.sectionId);
  }

  const updated = await deps.outlines.markSectionStatus(cmd.orgId, cmd.outlineId, cmd.sectionId, cmd.status);
  const section = updated.sections.find((s) => s.sectionId === cmd.sectionId);

  return {
    outlineId: updated.outlineId,
    sectionId: cmd.sectionId,
    // section 一定存在：刚写完，且 markSectionStatus 不会移除任何段落；status 一路只是兜底。
    status: (section?.status ?? cmd.status) as OutlineSectionStatusValue,
    writerOrigin: "human",
  };
}
