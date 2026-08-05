/**
 * F61 · 来源标记由系统按入口自动打标，不可被提交人改写（I-11；UC-3.1 V10）。
 *
 * 为什么这条值得一整份测试：`source` 是后面一串判定的**依据**——
 * `CC` 不可删（I-13）、`晋升生成` 必须能追回那个被签字的决策（I-22）。
 * 一个提交人能填的字段，等于让提交人自己决定这些规则适不适用于自己。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMUNITY_ENTRY_ENABLED,
  D09_UNRESOLVED,
  SKILL_SOURCES,
  assignSourceByEntry,
  isCommunityEntryAvailable,
  rejectCallerSuppliedSource,
  rejectSourceRewrite,
  type SkillCreationEntry,
} from "../../../src/domain/skill/source-tag";
import { createSkillDraft } from "../../../src/application/skill/create-skill-draft";
import {
  collectAudit,
  collectDraftStore,
  grantsOf,
  validContract,
} from "../../support/skill-fakes";

const REPO = fileURLToPath(new URL("../../../../..", import.meta.url));

const base = {
  orgId: "o1",
  submitterId: "u1",
  name: "MECE 假设拆解",
  duty: "把议题拆成互斥且穷尽的分支",
  contract: validContract(),
  // #459：契约 `createSkillDraft.in` 里 `visibility` / `modelRef` 是必填的，
  // 而此前用例层把它们丢了（于是 `SkillListItem.visibility` 无处可取）。
  visibility: "org-wide",
  ownerTeamId: null,
  modelRef: "model-default",
} as const;

describe("按入口打标（I-11）", () => {
  it.each([
    ["admin-new", "自建"],
    ["admin-import", "自建"],
    ["builtin-cc", "CC"],
    ["canvas", "画布"],
    ["community-import", "社区"],
    ["promotion", "晋升生成"],
  ] as const)("入口 %s ⇒ 来源 %s", (entry, source) => {
    expect(assignSourceByEntry(entry)).toBe(source);
  });

  it("五个来源取值都有入口能产生（没有产生不出来的取值）", () => {
    const entries: readonly SkillCreationEntry[] = [
      "admin-new",
      "admin-import",
      "builtin-cc",
      "canvas",
      "community-import",
      "promotion",
    ];
    expect(new Set(entries.map(assignSourceByEntry))).toEqual(new Set(SKILL_SOURCES));
  });

  // ⚠ #514 改了取样入口：原来这里用 `canvas`，而 `canvas` 打出的 `画布` 过不了
  //   `createSkillDraft.out` 的三值枚举，已在用例层 fail-closed（见
  //   `entry-source-within-contract.test.ts`）。本条要证的是「落库的是系统打的标」，
  //   与用哪个入口取样无关，所以换成 `admin-import` —— 它同样是「入参里没有 source、
  //   而落库值由入口决定」的形状，且 `自建 ≠ admin-import` 使断言仍然有内容。
  it("落库时写进去的是系统打的标，不是调用方给的", async () => {
    const store = collectDraftStore();
    const r = await createSkillDraft(
      { ...base, entry: "admin-import" },
      { grants: grantsOf("project:notes"), store, audit: collectAudit() },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("自建");
    expect(store.saved[0]?.source).toBe("自建");
  });
});

describe("调用方写不进来（V10）", () => {
  it("原始请求体里带 `source` ⇒ SOURCE_TAG_IMMUTABLE", () => {
    const r = rejectCallerSuppliedSource({ name: "x", source: "CC" });
    expect(r.rejected).toBe(true);
    expect(r.code).toBe("SOURCE_TAG_IMMUTABLE");
    expect(r.reason).toContain("由系统按入口打标");
  });

  it("不带 ⇒ 放行（不过火）", () => {
    expect(rejectCallerSuppliedSource({ name: "x" }).rejected).toBe(false);
    expect(rejectCallerSuppliedSource(undefined).rejected).toBe(false);
  });

  it("`source: undefined` 也算带了 —— 它是一次写入尝试", () => {
    // 「有这个 key」和「这个 key 的值是什么」是两件事。只查真值会漏掉
    // `{ source: undefined }` 这种由前端表单序列化天然产生的形态。
    expect(rejectCallerSuppliedSource({ source: undefined }).rejected).toBe(true);
  });

  it("用例层拒绝携带 source 的提交，**不入库**且写安全审计", async () => {
    const store = collectDraftStore();
    const audit = collectAudit();
    const r = await createSkillDraft(
      { ...base, entry: "admin-new", rawBody: { name: base.name, source: "CC" } },
      { grants: grantsOf("project:notes"), store, audit },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SOURCE_TAG_IMMUTABLE");
    expect(store.saved).toEqual([]);
    expect(audit.events.map((e) => e.kind)).toContain("skill-source-tag-write-attempt");
  });

  it("改写既有来源（晋升生成 → 自建）恒拒，理由说得出为什么", () => {
    const r = rejectSourceRewrite("晋升生成", "自建");
    expect(r.rejected).toBe(true);
    expect(r.code).toBe("SOURCE_TAG_IMMUTABLE");
    expect(r.reason).toContain("内置不可删");
    // 写成同一个值不算改写：否则一次幂等重放会被判成攻击。
    expect(rejectSourceRewrite("自建", "自建").rejected).toBe(false);
  });
});

describe("社区导入 phase-1 置灰（D-06 / DECISION-Q0）", () => {
  it("取值保留，入口关闭", () => {
    expect(SKILL_SOURCES).toContain("社区");
    expect(COMMUNITY_ENTRY_ENABLED).toBe(false);
    expect(isCommunityEntryAvailable("community-import")).toBe(false);
    expect(isCommunityEntryAvailable("admin-new")).toBe(true);
  });

  it("服务端拒，不是前端隐藏——直调同样通不过", async () => {
    const store = collectDraftStore();
    const r = await createSkillDraft(
      { ...base, entry: "community-import" },
      { grants: grantsOf("project:notes"), store, audit: collectAudit() },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("phase-2");
    expect(store.saved).toEqual([]);
  });
});

describe("D09 仍未裁决（来源标记三档 vs 五档）", () => {
  it("契约侧是三值，agent 没有动它", () => {
    const src = readFileSync(join(REPO, "packages/contracts/src/skills.ts"), "utf8");
    expect(src).toContain('export const SkillSource = z.enum(["自建", "晋升生成", "CC"]);');
    expect(D09_UNRESOLVED.contractValues).toEqual(["自建", "晋升生成", "CC"]);
  });

  it("两侧不同 ⇒ 分歧必须仍在登记簿里", () => {
    expect(D09_UNRESOLVED.domainMdValues.length).not.toBe(D09_UNRESOLVED.contractValues.length);
    const ledger = readFileSync(join(REPO, D09_UNRESOLVED.ledger), "utf8");
    expect(ledger).toContain("D09:");
    expect(ledger).toContain("来源标记是三档还是五档");
  });
});
