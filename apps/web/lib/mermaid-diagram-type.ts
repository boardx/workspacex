/**
 * 从 ```mermaid 围栏的**首个非空 token** 推断图类型，并对齐 `@repo/contracts` 的
 * `MermaidDiagramType` 白名单（12 种，唯一事实源）。
 *
 * ⚠ 单源纪律（CLAUDE.md）：api 侧 `detectDiagramType` 的「首行 → 类型」正则住在
 *   `apps/api/src/domain/canvas/mermaid-whitelist.ts`，web **不能** import apps/api，
 *   也**不复制那份正则**。这里只做最小推断——取围栏正文第一个非空 token，再拿
 *   `MermaidDiagramType` 枚举校验。枚举本身就是白名单单源；若将来需要更丰富的
 *   识别（含别名/参数解析），应把它沉进一个 web 与 api 共享的包，而不是在此复制。
 */
import { canvas } from "@repo/contracts";

const WHITELIST: readonly string[] = canvas.MermaidDiagramType.options;

/** 一些围栏首 token 与枚举名的最小别名（mermaid 语法名 → 契约枚举名）。 */
const TOKEN_ALIAS: Record<string, string> = {
  graph: "flowchart", // `graph TD` 是 flowchart 的经典写法
  flowchart: "flowchart",
  statediagram: "stateDiagram",
  "statediagram-v2": "stateDiagram",
};

export interface DiagramTypeResult {
  /** 围栏正文里探到的原始首 token（原样，未规整），用于诚实展示。 */
  rawToken: string;
  /** 命中白名单时的契约枚举值；未命中为 null。 */
  type: string | null;
  /** 是否在白名单内。 */
  inWhitelist: boolean;
}

/** 取正文第一个非空、非注释行的第一个 token。 */
function firstToken(code: string): string {
  const line = code
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("%%"));
  if (!line) return "";
  // 首 token = 到第一个空白/冒号/分号前的片段（`sequenceDiagram`、`graph TD`、`gantt` 都成立）
  return line.split(/[\s:;]/)[0] ?? "";
}

/**
 * 推断图类型并对齐白名单。大小写不敏感匹配枚举，命中则回填**规范枚举值**。
 */
export function resolveDiagramType(code: string): DiagramTypeResult {
  const rawToken = firstToken(code);
  const lower = rawToken.toLowerCase();
  const aliased = TOKEN_ALIAS[lower];
  const candidate = aliased ?? WHITELIST.find((t) => t.toLowerCase() === lower) ?? null;
  const inWhitelist = candidate != null && WHITELIST.includes(candidate);
  return {
    rawToken,
    type: inWhitelist ? candidate : null,
    inWhitelist,
  };
}
