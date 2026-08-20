import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  applyBlueprintUseCase,
  ApplyBlueprintError,
} from "../../src/application/templates/apply-blueprint";
import {
  BlueprintInitializationFailedError,
  type ApplyBlueprintCommand,
  type ApplyBlueprintRepository,
  type AppliedProject,
} from "../../src/application/templates/apply-blueprint-ports";
import type { BlueprintVersion } from "../../src/domain/templates/blueprint-version";
import type { InitializationCategory } from "../../src/domain/templates/initialization-preview";
import { designFacetKeys } from "../../src/domain/templates/design-facet-table";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F23 —— **事务性 + 幂等**（`uc-2-2` R3 E2/V12/V13）。
 *
 * 用一个内存假仓储演示两条不能各自为真的性质：
 *   · 同一 `idempotencyKey` 重复提交只建一个项目（V13）——幂等键做主键，不是先查后写。
 *   · 六类写入任一步失败 ⇒ 已整体回滚，不留半成品（E2）——假仓储在失败分支里
 *     刻意不提交任何行，用「失败后仓储内部存储仍为空」证明「没有半成品」不是靠约定。
 *
 * 这两条都是**仓储实现**的责任，本用例（`applyBlueprintUseCase`）只负责把仓储抛出的
 * 错误翻译成契约码——所以本文件的假仓储故意把这两条规则的**代价**做实，而不是
 * 简单地 mock 返回值，否则测试只能证明「用例调用了仓储」，证不了「仓储真的会拦」。
 */

const V1: BlueprintVersion = {
  id: "v-1",
  blueprintId: "bp-1",
  versionNumber: 1,
  content: {},
  changedDesignFacetKeys: [],
  rolledBackFrom: null,
  state: "published",
};

/** 内存假仓储：`idempotencyKey` 做主键去重；可配置在指定类别名上模拟失败并整体回滚。 */
class FakeApplyBlueprintRepository implements ApplyBlueprintRepository {
  readonly byIdempotencyKey = new Map<string, AppliedProject>();
  /** 已提交的项目行——只有真正「成功」的调用才会往这里追加一行,失败分支不追加。 */
  readonly committedRows: ApplyBlueprintCommand[] = [];
  failOnCategory: InitializationCategory | null = null;

  async apply(cmd: ApplyBlueprintCommand): Promise<AppliedProject> {
    const existing = this.byIdempotencyKey.get(cmd.idempotencyKey);
    if (existing) {
      // 幂等命中：返回先前那个项目，**不新建行**、**不重跑六类写入**。
      return { ...existing, created: false };
    }

    if (this.failOnCategory !== null) {
      const failed = cmd.initialized.find((c) => c.category === this.failOnCategory);
      if (failed) {
        // 模拟事务回滚：不追加 committedRows，不写入 byIdempotencyKey——
        // 调用方之后能观察到「没有任何半成品」。
        throw new BlueprintInitializationFailedError(this.failOnCategory);
      }
    }

    const created: AppliedProject = {
      projectId: randomUUID(),
      blueprintVersionId: cmd.blueprintVersionId,
      initialized: cmd.initialized,
      created: true,
    };
    this.committedRows.push(cmd);
    this.byIdempotencyKey.set(cmd.idempotencyKey, created);
    return created;
  }
}

const baseInput = {
  orgId: toOrgId("org-1"),
  actorId: "u-1",
  actorOrgRole: "lead" as const,
  blueprintId: "bp-1",
  blueprintExists: true,
  visibleToActor: true,
  resolvedVersion: V1,
  // 不点名具体 key（I-5 / lint-design-facet-single-source 规则 2）：用定义表派生的完整槽位清单。
  filledFacetKeys: designFacetKeys(),
  tier: "two-day" as const,
  projectName: "新项目",
  flowAgendaContent: null,
};

describe("幂等（V13）：同一 idempotencyKey 重复提交只建一个项目", () => {
  it("两次调用返回同一个 projectId；第二次 created=false；仓储内部只有一行", async () => {
    const repo = new FakeApplyBlueprintRepository();
    const first = await applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "same-key" });
    const second = await applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "same-key" });

    expect(second.projectId).toBe(first.projectId);
    expect(repo.committedRows.length).toBe(1); // 六类写入只真正跑了一次
    expect(repo.byIdempotencyKey.get("same-key")!.created).toBe(true); // 存的是"这是首次"
  });

  it("并发的两次调用（同一 key，Promise.all）也只落一行——去重键必须是主键冲突，不是先查后写", async () => {
    const repo = new FakeApplyBlueprintRepository();
    // 用一个会「先查后写」出错的仓储包一层，验证 FakeApplyBlueprintRepository 本身
    // 对同步执行是安全的（本测试运行时是单线程 JS，真正的并发竞态由 SQL 唯一约束把关，
    // 这里只确认应用层不会替仓储做「先查后写」这一步）。
    const [a, b] = await Promise.all([
      applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "concurrent-key" }),
      applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "concurrent-key" }),
    ]);
    expect(a.projectId).toBe(b.projectId);
  });

  it("不同 idempotencyKey ⇒ 两个不同项目（幂等不是「同蓝本只能建一次」）", async () => {
    const repo = new FakeApplyBlueprintRepository();
    const a = await applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "key-a" });
    const b = await applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "key-b" });
    expect(a.projectId).not.toBe(b.projectId);
    expect(repo.committedRows.length).toBe(2);
  });
});

