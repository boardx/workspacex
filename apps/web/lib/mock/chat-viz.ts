/**
 * VZ-01 signoff 原型 mock —— AI 气泡内 markdown + ```mermaid 渲染的三态样本。
 *
 * ⚠ 纯前端 mock（签核第 ① 件材料），不接后端。`text` 就是后端将来会下发的
 *   `msg.text: string`（markdown 源）。
 *
 * 为什么 markdown 正文放在 `chat-viz-md/*.md` 而不是内联在本文件：
 *   markdown 源天然含 `**加粗**`、``` 代码围栏等字面量，若内联进 `.ts`，会被
 *   `scripts/lint-design.sh` 的「MD 残留」规则误报（该规则只扫 .ts/.tsx，正是为了
 *   拦 JSX 文本里手滑留下的 `**`）。把真·markdown 放进真·`.md` 文件，既让 lint
 *   规则继续保护 JSX，又不必给它开洞。文件在服务端（本模块只被 server component
 *   `app/preview/chat-viz/page.tsx` 引用）用 fs 读入。
 *
 * 三态（scene）：
 *   markdown —— 富 markdown：标题 / 有序+无序列表 / 加粗 / 行内码 / 代码块 / 链接 / GFM 表格
 *   mermaid  —— 一段富文本 + 一张**白名单内**的 flowchart（正常渲染）
 *   error    —— 一段富文本 + 一段**越界图类型**（xychart-beta）+ 一段语法错的 flowchart
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage } from "./chat";

type AiMsg = Extract<ChatMessage, { kind: "ai" }>;

export const VIZ_SCENES = ["markdown", "mermaid", "error"] as const;
export type VizScene = (typeof VIZ_SCENES)[number];

export function resolveVizScene(raw?: string): VizScene {
  return (VIZ_SCENES as readonly string[]).includes(raw ?? "")
    ? (raw as VizScene)
    : "markdown";
}

const MD_DIR = join(process.cwd(), "lib", "mock", "chat-viz-md");
const SCENE_FILE: Record<VizScene, string> = {
  markdown: "markdown.md",
  mermaid: "flowchart.md",
  error: "error.md",
};

function bodyFor(scene: VizScene): string {
  return readFileSync(join(MD_DIR, SCENE_FILE[scene]), "utf8");
}

const base: Omit<AiMsg, "id" | "text"> = {
  kind: "ai",
  agentId: "scout",
  agentName: "Scout",
  agentRole: "调研 agent",
  initials: "Sc",
  skill: "market-entry-analysis",
  thinking: "思考了 6.4 秒 · 5 步",
  time: "14:12",
  badges: [],
};

export function vizMessages(scene: VizScene): AiMsg[] {
  return [{ ...base, id: `viz-${scene}`, text: bodyFor(scene) }];
}
