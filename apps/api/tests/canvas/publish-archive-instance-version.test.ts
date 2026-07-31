import { describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import {
  canCreateNewBinding,
  canInstantiateExistingBinding,
  previewArchiveImpact,
  publishNewVersion,
  transition,
  type LifecycleAction,
  type TemplateVersionRecord,
  type TemplateVersionState,
} from "../../src/domain/canvas/template-lifecycle";
import { createInstance, readFrozenTemplateRef } from "../../src/domain/canvas/instance-version-freeze";

/**
 * F101 — 模板发布状态机（草稿/试跑/发布/归档，O-10）+ 实例固化版本（I-4）+ 归档语义（I-5）。
 *
 * ## 这份测试在防什么
 *
 * 三段发布流程 + 归档/恢复只在原型里演示过 happy path（draft→trial→published 一路顺畅），
 * 从未穷举过「在 trial 状态点归档会怎样」「归档后能不能恢复到当初的状态」这类边角。
 * `TRANSITION_TABLE` 下面那条测试把 4 态 × 4 动作的 16 格全部枚举，而不是抽样几条 —— 抽样测试
 * 对状态机是危险的：状态机的缺陷经常正好长在没被抽到的那一格里。
 *
 * I-4（已建实例不被改动）与 I-5（归档不挡存量实例化）是本 feature 唯一要防的两类反直觉实现：
 * · 把「发新版」写成会遍历、改写已有实例 —— 这是最省事但违反 I-4 的实现。
 * · 把「归档」写成会挡住 `instantiateForSegment` —— 这是最省事但违反 O-10 的实现，
 *   O-10 裁决存在的唯一原因就是防它：一场正在进行的工作坊切到该环节不能因为模板被归档而失败。
 */

const ALL_ACTIONS: readonly LifecycleAction[] = ["trial", "publish", "archive", "restore"];

describe("F101 · 模板发布状态机（草稿/试跑/发布/归档）", () => {
  describe("四态 × 四动作转移表（16 格全穷举，不抽样）", () => {
    const cases: ReadonlyArray<{
      readonly state: TemplateVersionState;
      readonly action: LifecycleAction;
      readonly expect: { readonly ok: true; readonly next: TemplateVersionState } | { readonly ok: false };
    }> = [
      // draft
      { state: { status: "draft" }, action: "trial", expect: { ok: true, next: { status: "trial" } } },
      { state: { status: "draft" }, action: "publish", expect: { ok: true, next: { status: "published" } } },
      {
        state: { status: "draft" },
        action: "archive",
        expect: { ok: true, next: { status: "archived", archivedFrom: "draft" } },
      },
      { state: { status: "draft" }, action: "restore", expect: { ok: false } },
      // trial
      { state: { status: "trial" }, action: "trial", expect: { ok: false } },
      { state: { status: "trial" }, action: "publish", expect: { ok: true, next: { status: "published" } } },
      {
        state: { status: "trial" },
        action: "archive",
        expect: { ok: true, next: { status: "archived", archivedFrom: "trial" } },
      },
      { state: { status: "trial" }, action: "restore", expect: { ok: false } },
      // published
      { state: { status: "published" }, action: "trial", expect: { ok: false } },
      { state: { status: "published" }, action: "publish", expect: { ok: false } },
      {
        state: { status: "published" },
        action: "archive",
        expect: { ok: true, next: { status: "archived", archivedFrom: "published" } },
      },
      { state: { status: "published" }, action: "restore", expect: { ok: false } },
      // archived, arrived at from each of the three predecessors
      { state: { status: "archived", archivedFrom: "draft" }, action: "trial", expect: { ok: false } },
      { state: { status: "archived", archivedFrom: "draft" }, action: "publish", expect: { ok: false } },
      { state: { status: "archived", archivedFrom: "draft" }, action: "archive", expect: { ok: false } },
      {
        state: { status: "archived", archivedFrom: "draft" },
        action: "restore",
        expect: { ok: true, next: { status: "draft" } },
      },
      {
        state: { status: "archived", archivedFrom: "trial" },
        action: "restore",
        expect: { ok: true, next: { status: "draft" } },
      },
      {
        state: { status: "archived", archivedFrom: "published" },
        action: "restore",
        expect: { ok: true, next: { status: "published" } },
      },
    ];

    for (const { state, action, expect: exp } of cases) {
      const label = `${state.status}${state.archivedFrom ? `(from ${state.archivedFrom})` : ""} + ${action}`;
      it(label, () => {
        const result = transition(state, action);
        expect(result.ok, `${label} 期望 ok=${exp.ok}，实得 ${JSON.stringify(result)}`).toBe(exp.ok);
        if (exp.ok && result.ok) {
          expect(result.next).toEqual(exp.next);
        }
      });
    }

    it("draft / trial / published 三个非归档态各自穷举了全部 4 个动作，一个不少", () => {
      // 防止表被悄悄删行：每个非归档态必须对全部 4 个动作都有一条 case，
      // 而不是只测了"看起来重要"的那几个。
      for (const status of ["draft", "trial", "published"] as const) {
        const actionsCovered = cases
          .filter((c) => c.state.status === status && c.state.archivedFrom === undefined)
          .map((c) => c.action)
          .sort();
        expect(actionsCovered, `${status} 覆盖的动作`).toEqual([...ALL_ACTIONS].sort());
      }
    });

    it("archived 态的三种前驱（draft/trial/published）都测过 restore 的落点", () => {
      const restoreCasesForArchived = cases.filter(
        (c) => c.state.status === "archived" && c.action === "restore",
      );
      const covered = restoreCasesForArchived.map((c) => c.state.archivedFrom).sort();
      expect(covered).toEqual(["draft", "published", "trial"]);
    });
  });

  describe("draft → published 不经过 trial 是合法转移（[待定 D-b] 本 feature 不含该阻断）", () => {
    it("draft 状态下 publish 直接成功，不要求先 trial", () => {
      const result = transition({ status: "draft" }, "publish");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.next.status).toBe("published");
    });
  });

  describe("publishNewVersion —— 发布新版本时旧版自动归档（I-4 前半）", () => {
    it("同一 key 的旧 published 版本被归档；新版本状态变 published", () => {
      const registry: TemplateVersionRecord[] = [
        { key: "swot", version: 1, status: "published" },
      ];
      const { updated, archived } = publishNewVersion(registry, "swot", 2);

      expect(archived).toEqual([{ key: "swot", version: 1, status: "archived" }]);
      expect(updated).toContainEqual({ key: "swot", version: 1, status: "archived" });
      expect(updated).toContainEqual({ key: "swot", version: 2, status: "published" });
    });

    it("不同 key 的版本不受影响", () => {
      const registry: TemplateVersionRecord[] = [
        { key: "swot", version: 1, status: "published" },
        { key: "pestel", version: 1, status: "published" },
      ];
      const { updated, archived } = publishNewVersion(registry, "swot", 2);

      expect(archived.map((r) => r.key)).toEqual(["swot"]);
      expect(updated).toContainEqual({ key: "pestel", version: 1, status: "published" });
    });

    it("已归档的旧版本不会被重复归档进 archived 列表（只归档 published 状态的版本）", () => {
      const registry: TemplateVersionRecord[] = [
        { key: "swot", version: 1, status: "archived" },
        { key: "swot", version: 2, status: "published" },
      ];
      const { updated, archived } = publishNewVersion(registry, "swot", 3);

      expect(archived).toEqual([{ key: "swot", version: 2, status: "archived" }]);
      expect(updated).toContainEqual({ key: "swot", version: 1, status: "archived" });
    });

    it("registry 里还没有这个版本号时会新增一行 published（首次发布）", () => {
      const { updated, archived } = publishNewVersion([], "brand-new", 1);
      expect(archived).toEqual([]);
      expect(updated).toEqual([{ key: "brand-new", version: 1, status: "published" }]);
    });
  });

  describe("已建画布实例记着自己用的版本，不被改动（I-4 后半）", () => {
    it("发布 v2 后重读 v1 建出的实例：结构不变、templateVersion 仍是 v1", () => {
      // 1) v1 published，据它建出一个实例
      let registry: TemplateVersionRecord[] = [{ key: "empathy", version: 1, status: "published" }];
      const instance = createInstance("inst-1", "empathy", 1);

      // 2) 发布 v2 —— 旧版按 I-4 前半自动归档
      const { updated } = publishNewVersion(registry, "empathy", 2);
      registry = [...updated];

      // 3) registry 侧确实变了（v1 → archived，v2 → published）
      expect(registry).toContainEqual({ key: "empathy", version: 1, status: "archived" });
      expect(registry).toContainEqual({ key: "empathy", version: 2, status: "published" });

      // 4) 但已建实例读回来仍然是 v1 —— 它从不重新查询 registry
      const ref = readFrozenTemplateRef(instance);
      expect(ref).toEqual({ templateKey: "empathy", templateVersion: 1 });
    });

    it("同一模板 key 建出的多个实例互不影响：各自冻结各自当时的版本", () => {
      const instanceAtV1 = createInstance("inst-a", "jtbd", 1);
      publishNewVersion([{ key: "jtbd", version: 1, status: "published" }], "jtbd", 2);
      const instanceAtV2 = createInstance("inst-b", "jtbd", 2);
      publishNewVersion(
        [
          { key: "jtbd", version: 1, status: "archived" },
          { key: "jtbd", version: 2, status: "published" },
        ],
        "jtbd",
        3,
      );

      expect(readFrozenTemplateRef(instanceAtV1)).toEqual({ templateKey: "jtbd", templateVersion: 1 });
      expect(readFrozenTemplateRef(instanceAtV2)).toEqual({ templateKey: "jtbd", templateVersion: 2 });
    });
  });

  describe("归档语义（O-10）：只挡新增绑定，不挡存量实例化（I-5）", () => {
    const allStatuses = C.TemplateStatus.options;

    it("canCreateNewBinding 仅在 published 时为 true —— draft/trial/archived 均不可新增绑定", () => {
      for (const status of allStatuses) {
        expect(canCreateNewBinding(status), `status=${status}`).toBe(status === "published");
      }
    });

    it("canInstantiateExistingBinding 对任何当前状态都为 true —— 归档绝不阻断存量绑定的现场实例化", () => {
      // 这是本 feature 最容易做反的一条：把归档实现成"归档即禁止实例化"会让一场正在进行的
      // 工作坊切到该环节时直接失败。逐一穷举全部状态，而不是只测 archived 一种。
      for (const status of allStatuses) {
        expect(canInstantiateExistingBinding(status), `status=${status}`).toBe(true);
      }
      expect(canInstantiateExistingBinding("archived")).toBe(true);
    });

    it("archived 模板：不能新增绑定，但存量绑定仍可实例化——两个判定同时成立且不互相依赖", () => {
      expect(canCreateNewBinding("archived")).toBe(false);
      expect(canInstantiateExistingBinding("archived")).toBe(true);
    });
  });

  describe("previewArchiveImpact —— 归档确认框的「有 N 个议程环节仍绑定此模板」", () => {
    it("stillBoundSegmentCount 是真实计数，返回 0 与不返回是两回事", () => {
      expect(previewArchiveImpact([]).stillBoundSegmentCount).toBe(0);
      expect(previewArchiveImpact(["seg-1", "seg-2", "seg-3"]).stillBoundSegmentCount).toBe(3);
    });

    it("返回对象里一定带有 stillBoundSegmentCount 这个字段（不是 undefined）", () => {
      const result = previewArchiveImpact(["seg-1"]);
      expect(result.stillBoundSegmentCount).not.toBeUndefined();
      expect(typeof result.stillBoundSegmentCount).toBe("number");
    });
  });
});
