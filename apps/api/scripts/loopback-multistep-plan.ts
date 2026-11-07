/** Shared LangGraph messages for the multistep plan's state and live tool update. */
export function multistepPlanMessages(threadId: string) {
  const toolCallId = `todos-${threadId}`;
  return {
    announcement: {
      type: "ai", content: "",
      tool_calls: [{ id: toolCallId, name: "write_todos", args: { todos: [
        { content: "搜索相关文档", status: "in_progress" },
        { content: "读取最相关的一份", status: "pending" },
        { content: "综合结论作答", status: "pending" },
      ] } }],
    },
    result: { type: "tool", tool_call_id: toolCallId, content: "todos updated" },
  };
}
