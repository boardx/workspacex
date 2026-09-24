"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { DigitalInterviewQualityProjection } from "@/lib/interview-api";

export function DigitalInterviewReadiness({ quality, pending, onDecide }:
  { readonly quality: DigitalInterviewQualityProjection; readonly pending?: boolean;
    readonly onDecide: (status: "ready" | "warning_accepted", rationale: string | null) => void }) {
  const [rationale, setRationale] = React.useState("");
  const status = quality.readiness?.status ?? "blocking";
  const blockers = quality.readiness?.issues.filter((issue) => issue.severity === "blocking") ?? [];
  return <section data-testid="itv-readiness" className="mt-5 rounded-xl border border-border p-4"><h3 className="font-semibold">开始前检查</h3>
    {blockers.length > 0 && <ul className="mt-3 space-y-1 text-sm text-destructive">{blockers.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>}
    {status === "warning" && <label className="mt-3 grid gap-2 text-sm">接受提醒的理由（10–300 字）<textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} className="rounded-lg border border-input bg-background px-3 py-2" /></label>}
    <Button data-testid="itv-start-ready" className="mt-4" variant="primary" disabled={pending || status === "blocking" || status === "warning" && (rationale.trim().length < 10 || rationale.trim().length > 300)} onClick={() => onDecide(status === "ready" ? "ready" : "warning_accepted", status === "ready" ? null : rationale.trim())}>确认就绪并开始访谈</Button>
  </section>;
}
