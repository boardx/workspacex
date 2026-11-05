import { translate, type MessageKey } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * 工具的**用户可读名 + 这次调用做了什么**——**唯一**一份映射。
 *
 * 出处是 `copilotkit-v2-tool-renderers.tsx`（issue #2075 / TW-COPY-1），连同它当年
 * 写下的那条纪律一起搬到这里：
 *
 * ⚠ 未知工具**照旧回退到原始名**，不编一个好听的假名字：一个没人给过中文名的工具，
 *   印它的真名总比印一句我们瞎猜的描述诚实。真名同时留在 `title` 上（悬停可见），
 *   排障时不丢信息。
 *
 * ## 为什么搬出来（issue #3316 ②-c）
 * 「唯一一份」当时只在卡片那一层成立。折叠行（`run-trace-panel.tsx` 的 `eventLabel`）
 * 另建了**第二份**：四个工具各给一句动词短语（检索资料 / 派发后台任务 / 更新执行计划 /
 * 执行生成脚本），**其余一律落进「执行工具操作」这句通用话，工具名当场丢掉**。
 * 于是人类跑 pptx 生成时，轨迹里是一串「已执行工具操作」——事件里明明带着 `toolName`，
 * 展开一层也看得到，就是折叠行不说。这不是「没有产出」也不是「没投递到前端」，
 * 是展示层把已经拿到的事实抹平了。
 *
 * 现在两处读同一张表，新加一个工具只需要在这里加一行。
 *
 * ## 2026-09-16：这张表**太短**，用户看到的是 `read_file`（人类实测截图）
 *
 * 表里只有 7 个工具名，而这个部署真正会调的是 `native-invocation.ts` 的
 * `NATIVE_PROFILE_TOOLS`（40+ 个）。落表外的那些走「回退到真名」那条诚实的路，于是
 * 非技术用户屏幕上是一串 `read_file` ✓ —— 对他们而言与一串乱码等价。诚实的回退没有错，
 * 错的是**表没跟上**：这次把真的会出现在用户面前的工具一次补齐（下表按能力域分组），
 * 回退纪律一个字没改。
 *
 * 同时补第二件事实：光有名字还是「读取文件」七行一模一样——**读的是哪个文件**在
 * `args` 里躺着，此前只以 JSON 原文出现在展开层。`toolObject` 把它抽成一句人话
 * （`page-06.png`），给折叠行和工具卡**共用**——又一次「同一事实只声明一处」。
 */
const TOOL_LABEL_KEYS: Record<string, MessageKey> = {
  write_todos: "chatTools.name.write_todos",
  task: "chatTools.name.task",
  spawn_async_task: "chatTools.name.spawn_async_task",
  wx_run_status: "chatTools.name.wx_run_status",
  wx_run_cancel: "chatTools.name.wx_run_cancel",
  ls: "chatTools.name.ls",
  read_file: "chatTools.name.read_file",
  write_file: "chatTools.name.write_file",
  edit_file: "chatTools.name.edit_file",
  delete: "chatTools.name.delete",
  glob: "chatTools.name.glob",
  grep: "chatTools.name.grep",
  execute: "chatTools.name.execute",
  run_script: "chatTools.name.run_script",
  search_documents: "chatTools.name.search_documents",
  read_document: "chatTools.name.read_document",
  web_search: "chatTools.name.web_search",
  fetch_url: "chatTools.name.fetch_url",
  wx_document_parse: "chatTools.name.wx_document_parse",
  wx_knowledge_search: "chatTools.name.wx_knowledge_search",
  wx_knowledge_read: "chatTools.name.wx_knowledge_read",
  wx_cite: "chatTools.name.wx_cite",
  wx_remember: "chatTools.name.wx_remember",
  wx_memory_search: "chatTools.name.wx_memory_search",
  wx_memory_write: "chatTools.name.wx_memory_write",
  wx_memory_delete: "chatTools.name.wx_memory_delete",
  wx_project_list: "chatTools.name.wx_project_list",
  wx_project_read: "chatTools.name.wx_project_read",
  wx_artifact_publish: "chatTools.name.wx_artifact_publish",
  wx_artifact_download: "chatTools.name.wx_artifact_download",
  wx_canvas_read: "chatTools.name.wx_canvas_read",
  wx_canvas_update: "chatTools.name.wx_canvas_update",
  wx_image_generate: "chatTools.name.wx_image_generate",
  wx_audio_transcribe: "chatTools.name.wx_audio_transcribe",
  wx_skill_create_draft: "chatTools.name.wx_skill_create_draft",
  wx_schedule_create: "chatTools.name.wx_schedule_create",
  wx_schedule_list: "chatTools.name.wx_schedule_list",
  wx_schedule_cancel: "chatTools.name.wx_schedule_cancel",
  start_workflow: "chatTools.name.start_workflow",
  request_handoff: "chatTools.name.request_handoff",
  sql_db_list_tables: "chatTools.name.sql_db_list_tables",
  sql_db_schema: "chatTools.name.sql_db_schema",
  sql_db_query_checker: "chatTools.name.sql_db_query_checker",
  sql_db_query: "chatTools.name.sql_db_query",
  browser_navigate: "chatTools.name.browser_navigate",
  browser_snapshot: "chatTools.name.browser_snapshot",
  browser_click: "chatTools.name.browser_click",
  browser_fill_form: "chatTools.name.browser_fill_form",
  browser_take_screenshot: "chatTools.name.browser_take_screenshot",
  lookup_time: "chatTools.name.lookup_time",
  send_email: "chatTools.name.send_email",
};
/** Legacy Chinese projection; the authored tool-name dictionary remains single-source. */
export const TOOL_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_LABEL_KEYS).map(([name, key]) => [name, translate("zh-CN", key)]),
);

