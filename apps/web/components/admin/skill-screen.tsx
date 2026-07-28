"use client";
import { Plus, FileCode2, Braces, DatabaseZap } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { VisibilityBadge } from "./scope-badges";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SKILLS, SKILL_STATUS_LABEL, type SkillStatus } from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";

const STATUS_TONE: Record<SkillStatus, "primary" | "warning" | "neutral" | "outline"> = {
  enabled: "primary",
  review: "warning",
  draft: "neutral",
  disabled: "outline",
};

export function SkillScreen({ state }: { state: UiState }) {
  return (
    <AdminScreen
      state={state}
      moduleLabel="Skill"
      title="Skill 库"
      intro="phase-1 的 skill 是一份声明式契约，不是可执行代码包——不做沙箱、不跑任意代码，运行时只做「模板渲染 → 模型调用 → 输出按 schema 校验」。"
      emptyHint="Skill 库还是空的"
      errors={{ dataScope: "契约校验失败：数据范围声明申请读取『客户 CRM』，越出提交人自身权限，直接判为失败、不进待审核队列" }}
      depFailure="试跑需调用 skill 声明的模型；该模型当前不可用，无法生成最近一次试跑结果。"
      denialReason="Skill 库仅组织管理员与能力维护者可管理；引导师只能在蓝本里绑定已启用的 skill。"
      successMessage="Skill『MECE 假设拆解 v4』已通过安全扫描与方法论审核，置为已启用"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-12 text-muted-foreground">
            共 {SKILLS.length} 个 skill · {SKILLS.filter((s) => s.status === "enabled").length} 个已启用 · 1 个待审核
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" data-testid="admin-skill-import">导入契约</Button>
            <Button size="sm" variant="primary" data-testid="admin-skill-add">
              <Plus aria-hidden className="h-3.5 w-3.5" />
              新建 skill
            </Button>
          </div>
        </div>

        <p className="rounded-md border border-border-subtle bg-panel px-3 py-2 text-11 text-muted-foreground">
          每个 skill 由三段契约构成：<strong className="text-background-foreground">提示词模板</strong>（可带变量）、
          <strong className="text-background-foreground">输入输出 schema</strong>、
          <strong className="text-background-foreground">数据范围声明</strong>（与 MCP 授权范围求交）。
          这里没有「仓库导入 / 多文件可执行包」——那是被 D-06 明确排除的形态。
        </p>

        <div className="flex flex-col gap-2" data-testid="admin-skill-list">
          {SKILLS.map((s) => (
            <Card key={s.id} data-testid={`admin-skill-row-${s.id}`}>
              <CardContent className="flex flex-col gap-2.5 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-13 font-medium">{s.name}</span>
                  <Badge tone="outline" className="font-mono">{s.version}</Badge>
                  <Badge tone={STATUS_TONE[s.status]} data-testid={`admin-skill-status-${s.id}`}>
                    {SKILL_STATUS_LABEL[s.status]}
                  </Badge>
                  <VisibilityBadge scope={s.visibility} team={s.team} data-testid={`admin-skill-visibility-${s.id}`} />
                  {s.origin === "方法晋升" && <Badge tone="ai">方法晋升</Badge>}
                  <div className="ml-auto flex items-center gap-4 text-11 text-muted-foreground">
                    <span>{s.calls.toLocaleString()} 次调用</span>
                    {s.satisfaction > 0 && <span>满意度 {s.satisfaction}%</span>}
                  </div>
                </div>

                <p className="text-12 text-muted-foreground">{s.duty}</p>

                {/* 契约三段（D-06） */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid={`admin-skill-contract-${s.id}`}>
                  <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-2">
                    <FileCode2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="text-10 uppercase tracking-wide text-muted-foreground">提示词模板</span>
                      <span className="text-12">{s.promptVars} 个变量占位符</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-2">
                    <Braces aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="text-10 uppercase tracking-wide text-muted-foreground">输入输出 schema</span>
                      <span className="text-12">{s.schemaFields}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-2">
                    <DatabaseZap aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="text-10 uppercase tracking-wide text-muted-foreground">数据范围声明</span>
                      <span className="text-12">{s.dataScope}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminScreen>
  );
}
