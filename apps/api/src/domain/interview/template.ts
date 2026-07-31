/**
 * 访谈模板 —— 领域纯函数。洋葱最内层：不知道 HTTP、不知道 PostgreSQL（uc-6-1）。
 *
 * ## 这里只有一件事：版本内容的哈希
 *
 * domain.md：「`TemplateVersion` 不可变（按 `artifact_versions` 同构管理，SHA-256）」。
 * 「同构」不是「同一张表」——模板版本装的是结构化的 JSON（分段/时长/数据字段），不是对象存储里
 * 的字节流，所以这里没有 `content-hash.ts` 那样的 `Uint8Array`；但「一段确定的规范化字节
 * 得到一个确定的 SHA-256，且任何一位改动都改哈希」是同一条不变量，值得用同一个哈希算法、
 * 同一种「先规范化再哈希」的做法，而不是另起一套。
 *
 * 复用 `domain/artifact/content-hash.ts` 的 `computeContentHash`（同一份 sha256 实现），
 * 不在这里再写一遍 `createHash("sha256")`——这条规则已经在这个仓库漂移过 5 次。
 */
import { computeContentHash } from "../artifact/content-hash";

export interface TemplateSectionInput {
  readonly name: string;
  readonly minutes: number;
  readonly order: number;
}

export interface TemplateFieldInput {
  readonly fieldId: string;
  readonly name: string;
  readonly kind: string;
  readonly required: boolean;
}

export interface TemplateVersionContent {
  readonly name: string;
  readonly goal: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
  readonly tags: readonly string[];
}

/**
 * 规范化 —— key 顺序固定、数组按声明顺序（`order`/位次本身是内容的一部分，不重排），
 * 保证同一份逻辑内容永远得到同一个哈希，与写入时字段顺序无关。
 */
function canonicalize(content: TemplateVersionContent): string {
  return JSON.stringify({
    name: content.name,
    goal: content.goal,
    sections: content.sections.map((s) => ({ name: s.name, minutes: s.minutes, order: s.order })),
    dataFields: content.dataFields.map((f) => ({
      fieldId: f.fieldId,
      name: f.name,
      kind: f.kind,
      required: f.required,
    })),
    tags: [...content.tags],
  });
}

/** 该版本内容的 SHA-256。任何一个字段（含 `order`）改动都会改这个值。 */
export function computeTemplateVersionHash(content: TemplateVersionContent): string {
  return computeContentHash(new TextEncoder().encode(canonicalize(content)));
}

/**
 * `usedCount` 是从 `interview_template_applications` 现查出来的整数。这个函数本身不碰
 * 数据库——它只是把「这是一个非负整数投影，不接受任何调用方给的数值」这条不变量钉在一个
 * 类型签名上：调用方传入的**永远是查询结果**，没有另一个入口能构造它。
 */
export type UsedCount = number & { readonly __brand: "TemplateUsedCount" };

export function toUsedCount(countedFromLedger: number): UsedCount {
  if (!Number.isInteger(countedFromLedger) || countedFromLedger < 0) {
    throw new Error(`usedCount must be a non-negative integer, got ${countedFromLedger}`);
  }
  return countedFromLedger as UsedCount;
}
