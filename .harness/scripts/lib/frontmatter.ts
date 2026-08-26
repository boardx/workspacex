// frontmatter.ts — 最小 YAML frontmatter 解析器，从 design-signoff.ts 抽出
// （2026-08-26，spec-ref.ts 也要读 design-signoff.md 的 `status` 字段以支持
// `contracts/<bundle>#confirmed` 锚点——两处都要解析同一种文件，抽成共享模块，
// 避免「同一件事在两处各写一份解析逻辑」，也避免 spec-ref.ts ↔ design-signoff.ts
// 之间产生循环 import（design-signoff.ts 反过来要用 spec-ref.ts 的
// `hasRequirementsCoverage`）。
//
// 这些文件是人手写的，格式必然带毛边：值可能加引号、行尾常挂 `# 注释`、
// 列表可能写成 `[A, B]` 也可能写成多行 `- A`。解析器要能吃下这些，
// 但**不能**去猜语义——猜错的代价是门控静默放行。
import { existsSync, readFileSync } from "node:fs";

export type FrontmatterValue = string | string[];

/** 只解析首个 `---` 块。文件不存在或没有 frontmatter → null（与「空 frontmatter」区分开） */
export function parseFrontmatter(path: string): Record<string, FrontmatterValue> | null {
  if (!existsSync(path)) return null;
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, "utf8"))?.[1];
  if (block === undefined) return null;

  const out: Record<string, FrontmatterValue> = {};
  let lastKey: string | null = null;
  for (const raw of block.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && lastKey) {
      // 块状列表：`covers:` 下面挂 `- F01`
      const prev = out[lastKey];
      const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
      list.push(scalar(item[1]!));
      out[lastKey] = list;
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const key = kv[1]!;
    const rest = kv[2]!;
    lastKey = key;
    if (rest.trim() === "") {
      out[key] = []; // 等下面的块状列表来填；填不上就是空列表 = 声明了但没内容
      continue;
    }
    const inline = /^\[(.*)\]/.exec(rest.trim());
    out[key] = inline
      ? inline[1]!.split(",").map(scalar).filter((s) => s !== "")
      : scalar(rest);
  }
  return out;
}

/** 去行尾注释 → 去引号 → trim。⚠ 引号内的 `#` 不算注释 */
function scalar(raw: string): string {
  const s = raw.trim();
  const quoted = /^(["'])([\s\S]*?)\1/.exec(s);
  if (quoted) return quoted[2]!.trim();
  // ⚠ 整行只有注释 ⇒ 空值。`confirmed_by:            # 确认人（姓名/邮箱）` 这种模板占位
  //   此前会被解析成字符串 `"# 确认人（姓名/邮箱）"`——**非空**，于是
  //   「status 是 confirmed 但没有 confirmed_by ⇒ 签核必须记名」那条检查
  //   会被一个注释骗过去。下面那行 `\s+#` 要求 `#` 前有空白，而这里的 s 已 trim，
  //   `#` 落在行首就匹配不上。2026-07-30 phase-01 建九个束时抓到（九份模板全长这样）。
  if (s.startsWith("#")) return "";
  return s.replace(/\s+#.*$/, "").trim();
}

/** 原样取值（不 trim），用来检出 `confirmed_by: " yanbin shen"` 这类前导空格 */
export function frontmatterRawString(path: string, key: string): string | null {
  if (!existsSync(path)) return null;
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, "utf8"))?.[1] ?? "";
  const m = new RegExp(`^${key}\\s*:\\s*(.*)$`, "m").exec(block);
  if (!m) return null;
  const s = m[1]!.trim();
  const quoted = /^(["'])([\s\S]*?)\1/.exec(s);
  return quoted ? quoted[2]! : s.replace(/\s+#.*$/, "");
}

export function frontmatterString(fm: Record<string, FrontmatterValue> | null, key: string): string {
  const v = fm?.[key];
  return typeof v === "string" ? v : "";
}

export function frontmatterList(fm: Record<string, FrontmatterValue> | null, key: string): string[] | null {
  const v = fm?.[key];
  if (v === undefined) return null; // 没声明 ≠ 声明了空集
  return Array.isArray(v) ? v : [v];
}
