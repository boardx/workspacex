/**
 * F99 —— AI 按表预约：草稿 + 人接受后外发（uc-6-7 R3 步骤 5 / D-28，V4）。
 *
 * 断言口径逐字对齐 issue #290 / V4：
 * 「触发『按表预约』，断言系统只生成预约草稿，未发生任何外发调用；
 *   人点发送后才外发，且该动作写审计」。
 *
 * 纯应用层单测（fakes，不连 Postgres）——见 issue #74：本地对 Postgres 依赖的测试
 * 允许跳过，本文件按此原则只走内存 fakes，验证的是结构性保证本身。
 */
import { describe, expect, it } from "vitest";
import { draftBookingInvite } from "../../src/application/interview/draft-booking-invite";
import { sendBookingInvite } from "../../src/application/interview/send-booking-invite";
import { OutboundRequiresHumanError } from "../../src/application/interview/errors";
import type {
  BookingDraftRecord,
  BookingDraftRepository,
  CreateBookingDraftInput,
  OutboundGateway,
  SubjectBookingContext,
  SubjectBookingContextProvider,
} from "../../src/application/interview/booking-ports";
import { FakeProvenanceWriter } from "../support/role-view-fakes";
import { toOrgId, type OrgId } from "../../src/domain/org-id";

process.env.KERNEL_QUIET = "1";

const ORG = toOrgId("org-f99-booking");
const SUBJECT = "subj-f99-1";
const ACTOR = "u-f99-facilitator";

class FakeBookingDraftRepository implements BookingDraftRepository {
  readonly rows = new Map<string, BookingDraftRecord>();
  private n = 0;

  async create(input: CreateBookingDraftInput): Promise<BookingDraftRecord> {
    this.n += 1;
    const record: BookingDraftRecord = {
      draftId: `draft-${this.n}`,
      subjectId: input.subjectId,
      text: input.text,
      slots: input.slots,
      sentAt: null,
      createdBy: input.createdBy,
    };
    this.rows.set(record.draftId, record);
    return record;
  }

  async findById(_orgId: OrgId, draftId: string): Promise<BookingDraftRecord | null> {
    return this.rows.get(draftId) ?? null;
  }

  async markSent(_orgId: OrgId, draftId: string, sentAt: Date): Promise<BookingDraftRecord> {
    const existing = this.rows.get(draftId);
    if (!existing) throw new Error("draft not found");
    const updated = { ...existing, sentAt };
    this.rows.set(draftId, updated);
    return updated;
  }
}

/** Records every call so the test can assert it was NEVER invoked during drafting. */
class FakeOutboundGateway implements OutboundGateway {
  readonly calls: Array<{ subjectId: string; text: string; slots: readonly string[] }> = [];

  async send(input: { subjectId: string; text: string; slots: readonly string[] }): Promise<{ sentAt: Date }> {
    this.calls.push(input);
    return { sentAt: new Date("2026-08-02T00:00:00.000Z") };
  }
}

class FakeSubjectBookingContextProvider implements SubjectBookingContextProvider {
  constructor(private readonly ctx: SubjectBookingContext | null) {}
  async get(): Promise<SubjectBookingContext | null> {
    return this.ctx;
  }
}

function setup() {
  const repo = new FakeBookingDraftRepository();
  const outbound = new FakeOutboundGateway();
  const audit = new FakeProvenanceWriter();
  const subjectContext = new FakeSubjectBookingContextProvider({
    roleTitle: "采购总监",
    backgroundAndQuestions: "想了解储能投资决策链路",
  });
  return { repo, outbound, audit, subjectContext };
}

describe("F99 — AI 按表预约：draft 阶段零外发", () => {
  it("draftBookingInvite 只生成草稿文本，不触碰任何外发通道", async () => {
    const { repo, subjectContext } = setup();

    const result = await draftBookingInvite(
      { repo, subjectContext },
      { orgId: ORG, actorId: ACTOR, subjectId: SUBJECT, slots: ["2026-08-05 10:00", "2026-08-05 14:00"] },
    );

    expect(result.draftId).toBeTruthy();
    expect(result.text).toContain("草稿");
    expect(result.text).toContain("采购总监");
    expect(result.slots).toEqual(["2026-08-05 10:00", "2026-08-05 14:00"]);

    // 结构性保证：draftBookingInvite 的依赖类型里根本不存在 OutboundGateway ——
    // 这里额外用仓储状态断言草稿确实是「未发送」态,双重确认。
    const stored = await repo.findById(ORG, result.draftId);
    expect(stored?.sentAt).toBeNull();
  });

  it("agent 主体直接调用 sendBookingInvite 一律被拒，且未发生任何外发调用", async () => {
    const { repo, outbound, audit, subjectContext } = setup();
    const draft = await draftBookingInvite(
      { repo, subjectContext },
      { orgId: ORG, actorId: ACTOR, subjectId: SUBJECT, slots: ["2026-08-05 10:00"] },
    );

    await expect(
      sendBookingInvite(
        { repo, outbound, audit },
        { orgId: ORG, actorId: "agent-echo", actorKind: "agent", draftId: draft.draftId },
      ),
    ).rejects.toThrow(OutboundRequiresHumanError);

    expect(outbound.calls).toHaveLength(0);
    expect(audit.appended).toHaveLength(0);
    const stored = await repo.findById(ORG, draft.draftId);
    expect(stored?.sentAt).toBeNull();
  });

  it("人类主体点击发送后才外发，恰好一次外发调用，且写审计", async () => {
    const { repo, outbound, audit, subjectContext } = setup();
    const draft = await draftBookingInvite(
      { repo, subjectContext },
      { orgId: ORG, actorId: ACTOR, subjectId: SUBJECT, slots: ["2026-08-05 10:00"] },
    );

    expect(outbound.calls).toHaveLength(0); // draft 阶段仍是零外发

    const sent = await sendBookingInvite(
      { repo, outbound, audit },
      { orgId: ORG, actorId: ACTOR, actorKind: "human", draftId: draft.draftId },
    );

    expect(outbound.calls).toHaveLength(1);
    expect(outbound.calls[0]?.subjectId).toBe(SUBJECT);
    expect(sent.auditEventId).toBeTruthy();
    expect(audit.appended).toHaveLength(1);
    expect(audit.appended[0]?.actorId).toBe(ACTOR);

    const stored = await repo.findById(ORG, draft.draftId);
    expect(stored?.sentAt).not.toBeNull();
  });
});
