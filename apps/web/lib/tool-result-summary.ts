/**
 * Phase 14 · 需求 2 —— 工具执行结果的结构化摘要（量化信息）的**前端展示格式化**。
 *
 * ⚠ 这是 UI 先行原型（ADR-023 签核第 ① 件材料）里的展示层格式化器，**不接后端**。
 *   需求 2 的协议扩展（给工具结果 payload 附一个可选 `summary` 字段）属于后端契约变更，
 *   本次 UI 原型不动 `@repo/contracts`——所以这里定义的 `ToolResultSummary` 是**前端侧的
 *   预期形状**，真正落地时由后端契约提供同名字段，这份类型会被契约推导替换掉。
 *
 * 形状照需求原文：`summary: { rows?: number; bytes?: number; hits?: number }`——三者皆可选，
 * 没有摘要的工具类型不强制填。任一缺失就不产出对应 chip；三者全缺（或 summary 本身缺失）
 * 时 `formatToolResultQuantities` 返回空数组，调用方据此**优雅回退**到现有纯文字描述，
 * 绝不因字段缺失报错或留白。
 */

export interface ToolResultSummary {
  /** 读取/扫描的行数（读文件、查表类工具）。 */
  readonly rows?: number;
  /** 读取的字节数（用于换算人读体量 KB/MB）。 */
  readonly bytes?: number;
  /** 命中/匹配条数（检索类工具）。 */
  readonly hits?: number;
}

/** 千分位分组，避免「41208」这种一眼数不清的裸数字。 */
function groupThousands(n: number): string {
  return n.toLocaleString("en-US");
}

/** 字节数 → 人读体量（B / KB / MB / GB），保留一位小数。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/**
 * 把结构化摘要拍平成一组量化 chip 文案（如 `["41,208 行", "8.4 MB", "命中 12 条"]`）。
 * 任一字段缺失/非有限数就跳过；全缺则返回 `[]`——调用方据此回退到纯文字。
 */
export function formatToolResultQuantities(summary: ToolResultSummary | null | undefined): string[] {
  if (summary === null || summary === undefined) return [];
  const chips: string[] = [];
  if (typeof summary.rows === "number" && Number.isFinite(summary.rows)) {
    chips.push(`${groupThousands(summary.rows)} 行`);
  }
  if (typeof summary.bytes === "number" && Number.isFinite(summary.bytes)) {
    chips.push(formatBytes(summary.bytes));
  }
  if (typeof summary.hits === "number" && Number.isFinite(summary.hits)) {
    chips.push(`命中 ${groupThousands(summary.hits)} 条`);
  }
  return chips;
}

/** 是否存在可展示的量化信息（无则调用方走回退分支）。 */
export function hasToolResultQuantities(summary: ToolResultSummary | null | undefined): boolean {
  return formatToolResultQuantities(summary).length > 0;
}
