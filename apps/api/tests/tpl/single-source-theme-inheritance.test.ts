import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  saveAndSyncTopicUseCase,
  SaveAndSyncTopicError,
} from "../../src/application/templates/save-and-sync-topic";
import {
  TopicRevisionConflictError,
  type ProjectTopicRepository,
  type SaveAndSyncTopicCommand,
  type SavedTopic,
} from "../../src/application/templates/save-and-sync-topic-ports";

/**
 * F24 —— **定题单点继承**（`uc-2-2` R7 I-13 V5/V8）。
 *
 * 内存假仓储以 `projectId` 为唯一键做 upsert——与真实仓储的「唯一约束」同一形状：
 * 第二次调用改写**同一行**,不追加新行。「系统中不存在第二份主题/背景记录」（V5）
 * 因此不是靠断言两次返回值相等去*推断*的,是靠数「仓储内部一共有几行」去*证明*的。
 */
class FakeProjectTopicRepository implements ProjectTopicRepository {
  /** projectId → 当前这一行。只有一张表,永远只有一行/项目——这就是「单点」的存储形状。 */
  readonly rows = new Map<string, { topicId: string; revision: string }>();

  async saveAndSync(cmd: SaveAndSyncTopicCommand): Promise<SavedTopic> {
    const existing = this.rows.get(cmd.projectId);
    if (existing && existing.revision !== cmd.expectedTopicRevision) {
      throw new TopicRevisionConflictError();
    }
    const topicId = existing?.topicId ?? randomUUID();
    const nextRevision = randomUUID();
    // ⚠ 同一个 key 上 `.set`——覆盖同一行,不是 `.push` 追加一行。
    this.rows.set(cmd.projectId, { topicId, revision: nextRevision });
    return { topicId, revision: nextRevision };
  }
}

const baseInput = {
  projectId: "p-1",
  actorProjectRole: "facilitator" as const,
  title: "如何提升续费率",
  background: "Q3 续费率连续两月下滑,客户董事会 9 月要结果",
  expectedTopicRevision: "",
  aiGenerated: null,
};

describe("F24 · 定题单点继承", () => {
  it("V5：改主题后保存,分组/议程/AI 上下文三处读到同一个 topicId,系统中只有一行", async () => {
    const repo = new FakeProjectTopicRepository();

    const first = await saveAndSyncTopicUseCase(
      { repo },
      { ...baseInput, expectedTopicRevision: "" },
    );
    expect(first.syncedTo).toEqual(["grouping", "agenda", "ai-context"]);
    expect(repo.rows.size).toBe(1);

    const currentRevision = repo.rows.get("p-1")!.revision;
    const second = await saveAndSyncTopicUseCase(
      { repo },
      {
        ...baseInput,
        title: "如何在两个月内把续费率拉回 85%",
        expectedTopicRevision: currentRevision,
      },
    );

    // 同一个 topicId——不是「新建了第二个主题,前端凑巧显示了新的那个」。
    expect(second.topicId).toBe(first.topicId);
    // 全程只有一行:不存在第二份主题/背景记录。
    expect(repo.rows.size).toBe(1);
  });

  it("V5：两个不同项目各自单点继承,互不影响,合计仍是「每项目一行」", async () => {
    const repo = new FakeProjectTopicRepository();

    await saveAndSyncTopicUseCase(
      { repo },
      { ...baseInput, projectId: "p-1", expectedTopicRevision: "" },
    );
    await saveAndSyncTopicUseCase(
      { repo },
      { ...baseInput, projectId: "p-2", expectedTopicRevision: "" },
    );

    expect(repo.rows.size).toBe(2);
    expect(repo.rows.get("p-1")!.topicId).not.toBe(repo.rows.get("p-2")!.topicId);
  });

  it("V8：AI 生成主题/背景必须挂来源,来源非空时正常保存并可辨识为机器产出的输入", async () => {
    const repo = new FakeProjectTopicRepository();
    const out = await saveAndSyncTopicUseCase(
      { repo },
      {
        ...baseInput,
        expectedTopicRevision: "",
        aiGenerated: { sources: ["12 条洞察", "4 场访谈", "客户董事会时间表"] },
      },
    );
    expect(out.topicId).toBeTruthy();
    expect(repo.rows.size).toBe(1);
  });

  it("V8：AI 生成来源为空 ⇒ AI_SOURCES_INSUFFICIENT,不得伪造来源、不落为最终值", async () => {
    const repo = new FakeProjectTopicRepository();
    await expect(
      saveAndSyncTopicUseCase(
        { repo },
        { ...baseInput, expectedTopicRevision: "", aiGenerated: { sources: [] } },
      ),
    ).rejects.toMatchObject(new SaveAndSyncTopicError("AI_SOURCES_INSUFFICIENT"));
    // 校验在写入之前就拦住——不留半成品行。
    expect(repo.rows.size).toBe(0);
  });

  it("并发态：expectedTopicRevision 对不上当前版本 ⇒ VERSION_CHANGED,不覆盖对方的改动", async () => {
    const repo = new FakeProjectTopicRepository();
    await saveAndSyncTopicUseCase({ repo }, { ...baseInput, expectedTopicRevision: "" });

    await expect(
      saveAndSyncTopicUseCase(
        { repo },
        { ...baseInput, title: "别人先改的主题", expectedTopicRevision: "stale-revision" },
      ),
    ).rejects.toMatchObject(new SaveAndSyncTopicError("VERSION_CHANGED"));
  });

  it("权限态：组员/组长/观察者写操作按钮置灰 ⇒ ROLE_INSUFFICIENT，只有引导师能定题（V14）", async () => {
    const repo = new FakeProjectTopicRepository();
    for (const role of ["member", "groupLead", "observer"] as const) {
      await expect(
        saveAndSyncTopicUseCase(
          { repo },
          { ...baseInput, actorProjectRole: role, expectedTopicRevision: "" },
        ),
      ).rejects.toMatchObject(new SaveAndSyncTopicError("ROLE_INSUFFICIENT"));
    }
    expect(repo.rows.size).toBe(0);
  });

  it("无项目角色 ⇒ NO_PROJECT_ROLE", async () => {
    const repo = new FakeProjectTopicRepository();
    await expect(
      saveAndSyncTopicUseCase(
        { repo },
        { ...baseInput, actorProjectRole: null, expectedTopicRevision: "" },
      ),
    ).rejects.toMatchObject(new SaveAndSyncTopicError("NO_PROJECT_ROLE"));
  });
});
