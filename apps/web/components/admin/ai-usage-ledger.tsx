"use client";
import * as React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrgMemberNames, memberLabel } from "@/lib/use-org-member-names";
import type { UsageCalls } from "@/lib/live-ai-usage";
import { creditLabel, costLabel, formatTokens, nativeQuantity, usageDateLabel, usageDay, usageTime } from "./ai-usage-format";

const callTimestamp = (call: UsageCalls["calls"][number]) => call.startedAt ?? call.occurredAt;

export function AiUsageLedger({ calls, orgId, selfUserId }: { calls: UsageCalls["calls"]; orgId: string; selfUserId?: string }) {
  const names = useOrgMemberNames(selfUserId ? null : orgId);
  const days = new Map<string, UsageCalls["calls"]>();
  for (const call of calls) {
    // Match the API date filter (request start, falling back to receipt time).
    // Cursor identity continues to use occurredAt unchanged.
    const day = usageDay(callTimestamp(call));
    days.set(day, [...(days.get(day) ?? []), call]);
  }
  return <Table data-testid="usage-ledger">
    <TableHeader><TableRow>
      <TableHead>调用时间</TableHead><TableHead>模型</TableHead>{!selfUserId && <TableHead>成员</TableHead>}
      <TableHead className="text-right">输入 Token</TableHead><TableHead className="text-right">输出 Token</TableHead>
      <TableHead>付款方</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">总用量</TableHead><TableHead className="text-right">费用</TableHead><TableHead>状态</TableHead>
    </TableRow></TableHeader>
    {[...days].sort(([left], [right]) => right.localeCompare(left)).map(([day, rows]) => <TableBody key={day}>
      <TableRow className="bg-muted/40 transition-colors hover:bg-muted/40"><TableCell colSpan={selfUserId ? 9 : 10} className="py-3 font-medium">{usageDateLabel(`${day}T00:00:00+08:00`)}</TableCell></TableRow>
      {[...rows].sort((left, right) => Date.parse(callTimestamp(right)) - Date.parse(callTimestamp(left))).map(call => <TableRow key={call.id}>
        <TableCell className="whitespace-nowrap align-top tabular-nums">{usageTime(callTimestamp(call))}</TableCell>
        <TableCell className="min-w-40 align-top"><span className="font-medium break-all">{call.modelId}</span><div className="mt-1 text-12 text-muted-foreground">{call.modelProvider}</div></TableCell>
        {!selfUserId && <TableCell className="align-top">{memberLabel(call.userId, selfUserId, names)}</TableCell>}
        <TableCell className="text-right align-top tabular-nums">{call.totalSource === "not-applicable" ? "—" : formatTokens(call.inputTokens)}</TableCell>
        <TableCell className="text-right align-top tabular-nums">{call.totalSource === "not-applicable" ? "—" : formatTokens(call.outputTokens)}</TableCell>
        <TableCell className="align-top">{call.payer ? call.payer.ownerType === "user" ? "个人账户" : `组织账户${call.organizationName ? ` · ${call.organizationName}` : ""}` : "暂无数据"}</TableCell>
        <TableCell className="text-right align-top tabular-nums">{call.creditStatus === "unbilled" ? "历史未计费" : creditLabel(call.creditHundredths)}{call.creditStatus === "pending" && <p className="text-12 text-muted-foreground">待核对</p>}</TableCell>
        <TableCell className="min-w-40 text-right align-top tabular-nums">
          <span className="font-medium">{call.nativeUsage ? nativeQuantity(call.nativeUsage) : call.totalSource === "unknown" ? "未上报" : call.totalSource === "not-applicable" ? "Token 不适用" : formatTokens(call.totalTokens)}</span>
          <details className="mt-2 text-12 text-muted-foreground"><summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">计量详情</summary>
            <div className="mt-2 space-y-1">
              {call.totalSource === "not-applicable" ? <p>Token 不适用</p> : <><p>缓存输入：{formatTokens(call.cacheInputTokens)}</p><p>推理输出：{formatTokens(call.reasoningOutputTokens)}</p><p>缓存与推理量已包含在输入 / 输出中</p></>}
              {call.totalSource === "legacy" && <p>历史统计口径</p>}
            </div>
          </details>
        </TableCell>
        <TableCell className="whitespace-nowrap text-right align-top tabular-nums">{costLabel(call)}</TableCell>
        <TableCell className="whitespace-nowrap align-top"><span className={call.outcome === "failed" ? "text-destructive" : "text-muted-foreground"}>{call.outcome === "failed" ? "失败" : "成功"}</span></TableCell>
      </TableRow>)}
    </TableBody>)}
  </Table>;
}