export function toolLabel(name: string, locale: Locale = "zh-CN"): string {
  const key = Object.hasOwn(TOOL_LABEL_KEYS, name) ? TOOL_LABEL_KEYS[name] : undefined;
  return key === undefined ? name : translate(locale, key);
}

/**
 * **这次调用的对象**——「读取文件」后面那半句（`page-06.png`）。
 *
 * 只从 `args` 里挑**用户认得出的那一个字段**，不是把参数序列化一遍：整段 JSON 在展开层
 * 里还在（技术细节），这里要的是一行能让人认出「哦，它在读那张第 6 页的图」的短语。
 *
 * 三条纪律：
 *   · **路径只取文件名**。`/workspace/preview-xlsx-review/page-06.png` 里对用户有意义的
 *     只有 `page-06.png`；前面那截是沙箱的内部布局，印出来既占一行又没人看得懂。
 *   · **认不出就返回 `null`**，由调用方决定退回什么——不编。同 `toolLabel` 的回退纪律：
 *     一个我们没读懂的参数，宁可不说，也不要说一句像模像样的错话。
 *   · **截断有上限**。折叠行只有一行，长 SQL / 长 prompt 原样铺开会把这一行撑爆。
 */
export function toolObject(name: string, args: unknown): string | null {
  if (args === null || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return null;
  };
  const path = pick("file_path", "path", "filePath", "file", "target_file");
  if (path !== null) return clamp(basename(path));
  const url = pick("url", "href");
  if (url !== null) return clamp(hostOf(url));
  const query = pick("query", "q", "pattern", "search", "keyword", "description", "command", "sql", "prompt", "subject", "title", "name", "statement", "workflowId", "targetRole");
  if (query !== null) return clamp(query);
  return null;
}

/** 折叠行只有一行，对象短语超过这个长度就截断加省略号。按码点截，不劈开 emoji。 */
const OBJECT_MAX = 32;
function clamp(text: string): string {
  const points = Array.from(text.replace(/\s+/gu, " ").trim());
  return points.length <= OBJECT_MAX ? points.join("") : `${points.slice(0, OBJECT_MAX - 1).join("")}…`;
}
function basename(path: string): string {
  const parts = path.split(/[\\/]/u).filter((part) => part !== "");
  return parts.at(-1) ?? path;
}
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * 结果**等于什么都没有**——屏幕上不该出现 `null`。
 *
 * 人类实测截图里，一次成功的 `read_file` 展开后「结果」一栏写着大大的 `null`：
 * 对非技术用户那不是「没有返回内容」，那是「出错了」。后端确实给了 `null`（这条工具
 * 的返回被内核吃掉了），事实不改，改的是**怎么说这件事**。
 */
export function isEmptyToolResult(result: unknown): boolean {
  if (result === undefined || result === null) return true;
  if (typeof result === "string") {
    const text = result.trim();
    return text === "" || text === "null" || text === "undefined" || text === "{}" || text === "[]";
  }
  if (Array.isArray(result)) return result.length === 0;
  if (typeof result === "object") return Object.keys(result as object).length === 0;
  return false;
}
