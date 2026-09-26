import { describe, expect, it } from "vitest";
import { SurveyService, type SurveyRecord, type SurveyRepository } from "../../src/application/survey/survey-service";
import { toOrgId } from "../../src/domain/org-id";
import type { SurveyDraftInput, SurveySubmissionInput } from "@repo/contracts/survey-runtime";

const org = toOrgId("survey-source-org");
const owner = "survey-source-owner";
const draft: SurveyDraftInput = {
  title: "真实问卷",
  questions: [{ id: "Q1", order: 1, chapterId: "general", title: "您会推荐我们吗？", type: "single", required: true, options: ["会", "不会"] }],
  template: { id: "report-1", title: "报告", sections: [{ id: "section-1", title: "结果", blocks: [{ id: "block-1", title: "分布", type: "bar", questionIds: ["Q1"], statistic: "distribution", samplePolicy: "valid", minGroupSize: 5 }] }] },
};
const submission: SurveySubmissionInput = {
  submissionId: "source-lifecycle-submission",
  answers: [{ questionId: "Q1", value: "会" }],
  durationSeconds: 1,
  role: "未填写",
  companySize: "未填写",
};

function setup() {
  const rows = new Map<string, SurveyRecord>();
  const repo: SurveyRepository = {
    async list(currentOrg, actor) { return [...rows.entries()].filter(([key, value]) => key.startsWith(`${currentOrg}:`) && value.ownerId === actor).map(([, value]) => structuredClone(value.model)); },
    async create(currentOrg, value) { rows.set(`${currentOrg}:${value.model.id}`, structuredClone(value)); },
    async transact(currentOrg, id, work) { const key = `${currentOrg}:${id}`; const current = rows.get(key); if (!current) throw new Error("missing"); const next = structuredClone(current); const result = await work(next); rows.set(key, next); return structuredClone(result); },
    async delete() { throw new Error("not used"); },
  };
  return { service: new SurveyService(repo, () => new Date("2026-09-26T00:00:00.000Z")), rows };
}

describe("survey Markdown source lifecycle", () => {
  it("bootstraps an equivalent design source for a legacy structured draft", async () => {
    const { service } = setup();
    const created = await service.create(org, owner, draft);
    const loaded = await service.get(org, owner, created.id);

    expect(loaded.source!.documents.design.markdown).toContain("# 真实问卷");
    expect(loaded.questions).toEqual(draft.questions);
  });

  it("freezes source and compiled projection when collection starts", async () => {
    const { service } = setup();
    const created = await service.create(org, owner, draft);
    const saved = await service.saveSource(org, owner, created.id, created.version, {
      design: "# 真实问卷\n\n## Q1 [single, required]\n您会推荐我们吗？\n- 会\n- 不会\n",
      publication: "# 发布设置\n",
      reportTemplate: "# 报告模板\n",
    });
    const ready = await service.prepare(org, owner, saved.id, saved.version);
    const collected = await service.startCollection(org, owner, ready.id, ready.version);

    expect(collected.publication?.sourceSnapshot!.contentHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(service.saveSource(org, owner, collected.id, collected.version, {
      design: "# 变更\n",
      publication: "# 发布设置\n",
      reportTemplate: "# 报告模板\n",
    })).rejects.toMatchObject({ code: "closed" });
  });

  it("does not mutate the source projection when a save is stale or invalid", async () => {
    const { service } = setup();
    const created = await service.create(org, owner, draft);
    const original = await service.get(org, owner, created.id);

    await expect(service.saveSource(org, owner, created.id, created.version - 1, {
      design: "# 过期更新\n",
      publication: "# 发布设置\n",
      reportTemplate: "# 报告模板\n",
    })).rejects.toMatchObject({ code: "version_conflict" });
    await expect(service.saveSource(org, owner, created.id, created.version, {
      design: "# 无效问卷\n\n## Q1 [single]\n没有选项\n",
      publication: "# 发布设置\n",
      reportTemplate: "# 报告模板\n",
    })).rejects.toMatchObject({ code: "invalid_source" });

    const unchanged = await service.get(org, owner, created.id);
    expect(unchanged.version).toBe(original.version);
    expect(unchanged.questions).toEqual(original.questions);
    expect(unchanged.source).toEqual(original.source);
  });

  it("keeps legacy publications fillable and source-enabled snapshots immutable", async () => {
    const { service, rows } = setup();
    const legacy = await service.create(org, owner, draft);
    const ready = await service.prepare(org, owner, legacy.id, legacy.version);
    const collected = await service.startCollection(org, owner, ready.id, ready.version);
    const token = collected.publication!.token;

    const stored = rows.get(`${org}:${collected.id}`)!;
    delete stored.model.source;
    delete stored.model.publication!.sourceSnapshot;

    const receipt = await service.submit(token, submission);
    expect(receipt.responseId).toBeTruthy();
    expect((await service.publicGet(token)).questions).toEqual(draft.questions);
    expect((await service.get(org, owner, collected.id)).publication?.sourceSnapshot).toBeUndefined();
  });
});
