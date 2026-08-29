/**
 * F65 · 两次真正并发的挂载请求，同一线程、同一 skill（issue：`chat-skill-mounted-<id>`
 * 在 e2e `skill-agent-import-usecase-audit.spec.ts` ④ 里 strict mode violation
 * resolved to 2 elements——`fullstack-smoke` 里几个 spec 文件都会挂同一个种子
 * skill、都不带 `thread=` 打开 chat，落到同一条默认线程，Playwright 按文件并行跑，
 * 挂载请求因此可能真正同时到达）。
 *
 * `mount-skill-to-thread.ts` 的乐观锁只在**内存里**比对一份 `load()` 快照的指纹，
 * 挡不住两个请求都在写之前读到同一份快照的情况——那种竞态只能由存储层的
 * `thread_skill_mounts_active_skill_uniq` 唯一索引裁决先后（真实实现见
 * `pg-thread-mount-store.ts`）。这里用一个会抛
 * `ThreadMountConcurrentMountError` 的替身存储模拟「输了那一局」的请求，
 * 断言用例把它翻译成客户端已经认识的 `SKILL_VERSION_CHANGED`，**不**让第二条
 * 活跃挂载真的写进去。
 */
import { describe, expect, it } from "vitest";
import { mountSkillToThread } from "../../../src/application/skill/mount-skill-to-thread";
import { ThreadMountConcurrentMountError } from "../../../src/application/skill/ports";
import { collectAudit, threadMountStore, visibility } from "../../support/skill-fakes";

const AUTH = {
  allowed: true,
  projectId: "p-1",
  projectRole: "facilitator",
  decisionId: "d-1",
} as const;

function baseInput(overrides: Partial<Parameters<typeof mountSkillToThread>[0]> = {}) {
  return {
    threadId: "thread-race",
    principalId: "u-a",
    authorization: AUTH,
    skillIds: ["sk-mece"],
    mountIdFor: (i: number) => `mount-${i}`,
    mountedAt: "2026-08-01T00:00:00Z",
    expectedFingerprint: null,
    ...overrides,
  };
}

describe("F65 · 并发挂载：存储层唯一索引挡下第二条活跃行", () => {
  it("save() 抛 ThreadMountConcurrentMountError ⇒ 用例回 SKILL_VERSION_CHANGED，不写入", async () => {
    const mounts = threadMountStore();
    const racingSave: typeof mounts.save = async () => {
      throw new ThreadMountConcurrentMountError("sk-mece");
    };

    const result = await mountSkillToThread(baseInput(), {
      mounts: { ...mounts, save: racingSave },
      skills: visibility({ "sk-mece": { status: "已启用", currentVersionId: "v3" } }),
      audit: collectAudit(),
      fingerprintOf: (m) => JSON.stringify(m),
    });

    expect(result).toEqual({
      ok: false,
      code: "SKILL_VERSION_CHANGED",
      reason: "挂载列表已被他人改动：与另一次并发挂载冲突，不得静默产生重复挂载",
    });
    // 输了那一局的请求没有偷偷把它这一份写进替身存储——`save` 被替换成了
    // 恒抛异常的版本，真实存储侧同理靠 SAVEPOINT 回滚了那一行 INSERT。
    expect(mounts.savesByThread.has("thread-race")).toBe(false);
  });

  it("issue #2350 追加：赢家写进去的正是这次也想要的那一行 ⇒ 改判成功，不报假冲突", async () => {
    // `initial` 模拟"赢家已经把这一行提交进去"：同一 skillId、同一 versionId、
    // 仍然活跃（removedAt: null）——这次调用的目标其实已经达成，只是不是由这次
    // 写操作亲手达成的。真实证据：`skill-agent-import-usecase-audit.spec.ts` ④
    // 等四个 fullstack-smoke spec 并发挂同一个种子 skill 到同一条默认线程，
    // "慢的那一个"此前会被判 `SKILL_VERSION_CHANGED`，即便它想要的状态已经存在。
    const mounts = threadMountStore({
      "thread-race": [
        {
          mountId: "mount-winner", threadId: "thread-race", skillId: "sk-mece",
          versionId: "v3", mountedAt: "2026-08-01T00:00:00Z", removedAt: null,
        },
      ],
    });
    const racingSave: typeof mounts.save = async () => {
      throw new ThreadMountConcurrentMountError("sk-mece");
    };

    const result = await mountSkillToThread(baseInput(), {
      mounts: { ...mounts, save: racingSave },
      skills: visibility({ "sk-mece": { status: "已启用", currentVersionId: "v3" } }),
      audit: collectAudit(),
      fingerprintOf: (m) => JSON.stringify(m),
    });

    expect(result).toEqual({
      ok: true,
      // 回的是赢家那一行的真实 mountId（"mount-winner"），不是这次调用自己
      // 想写的那个（"mount-0"，来自 `baseInput` 的 `mountIdFor`）——诚实反映
      // 是谁真的写进去的，不伪造一条这次请求自己从未真正插入过的记录。
      mounts: [{
        mountId: "mount-winner", threadId: "thread-race", skillId: "sk-mece",
        versionId: "v3", mountedAt: "2026-08-01T00:00:00Z", removedAt: null,
      }],
    });
  });

  it("赢家写进去的是别的东西（版本不一样）⇒ 仍然诚实报冲突，不吞掉真正的分歧", async () => {
    // 与上一条唯一的差异：`initial` 里活跃的是 v9，不是这次调用想要的 v3——
    // 目标没有达成，不能改判成功。
    const mounts = threadMountStore({
      "thread-race": [
        {
          mountId: "mount-someone-else", threadId: "thread-race", skillId: "sk-mece",
          versionId: "v9", mountedAt: "2026-08-01T00:00:00Z", removedAt: null,
        },
      ],
    });
    const racingSave: typeof mounts.save = async () => {
      throw new ThreadMountConcurrentMountError("sk-mece");
    };

    const result = await mountSkillToThread(baseInput(), {
      mounts: { ...mounts, save: racingSave },
      skills: visibility({ "sk-mece": { status: "已启用", currentVersionId: "v3" } }),
      audit: collectAudit(),
      fingerprintOf: (m) => JSON.stringify(m),
    });

    expect(result).toEqual({
      ok: false,
      code: "SKILL_VERSION_CHANGED",
      reason: "挂载列表已被他人改动：与另一次并发挂载冲突，不得静默产生重复挂载",
    });
  });

  it("非并发冲突的其它异常仍然原样上抛，不被这里悄悄吞掉", async () => {
    const boom = new Error("db 掉线");
    const mounts = threadMountStore();
    const failingSave: typeof mounts.save = async () => {
      throw boom;
    };

    await expect(
      mountSkillToThread(baseInput(), {
        mounts: { ...mounts, save: failingSave },
        skills: visibility({ "sk-mece": { status: "已启用", currentVersionId: "v3" } }),
        audit: collectAudit(),
        fingerprintOf: (m) => JSON.stringify(m),
      }),
    ).rejects.toBe(boom);
  });

  it("正常路径（无竞态）仍然只写一条活跃挂载——回归基线", async () => {
    const mounts = threadMountStore();
    const result = await mountSkillToThread(baseInput(), {
      mounts,
      skills: visibility({ "sk-mece": { status: "已启用", currentVersionId: "v3" } }),
      audit: collectAudit(),
      fingerprintOf: (m) => JSON.stringify(m),
    });

    expect(result.ok).toBe(true);
    const saved = mounts.savesByThread.get("thread-race") ?? [];
    expect(saved.filter((m) => m.skillId === "sk-mece" && m.removedAt === null)).toHaveLength(1);
  });
});
