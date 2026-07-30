/**
 * **静态契约校验**（F61；UC-3.1 R3 步骤 2、裁决 D-06）。
 *
 * D-06：phase-1 的 skill **＝ 声明式契约**（提示词模板 ＋ 输入输出 schema ＋ 数据范围），
 * **无沙箱、不执行任意代码**。所以本文件里没有、也不会有任何「加载入口」「运行脚本」
 * 「解压包体」的概念——`DECISION-Q0` 复核后仍逐字保留这条：外部社区导入 / 仓库导入 /
 * 落地检查六道关 / 沙箱试跑**全部在 phase-2**。
 *
 * UC-3.1 R3 步骤 2 把「静态契约校验」拆成**四条**，本文件实现前三条，第四条见 `data-scope.ts`：
 *   ① 必填字段齐全
 *   ② 输入输出 schema **可解析且自洽**
 *   ③ 声明了**失败兜底**（输出不符合 schema 时怎么办）
 *   ④ 数据范围声明不越出提交人自身权限 → `data-scope.ts`（失败码不同，故不合并）
 *
 * ⚠ 校验失败**逐条列出原因、不入库**（R3 步骤 2 末句 / usecases.md 失败表）。
 *   所以返回的是 `readonly ValidationIssue[]`，不是一个 boolean：
 *   一个只说「不合格」的校验器，界面上只能显示「不合格」。
 */
import { skills } from "@repo/contracts";
import type { z } from "zod";

/** 从契约派生，**不重写**：错误码是契约的一部分（ADR-020）。 */
export type SkillErrorCode = z.infer<typeof skills.SkillError>;

/** 三段契约的形状同样从契约派生。 */
export type DeclarativeContract = z.infer<typeof skills.DeclarativeContract>;

/**
 * 一条校验失败原因。
 *
 * `field` ＋ `detail` 而不是一句拼好的话：界面要按字段把红框打在对应输入上，
 * 拼好的整句只能塞进一个全局 toast。
 */
export interface ValidationIssue {
  readonly field: keyof DeclarativeContract;
  readonly rule: "required" | "unparsable" | "inconsistent";
  readonly detail: string;
}

export interface StaticValidationResult {
  readonly ok: boolean;
  /** 失败码。⚠ `ok` 为 true 时为 null——不给一个「成功的错误码」 */
  readonly code: SkillErrorCode | null;
  readonly issues: readonly ValidationIssue[];
}

/** 契约里 `.min(1)` 的四个字符串字段。缺任一 ⇒ 必填不齐。 */
const REQUIRED_TEXT_FIELDS = [
  "promptTemplate",
  "inputSchema",
  "outputSchema",
  "fallbackDeclaration",
] as const satisfies readonly (keyof DeclarativeContract)[];

/**
 * 「可解析」＝ 是一段合法 JSON，且顶层是对象。
 *
 * 不上完整的 JSON Schema 校验器：phase-1 要挡住的是「提交了一坨不是 schema 的东西」，
 * 而**能跑的最弱判据配一条会红的测试**，好过一个装了依赖却没人看结论的重型校验。
 * 判据本身写在这里，将来换实现时它是那份规格。
 */
function parseSchema(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * 「自洽」的三条判据。
 *
 * R3 只写了「可解析且自洽」四个字，没有定义自洽。这里把它定成三条**可断言**的规则，
 * 每一条都对应一种「解析得开、但 agent 运行时一定会炸」的 schema：
 *
 *   ① 没有 `type`：运行时不知道该按什么校验输出，`fallbackDeclaration` 会被无条件触发；
 *   ② `required` 里的字段不在 `properties` 里：这个约束永远不可能被满足；
 *   ③ `properties` 为空对象但 `type: "object"`：契约上「有结构」，实际没有任何字段可校验——
 *      它与「没写 schema」等价，而它会以「写了」的样子通过必填检查。
 *
 * ⚠ 三条都只看**声明本身**，不看数据、不发请求：这是静态校验，不是试跑。
 */
function selfConsistencyIssues(
  field: keyof DeclarativeContract,
  schema: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const type = schema["type"];
  if (typeof type !== "string" || type.length === 0) {
    issues.push({
      field,
      rule: "inconsistent",
      detail: "schema 缺少 `type`：运行时无从判定输出是否符合 schema，失败兜底会被无条件触发",
    });
  }

  const props = schema["properties"];
  const propKeys =
    typeof props === "object" && props !== null && !Array.isArray(props)
      ? Object.keys(props as Record<string, unknown>)
      : null;

  const required = schema["required"];
  if (Array.isArray(required)) {
    for (const r of required) {
      if (typeof r !== "string") continue;
      if (propKeys === null || !propKeys.includes(r)) {
        issues.push({
          field,
          rule: "inconsistent",
          detail: `required 声明了 \`${r}\`，但 properties 里没有它——这条约束永远不可能被满足`,
        });
      }
    }
  }

  if (type === "object" && propKeys !== null && propKeys.length === 0) {
    issues.push({
      field,
      rule: "inconsistent",
      detail: "type 为 object 但 properties 为空：与「没写 schema」等价，却会以「写了」的样子过必填检查",
    });
  }

  return issues;
}

/**
 * 跑静态契约校验。**纯函数**：同样的输入永远同样的结论，没有时钟、没有 IO。
 *
 * ⚠ 本函数**不做**数据范围越权检查。两者失败码不同
 * （`CONTRACT_VALIDATION_FAILED` vs `DATA_SCOPE_EXCEEDS_SUBMITTER`），
 * 而 usecases.md 的失败表要求两者在界面上是两种不同的处置
 * （前者「逐条列出原因」，后者「越权项逐条 ＋ 申请授权入口」）。
 * 合并成一个码会让「你写错了」和「你没这个权限」显示成同一件事。
 */
export function validateDeclarativeContract(
  contract: DeclarativeContract,
): StaticValidationResult {
  const issues: ValidationIssue[] = [];

  /* ① 必填齐全 —— 含 `fallbackDeclaration`，即 R3 的第 ③ 条。
     它和别的必填字段放在一起检查，是因为「没写失败兜底」在提交人眼里就是漏填了一格；
     单独拎出来只会让界面上多一个位置不同的错误。 */
  for (const f of REQUIRED_TEXT_FIELDS) {
    const v = contract[f];
    if (typeof v !== "string" || v.trim().length === 0) {
      issues.push({
        field: f,
        rule: "required",
        detail:
          f === "fallbackDeclaration"
            ? "未声明失败兜底：输出不符合 schema 时该怎么办没有答案（UC-3.1 R3 步骤 2）"
            : "必填项为空",
      });
    }
  }

  /* ② 输入输出 schema 可解析且自洽 */
  for (const f of ["inputSchema", "outputSchema"] as const) {
    const text = contract[f];
    if (typeof text !== "string" || text.trim().length === 0) continue; // 已由 ① 报过，不重复报
    const parsed = parseSchema(text);
    if (parsed === null) {
      issues.push({
        field: f,
        rule: "unparsable",
        detail: "不是可解析的 JSON 对象",
      });
      continue;
    }
    issues.push(...selfConsistencyIssues(f, parsed));
  }

  return issues.length === 0
    ? { ok: true, code: null, issues: [] }
    : { ok: false, code: "CONTRACT_VALIDATION_FAILED", issues };
}
