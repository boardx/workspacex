/**
 * 工具的**用户可读名**——**唯一**一份映射。
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
 */
export const TOOL_LABEL: Record<string, string> = {
  write_todos: "制定执行计划",
  search_documents: "检索文档",
  read_document: "读取文档",
  lookup_time: "查询当前时间",
  send_email: "发送邮件",
  spawn_async_task: "派发后台任务",
  run_script: "执行生成脚本",
};

export function toolLabel(name: string): string {
  return TOOL_LABEL[name] ?? name;
}
