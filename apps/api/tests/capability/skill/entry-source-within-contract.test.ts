/**
 * #514 · **入口打出的来源必须能过契约出参**，否则在入口处 fail-closed。
 *
 * 缺陷形状：`assignSourceByEntry` 按 domain.md 打五档标（含 `画布` / `社区`），
 * 而 `createSkillDraft.out.source` 是三值 `SkillSource`。⇒ 走 `canvas` 入口创建成功的
 * skill，其返回体**过不了自己那条契约的出参校验**——用例说 ok，契约说非法。
 *
 * ## 为什么不是「把 `画布` 映射成 `自建`」
 *
 * 那是拿「能过」换「说谎」（coord-main 裁决）：映射之后，代码里再也看不出
 * 「画布沉淀出来的 skill 与后台手建的 skill 是同一件事吗」这个问题**从未被回答过**。
 * D09 登记的正是这个未裁问句（`source-tag.ts` 尾部）。
 *
 * ## 选 B（fail-closed）而不是 A（扩契约枚举）
 *
 * 扩枚举是**新契约面**，按 ADR-023 要人类补签；而且五档语义**没有人真正决定过**
 * （D09 的问句里「`画布` 来源是否真实存在」都还开着）。先扩再补签，等于把一个未裁的
 * 语义先固化成契约，再请人追认。fail-closed 把「未裁」**保持为可见的运行时拒绝**：
 * 谁真的要开画布入口，谁就会撞上这条拒绝并被迫去要那次签核。
 *
 * ⚠ 本文件的判据**从契约枚举推导**，不硬编码 `["canvas","community-import"]`：
 *   D09 一旦被人裁成五档，`outside` 自然收敛为空、这条门自然放开，
 *   不需要有人记得回来改这里；而新增一个映射到第六个取值的入口，会自动被它挡住。
 */
import { describe, expect, it } from "vitest";
import { skills as C } from "@repo/contracts";
import {
  SKILL_SOURCES,
  assignSourceByEntry,
  entrySourceWithinContract,
  type SkillCreationEntry,
} from "../../../src/domain/skill/source-tag";
import { createSkillDraft } from "../../../src/application/skill/create-skill-draft";
import { collectAudit, collectDraftStore, grantsOf, validContract } from "../../support/skill-fakes";

const ALL_ENTRIES: readonly SkillCreationEntry[] = [
  "admin-new",
  "admin-import",
  "builtin-cc",
  "canvas",
  "community-import",
  "promotion",
];

const base = {
  orgId: "o1",
  submitterId: "u1",
  name: "MECE 假设拆解",
  duty: "把议题拆成互斥且穷尽的分支",
  contract: validContract(),
  visibility: "org-wide",
  ownerTeamId: null,
  modelRef: "model-default",
} as const;

const deps = () => ({ grants: grantsOf("project:notes"), store: collectDraftStore(), audit: collectAudit() });

/** 契约侧合法取值（**唯一事实源是契约本身**，不在这里抄一份）。 */
const CONTRACT_SOURCES = C.SkillSource.options as readonly string[];

const inside = ALL_ENTRIES.filter((e) => CONTRACT_SOURCES.includes(assignSourceByEntry(e)));
const outside = ALL_ENTRIES.filter((e) => !CONTRACT_SOURCES.includes(assignSourceByEntry(e)));

describe("#514 前置：判据本身不是空转的", () => {
  it("划分覆盖全部入口，且两侧都非空（否则下面的循环是空断言）", () => {
    expect(inside.length + outside.length).toBe(ALL_ENTRIES.length);
    expect(inside.length).toBeGreaterThan(0);
    // outside 为空 ⇒ D09 已被裁成「契约含全部五档」。那时本门自然失效，
    // 这条断言会红，**这是要的**：它逼人回来确认那次裁决确实发生过，而不是悄悄漂移。
    expect(outside.length, "D09 若已裁决请连同本门一起复核").toBeGreaterThan(0);
  });

  it("正样本：合法入口的返回体**真的能过** out.strict（证明这条校验会绿，不是恒红）", async () => {
    const d = deps();
    const r = await createSkillDraft({ ...base, entry: "admin-new" }, d);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const parsed = C.operations.createSkillDraft.out.safeParse({
      skillId: r.skillId,
      versionId: r.versionId,
      source: r.source,
      status: r.status,
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

describe("#514 缺陷复现：契约外的来源不得被当成成功返回", () => {
  it.each(outside)("入口 %s 打出的来源不在契约枚举里（这就是缺陷的根）", (entry) => {
    const tag = assignSourceByEntry(entry);
    expect(SKILL_SOURCES).toContain(tag);
    expect(CONTRACT_SOURCES).not.toContain(tag);
  });

  it.each(outside)("入口 %s ⇒ 用例层 fail-closed，不入库，理由说得出「未裁」", async (entry) => {
    const d = deps();
    const r = await createSkillDraft({ ...base, entry }, d);

    // 修复前：`canvas` 这条是 ok: true（source: "画布"）⇒ 本断言红。
    expect(r.ok, `入口 ${entry} 不该成功返回一个契约外的 source`).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(d.store.saved).toEqual([]);
  });

  it("画布入口的拒绝理由必须指名 D09，而不是一句泛泛的不可用", async () => {
    const d = deps();
    const r = await createSkillDraft({ ...base, entry: "canvas" }, d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("D09");
    expect(r.reason).toContain("画布");
  });

  it("社区入口保留它更具体的 phase-2 理由（本门不得盖掉先到的那道门）", async () => {
    const d = deps();
    const r = await createSkillDraft({ ...base, entry: "community-import" }, d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("phase-2");
  });
});

describe("#514 全量：任何入口都不产出过不了契约的返回体", () => {
  it.each(ALL_ENTRIES)("入口 %s：要么被拒，要么返回体过 out.safeParse strict", async (entry) => {
    const d = deps();
    const r = await createSkillDraft({ ...base, entry }, d);
    if (!r.ok) {
      expect(d.store.saved).toEqual([]);
      return;
    }
    const parsed = C.operations.createSkillDraft.out.safeParse({
      skillId: r.skillId,
      versionId: r.versionId,
      source: r.source,
      status: r.status,
    });
    expect(parsed.success, `入口 ${entry} 的返回体过不了契约：${JSON.stringify(parsed.error?.issues)}`).toBe(
      true,
    );
  });
});

describe("#514 判定函数本身", () => {
  it("entrySourceWithinContract 与「契约枚举包含该取值」逐项一致", () => {
    for (const entry of ALL_ENTRIES) {
      expect(entrySourceWithinContract(entry), entry).toBe(
        CONTRACT_SOURCES.includes(assignSourceByEntry(entry)),
      );
    }
  });

  it("它不改写来源标记：assignSourceByEntry 仍按 domain.md 打五档", () => {
    expect(assignSourceByEntry("canvas")).toBe("画布");
    expect(assignSourceByEntry("community-import")).toBe("社区");
    expect(new Set(ALL_ENTRIES.map(assignSourceByEntry))).toEqual(new Set(SKILL_SOURCES));
  });
});
