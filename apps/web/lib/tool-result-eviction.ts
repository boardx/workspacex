/**
 * deep-agent 内核（`deepagents` `FilesystemMiddleware`，配置见
 * `apps/deep-agent-service/src/deep_agent_service/harness.py` 的 `TOOL_RESULT_EVICT_TOKENS`）
 * 把超阈值的工具结果驱逐成沙箱文件 `/large_tool_results/<call_id>` 后，ToolMessage 正文被替换成
 * 一段**给模型看**的英文占位（"Tool result too large, the result of this tool call … was saved in
 * the filesystem at this path: /large_tool_results/… You can read the result from the filesystem
 * by using the read_file tool …" + 一段截断预览）。同一形状在 apps/api 侧的既有描述：
 * `infrastructure/agent-run/deep-agent-model-provider.ts` 的 `ThreadStateFileData`（`state.files`
 * 的键就是这个路径）与 `application/agent-run/agui-file-events.ts` 头注（"tool-result-eviction
 * scratch data never meant to be user-visible files"）。本文件是 apps/web 唯一的识别点——
 * 工具卡不要各自再写一份 `startsWith("Tool result too large")`。
 *
 * 2026-09-06 devapp 实测（人类反馈"这个结果看起来也挺奇怪的"）：`task` 子代理的汇报稍长就被
 * 驱逐，/chat 工具卡把这段英文搬运痕迹原样展示给用户。识别之后由渲染层改成一句中文 + 可折叠原文。
 */

/** 占位正文的固定开头（deepagents 0.7.6 实测，`test_harness.py::test_large_tool_result_evicted_to_file`）。 */
const EVICTED_PREFIX = "Tool result too large";
/** 沙箱路径：`call_id` 由内核生成，字符集按 langgraph/OpenAI 风格的 `call_xxx` 与 uuid 兜底。 */
const EVICTED_PATH_RE = /\/large_tool_results\/[A-Za-z0-9_.-]+/;

export interface EvictedToolResult {
  /** 沙箱内的完整结果路径，例如 `/large_tool_results/call_abc123`。 */
  readonly path: string;
  /** 内核原始占位正文（含预览），供"查看原文"折叠展示。 */
  readonly raw: string;
}

/**
 * 纯函数：`text` 是内核驱逐占位就返回路径与原文，否则 `null`。
 * 判据两条同时成立：去掉首部空白后以 `Tool result too large` 开头，且正文含 `/large_tool_results/<id>`。
 * 只满足其一（普通结果里恰好提到这个路径、或恰好以这句话开头却没有路径）都不当作驱逐——宁可漏判
 * 露出英文，也不把一条真实结果错标成"已存为文件"。
 */
export function parseEvictedToolResult(text: string | null | undefined): EvictedToolResult | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(EVICTED_PREFIX)) return null;
  const match = EVICTED_PATH_RE.exec(trimmed);
  if (match === null) return null;
  return { path: match[0], raw: text };
}

/** 给用户看的那一句——单一来源，工具卡与测试都引用它而不是各写一遍。 */
export function evictedToolResultNotice(path: string): string {
  return `结果较长，已存为文件 ${path}，agent 会按需读取`;
}
