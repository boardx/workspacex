/**
 * F83：模板库列表与编辑器（uc-6-1 R3 步骤0 / R8 / A2）。
 *
 * 纯单元测试（in-memory fakes，不碰 Postgres）——per issue #74，本地跳过依赖 Postgres 的
 * 测试，这里验证的是用例层行为：列表五要素、编辑产生新版本且不影响已建访谈的引用、
 * 编辑不清空来源链（F83 新增的可追溯性要求）、契约 `.strict()` schema 与用例输出对齐。
 */
import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import { toOrgId } from "../../src/domain/org-id";
import { createTemplate } from "../../src/application/interview/create-template";
import { updateTemplate } from "../../src/application/interview/update-template";
import { listTemplates } from "../../src/application/interview/list-templates";
import { getTemplate } from "../../src/application/interview/get-template";
import { TemplateVersionChangedError } from "../../src/application/interview/errors";
import { FakeTemplateRepository } from "../support/template-draft-fakes";
import { SequentialIdFactory } from "../support/artifact-fakes";

const ORG = toOrgId("org-f83-editor-list");

function harness() {
  const repo = new FakeTemplateRepository();
  const ids = new SequentialIdFactory();
  return { repo, ids };
}

describe("模板库列表 —— 五要素", () => {
  it("名称/用过N次/一句话/题数/时长区间，且 usedCount 不是入参能写的字段", async () => {
    const { repo, ids } = harness();

    const created = await createTemplate(
      { repo, ids },
      {
        orgId: ORG,
        actorId: "researcher-1",
        name: "首轮访谈模板",
        goal: "了解目标用户的核心痛点",
        sections: [
          { name: "破冰", minutes: 5, order: 0 },
          { name: "核心问题", minutes: 30, order: 1 },
          { name: "收尾", minutes: 10, order: 2 },
        ],
        dataFields: [{ fieldId: "f1", name: "痛点严重度", kind: "scale", required: true }],
        tags: ["客户"],
      },
    );

    repo.setUsedCount(created.templateId, 3);

    const rows = await listTemplates({ repo }, ORG);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      templateId: created.templateId,
      name: "首轮访谈模板",
      usedCount: 3,
      oneLiner: "了解目标用户的核心痛点",
      questionCount: 3,
      minutesRangeMin: 5,
      minutesRangeMax: 30,
    });

    // 契约 `createTemplate.in` 是 `.strict()`：入参里没有 usedCount 这个键这件事，
    // 由 schema 本身钉死——构造一个带 usedCount 的请求必须被拒绝。
    const withStatWrite = {
      name: "x",
      goal: "y",
      sections: [],
      dataFields: [],
      tags: [],
      usedCount: 99,
    };
    const parsed = interview.operations.createTemplate.in.safeParse(withStatWrite);
    expect(parsed.success).toBe(false);
  });

  it("空模板库：list 返回空数组（不预置示例模板，V7 的后端一半）", async () => {
    const { repo } = harness();
    const rows = await listTemplates({ repo }, ORG);
    expect(rows).toEqual([]);
  });
});

