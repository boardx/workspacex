/**
 * F214（`agent-interrupts` 契约束）—— UC-2 `fillRunParams` 不变量 I-3：
 * 「AI 猜测的字段必有依据文案」，`domain.md` 五节逐字要求：
 * `aiGuess !== null` ⇒ `rationale !== null`。
 *
 * `schema.test.ts`（F212）已经对单个 `ParamField` 断言过这条 `.refine`；本文件是
 * F214 的独立机械判据，覆盖点不同：**整份 `fields` 数组**里任意一个字段违反 I-3，
 * 整个 `FillParamsArgs` 都必须被拒绝（不是"数组里有一个好字段就放行"），并且反过来
 * 覆盖 ui.md 屏二明确要求的两种合法形状——`aiGuess` 非 null 带依据、
 * `aiGuess === null` 的纯人工必填项不需要依据。
 */
import { describe, expect, it } from "vitest";
import { FillParamsArgs, ParamField } from "../../src/agent-interrupts";

const guessedField = (rationale: string | null) => ({
  name: "compare_baseline",
  label: "对比基准",
  aiGuess: "同比（YoY）",
  rationale,
  required: true,
  currentValue: "同比（YoY）",
});

const plainRequiredField = () => ({
  name: "cc_recipients",
  label: "抄送对象",
  aiGuess: null,
  rationale: null,
  required: true,
  currentValue: null,
});

describe("F214 UC-2 fillRunParams —— I-3：有猜测必有依据", () => {
  it("单字段：aiGuess 非 null 且 rationale 为 null → 拒绝", () => {
    expect(ParamField.safeParse(guessedField(null)).success).toBe(false);
  });

  it("单字段：aiGuess 非 null 且 rationale 非 null → 接受", () => {
    expect(ParamField.safeParse(guessedField("近 6 份月报都用同比口径。")).success).toBe(true);
  });

  it("单字段：aiGuess === null 时不要求 rationale（纯人工必填项，ui.md 屏二『无高亮』分支）", () => {
    expect(ParamField.safeParse(plainRequiredField()).success).toBe(true);
  });

  it("反空转：mock 场景里两类字段都真实存在——下面『数组级』断言才有意义", () => {
    expect(ParamField.safeParse(guessedField("有依据")).success).toBe(true);
    expect(ParamField.safeParse(plainRequiredField()).success).toBe(true);
  });

  it("数组级：多字段中只要有一个违反 I-3，整个 FillParamsArgs 被拒绝——不是「有一个好字段就放行」", () => {
    const result = FillParamsArgs.safeParse({
      requestId: "req-1",
      fields: [
        guessedField("有依据"), // 合法
        plainRequiredField(), // 合法（无需依据）
        guessedField(null), // 违反 I-3——单独这一条就该让整体报错
      ],
    });
    expect(result.success).toBe(false);
  });

  it("数组级：全部字段都合法 → FillParamsArgs 整体通过", () => {
    const result = FillParamsArgs.safeParse({
      requestId: "req-1",
      fields: [guessedField("有依据"), plainRequiredField()],
    });
    expect(result.success).toBe(true);
  });

  it("边界：rationale 为空字符串（非 null）仍算「有依据」——I-3 只检查 null 与否，不检查内容长度", () => {
    expect(ParamField.safeParse(guessedField("")).success).toBe(true);
  });
});
