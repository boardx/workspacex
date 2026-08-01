/**
 * F83：从若干已办访谈反向抽取模板草案 —— 经确认后才入库，来源可追溯（uc-6-1 A3 / R3 步骤5 / V3）。
 *
 * 纯单元测试（in-memory fakes，不碰 Postgres，per issue #74）。算法本身是确定性合并
 * （见 `domain/interview/template-draft.ts` 文件头对判断取舍的说明），这里验证的是
 * 契约行为：草案确认前不入库、确认后来源可追溯、O-05 过滤、越权访问被拒（复用 F80 的
 * `InterviewScopeRepository` 可见性门，不是新开一条）、草案确认不可重放。
 */
import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import { toOrgId } from "../../src/domain/org-id";
import { extractTemplateDraft } from "../../src/application/interview/extract-template-draft";
import { confirmTemplateDraft } from "../../src/application/interview/confirm-template-draft";
import { listTemplates } from "../../src/application/interview/list-templates";
import { getTemplate } from "../../src/application/interview/get-template";
import { NoInterviewAccessError, TemplateDraftNotConfirmedError } from "../../src/application/interview/errors";
import {
  FakeInterviewScopeRepository,
  FakeSourceInterviewReader,
  FakeTemplateDraftStore,
  FakeTemplateRepository,
  SeqDecisionIds,
} from "../support/template-draft-fakes";
import { SequentialIdFactory } from "../support/artifact-fakes";

const ORG = toOrgId("org-f83-extract");
const RESEARCHER = "researcher-1";

function harness() {
  const repo = new FakeTemplateRepository();
  const store = new FakeTemplateDraftStore();
  const reader = new FakeSourceInterviewReader();
  const scopeRepo = new FakeInterviewScopeRepository();
  const decisions = new SeqDecisionIds();
  const ids = new SequentialIdFactory();
  return { repo, store, reader, scopeRepo, decisions, ids };
}

/** Seed both halves of a usable source interview: visible to the researcher, and its
 *  extraction material (see `extractTemplateDraft`'s two-step read: scope gate, then reader). */
function seedSourceInterview(
  h: ReturnType<typeof harness>,
  input: {
    readonly interviewId: string;
    readonly aiAnalysisAllowed?: boolean;
    readonly sections?: readonly { name: string; minutes: number; order: number }[];
    readonly dataFields?: readonly { fieldId: string; name: string; kind: string; required: boolean }[];
  },
): void {
  h.scopeRepo.seedVisible(input.interviewId, RESEARCHER);
  h.reader.seed(input);
}

describe("extractTemplateDraft —— 从 3 场访谈抽取草案", () => {
  it("V3：抽取结果是草案，确认前不进模板库列表/详情", async () => {
    const h = harness();
    seedSourceInterview(h, {
      interviewId: "itv-1",
      sections: [{ name: "破冰", minutes: 5, order: 0 }],
      dataFields: [{ fieldId: "f1", name: "痛点", kind: "text", required: true }],
    });
    seedSourceInterview(h, {
      interviewId: "itv-2",
      sections: [{ name: "破冰", minutes: 5, order: 0 }, { name: "深入", minutes: 20, order: 1 }],
      dataFields: [{ fieldId: "f1", name: "痛点", kind: "text", required: true }],
    });
    seedSourceInterview(h, {
      interviewId: "itv-3",
      sections: [{ name: "收尾", minutes: 5, order: 2 }],
      dataFields: [{ fieldId: "f2", name: "满意度", kind: "scale", required: false }],
    });

    const draft = await extractTemplateDraft(h, {
      orgId: ORG,
      actorId: RESEARCHER,
      sourceInterviewIds: ["itv-1", "itv-2", "itv-3"],
    });

    // 来自 3 场访谈——括注的语义在这个实现里落地成：草案的 sourceInterviewIds 恰好是
    // 三个都被判定可用（可见 + 未被 O-05 排除）的来源。
    expect(draft.sourceInterviewIds).toEqual(["itv-1", "itv-2", "itv-3"]);
    // 分段按 name 去重：两场都出现的「破冰」只出现一次。
    expect(draft.sections.map((s) => s.name)).toEqual(["破冰", "深入", "收尾"]);
    expect(draft.dataFields.map((f) => f.fieldId)).toEqual(["f1", "f2"]);
    expect(draft.confirmedTemplateId).toBeNull();

    // 草案不进模板库：list/get 对这份数据一无所知。
    expect(await listTemplates({ repo: h.repo }, ORG)).toEqual([]);
    expect(await getTemplate({ repo: h.repo }, ORG, draft.draftId)).toBeNull();

    // 契约 `extractTemplateDraft.out` 是 `.strict()`。
    const parsed = interview.operations.extractTemplateDraft.out.safeParse({
      draftId: draft.draftId,
      sections: draft.sections,
      dataFields: draft.dataFields,
      sourceInterviewIds: draft.sourceInterviewIds,
    });
    expect(parsed.success).toBe(true);
  });

  it("O-05：拒绝 AI 分析的场次静默排除在抽取输入之外，不是错误", async () => {
    const h = harness();
    seedSourceInterview(h, {
      interviewId: "itv-ok",
      sections: [{ name: "开场", minutes: 5, order: 0 }],
      dataFields: [],
    });
    seedSourceInterview(h, {
      interviewId: "itv-declined",
      aiAnalysisAllowed: false,
      sections: [{ name: "本场受访者拒绝AI分析——这些字段不该出现在草案里", minutes: 99, order: 0 }],
      dataFields: [],
    });

    const draft = await extractTemplateDraft(h, {
      orgId: ORG,
      actorId: RESEARCHER,
      sourceInterviewIds: ["itv-ok", "itv-declined"],
    });

    expect(draft.sourceInterviewIds).toEqual(["itv-ok"]);
    expect(draft.sections.map((s) => s.name)).toEqual(["开场"]);
  });

  it("越权/不存在的来源 id ⇒ NoInterviewAccessError，不静默丢弃（复用 F80 的可见性门）", async () => {
    const h = harness();
    seedSourceInterview(h, { interviewId: "itv-visible", sections: [], dataFields: [] });
    // itv-ghost 未在 scopeRepo 里 seed ⇒ findVisibleById 返回 null，与「不存在」不可区分。

    await expect(
      extractTemplateDraft(h, {
        orgId: ORG,
        actorId: RESEARCHER,
        sourceInterviewIds: ["itv-visible", "itv-ghost"],
      }),
    ).rejects.toThrow(NoInterviewAccessError);
  });
});