describe("模板编辑器 —— 编辑产生新版本，来源链不因编辑丢失", () => {
  it("编辑同一模板：版本号前移，旧版本内容不变，来源链原样带过去", async () => {
    const { repo, ids } = harness();

    const v1 = await createTemplate(
      { repo, ids },
      {
        orgId: ORG,
        actorId: "researcher-1",
        name: "初版模板",
        goal: "目标 A",
        sections: [{ name: "开场", minutes: 5, order: 0 }],
        dataFields: [],
        tags: [],
      },
    );
    expect(v1.versionNumber).toBe(1);
    expect(v1.sourceInterviewIds).toEqual([]);

    const v2 = await updateTemplate(
      { repo, ids },
      {
        orgId: ORG,
        actorId: "researcher-1",
        templateId: v1.templateId,
        expectedVersionNumber: 1,
        name: "初版模板（改）",
        goal: "目标 A'",
        sections: [{ name: "开场", minutes: 8, order: 0 }],
        dataFields: [],
        tags: [],
      },
    );
    expect(v2.versionNumber).toBe(2);
    expect(v2.name).toBe("初版模板（改）");

    // 旧版本行原样保留（A2：已建访谈引用旧版本号，内容必须还是当初那份）。
    const v1Reread = await repo.getVersion(ORG, v1.templateId, v1.versionId);
    expect(v1Reread?.name).toBe("初版模板");
    expect(v1Reread?.sections[0]?.minutes).toBe(5);
  });

  it("并发编辑：expectedVersionNumber 与当前 head 不一致 ⇒ TemplateVersionChangedError", async () => {
    const { repo, ids } = harness();
    const v1 = await createTemplate(
      { repo, ids },
      { orgId: ORG, actorId: "u1", name: "T", goal: "G", sections: [], dataFields: [], tags: [] },
    );

    await expect(
      updateTemplate(
        { repo, ids },
        {
          orgId: ORG,
          actorId: "u2",
          templateId: v1.templateId,
          expectedVersionNumber: 99,
          name: "T2",
          goal: "G2",
          sections: [],
          dataFields: [],
          tags: [],
        },
      ),
    ).rejects.toThrow(TemplateVersionChangedError);
  });

  it("详情（getTemplate）能看到当前 usedCount 与 sourceInterviewIds", async () => {
    const { repo, ids } = harness();
    const created = await repo.create({
      orgId: ORG,
      templateId: ids.next("tpl"),
      versionId: ids.next("tplv"),
      actorId: "u1",
      name: "抽取来的模板",
      goal: "",
      sections: [{ name: "S1", minutes: 10, order: 0 }],
      dataFields: [],
      tags: [],
      contentHash: "0".repeat(64),
      sourceInterviewIds: ["itv-1", "itv-2"],
    });
    repo.setUsedCount(created.templateId, 5);

    const detail = await getTemplate({ repo }, ORG, created.templateId);
    expect(detail?.usedCount).toBe(5);
    expect(detail?.sourceInterviewIds).toEqual(["itv-1", "itv-2"]);

    // 契约 `getTemplate.out` 是 `.strict()`：输出形状必须与用例返回值一致。
    const parsed = interview.operations.getTemplate.out.safeParse({
      templateId: detail!.templateId,
      versionId: detail!.versionId,
      versionNumber: detail!.versionNumber,
      name: detail!.name,
      goal: detail!.goal,
      sections: detail!.sections,
      dataFields: detail!.dataFields,
      tags: detail!.tags,
      usedCount: detail!.usedCount,
      sourceInterviewIds: detail!.sourceInterviewIds,
    });
    expect(parsed.success).toBe(true);
  });

  it("编辑已带来源链的模板：来源链跟着走，不被清空", async () => {
    const { repo, ids } = harness();
    const created = await repo.create({
      orgId: ORG,
      templateId: ids.next("tpl"),
      versionId: ids.next("tplv"),
      actorId: "u1",
      name: "抽取来的模板",
      goal: "",
      sections: [{ name: "S1", minutes: 10, order: 0 }],
      dataFields: [],
      tags: [],
      contentHash: "0".repeat(64),
      sourceInterviewIds: ["itv-1", "itv-2", "itv-3"],
    });

    const edited = await updateTemplate(
      { repo, ids },
      {
        orgId: ORG,
        actorId: "u1",
        templateId: created.templateId,
        expectedVersionNumber: 1,
        name: "抽取来的模板（研究员改过）",
        goal: "",
        sections: [{ name: "S1", minutes: 12, order: 0 }],
        dataFields: [],
        tags: [],
      },
    );

    expect(edited.sourceInterviewIds).toEqual(["itv-1", "itv-2", "itv-3"]);
  });
});
