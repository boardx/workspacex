"use client";
import * as React from "react";
import type { FeedbackKind, FeedbackStructured } from "@/lib/live-feedback";
import { cn } from "@/lib/utils";

/**
 * UC-17.8 D1 —— 结构化补充字段的**唯一前端字段表** + 只读展示。
 *
 * 键 = 契约 `BugStructuredFields` / `ReqStructuredFields` 的键（`satisfies` 钉死：契约加/改键，
 * 这里编译不过）。提交表单（`feedback-dialog.tsx`）、「我提过的」、后台详情、收件箱 drawer
 * 四处共用这一份，不各写一份「哪几项、叫什么」。
 *
 * `testid` 沿用原型期的短名（`actual` / `scene` …），既有 `design-loop.test.tsx` 断的就是它们。
 */
export interface StructuredFieldDef<K extends string = string> {
  readonly key: K;
  readonly label: string;
  readonly testid: string;
  readonly multiline?: boolean;
}

type BugKey = keyof Extract<FeedbackStructured, { reproSteps?: unknown }>;
type ReqKey = keyof Extract<FeedbackStructured, { useScenario?: unknown }>;

const BUG_FIELDS = [
  { key: "reproFrequencyEnv", label: "复现频率 · 环境", testid: "freq-env" },
  { key: "expectedResult", label: "期望结果", testid: "expected" },
  { key: "actualResult", label: "实际结果", testid: "actual" },
  { key: "reproSteps", label: "复现步骤", testid: "repro-steps", multiline: true },
] as const satisfies readonly StructuredFieldDef<BugKey>[];

const REQ_FIELDS = [
  { key: "useScenario", label: "使用场景", testid: "scene" },
  { key: "expectedCapability", label: "期望能力", testid: "capability" },
  { key: "priorityScope", label: "优先级 · 影响范围", testid: "priority" },
] as const satisfies readonly StructuredFieldDef<ReqKey>[];

export const STRUCTURED_FIELDS: Record<FeedbackKind, readonly StructuredFieldDef[]> = {
  缺陷: BUG_FIELDS,
  需求: REQ_FIELDS,
};

/**
 * 只列**有值**的字段；`null`（契约：没填）/ 一个都没有 ⇒ 什么都不渲染（`{}` 与不传等价，见契约头注）。
 * ⚠ 也容忍 `undefined`：旧夹具 / 旧投影没有这个键，一块展示区块不该让整个详情崩掉。
 */
export function FeedbackStructuredView({
  kind, structured, testid, compact,
}: {
  kind: FeedbackKind;
  structured: FeedbackStructured | null | undefined;
  testid: string;
  compact?: boolean;
}) {
  if (structured == null) return null;
  const rows = STRUCTURED_FIELDS[kind]
    .map((f) => ({ f, v: (structured as Record<string, string | undefined>)[f.key] }))
    .filter((x): x is { f: StructuredFieldDef; v: string } => typeof x.v === "string" && x.v.trim() !== "");
  if (rows.length === 0) return null;
  return (
    <dl
      data-testid={testid}
      className={cn("grid gap-x-3 gap-y-1", compact ? "grid-cols-[auto_minmax(0,1fr)] text-11" : "grid-cols-[6rem_minmax(0,1fr)] text-12")}
    >
      {rows.map(({ f, v }) => (
        <React.Fragment key={f.key}>
          <dt className="text-muted-foreground">{f.label}</dt>
          <dd className={cn("text-card-foreground", f.multiline ? "whitespace-pre-wrap" : compact ? "line-clamp-2" : "whitespace-pre-wrap")} data-testid={`${testid}-${f.testid}`}>
            {v}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
