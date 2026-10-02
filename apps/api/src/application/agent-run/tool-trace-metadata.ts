import { nativeToolProvenance } from "@repo/contracts/native-tool-identities";

/** Actual native adapters, not catalog provider recommendations or authorization.
 * These wrappers are Workspacex code (web_search currently uses BoardX, not Tavily).
 * No remote image/build revision is invented when the invocation does not supply one.
 * WX-T018 has no callable adapter in the current native profile and is not attributed.
 */
export const STANDARD_TOOL_TRACE_IDENTITIES = [
  ["WX-T014", "web_search", "apps/deep-agent-service/src/deep_agent_service/standard_web_tools.py:standard_web_tools"],
  ["WX-T015", "fetch_url", "apps/deep-agent-service/src/deep_agent_service/standard_web_tools.py:standard_web_tools"],
  ["WX-T016", "wx_knowledge_search", "apps/deep-agent-service/src/deep_agent_service/standard_context_tools.py:standard_context_tools"],
  ["WX-T017", "wx_knowledge_read", "apps/deep-agent-service/src/deep_agent_service/standard_context_tools.py:standard_context_tools"],
  ["WX-T019", "wx_document_parse", "apps/deep-agent-service/src/deep_agent_service/standard_document_tools.py:document_parse_tool"],
  ["WX-T020", "wx_artifact_publish", "apps/deep-agent-service/src/deep_agent_service/native_artifact_publish.py:artifact_publish_tool"],
  ["WX-T021", "wx_artifact_download", "apps/deep-agent-service/src/deep_agent_service/standard_artifact_download.py:artifact_download_tool"],
  ["WX-T022", "browser_navigate", "apps/deep-agent-service/src/deep_agent_service/standard_browser_tools.py:standard_browser_tools"],
  ["WX-T023", "browser_snapshot", "apps/deep-agent-service/src/deep_agent_service/standard_browser_tools.py:standard_browser_tools"],
  ["WX-T024", "browser_click", "apps/deep-agent-service/src/deep_agent_service/standard_browser_tools.py:standard_browser_tools"],
  ["WX-T025", "browser_fill_form", "apps/deep-agent-service/src/deep_agent_service/standard_browser_tools.py:standard_browser_tools"],
  ["WX-T026", "browser_take_screenshot", "apps/deep-agent-service/src/deep_agent_service/standard_browser_tools.py:standard_browser_tools"],
  ["WX-T027", "wx_project_list", "apps/deep-agent-service/src/deep_agent_service/standard_context_tools.py:standard_context_tools"],
  ["WX-T028", "wx_project_read", "apps/deep-agent-service/src/deep_agent_service/standard_context_tools.py:standard_context_tools"],
  ["WX-T029", "wx_canvas_read", "apps/deep-agent-service/src/deep_agent_service/standard_canvas_tools.py:standard_canvas_tools"],
  ["WX-T030", "wx_canvas_update", "apps/deep-agent-service/src/deep_agent_service/standard_canvas_tools.py:standard_canvas_tools"],
  ["WX-T031", "wx_memory_search", "apps/deep-agent-service/src/deep_agent_service/standard_memory.py:standard_memory_tools"],
  ["WX-T032", "wx_memory_write", "apps/deep-agent-service/src/deep_agent_service/standard_memory.py:standard_memory_tools"],
  ["WX-T033", "wx_memory_delete", "apps/deep-agent-service/src/deep_agent_service/standard_memory.py:standard_memory_tools"],
  ["WX-T034", "wx_schedule_create", "apps/deep-agent-service/src/deep_agent_service/standard_schedule.py:standard_schedule_tools"],
  ["WX-T035", "wx_schedule_list", "apps/deep-agent-service/src/deep_agent_service/standard_schedule.py:standard_schedule_tools"],
  ["WX-T036", "wx_schedule_cancel", "apps/deep-agent-service/src/deep_agent_service/standard_schedule.py:standard_schedule_tools"],
  ["WX-T037", "wx_audio_transcribe", "apps/deep-agent-service/src/deep_agent_service/standard_audio_tools.py:audio_transcribe_tool"],
  ["WX-T038", "wx_image_generate", "apps/deep-agent-service/src/deep_agent_service/standard_image_tools.py:image_generate_tool"],
  ["WX-T039", "wx_skill_create_draft", "apps/deep-agent-service/src/deep_agent_service/standard_skill_draft.py:skill_draft_tool"],
  ["WX-T040", "wx_run_status", "apps/deep-agent-service/src/deep_agent_service/standard_run_status.py:run_status_tool"],
  ["WX-T041", "wx_run_cancel", "apps/deep-agent-service/src/deep_agent_service/standard_run_cancel.py:run_cancel_tool"],
  ["WX-T042", "spawn_async_task", "apps/deep-agent-service/src/deep_agent_service/standard_subtask_tools.py:spawn_async_task_tool"],
  ["WX-T043", "sql_db_list_tables", "apps/deep-agent-service/src/deep_agent_service/standard_sql.py:standard_sql_tools"],
  ["WX-T044", "sql_db_schema", "apps/deep-agent-service/src/deep_agent_service/standard_sql.py:standard_sql_tools"],
  ["WX-T045", "sql_db_query_checker", "apps/deep-agent-service/src/deep_agent_service/standard_sql.py:standard_sql_tools"],
  ["WX-T046", "sql_db_query", "apps/deep-agent-service/src/deep_agent_service/standard_sql.py:standard_sql_tools"],
] as const;

export function toolTraceMetadata(toolName: string, native: boolean) {
  const upstream = nativeToolProvenance(toolName, native);
  if (upstream.capability || !native) return upstream;
  const identity = STANDARD_TOOL_TRACE_IDENTITIES.find(item => item[1] === toolName);
  return identity ? { capabilityId: identity[0], implementationSource: {
    kind: "workspacex" as const, locator: identity[2], license: "Apache-2.0",
  } } : {};
}

/** Per-attempt observation; a missing start never fabricates an elapsed time. */
export class ToolTraceTimings {
  private readonly starts = new Map<string, number>();
  observe(callId: string, at: string, phase: "in_progress" | "complete" | undefined): { durationMs?: number } {
    const observedAt = Date.parse(at), start = this.starts.get(callId);
    const duration = start === undefined ? undefined : Math.max(0, observedAt - start);
    if (phase === "in_progress") {
      if (start === undefined && Number.isFinite(observedAt)) this.starts.set(callId, observedAt);
    } else this.starts.delete(callId);
    return duration !== undefined && Number.isFinite(duration) ? { durationMs: duration } : {};
  }
}
