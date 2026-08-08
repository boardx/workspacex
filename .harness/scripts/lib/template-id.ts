/**
 * template-id.ts —— HMV2-009，原子 Template ID 分配器。
 *
 * 复用 `adr-id.ts` 已经验证过的模式（ADR-020 收口 #778/#730 的真实撞号事故）：
 * **不是运行时锁，是"占号即登记，让后到的人在合并时撞见冲突"**。
 *
 *   · 权威载体是 `.harness/templates/registry.yaml` 本身——取号的同一次运行
 *     把新 entry 写回文件；
 *   · 两个并发分支各自取号、各自写回同一个文件的同一个位置，第二个 merge/rebase
 *     时 git 会给出文本冲突，不会静默各自为政；
 *   · 因此这里的"原子性"不是数据库事务，是"权威载体唯一 + 冲突可见"。
 *
 * 域码（`REQ`/`FTR`/…）当前是一个开放集合——新增一个从未出现过的域码是合法操作
 * （允许拓展模板目录），流水号在**该域码内部**从 1 起严格递增。
 */
import { TEMPLATE_ID_RE, type TemplateRegistryEntry } from "./template-model";

/** 拆出 `TPL-REQ-003` 的域码与流水号；不匹配格式返回 null。 */
export function parseTemplateId(id: string): { domain: string; number: number } | null {
  const m = TEMPLATE_ID_RE.exec(id.trim());
  if (!m) return null;
  return { domain: m[1]!, number: Number.parseInt(m[2]!, 10) };
}

/**
 * 给定域码与现有全部 template_id，取该域码内的下一个号。
 * 全新域码（现有条目里从未出现过）从 001 起。
 */
export function nextTemplateId(domain: string, existingIds: readonly string[]): string {
  if (!/^[A-Z]{3}$/.test(domain)) {
    throw new Error(`域码必须是三位大写字母，实得 "${domain}"`);
  }
  let max = 0;
  for (const id of existingIds) {
    const parsed = parseTemplateId(id);
    if (parsed && parsed.domain === domain && parsed.number > max) max = parsed.number;
  }
  return `TPL-${domain}-${String(max + 1).padStart(3, "0")}`;
}

/** 显式指定 id 时的冲突检测（对应 `new-adr.ts --id` 那条路径）。 */
export function findTemplateIdConflict(id: string, existingEntries: readonly TemplateRegistryEntry[]): string | null {
  const hit = existingEntries.find((e) => e.template_id === id);
  if (!hit) return null;
  return `registry.yaml 已有 "${id}" 的条目（name=${hit.name}, status=${hit.status}）`;
}
