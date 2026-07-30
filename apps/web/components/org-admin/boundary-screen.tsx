"use client";
import * as React from "react";
import { EyeOff, ScrollText, FileClock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Toast } from "@/components/admin/panel";
import type { UiState } from "@/lib/ui-state";
import { OrgAdminFrame } from "./org-admin-frame";
import {
  PERSONAL_LAYER_COUNTS, ADMIN_PROJECT_ACCESS, WHO_READ_MY_PROJECT,
} from "@/lib/mock/org-admin";

/**
 * UC-1.4 载体三 · 管理员权力边界（D-18 硬约束）
 *
 * ① 个人层：管理员**只见计数，内容不可见**（响应体里不存在内容字段，I-8）。
 * ② 项目层：可读，但**每次访问写审计日志，且对项目负责人可见**。
 * ③ 管理员可查「看我的访问记录」。
 * ④ 管理员**不是超级用户**——不因管理员身份自动获得项目内容读取权。
 * [设计·需补] 项目负责人侧「谁读过我的项目」（D-18 ② 的另一半），原型未画，本次补。
 */
export function BoundaryScreen({ state }: { state: UiState }) {
  const [toast, setToast] = React.useState<string | null>(null);

  return (
    <OrgAdminFrame
      state={state}
      uc="UC-1.4 R8 载体三"
      title="管理员边界"
      intro="这不是缺失功能，是产品的硬约束（D-18）。邀请权 ≠ 阅读权：管理员能邀人、改角色配额，但看不到个人层内容。"
      emptyHint="本组织还没有任何成员的个人层计数与访问记录。"
      errors={{ boundary: "计量流水线返回异常，个人层「条目数」暂时无法刷新；已展示上次成功值并标注时间。" }}
      depFailure="审计日志服务不可用：管理员的项目层读取已暂停（读了却留不下痕，等于绕过 D-18），恢复后再开放。"
      denial={{ layer: "organization", reason: "管理员边界说明区仅组织管理员与项目负责人可见；顾问只能在「看我的访问记录」查自己的历史。" }}
      successMessage="已记录一条项目层访问审计：对项目负责人可见，你也能在「看我的访问记录」看到同一条。"
      skeletonRows={4}
    >
      <div className="flex flex-col gap-4">
        {/* 你作为管理员看不到什么 */}
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3" data-testid="boundary-headline">
          <EyeOff aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="text-13 font-semibold">「你作为管理员看不到什么」</p>
            <p className="text-11 text-muted-foreground">个人层是三层记忆里唯一对管理员封闭的一层——要拿到某人的私有内容，只有一条路径：本人显式升到项目层。</p>
          </div>
        </div>

        {/* 个人层：只有计数 */}
        <section className="flex flex-col gap-2" data-testid="boundary-personal-layer">
          <div className="flex items-center gap-1.5">
            <ScrollText aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">个人层 · 只有计数</h2>
            <Badge tone="outline">内容不可见</Badge>
          </div>
          <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {PERSONAL_LAYER_COUNTS.map((m) => (
              <li key={m.name} className="flex flex-col gap-0.5 rounded-md border border-border p-3" data-testid="boundary-personal-row">
                <span className="text-12 font-medium">{m.name}</span>
                <span className="text-20 font-semibold tracking-tight">{m.count}</span>
                <span className="text-10 text-muted-foreground">私有条目（内容不可见）</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 项目层：可读但留痕 */}
        <section className="flex flex-col gap-2" data-testid="boundary-project-layer">
          <div className="flex items-center gap-1.5">
            <FileClock aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">项目层 · 可读但留痕</h2>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-3">
              <p className="text-12">
                出于审计目的你可以读项目内容，但<strong>每次访问会写入审计日志，并对项目负责人可见</strong>。
                本月你访问过 <strong>{ADMIN_PROJECT_ACCESS.thisMonth}</strong> 个项目。
              </p>
              <Button size="sm" variant="outline" className="self-start" onClick={() => setToast("已打开「看我的访问记录」：本月 3 条项目层访问，逐条含时间 / 项目 / 目的")} data-testid="boundary-my-access">看我的访问记录</Button>
            </CardContent>
          </Card>
        </section>

        {/* 项目负责人侧：谁读过我的项目（需补） */}
        <section className="flex flex-col gap-2" data-testid="boundary-who-read">
          <div className="flex items-center gap-1.5">
            <Users aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">谁读过我的项目</h2>
            <Badge tone="ai">项目负责人视图 · 需补原型</Badge>
          </div>
          <p className="text-11 text-muted-foreground">D-18 ② 要求管理员的项目层访问「对项目负责人可见」。原型只画了管理员侧，这里补项目负责人侧。</p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {WHO_READ_MY_PROJECT.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="boundary-access-row">
                <code className="text-11 text-muted-foreground">{a.time}</code>
                <span className="text-12 font-medium">{a.admin}</span>
                <span className="text-11 text-muted-foreground">读取「{a.project}」</span>
                <span className="ml-auto text-10 text-muted-foreground">{a.purpose}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Toast message={toast} testid="boundary-toast" onDismiss={() => setToast(null)} />
    </OrgAdminFrame>
  );
}
