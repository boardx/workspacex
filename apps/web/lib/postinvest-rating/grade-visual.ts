/**
 * colorToken → CSS 语义 token 的**呈现解析**（不是等级→颜色的业务映射表）。
 *
 * R8 `rating-result-card` 规定：颜色 token 从 skill 包读取，前端不另写一份「等级→颜色」映射。
 * 因此本文件不认识 A–E，也不认识分数区间——它只把 `gradeMeta.colorToken`（由 API 从 skill 包
 * 带回的 token 名，如 `rating.grade.b`）解析成本设计系统里的语义色类。这是 token 解析层，
 * 等价于 tailwind 把 `--primary` 解析成实际色值，不构成第二份评级事实源。
 *
 * ⚠ 已知缺口：设计 token 单源（app/globals.css）暂无 `rating.grade.*` 专用色阶，也无独立的
 *   「深红」token。这里先复用最接近的既有语义色（success/ai/warning/destructive）占位，E 档与
 *   D 档目前共用 destructive——待人类签核时决定是否新增 rating 专用色阶（见 ui.md 缺口）。
 */
export type GradeVisual = {
  /** 结论卡左侧色条 / 等级大字底色。 */
  readonly barClass: string;
  /** 等级徽标底色。 */
  readonly chipClass: string;
  /** 人类可读的色名（占位期用于让签核者看到「本应是什么颜色」）。 */
  readonly colorName: string;
};

const FALLBACK: GradeVisual = { barClass: "bg-muted", chipClass: "bg-muted text-muted-foreground", colorName: "未知" };

const TOKEN_VISUAL: Readonly<Record<string, GradeVisual>> = {
  "rating.grade.a": { barClass: "bg-success", chipClass: "bg-success text-success-foreground", colorName: "绿" },
  "rating.grade.b": { barClass: "bg-ai", chipClass: "bg-ai-tint text-ai-tint-foreground", colorName: "蓝" },
  "rating.grade.c": { barClass: "bg-warning", chipClass: "bg-warning text-warning-foreground", colorName: "橙" },
  "rating.grade.d": { barClass: "bg-destructive", chipClass: "bg-destructive text-destructive-foreground", colorName: "红" },
  "rating.grade.e": { barClass: "bg-destructive", chipClass: "bg-destructive text-destructive-foreground", colorName: "深红" },
};

export function resolveGradeVisual(colorToken: string | null | undefined): GradeVisual {
  if (!colorToken) return FALLBACK;
  return TOKEN_VISUAL[colorToken] ?? FALLBACK;
}
