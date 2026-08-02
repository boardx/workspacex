/**
 * Ports for F99's booking-draft slice (uc-6-7 R3 步骤 5).
 *
 * ## `OutboundGateway` 是唯一能让邮件/短信离开系统的口子
 *
 * `draftBookingInvite`（应用层）的依赖里**不包含**这个接口——这不是疏漏,
 * 是这个 feature 的结构性保证本身:草稿生成这条调用链上根本不存在能触达
 * `OutboundGateway` 的路径。只有 `sendBookingInvite` 持有它,且入口第一行
 * 就判定 `actorKind`（见 `errors.ts` 的 `OutboundRequiresHumanError`）。
 */
import type { OrgId } from "../../domain/org-id";

export interface BookingDraftRecord {
  readonly draftId: string;
  readonly subjectId: string;
  readonly text: string;
  readonly slots: readonly string[];
  readonly sentAt: Date | null;
  readonly createdBy: string;
}

export interface CreateBookingDraftInput {
  readonly orgId: OrgId;
  readonly subjectId: string;
  readonly text: string;
  readonly slots: readonly string[];
  readonly createdBy: string;
}

export interface BookingDraftRepository {
  create(input: CreateBookingDraftInput): Promise<BookingDraftRecord>;
  findById(orgId: OrgId, draftId: string): Promise<BookingDraftRecord | null>;
  /** 落「已外发」事实。⚠ 只有 `sendBookingInvite` 在人类主体判定通过之后调用它。 */
  markSent(orgId: OrgId, draftId: string, sentAt: Date): Promise<BookingDraftRecord>;
}

export const BOOKING_DRAFT_REPOSITORY = Symbol("BookingDraftRepository");

/**
 * 生成草稿文案所需的对象上下文(部门角色 + 背景与要问什么)。
 *
 * ⚠ 刻意不复用 `SubjectRepository`(它返回 `Guarded<SubjectRecord>`，需要一次
 * 权限判定才能解封)——草稿生成是系统在对象已确认入表之后自动触发的动作,
 * 不是某个用户在读这一行,与 `consent-token-ports.ts` 的 `ConsentRenderParamsProvider`
 * 同一处置:系统内部读取自己需要的字段,不途经 `disclose`。
 */
export interface SubjectBookingContext {
  readonly roleTitle: string;
  readonly backgroundAndQuestions: string;
}

export interface SubjectBookingContextProvider {
  get(orgId: OrgId, subjectId: string): Promise<SubjectBookingContext | null>;
}

export const SUBJECT_BOOKING_CONTEXT_PROVIDER = Symbol("SubjectBookingContextProvider");

/** 唯一能把预约邀请真正发出去的口子（见文件头）。 */
export interface OutboundGateway {
  send(input: {
    readonly subjectId: string;
    readonly text: string;
    readonly slots: readonly string[];
  }): Promise<{ readonly sentAt: Date }>;
}

export const OUTBOUND_GATEWAY = Symbol("OutboundGateway");
