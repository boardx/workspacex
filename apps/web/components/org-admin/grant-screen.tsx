"use client";
import * as React from "react";
import { KeyRound, Clock, UserPlus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, Toast } from "@/components/admin/panel";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { PROJECT_ROLE_LABEL } from "@/lib/identity";
import { OrgAdminFrame } from "./org-admin-frame";
import {
  GRANT_RECORDS, GRANT_PEOPLE, GRANT_RESOURCES, GRANT_SEGMENTS,
} from "@/lib/mock/org-admin";

/**
 * UC-1.4 载体二 · 临时提权授予入口 + 审计留痕
 *
 * [原型] 留痕逐字：「09:41:07 授予客户方王毅『观察者』＋ 第 2 组原始内容临时读权 · 环节 3 结束自动失效」。
 * [设计·需补] 授予入口（选人 → 选资源 → 选失效环节）原型未画，本次补。
 * ⚠ 失效条件是**流程节点**（某环节结束），不是时间点：环节提前结束/跳过/合并同样立即失效，
 *   由服务端在环节状态机变更时主动收回（R7 / A2）。授予是高影响动作：二次确认 + 明示失效环节。
 */
export function GrantScreen({ state, previewRole }: { state: UiState; previewRole: ProjectRole }) {
  const [person, setPerson] = React.useState(GRANT_PEOPLE[0]!);
  const [resource, setResource] = React.useState(GRANT_RESOURCES[0]!);
  const [segment, setSegment] = React.useState(GRANT_SEGMENTS[0]!);
  const [confirming, setConfirming] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  // 授予临时读权仅引导师 / 项目负责人可做（R6 步骤 6）
  const canGrant = previewRole === "facilitator";

  return (
    <OrgAdminFrame
      state={state}
      uc="UC-1.4 R8 载体二"
      title="临时提权"
      intro="在既有项目角色之上追加一条具体资源的临时读权，失效条件是流程节点（不是时间点）。授予、每次使用、失效都写审计。"
      emptyHint="还没有任何临时读权记录。用下面的入口授予一条，或从项目审计里检索历史。"
      errors={{ grant: "请先选定「人 / 资源 / 失效环节」三项再授予；失效环节不能为空。" }}
      depFailure="项目环节状态机不可用，无法登记「按环节失效」的锚点；授予已暂停，避免出现收不回的临时读权。"
      denial={{ layer: "project", reason: "授予临时读权仅引导师 / 项目负责人可做。你以「" + PROJECT_ROLE_LABEL[previewRole] + "」身份进入，只能查看自己被授予的临时读权。" }}
      successMessage="临时读权已授予；将在所选环节结束时由服务端主动收回，失效事件写审计并通知授予人。"
      skeletonRows={4}
    >
      <div className="flex flex-col gap-4">
        {/* 授予入口（选人 → 选资源 → 选失效环节） */}
        <section className="flex flex-col gap-3 rounded-lg border border-border p-4" data-testid="grant-form">
          <div className="flex items-center gap-1.5">
            <UserPlus aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">授予临时读权</h2>
            <Badge tone="outline">高影响动作 · 需二次确认</Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <PickerColumn label="① 授予给谁" icon={<UserPlus aria-hidden className="h-3.5 w-3.5" />} options={GRANT_PEOPLE} value={person} onChange={setPerson} testid="grant-person" />
            <PickerColumn label="② 哪一份资源" icon={<FileText aria-hidden className="h-3.5 w-3.5" />} options={GRANT_RESOURCES} value={resource} onChange={setResource} testid="grant-resource" />
            <PickerColumn label="③ 哪个环节结束失效" icon={<Clock aria-hidden className="h-3.5 w-3.5" />} options={GRANT_SEGMENTS} value={segment} onChange={setSegment} testid="grant-segment" />
          </div>

          <div className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2">
            <KeyRound aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-11 text-muted-foreground">
              将授予 <strong className="text-background-foreground">{person}</strong>「观察者」＋ <strong className="text-background-foreground">{resource}</strong> 临时读权 ·
              <strong className="text-background-foreground"> {segment} 结束自动失效</strong>
            </p>
            <Button size="sm" variant="primary" className="ml-auto" disabled={!canGrant} onClick={() => setConfirming(true)} data-testid="grant-submit">授予</Button>
          </div>
        </section>

        {/* 临时读权留痕（生效中 / 已失效） */}
        <section className="flex flex-col gap-2" data-testid="grant-records">
          <h2 className="text-14 font-semibold">临时读权留痕<span className="ml-1 text-11 font-normal text-muted-foreground">（不可删除 · 可导出 CSV / JSON）</span></h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {GRANT_RECORDS.map((r, i) => (
              <li key={i} className="flex flex-col gap-0.5 px-3 py-2" data-testid="grant-record-row">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-11 text-muted-foreground">{r.time}</code>
                  <span className="text-12">授予 <strong>{r.grantee}</strong> {r.grant}</span>
                  <Badge tone={r.state === "active" ? "primary" : "outline"} className="ml-auto" data-testid={`grant-state-${r.state}`}>
                    {r.state === "active" ? "生效中" : "已失效"}
                  </Badge>
                </div>
                <p className="text-10 text-muted-foreground">失效依据：{r.expiresOn}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {confirming && (
        <ConfirmDialog
          testid="grant-confirm-dialog"
          title="授予临时读权？"
          confirmLabel="确认授予"
          requireReason
          reasonPlaceholder="授予理由（写入审计，如：客户方需在评审环节查看原始证据）"
          impact={
            <div className="flex flex-col gap-1">
              <p>将给 <strong>{person}</strong> 在既有角色之上追加：<strong>{resource}</strong> 的临时读权。</p>
              <p>失效条件：<strong>{segment} 结束自动失效</strong>（流程节点，非时间点）。环节提前结束/跳过/合并同样立即失效。</p>
              <p>授予、每次使用、失效三个时刻都写审计并通知你。</p>
            </div>
          }
          onCancel={() => setConfirming(false)}
          onConfirm={() => { setToast(`已授予 ${person} 临时读权；${segment} 结束时自动收回，已记入审计`); setConfirming(false); }}
        />
      )}

      <Toast message={toast} testid="grant-toast" onDismiss={() => setToast(null)} />
    </OrgAdminFrame>
  );
}

function PickerColumn({
  label, icon, options, value, onChange, testid,
}: {
  label: string;
  icon: React.ReactNode;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  testid: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1">{icon} {label}</Label>
      <div className="flex flex-col gap-1" data-testid={testid}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            data-testid={`${testid}-option`}
            className={[
              "rounded-md border px-2 py-1.5 text-left text-11 transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === o ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted",
            ].join(" ")}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
