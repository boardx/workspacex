"use client";
import * as React from "react";
import { Copy, QrCode, ExternalLink, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toast } from "@/components/admin/panel";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { OrgAdminFrame } from "./org-admin-frame";
import {
  ROSTER, ROSTER_PRESENT, ROSTER_TOTAL, ATTEND_LABEL,
  type AttendState,
} from "@/lib/mock/org-admin";

/**
 * UC-1.3 载体二 · 现场协作 → 全场 → 分组与签到（现场面）
 *
 * 与载体一**共用同一份数据**（同一批链接、同一份名单），任务侧重不同：这里是开场与到场核对。
 * 逐项照录 R8：每组链接 + [复制] + [二维码] + 签到名单 + 到场状态（组长/已到/未到）+
 * 每组 n/m + 全场计数（11/12 已到）+ [看加入页]。观察者只见脱敏聚合（R5）。
 */
export function RosterScreen({ state, previewRole }: { state: UiState; previewRole: ProjectRole }) {
  const [toast, setToast] = React.useState<string | null>(null);

  // 观察者：到场信息至多脱敏聚合，链接/二维码不可见（R5）
  const observer = previewRole === "observer";

  return (
    <OrgAdminFrame
      state={state}
      uc="UC-1.3 R8 载体二"
      title="分组与签到"
      intro={`${ROSTER_PRESENT} / ${ROSTER_TOTAL} 已到 · 每组一条加入链接，打开即进，不需要注册。到场状态实时刷新。`}
      emptyHint="还没有分组。先在「项目筹备 → 定题与分组」建组与名单，再回这里核对到场。"
      errors={{ roster: "二维码服务返回异常，无法为第 3 组出图；复制链接仍可用，可稍后重试出码。" }}
      depFailure="实时到场通道（WebSocket）不可用，已降级为轮询并标「非实时」；计数可能有几秒延迟。"
      denial={observer
        ? { layer: "project", reason: "你是观察者：到场信息只以脱敏聚合形式呈现（如「11/12 已到」），加入链接、令牌与参与者手机号对你不可见。" }
        : { layer: "project", reason: "分组与签到仅引导师 / 组长（本组）可见。" }}
      successMessage="陈默 已进入第 2 组：状态由「未到」变「已到」，本组 1/2 与全场 11/12 同步 +1。"
      skeletonRows={4}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2">
          <Users aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="text-13 font-medium">全场 {ROSTER_PRESENT} / {ROSTER_TOTAL} 已到</span>
          <span className="text-11 text-muted-foreground">每组一条加入链接，打开即进，不需要注册</span>
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => setToast("已打开参与者会看到的落地页预览（UC-1.2）")} data-testid="roster-see-join-page"><ExternalLink aria-hidden className="h-3 w-3" /> 看加入页</Button>
        </div>

        {observer && (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-11 text-muted-foreground" data-testid="roster-observer-note">
            观察者视角：以下仅显示<strong className="text-background-foreground">脱敏聚合到场数</strong>，不展开姓名、链接与二维码。
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {ROSTER.map((g) => (
            <li key={g.groupNo} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="roster-group-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-11 text-accent-foreground">{g.groupNo}</span>
                <span className="text-13 font-medium">{g.title}</span>
                <Badge tone={g.present === g.total ? "primary" : "warning"} data-testid="roster-count">{g.present}/{g.total}</Badge>
                {!observer && (
                  <div className="ml-auto flex gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => setToast(`已复制第 ${g.groupNo} 组加入链接`)} data-testid="roster-copy"><Copy aria-hidden className="h-3 w-3" /> 复制</Button>
                    <Button size="xs" variant="outline" onClick={() => setToast("二维码已生成（可投屏）")} data-testid="roster-qr"><QrCode aria-hidden className="h-3 w-3" /> 二维码</Button>
                  </div>
                )}
              </div>
              {!observer && (
                <div className="flex flex-wrap items-center gap-1.5 pl-7" data-testid="roster-signin-list">
                  {g.members.map((m) => (
                    <span key={m.name} className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-11">
                      {m.name}
                      <AttendTag state={m.state} />
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Toast message={toast} testid="roster-toast" onDismiss={() => setToast(null)} />
    </OrgAdminFrame>
  );
}

function AttendTag({ state }: { state: AttendState }) {
  const tone = state === "lead" ? "ai" : state === "present" ? "primary" : "outline";
  return <Badge tone={tone} data-testid={`roster-attend-${state}`}>{ATTEND_LABEL[state]}</Badge>;
}
