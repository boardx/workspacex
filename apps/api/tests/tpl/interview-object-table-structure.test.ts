import { describe, expect, it } from "vitest";
import {
  updateInterviewSubjectsUseCase,
  UpdateInterviewSubjectsError,
  canUpdateInterviewSubjects,
} from "../../src/application/templates/update-interview-subjects";
import type {
  InterviewSubjectsRepository,
  UpdateInterviewSubjectsCommand,
  UpdatedInterviewSubjects,
} from "../../src/application/templates/interview-subjects-ports";
import { InterviewSubjectsRevisionConflictError } from "../../src/application/templates/interview-subjects-ports";
import { toOrgId } from "../../src/domain/org-id";
import {
  INTERVIEW_SUBJECT_COLUMNS,
  findRowMissingColumns,
  hasAllSixColumns,
  type InterviewSubjectRow,
} from "../../src/domain/templates/interview-subject";

/**
 * F25 —— **观察/访谈对象表：六列结构与填写**（`uc-2-2` R8 V9）。
 *
 * 只断言结构与填写：对象/部门角色/联系方式/背景与要问什么/方式/状态六列齐全、可增删。
 * 预约、提纲生成、转写自动回流属 06-itv，本测试不涉及。
 */
class FakeInterviewSubjectsRepository implements InterviewSubjectsRepository {
  public calls: UpdateInterviewSubjectsCommand[] = [];
  private revision = "rev-0";
  private shouldConflict = false;

  forceConflict(): void {
    this.shouldConflict = true;
  }

  async updateSubjects(
    cmd: UpdateInterviewSubjectsCommand,
  ): Promise<UpdatedInterviewSubjects> {
    this.calls.push(cmd);
    if (this.shouldConflict) throw new InterviewSubjectsRevisionConflictError();
    this.revision = `rev-${this.calls.length}`;
    return { subjects: cmd.subjects, revision: this.revision };
  }

  async getSubjects() {
    return { subjects: [], revision: this.revision };
  }
}

function subjectRow(overrides: Partial<InterviewSubjectRow> = {}): InterviewSubjectRow {
  return {
    subjectId: "s-1",
    name: "Dr. Weber",
    role: "某物流园区 · 运营总监",
    contact: "+49 ··· （AI 建议）",
    focus: "工商储在其园区的实际痛点与付费意愿",
    method: "远程视频",
    status: "待预约",
    ...overrides,
  };
}

describe("F25 · 观察/访谈对象表六列齐全（V9）", () => {
  it("六列恰好是原型逐字的六列,不多不少", () => {
    expect([...INTERVIEW_SUBJECT_COLUMNS].sort()).toEqual(
      ["contact", "focus", "method", "name", "role", "status"].sort(),
    );
  });

  it("一行六列齐全 ⇒ 合法", () => {
    expect(hasAllSixColumns(subjectRow())).toBe(true);
  });

  it("缺一列 ⇒ 不合法（六列缺一即结构不完整）", () => {
    const { status: _status, ...missingStatus } = subjectRow();
    expect(hasAllSixColumns(missingStatus)).toBe(false);
  });

  it("找出第一个字段不齐的行的下标", () => {
    const rows = [subjectRow({ subjectId: "s-1" }), { subjectId: "s-2", name: "李工" }];
    expect(findRowMissingColumns(rows)).toBe(1);
  });

  it("行齐全时 findRowMissingColumns 返回 undefined", () => {
    const rows = [subjectRow({ subjectId: "s-1" }), subjectRow({ subjectId: "s-2" })];
    expect(findRowMissingColumns(rows)).toBeUndefined();
  });
});

