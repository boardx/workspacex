/**
 * `sendBookingInvite` —— 外发（F99，uc-6-7 R3 步骤 5 / D-28）。
 *
 * ⚠ **只能由人类主体触发**：`actorKind` 不是来自契约 wire 类型（`sendBookingInvite.in`
 * 只有 `draftId`）,而是调用方（HTTP 层/未来的 agent 运行时）在命令里附带的执行上下文——
 * 与 `record-tool-call.ts` 头部同一处置:全仓目前没有 agent 执行引擎,`actorKind` 是
 * 这条判定在有真正的 agent 运行时之前唯一可以钉住的位置。agent 试图直接调用
 * 一律在读到 `actorKind` 的第一行就拒绝,在任何仓储/外发调用发生之前。
 *
 * 🔴 **已知契约缺口**：`provenance.ProvenanceEventType` 枚举里没有「预约外发」专用的
 * 成员,`ProvenanceTargetKind` 也没有 `subject`。与 F109/F117 撞到的同一类缺口
 * 同一处置——复用最不失真的既有值（`human-edited` / `interview`），如实标注,
 * 而不是绕开审计要求。见 PR 说明，需要 ADR-101 同批追认。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import { canSendBookingInvite, type BookingActorKind } from "../../domain/interview/booking-draft";
import type { OrgId } from "../../domain/org-id";
import type { ProvenanceWriter } from "../provenance/ports";
import { BookingDraftNotFoundError, OutboundRequiresHumanError } from "./errors";
import type { BookingDraftRepository, OutboundGateway } from "./booking-ports";

export type SendBookingInviteResult = z.infer<typeof interview.operations.sendBookingInvite.out>;

export interface SendBookingInviteDeps {
  readonly repo: BookingDraftRepository;
  readonly outbound: OutboundGateway;
  readonly audit: ProvenanceWriter;
  readonly now?: () => Date;
}

export interface SendBookingInviteCommand {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly actorKind: BookingActorKind;
  readonly draftId: string;
}

export async function sendBookingInvite(
  deps: SendBookingInviteDeps,
  cmd: SendBookingInviteCommand,
): Promise<SendBookingInviteResult> {
  // 第一行就判定，任何仓储/外发调用之前——见文件头。
  if (!canSendBookingInvite(cmd.actorKind)) {
    throw new OutboundRequiresHumanError(cmd.draftId);
  }

  const draft = await deps.repo.findById(cmd.orgId, cmd.draftId);
  if (draft === null) {
    throw new BookingDraftNotFoundError(cmd.draftId);
  }

  const sent = await deps.outbound.send({
    subjectId: draft.subjectId,
    text: draft.text,
    slots: draft.slots,
  });

  await deps.repo.markSent(cmd.orgId, cmd.draftId, sent.sentAt);

  const auditEventId = await deps.audit.append({
    orgId: cmd.orgId,
    // 见文件头「已知契约缺口」——复用既有类型,不是本次新造语义。
    type: "human-edited",
    actorId: cmd.actorId,
    target: { kind: "interview", id: draft.subjectId },
    detail: { op: "booking-invite-sent", draftId: cmd.draftId, subjectId: draft.subjectId },
  });

  return { sentAt: sent.sentAt.toISOString(), auditEventId };
}