describe("confirmTemplateDraft —— 确认后才入库，来源可追溯", () => {
  it("确认后：模板出现在列表/详情里，详情列出 3 场来源（V3 验收线索）", async () => {
    const h = harness();
    seedSourceInterview(h, { interviewId: "itv-1", sections: [{ name: "S1", minutes: 10, order: 0 }], dataFields: [] });
    seedSourceInterview(h, { interviewId: "itv-2", sections: [{ name: "S2", minutes: 15, order: 1 }], dataFields: [] });
    seedSourceInterview(h, { interviewId: "itv-3", sections: [{ name: "S3", minutes: 20, order: 2 }], dataFields: [] });

    const draft = await extractTemplateDraft(h, {
      orgId: ORG,
      actorId: RESEARCHER,
      sourceInterviewIds: ["itv-1", "itv-2", "itv-3"],
    });

    const confirmed = await confirmTemplateDraft(h, {
      orgId: ORG,
      actorId: RESEARCHER,
      draftId: draft.draftId,
      edits: null,
    });

    expect(confirmed.versionNumber).toBe(1);
    expect(confirmed.sourceInterviewIds).toEqual(["itv-1", "itv-2", "itv-3"]);

    const detail = await getTemplate({ repo: h.repo }, ORG, confirmed.templateId);
    expect(detail?.sourceInterviewIds).toEqual(["itv-1", "itv-2", "itv-3"]);

    const rows = await listTemplates({ repo: h.repo }, ORG);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.templateId).toBe(confirmed.templateId);

    // 草案自己也留痕：confirmedTemplateId 指回新建出来的模板。
    expect(h.store.peek(draft.draftId)?.confirmedTemplateId).toBe(confirmed.templateId);
  });

  it("edits：确认时可覆盖名称/目标，未覆盖的字段保留草案默认值", async () => {
    const h = harness();
    seedSourceInterview(h, { interviewId: "itv-1", sections: [{ name: "S1", minutes: 10, order: 0 }], dataFields: [] });

    const draft = await extractTemplateDraft(h, {
      orgId: ORG,
      actorId: RESEARCHER,
      sourceInterviewIds: ["itv-1"],
    });

    const confirmed = await confirmTemplateDraft(h, {
      orgId: ORG,
      actorId: RESEARCHER,
      draftId: draft.draftId,
      edits: JSON.stringify({ name: "研究员定的名字", goal: "研究员补的目标" }),
    });

    const detail = await getTemplate({ repo: h.repo }, ORG, confirmed.templateId);
    expect(detail?.name).toBe("研究员定的名字");
    expect(detail?.goal).toBe("研究员补的目标");
    // sections 未在 edits 里出现 ⇒ 保留草案原样。
    expect(detail?.sections.map((s) => s.name)).toEqual(["S1"]);
  });

  it("草案确认不可重放：确认过一次后再确认 ⇒ TemplateDraftNotConfirmedError", async () => {
    const h = harness();
    seedSourceInterview(h, { interviewId: "itv-1", sections: [{ name: "S1", minutes: 10, order: 0 }], dataFields: [] });

    const draft = await extractTemplateDraft(h, {
      orgId: ORG,
      actorId: RESEARCHER,
      sourceInterviewIds: ["itv-1"],
    });

    await confirmTemplateDraft(h, { orgId: ORG, actorId: RESEARCHER, draftId: draft.draftId, edits: null });

    await expect(
      confirmTemplateDraft(h, { orgId: ORG, actorId: RESEARCHER, draftId: draft.draftId, edits: null }),
    ).rejects.toThrow(TemplateDraftNotConfirmedError);
  });

  it("不存在的 draftId ⇒ TemplateDraftNotConfirmedError", async () => {
    const h = harness();
    await expect(
      confirmTemplateDraft(h, { orgId: ORG, actorId: RESEARCHER, draftId: "tpldraft-ghost", edits: null }),
    ).rejects.toThrow(TemplateDraftNotConfirmedError);
  });
});