describe("F25 · updateInterviewSubjects 用例", () => {
  it("facilitator 能填对象表,`[＋ 加对象]` 生效——仓储收到最终列表(可增删)", async () => {
    const repo = new FakeInterviewSubjectsRepository();
    const subjects = [
      subjectRow({ subjectId: "s-1" }),
      subjectRow({ subjectId: "s-2", name: "李工", status: "已确认" }),
      subjectRow({
        subjectId: "s-3",
        name: "（AI 建议人选）",
        status: "AI 建议 · 需人确认",
      }),
    ];

    const out = await updateInterviewSubjectsUseCase(
      { repo },
      {
        orgId: toOrgId("org-1"),
        projectId: "p-1",
        groupId: "g-1",
        actorProjectRole: "facilitator",
        subjects,
        expectedRevision: "rev-0",
      },
    );

    expect(out.subjects).toEqual(subjects);
    expect(repo.calls).toHaveLength(1);
    expect(repo.calls[0]?.groupId).toBe("g-1");
  });

  it("groupLead 也能填(嵌在组卡内,是本组产出)", async () => {
    expect(canUpdateInterviewSubjects("groupLead")).toBe(true);
    const repo = new FakeInterviewSubjectsRepository();
    await updateInterviewSubjectsUseCase(
      { repo },
      {
        orgId: toOrgId("org-1"),
        projectId: "p-1",
        groupId: "g-1",
        actorProjectRole: "groupLead",
        subjects: [subjectRow()],
        expectedRevision: "rev-0",
      },
    );
    expect(repo.calls).toHaveLength(1);
  });

  it("member/observer 不能写 ⇒ ROLE_INSUFFICIENT", async () => {
    const repo = new FakeInterviewSubjectsRepository();
    for (const role of ["member", "observer"] as const) {
      expect(canUpdateInterviewSubjects(role)).toBe(false);
      await expect(
        updateInterviewSubjectsUseCase(
          { repo },
          {
            orgId: toOrgId("org-1"),
        projectId: "p-1",
            groupId: "g-1",
            actorProjectRole: role,
            subjects: [subjectRow()],
            expectedRevision: "rev-0",
          },
        ),
      ).rejects.toMatchObject(new UpdateInterviewSubjectsError("ROLE_INSUFFICIENT"));
    }
    expect(repo.calls).toHaveLength(0);
  });

  it("无项目角色 ⇒ NO_PROJECT_ROLE", async () => {
    const repo = new FakeInterviewSubjectsRepository();
    await expect(
      updateInterviewSubjectsUseCase(
        { repo },
        {
          orgId: toOrgId("org-1"),
        projectId: "p-1",
          groupId: "g-1",
          actorProjectRole: null,
          subjects: [subjectRow()],
          expectedRevision: "rev-0",
        },
      ),
    ).rejects.toMatchObject(new UpdateInterviewSubjectsError("NO_PROJECT_ROLE"));
  });

  it("并发冲突 ⇒ VERSION_CHANGED", async () => {
    const repo = new FakeInterviewSubjectsRepository();
    repo.forceConflict();
    await expect(
      updateInterviewSubjectsUseCase(
        { repo },
        {
          orgId: toOrgId("org-1"),
        projectId: "p-1",
          groupId: "g-1",
          actorProjectRole: "facilitator",
          subjects: [subjectRow()],
          expectedRevision: "rev-stale",
        },
      ),
    ).rejects.toMatchObject(new UpdateInterviewSubjectsError("VERSION_CHANGED"));
  });

  it("仓储失败 ⇒ DEPENDENCY_UNAVAILABLE,不吞成空结果", async () => {
    const repo: InterviewSubjectsRepository = {
      updateSubjects: async () => {
        throw new Error("db down");
      },
      getSubjects: async () => ({ subjects: [], revision: "0" }),
    };
    await expect(
      updateInterviewSubjectsUseCase(
        { repo },
        {
          orgId: toOrgId("org-1"),
        projectId: "p-1",
          groupId: "g-1",
          actorProjectRole: "facilitator",
          subjects: [subjectRow()],
          expectedRevision: "rev-0",
        },
      ),
    ).rejects.toMatchObject(new UpdateInterviewSubjectsError("DEPENDENCY_UNAVAILABLE"));
  });
});
