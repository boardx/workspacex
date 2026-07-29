"use client";
import * as React from "react";
import {
  Eye, EyeOff, UserPlus, Sparkles, Check, X, Pencil, ShieldCheck, Users, Info,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { UiState } from "@/lib/ui-state";
import { canWriteInterview, type InterviewView } from "@/lib/mock/interview";
import {
  RESPONDENTS, ROSTER_SUMMARY, CONSENT_STATE_LABEL, CONSENT_STATE_TONE,
  SESSION_ROLES, MULTIPARTY_SWITCHES, AI_CANDIDATE_SUGGESTIONS,
  type Respondent,
} from "@/lib/mock/interview-studio";

/**
 * UC-6.3 屏B（研究员侧只读镜像）+ UC-6.7 访谈侧 27 位受访者投影。
 * 同意书列是只读展示 + 提交时间，无勾选控件（同意只有一个来源：受访者本人）。
 * 联系方式默认遮盖，[查看] 每次写审计；批量导出默认不含联系方式。
 */
export function RespondentRoster({ state, view }: { state: UiState; view: InterviewView }) {
  const canWrite = canWriteInterview(view);
  return (
    <div className="flex flex-col gap-4" data-testid="itv-respondents">
      <Tabs defaultValue="roster">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList data-testid="itv-respondents-subtabs">
            <TabsTrigger value="roster" data-testid="itv-respondents-subtab-roster">名单与角色 {ROSTER_SUMMARY.respondents}</TabsTrigger>
            <TabsTrigger value="prep" data-testid="itv-respondents-subtab-prep">授权与准备 · 1 未授权</TabsTrigger>
          </TabsList>
          <span className="text-11 text-muted-foreground" data-testid="itv-roster-summary">
            {ROSTER_SUMMARY.sessions} 场次 · {ROSTER_SUMMARY.respondents} 位受访者
          </span>
        </div>

        <TabsContent value="roster">
          <StateShell
            state={state}
            emptyHint="本场还没有受访者——不预置示例对象，两个出口自己选"
            onCreate={() => {}}
            errors={{ contact: "添加参与者失败：联系方式格式不合法，或该手机号已在本项目名单中（去重冲突）" }}
            depFailure={{ what: "名单依赖同意书状态服务（单一来源）；服务不可用，同意书列暂无法刷新，可重试。", retry: () => {} }}
            denial={{ layer: "project", reason: "观察者只能看已发布脱敏结果，受访者名单与联系方式一律不可见。" }}
            successMessage="已把 AI 建议的候选人「荷兰某物流园区能源经理」加入名单（联系方式留空，需人工补）"
            skeletonRows={5}
          >
            <div className="flex flex-col gap-4">
              {/* 本场角色 */}
              <section className="flex flex-wrap items-center gap-2" data-testid="itv-session-roles">
                {SESSION_ROLES.map((r) => (
                  <Badge key={r.id} tone="neutral" data-testid={`itv-role-${r.id}`}>
                    {r.name} · {r.role}
                  </Badge>
                ))}
              </section>

              {/* 名单表 */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-14 font-semibold">受访者名单</h2>
                  {canWrite && (
                    <Button size="xs" variant="outline" onClick={() => {}} data-testid="itv-roster-add">
                      <UserPlus aria-hidden className="h-3 w-3" /> 添加参与者
                    </Button>
                  )}
                </div>
                <p className="text-10 text-muted-foreground">
                  同意书列只读展示提交时间，点开看渲染快照；没有可勾选控件。联系方式默认遮盖，查看写审计，批量导出默认不含。
                </p>
                <div className="flex flex-col gap-2">
                  {RESPONDENTS.map((r) => (
                    <RespondentRow key={r.id} r={r} canWrite={canWrite} />
                  ))}
                </div>
              </section>

              {/* AI 建议人选：候选卡在表下方，三出口，不自动填联系方式 */}
              {canWrite && <AiCandidatePanel />}

              {/* 多人访谈设置 · 七个开关 */}
              <MultipartySwitches canWrite={canWrite} />
            </div>
          </StateShell>
        </TabsContent>

        <TabsContent value="prep">
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5" data-testid="itv-respondents-prep">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="text-11 text-muted-foreground">
              「授权与准备」子标签内部在原型档案中<strong className="text-background-foreground">未探明</strong>（UC-6.3 R10）。
              此处不臆造界面；现场状态条口径「授权 3/4 · Weber 不参与 AI 分析」在<strong className="text-background-foreground">记录</strong>标签的左栏已实现。
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RespondentRow({ r, canWrite }: { r: Respondent; canWrite: boolean }) {
  const [revealed, setRevealed] = React.useState(false);
  return (
    <Card data-testid={`itv-respondent-${r.id}`}>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-11 font-mono text-muted-foreground">{r.id}</span>
              <span className="text-12 font-medium">{r.name}</span>
              <Badge tone={CONSENT_STATE_TONE[r.consent]} data-testid={`itv-respondent-consent-${r.id}`}>
                {CONSENT_STATE_LABEL[r.consent]}
              </Badge>
              {r.submittedAt && <span className="text-9 text-muted-foreground">提交 {r.submittedAt}</span>}
            </div>
            <span className="text-11 text-muted-foreground">{r.roleTitle}</span>
            <div className="flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
              <Badge tone="outline">{r.type}</Badge>
              <Badge tone="outline">{r.source}</Badge>
              <Badge tone="outline">{r.language}</Badge>
              {r.needsCaption && <Badge tone="warning">需字幕</Badge>}
            </div>
            {(r.tags.length > 0 || r.relations) && (
              <div className="flex flex-wrap items-center gap-1.5 text-10">
                {r.tags.map((t) => (
                  <span key={t} className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">{t}</span>
                ))}
                {r.relations && (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-accent-foreground" data-testid={`itv-respondent-relation-${r.id}`}>{r.relations}</span>
                )}
              </div>
            )}
          </div>

          {/* 联系方式：默认遮盖，查看写审计 */}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="font-mono text-11" data-testid={`itv-respondent-contact-${r.id}`}>
              {revealed ? r.contactFull : r.contactMasked}
            </span>
            {canWrite && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setRevealed((v) => !v)}
                data-testid={`itv-respondent-reveal-${r.id}`}
              >
                {revealed ? (
                  <><EyeOff aria-hidden className="h-3 w-3" /> 遮盖</>
                ) : (
                  <><Eye aria-hidden className="h-3 w-3" /> 查看（写审计）</>
                )}
              </Button>
            )}
          </div>
        </div>
        {revealed && (
          <p className="text-9 text-warning" data-testid={`itv-respondent-audit-${r.id}`}>
            已记录一条审计：你于此刻查看了 {r.id} 的联系方式（管理员的项目层访问对项目负责人可见）。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AiCandidatePanel() {
  const [open, setOpen] = React.useState(false);
  return (
    <section className="flex flex-col gap-2" data-testid="itv-ai-candidates">
      <Button size="sm" variant="ai" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="self-start" data-testid="itv-ai-candidate-trigger">
        <Sparkles aria-hidden className="h-3.5 w-3.5" /> AI 建议人选
      </Button>
      {open && (
        <div className="flex flex-col gap-2">
          <p className="text-10 text-muted-foreground">
            结果以候选卡出现在表下方，不直接插入名单行；每张卡含建议理由与来源，三出口。加入时联系方式留空，不自动填。
          </p>
          {AI_CANDIDATE_SUGGESTIONS.map((c) => (
            <Card key={c.id} data-testid={`itv-candidate-${c.id}`} className="border-ai/30">
              <CardContent className="flex flex-col gap-2 pt-4">
                <div className="flex items-center gap-2">
                  <Badge tone="ai">AI 候选</Badge>
                  <span className="text-12 font-medium">{c.name}</span>
                </div>
                <p className="text-11 text-muted-foreground">{c.reason}</p>
                <p className="text-9 text-muted-foreground">来源：{c.source}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="xs" variant="primary" onClick={() => {}} data-testid={`itv-candidate-add-${c.id}`}>
                    <Check aria-hidden className="h-3 w-3" /> 加入表
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => {}} data-testid={`itv-candidate-edit-${c.id}`}>
                    <Pencil aria-hidden className="h-3 w-3" /> 编辑后加入
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => {}} data-testid={`itv-candidate-ignore-${c.id}`}>
                    <X aria-hidden className="h-3 w-3" /> 忽略
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function MultipartySwitches({ canWrite }: { canWrite: boolean }) {
  const [switches, setSwitches] = React.useState(
    () => Object.fromEntries(MULTIPARTY_SWITCHES.map((s) => [s.id, s.on])) as Record<string, boolean>,
  );
  return (
    <section className="flex flex-col gap-2" data-testid="itv-multiparty">
      <div className="flex items-center gap-1.5">
        <Users aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        <h2 className="text-14 font-semibold">多人访谈设置</h2>
        <Badge tone="outline">7 个开关</Badge>
      </div>
      <div className="grid grid-cols-1 gap-1.5 rounded-md border border-border-subtle bg-panel p-3 sm:grid-cols-2">
        {MULTIPARTY_SWITCHES.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2" data-testid={`itv-switch-${s.id}`}>
            <span className="text-11">{s.label}</span>
            <Toggle
              checked={switches[s.id]!}
              onCheckedChange={(v) => canWrite && setSwitches((p) => ({ ...p, [s.id]: v }))}
              label={s.label}
              disabled={!canWrite}
            />
          </div>
        ))}
      </div>
      <p className="text-9 text-muted-foreground">
        「向受访者展示 AI 建议」默认关——AI 副驾驶的追问只对研究员，不下发给受访者。
      </p>
    </section>
  );
}