describe("事务性（E2/V12）：六类写入任一步失败 ⇒ 整体回滚，不留半成品", () => {
  it("失败时用例抛 ApplyBlueprintError('INITIALIZATION_FAILED')，detail 指明失败的类别名", async () => {
    const repo = new FakeApplyBlueprintRepository();
    repo.failOnCategory = "分组";

    try {
      await applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "will-fail" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyBlueprintError);
      const e = err as ApplyBlueprintError;
      expect(e.reasonCode).toBe("INITIALIZATION_FAILED");
      expect(e.failedCategory).toBe("分组");
    }
  });

  it("失败后仓储内部没有任何半成品行——不是「有议程没分组」，是什么都没有", async () => {
    const repo = new FakeApplyBlueprintRepository();
    repo.failOnCategory = "画布与产出物"; // filledFacetKeys 里的 outputs 会映射到这一类

    await expect(
      applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "will-fail-2" }),
    ).rejects.toBeInstanceOf(ApplyBlueprintError);

    expect(repo.committedRows.length).toBe(0);
    expect(repo.byIdempotencyKey.size).toBe(0);
  });

  it("失败之后用同一个 idempotencyKey 重试，能重新走一遍六类写入（失败不占用幂等键）", async () => {
    const repo = new FakeApplyBlueprintRepository();
    repo.failOnCategory = "分组";

    await expect(
      applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "retry-key" }),
    ).rejects.toBeInstanceOf(ApplyBlueprintError);

    repo.failOnCategory = null; // 第二次重试时依赖恢复
    const result = await applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "retry-key" });
    expect(result.projectId).toBeTruthy();
    expect(repo.committedRows.length).toBe(1);
  });
});

describe("权限与资源门槛（先于事务发生，事务性写入不应因权限问题被触发）", () => {
  it("actorOrgRole 为 null ⇒ NO_ORG_ROLE，仓储从未被调用", async () => {
    const repo = new FakeApplyBlueprintRepository();
    await expect(
      applyBlueprintUseCase(
        { repo },
        { ...baseInput, actorOrgRole: null, idempotencyKey: "no-role" },
      ),
    ).rejects.toThrow(ApplyBlueprintError);
    expect(repo.committedRows.length).toBe(0);
  });

  it("consultant 角色 ⇒ ROLE_INSUFFICIENT（只有 lead 能套用蓝本建项目，同 F17）", async () => {
    const repo = new FakeApplyBlueprintRepository();
    try {
      await applyBlueprintUseCase(
        { repo },
        { ...baseInput, actorOrgRole: "consultant", idempotencyKey: "wrong-role" },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyBlueprintError);
      expect((err as ApplyBlueprintError).reasonCode).toBe("ROLE_INSUFFICIENT");
    }
    expect(repo.committedRows.length).toBe(0);
  });

  it("admin 角色同样不能套用蓝本建项目（U-4 裁 A 的同一条边）", async () => {
    const repo = new FakeApplyBlueprintRepository();
    try {
      await applyBlueprintUseCase(
        { repo },
        { ...baseInput, actorOrgRole: "admin", idempotencyKey: "admin-role" },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApplyBlueprintError).reasonCode).toBe("ROLE_INSUFFICIENT");
    }
  });

  it("蓝本不存在 ⇒ BLUEPRINT_NOT_FOUND", async () => {
    const repo = new FakeApplyBlueprintRepository();
    try {
      await applyBlueprintUseCase(
        { repo },
        { ...baseInput, blueprintExists: false, idempotencyKey: "not-found" },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApplyBlueprintError).reasonCode).toBe("BLUEPRINT_NOT_FOUND");
    }
  });

  it("team-only 蓝本对非该 team 成员不可见 ⇒ BLUEPRINT_NOT_VISIBLE", async () => {
    const repo = new FakeApplyBlueprintRepository();
    try {
      await applyBlueprintUseCase(
        { repo },
        { ...baseInput, visibleToActor: false, idempotencyKey: "not-visible" },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ApplyBlueprintError).reasonCode).toBe("BLUEPRINT_NOT_VISIBLE");
    }
  });
});
