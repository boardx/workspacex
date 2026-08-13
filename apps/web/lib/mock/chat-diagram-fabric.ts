/**
 * VZ-02 signoff 原型 mock —— AI 气泡内 ```mermaid 的 **fabric 渲染 + 最大化编辑 + 保存** 样本。
 *
 * ⚠ 纯前端 mock（签核第 ① 件材料），不接后端。`text` 就是后端将来下发的
 *   `msg.text: string`（markdown 源）。渲染链纯客户端（fabric 只在浏览器可用）。
 *
 * 复用 VZ-01 的 markdown 源文件（`chat-viz-md/*.md`，单一事实源，不另抄一份）：
 *   fabric —— 富文本 + 一张**白名单内**的 flowchart（fabric 只读渲染，可最大化编辑）
 *   error  —— 一段**越界图类型**（xychart-beta）+ 一段语法错的 flowchart（诚实错误态）
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage } from "./chat";

type AiMsg = Extract<ChatMessage, { kind: "ai" }>;

export const FABRIC_SCENES = ["fabric", "error"] as const;
export type FabricScene = (typeof FABRIC_SCENES)[number];

export function resolveFabricScene(raw?: string): FabricScene {
  return (FABRIC_SCENES as readonly string[]).includes(raw ?? "")
    ? (raw as FabricScene)
    : "fabric";
}

const MD_DIR = join(process.cwd(), "lib", "mock", "chat-viz-md");
const SCENE_FILE: Record<FabricScene, string> = {
  fabric: "flowchart.md",
  error: "error.md",
};

function bodyFor(scene: FabricScene): string {
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

export function fabricMessages(scene: FabricScene): AiMsg[] {
  return [{ ...base, id: `fab-${scene}`, text: bodyFor(scene) }];
}
