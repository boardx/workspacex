import * as React from "react";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
const base = { runId: "failed", emittedAt: "2026-11-05T00:00:00Z" };
const events: ExecutionEvent[] = [
  { ...base, seq: 1, kind: "tool_start", toolCallId: "todos", toolName: "write_todos", args: { todos: [{ content: "生成图片", status: "in_progress" }] } },
  { ...base, seq: 2, kind: "status", status: "failed" },
];
const markup = renderToStaticMarkup(<main style={{ width: 760 }}><RunTracePanel runId="failed" events={events} failureScope="org/thread" /><p>后续对话仍可阅读</p></main>);
writeFileSync(process.argv[2]!, `<html><head><link rel="stylesheet" href="out.css"></head><body>${markup}</body></html>`);
