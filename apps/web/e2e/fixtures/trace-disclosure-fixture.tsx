/**
 * issue #3205 —— 用**真组件**渲出 `RunTracePanel` 展开态的静态 DOM，供
 * `chat-trace-disclosure-geometry.spec.ts` 在真浏览器里量几何。
 *
 * 为什么单独一个进程：Playwright 的测试转译器会把 JSX 编译成它自己的组件测试节点
 * （`__pw_type`），在 spec 里直接 import 本仓的 TSX 组件渲不出 HTML。所以由 `tsx`
 * 起一个普通 Node 进程渲染，spec 只负责量——**渲的是真组件，不是手写替身**。
 *
 * 用法：node --import tsx e2e/fixtures/trace-disclosure-fixture.tsx <输出 html 路径>
 */
import * as React from "react";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
import { Card, CardContent } from "@/components/ui/card";

const base = { runId: "run-1", emittedAt: "2026-09-07T00:00:00Z" };
const events: ExecutionEvent[] = [
  { ...base, seq: 1, kind: "tool_start", toolCallId: "t1", toolName: "fetch_url", args: { url: "https://example.com" } },
  { ...base, seq: 2, kind: "tool_end", toolCallId: "t1", toolName: "fetch_url", result: "refused", ok: false },
  { ...base, seq: 3, kind: "tool_start", toolCallId: "t2", toolName: "fetch_url", args: { url: "https://ok.example" } },
  { ...base, seq: 4, kind: "tool_end", toolCallId: "t2", toolName: "fetch_url", result: "fine", ok: true },
];

const markup = renderToStaticMarkup(
  <RunTracePanel
    runId="run-1"
    events={events}
    expanded
    onExpandedChange={() => {}}
    renderTool={() => <Card data-testid="tool-card"><CardContent className="p-2.5 text-11">fetch_url</CardContent></Card>}
  />,
);
writeFileSync(
  process.argv[2]!,
  `<html><head><link rel="stylesheet" href="out.css"></head><body class="bg-background"><div style="width:760px">${markup}</div></body></html>`,
);
