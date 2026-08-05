/**
 * F61 · 静态契约校验（UC-3.1 R3 步骤 2；裁决 D-06）。
 *
 * R3 步骤 2 逐字四条：「必填字段齐全、输入输出 schema **可解析且自洽**、
 * 数据范围声明不越出提交人自身权限、是否声明了失败兜底」，
 * 「校验失败列出**逐条**原因，**不入库**」。
 *
 * 第三条（越权）在 `scope-not-exceed-submitter.test.ts`：它的失败码不同，
 * 界面上的处置也不同（那边要给「申请授权」入口）。
 */
import { describe, expect, it } from "vitest";
import { validateDeclarativeContract } from "../../../src/domain/skill/declarative-contract";
import { createSkillDraft } from "../../../src/application/skill/create-skill-draft";
import {
  collectAudit,
  collectDraftStore,
  grantsOf,
  validContract,
} from "../../support/skill-fakes";

describe("① 必填齐全", () => {
  it("一份完整契约通过（不过火：校验器不能恒拒）", () => {
    const r = validateDeclarativeContract(validContract());
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
    expect(r.code).toBeNull();
    expect(r.issues).toEqual([]);
  });

  it.each([
    ["promptTemplate", "提示词模板"],
    ["inputSchema", "输入 schema"],
    ["outputSchema", "输出 schema"],
    ["fallbackDeclaration", "失败兜底声明"],
  ] as const)("缺 %s（%s）⇒ CONTRACT_VALIDATION_FAILED", (field, _label) => {
    const r = validateDeclarativeContract(validContract({ [field]: "" }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe("CONTRACT_VALIDATION_FAILED");
    expect(r.issues.some((i) => i.field === field && i.rule === "required")).toBe(true);
  });

  it("只有空白也算缺（`\"   \"` 不是一份提示词模板）", () => {
    const r = validateDeclarativeContract(validContract({ promptTemplate: "   " }));
    expect(r.ok).toBe(false);
  });

  it("D-06 的第三段：没写失败兜底 ⇒ 拒，且理由说得出「怎么办没有答案」", () => {
    const r = validateDeclarativeContract(validContract({ fallbackDeclaration: "" }));
    const issue = r.issues.find((i) => i.field === "fallbackDeclaration");
    expect(issue?.detail).toContain("失败兜底");
  });
});

describe("② schema 可解析且自洽", () => {
  it("不是 JSON ⇒ unparsable", () => {
    const r = validateDeclarativeContract(validContract({ inputSchema: "这不是 JSON" }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "inputSchema" && i.rule === "unparsable")).toBe(true);
  });

  it("是 JSON 但不是对象（数组 / 字符串 / 数字）⇒ unparsable", () => {
    for (const bad of ["[1,2]", '"x"', "42", "null"]) {
      const r = validateDeclarativeContract(validContract({ outputSchema: bad }));
      expect(r.ok, `${bad} 不该通过`).toBe(false);
    }
  });

  it("自洽判据 a：缺 `type` ⇒ inconsistent", () => {
    const r = validateDeclarativeContract(
      validContract({ inputSchema: '{"properties":{"a":{"type":"string"}}}' }),
    );
    expect(r.issues.some((i) => i.rule === "inconsistent" && i.detail.includes("type"))).toBe(true);
  });

  it("自洽判据 b：`required` 指向 properties 里没有的字段 ⇒ inconsistent", () => {
    const r = validateDeclarativeContract(
      validContract({
        inputSchema: '{"type":"object","properties":{"a":{"type":"string"}},"required":["b"]}',
      }),
    );
    expect(r.ok).toBe(false);
    const detail = r.issues.find((i) => i.rule === "inconsistent")?.detail ?? "";
    // 「永远不可能被满足」是这条判据存在的理由，写进原因里而不是只给一个码。
    expect(detail).toContain("永远不可能被满足");
  });

  it("自洽判据 c：`type: object` 但 properties 为空 ⇒ inconsistent", () => {
    const r = validateDeclarativeContract(
      validContract({ outputSchema: '{"type":"object","properties":{}}' }),
    );
    expect(r.ok).toBe(false);
  });

  it("逐条列出：一份三处都错的契约给回三条以上原因，不是一句「校验失败」", () => {
    const r = validateDeclarativeContract(
      validContract({
        promptTemplate: "",
        inputSchema: "{",
        outputSchema: '{"properties":{"a":{}},"required":["z"]}',
      }),
    );
    expect(r.issues.length).toBeGreaterThanOrEqual(3);
    expect(new Set(r.issues.map((i) => i.field))).toEqual(
      new Set(["promptTemplate", "inputSchema", "outputSchema"]),
    );
  });
});

describe("③ 校验失败 ⇒ 不入库（行为，不是文案）", () => {
  it("静态校验失败时 saveDraft 一次都没被调用", async () => {
    const store = collectDraftStore();
    const r = await createSkillDraft(
      {
        orgId: "o1",
        submitterId: "u1",
        name: "MECE 假设拆解",
        duty: "把议题拆成互斥且穷尽的分支",
        contract: validContract({ fallbackDeclaration: "" }),
        entry: "admin-new",
        // #459：契约 `createSkillDraft.in` 必填，此前用例层把它们丢了。
        visibility: "org-wide",
        ownerTeamId: null,
        modelRef: "model-default",
      },
      { grants: grantsOf("project:notes"), store, audit: collectAudit() },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CONTRACT_VALIDATION_FAILED");
    // 断言返回码证明不了「不入库」：一个写进去了再标失败的实现，返回码一模一样。
    expect(store.saved, "校验失败却入了库").toEqual([]);
    expect(r.enteredReviewQueue).toBe(false);
  });

  it("校验通过 ⇒ 落草稿（不过火：成功路径必须真的写进去）", async () => {
    const store = collectDraftStore();
    const r = await createSkillDraft(
      {
        orgId: "o1",
        submitterId: "u1",
        name: "MECE 假设拆解",
        duty: "把议题拆成互斥且穷尽的分支",
        contract: validContract(),
        entry: "admin-new",
        // #459：契约 `createSkillDraft.in` 必填，此前用例层把它们丢了。
        visibility: "org-wide",
        ownerTeamId: null,
        modelRef: "model-default",
      },
      { grants: grantsOf("project:notes"), store, audit: collectAudit() },
    );

    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("草稿");
    expect(store.saved).toHaveLength(1);
  });
});

describe("D-06：phase-1 无沙箱，契约里没有「代码」这一段", () => {
  it("三段契约恰是 提示词模板 / 输入输出 schema / 数据范围（＋失败兜底）", () => {
    // 有 `code` / `entrypoint` / `runtime` 字段时 TypeScript 会先红；
    // 这条断言守的是另一半：字段没多出来，且 D-06 的三段一个不少。
    const keys = Object.keys(validContract()).sort();
    expect(keys).toEqual(
      [
        "dataScope",
        "fallbackDeclaration",
        "inputSchema",
        "outputSchema",
        "promptTemplate",
        "readsRawTranscript",
      ].sort(),
    );
  });
});
