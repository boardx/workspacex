/**
 * `draftBookingInvite` —— 生成预约话术草稿（F99，uc-6-7 R3 步骤 5-6 / D-28）。
 *
 * ⚠ **draft 阶段零外发调用**（I-24）：本函数的依赖里没有 `OutboundGateway`,
 * 见 `booking-ports.ts` 文件头——这不是一个运行时判断,是一个类型签名里
 * 就不存在的能力。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import { draftInviteText } from "../../domain/interview/booking-draft";
import type { OrgId } from "../../domain/org-id";
import type { BookingDraftRepository, SubjectBookingContextProvider } from "./booking-ports";

export type DraftBookingInviteResult = z.infer<typeof interview.operations.draftBookingInvite.out>;

export interface DraftBookingInviteDeps {
  readonly repo: BookingDraftRepository;
  readonly subjectContext: SubjectBookingContextProvider;
}

export interface DraftBookingInviteCommand {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly subjectId: string;
  readonly slots: readonly string[];
}

export async function draftBookingInvite(
  deps: DraftBookingInviteDeps,
  cmd: DraftBookingInviteCommand,
): Promise<DraftBookingInviteResult> {
  const ctx = await deps.subjectContext.get(cmd.orgId, cmd.subjectId);
  const text = draftInviteText({
    roleTitle: ctx?.roleTitle ?? "",
    backgroundAndQuestions: ctx?.backgroundAndQuestions ?? "",
    slots: cmd.slots,
  });

  const record = await deps.repo.create({
    orgId: cmd.orgId,
    subjectId: cmd.subjectId,
    text,
    slots: cmd.slots,
    createdBy: cmd.actorId,
  });

  return { draftId: record.draftId, text: record.text, slots: [...record.slots] };
}
