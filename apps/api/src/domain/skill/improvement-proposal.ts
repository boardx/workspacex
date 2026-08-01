/**
 * 改进提案 diff（F68；UC-3.6 R3 阶段三步骤 5/6，E3）。
 *
 * 纯函数：给定 `vN` 现行契约与提议的 `vN+1` 契约，算出**逐字段 diff**与
 * **是否破坏输入输出 schema 兼容性**。不知道版本链怎么落库、不知道谁在审——
 * 那些是 `application/skill/generate-improvement-proposal.ts` 的事。
 */
import type { DeclarativeContract } from "./declarative-contract";

export interface ProposalDiffEntry {
  readonly field: keyof DeclarativeContract;
  readonly before: string;
  readonly after: string;
}

function stringifyField(v: DeclarativeContract[keyof DeclarativeContract]): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** 逐字段对比，只收不相等的字段——没变的字段不出现在 diff 里。 */
export function diffContract(
  before: DeclarativeContract,
  after: DeclarativeContract,
): readonly ProposalDiffEntry[] {
  const fields = Object.keys(before) as (keyof DeclarativeContract)[];
  const entries: ProposalDiffEntry[] = [];
  for (const field of fields) {
    const b = stringifyField(before[field]);
    const a = stringifyField(after[field]);
    if (b !== a) entries.push({ field, before: b, after: a });
  }
  return entries;
}

function requiredFieldsOf(schemaText: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(schemaText);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "required" in parsed &&
      Array.isArray((parsed as { required: unknown }).required)
    ) {
      return (parsed as { required: unknown[] }).required.filter(
        (x): x is string => typeof x === "string",
      );
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * E3：破坏兼容性的判据——`vN+1` 的 `outputSchema` **丢掉了** `vN` 曾经必填的字段。
 * ⚠ 只判「丢字段」这一个方向：新增必填输出字段不破坏**读**这份输出的下游
 *   （下游本就没读过它），这与「移除下游可能正在读的字段」不是同一件事。
 */
export function isSchemaBreaking(before: DeclarativeContract, after: DeclarativeContract): boolean {
  const beforeRequired = requiredFieldsOf(before.outputSchema);
  const afterRequired = new Set(requiredFieldsOf(after.outputSchema));
  return beforeRequired.some((f) => !afterRequired.has(f));
}
