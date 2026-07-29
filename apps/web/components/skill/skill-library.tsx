"use client";
import * as React from "react";
import { Plus, FileCode2, Braces, DatabaseZap, Play, ShieldCheck, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { ScreenHead, RoleGate, NewScreenTag } from "./skill-shared";
import {
  SKILLS, REVIEW_QUEUE, TRY_RUN_SAMPLE,
  SKILL_STATUS_LABEL, SKILL_STATUS_TONE, SKILL_SOURCE_LABEL, SKILL_SOURCE_TONE,
  COMMUNITY_DISABLED, satisfactionText,
  type SkillView, type SkillRow,
} from "@/lib/mock/skill";

const enabled = SKILLS.filter((s) => s.status === "enabled");
const reviewing = SKILLS.filter((s) => s.status === "review");

export function SkillLibrary({ state, view }: { state: UiState; view: SkillView }) {
  const [tryOf, setTryOf] = React.useState<string | null>(null);
  const [viewOf, setViewOf] = React.useState<SkillRow | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-4">
      <ScreenHead title="Skill 库与市场" uc="UC-3.1 R3/R7 · F61 F62">
        每个 skill 是一份声明式契约（提示词模板 ＋ 输入输出 schema ＋ 数据范围声明），
        经<strong className="text-foreground">安全扫描 + 方法论审核</strong>双门禁发布。来源标记由系统按入口自动打标，提交人不可改写。
      </ScreenHead>

      <RoleGate view={view} allow={["maintainer", "reviewer", "facilitator"]} what="Skill 库">
        <StateShell
          state={state}
          skeletonRows={5}
          emptyHint="清空组织 skill 配置后就是这里——空态，而不是 86 条内建示例（F61 硬约束）"
          errors={{
            dataScope:
              "契约校验失败：数据范围声明申请读取「客户 CRM」，越出提交人自身权限——直接判失败、不进待审核队列",
          }}
          depFailure={{
            what: "试跑需调用 skill 声明的模型；该模型当前不可用，无法生成试跑结果。不静默换模型（对照 UC-20.3）。",
          }}
          denial={{ layer: "organization", reason: "Skill 库仅组织管理员与能力维护者可管理" }}
          successMessage="『MECE 假设拆解 v5』已通过安全扫描与方法论审核，置为已启用"
        >
          {view === "facilitator" && (
            <p className="mb-3 rounded-md border border-border-subtle bg-panel px-3 py-2 text-11 text-muted-foreground">
              引导师视角：只读浏览<strong className="text-foreground">已启用且可见性范围覆盖你</strong>的 skill，用于在蓝本里绑定（UC-3.2）。
              不能改契约、不能发布、看不到待审核队列。
            </p>
          )}

          {/* 标题行计数 + 两主动作 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-12 text-muted-foreground" data-testid="skill-lib-counts">
              {enabled.length} 个已启用 · {reviewing.length} 个待审核 ·
              本月组织额度 78%（4,820 万 / 6,200 万 tokens · 还剩 6 天）
            </p>
            {view !== "facilitator" && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={COMMUNITY_DISABLED}
                  data-testid="skill-lib-import"
                  title={COMMUNITY_DISABLED ? "社区导入 phase-1 不实现（D-06），入口置灰" : undefined}
                >
                  导入契约（社区 · 置灰）
                </Button>
                <Button size="sm" variant="primary" onClick={() => setAddOpen((v) => !v)} data-testid="skill-lib-add">
                  <Plus aria-hidden className="h-3.5 w-3.5" /> 新建 skill
                </Button>
              </div>
            )}
          </div>

          {/* 新建/编辑配置面板（真·未探明 → 补抽取；此处画出三段契约编辑器） */}
          {addOpen && view !== "facilitator" && (
            <ContractEditor onClose={() => setAddOpen(false)} />
          )}

          {/* 待审核队列（F62 双门禁） */}
          {view !== "facilitator" && (
            <section className="mt-4 flex flex-col gap-2" data-testid="skill-review-queue">
              <h2 className="text-13 font-semibold">待审核 · 双重门禁</h2>
              {REVIEW_QUEUE.map((r) => (
                <Card key={r.id} data-testid={`skill-review-row-${r.id}`} className="border-warning/30">
                  <CardContent className="flex flex-col gap-2 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-13 font-medium">{r.name}</span>
                      <Badge tone="warning">待审核</Badge>
                      <span className="text-10 text-muted-foreground">
                        {r.submitter} · {r.submittedAt}
                        {r.files ? ` · ${r.files} 个文件` : ""} · 来源 {SKILL_SOURCE_LABEL[r.source]}
                      </span>
                    </div>
                    {/* 两道门禁结论并排 */}
                    <div className="flex flex-wrap items-center gap-2 text-11">
                      <Badge tone={r.securityScan === "passed" ? "primary" : "danger"}>
                        <ShieldCheck aria-hidden className="h-3 w-3" />
                        安全扫描 {r.securityScan === "passed" ? "✓ 通过" : r.securityScan === "risk" ? "⚠ 有风险项待确认" : "✗ 拒绝"}
                      </Badge>
                      <Badge tone={r.methodReview === "passed" ? "primary" : r.methodReview === "returned" ? "danger" : "outline"}>
                        方法论审核 {r.methodReview === "pending" ? "⏳ 待审" : r.methodReview === "returned" ? "↩ 已退回" : "✓ 通过"}
                      </Badge>
                    </div>
                    {r.scanRisks && (
                      <ul className="flex flex-col gap-1 rounded-md border border-warning/30 bg-warning/5 p-2 text-10 text-muted-foreground">
                        {r.scanRisks.map((risk, i) => <li key={i}>· {risk}</li>)}
                      </ul>
                    )}
                    {r.returnReason && (
                      <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-10 text-destructive">{r.returnReason}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="xs" variant="primary" data-testid={`skill-review-approve-${r.id}`} disabled={view !== "reviewer"}>
                        批准发布 → 已启用
                      </Button>
                      <Button size="xs" variant="outline" data-testid={`skill-review-return-${r.id}`} disabled={view !== "reviewer"}>
                        退回（附理由）→ 草稿
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setTryOf((v) => (v === r.id ? null : r.id))} data-testid={`skill-review-tryrun-${r.id}`}>
                        <Play aria-hidden className="h-3 w-3" /> 试跑 <NewScreenTag>试跑入口</NewScreenTag>
                      </Button>
                      {view === "maintainer" && (
                        <span className="text-9 text-destructive">你是提交人：批准按钮对你禁用（提交人 ≠ 审核人，O-21）</span>
                      )}
                    </div>
                    {tryOf === r.id && <TryRunPanel bad={r.securityScan !== "passed"} />}
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {/* 全量清单 */}
          <section className="mt-4 flex flex-col gap-2" data-testid="skill-lib-list">
            <h2 className="text-13 font-semibold">
              {view === "facilitator" ? "可绑定的已启用 skill" : "全部 skill（含四态）"}
            </h2>
            {(view === "facilitator" ? enabled : SKILLS).map((s) => (
              <Card key={s.id} data-testid={`skill-row-${s.id}`}>
                <CardContent className="flex flex-wrap items-center gap-3 pt-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-13 font-medium">{s.name}</span>
                      <Badge tone="outline" className="font-mono">{s.version}</Badge>
                      <Badge tone={SKILL_SOURCE_TONE[s.source]} data-testid={`skill-source-${s.id}`}>
                        {SKILL_SOURCE_LABEL[s.source]}
                      </Badge>
                      <Badge tone={SKILL_STATUS_TONE[s.status]} data-testid={`skill-status-${s.id}`}>
                        {SKILL_STATUS_LABEL[s.status]}
                      </Badge>
                      {s.visibility === "team" && <Badge tone="outline">仅{s.team}</Badge>}
                      {s.idle && <Badge tone="neutral">闲置</Badge>}
                      {s.builtin && <Badge tone="outline">内置不可删</Badge>}
                    </div>
                    <p className="text-10 text-muted-foreground">
                      调用 {s.calls.toLocaleString()} · 满意度{" "}
                      <span data-testid={`skill-sat-${s.id}`}>{satisfactionText(s.up, s.down)}</span>
                      {s.up + s.down > 0 ? `（${s.up} 👍 / ${s.down} 👎）` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setViewOf(s)} data-testid={`skill-view-${s.id}`}>
                      <Eye aria-hidden className="h-3 w-3" /> 查看契约
                    </Button>
                    {view !== "facilitator" && (
                      <>
                        <Button size="xs" variant="outline" data-testid={`skill-edit-${s.id}`}>编辑</Button>
                        <Button size="xs" variant="ghost" onClick={() => setTryOf((v) => (v === s.id ? null : s.id))} data-testid={`skill-tryrun-${s.id}`}>
                          <Play aria-hidden className="h-3 w-3" /> 试跑<NewScreenTag>补画</NewScreenTag>
                        </Button>
                      </>
                    )}
                  </div>
                  {tryOf === s.id && (
                    <div className="w-full"><TryRunPanel bad={false} /></div>
                  )}
                </CardContent>
              </Card>
            ))}
          </section>
        </StateShell>
      </RoleGate>

      {/* 只读契约视图（真·未探明 → 补抽取；此处画出三段并列） */}
      {viewOf && <ContractViewer skill={viewOf} onClose={() => setViewOf(null)} />}
    </div>
  );
}

/* ── 三段契约编辑器（新建/编辑；补抽取所指的配置面板内部）─────────────── */

function ContractEditor({ onClose }: { onClose: () => void }) {
  return (
    <Card className="mt-3 border-primary/30" data-testid="skill-contract-editor">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-13 font-semibold">
            <FileCode2 aria-hidden className="h-4 w-4" /> 新建 skill · 声明式契约三件套
          </h3>
          <span className="text-9 text-muted-foreground">来源标记由系统按入口自动打标（自建），不可改写</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tmpl" className="flex items-center gap-1"><Braces aria-hidden className="h-3 w-3" />提示词模板（可带变量）</Label>
          <Textarea id="tmpl" data-testid="skill-editor-template" rows={3}
            placeholder="对 {{hypotheses}} 按 {{criteria}} 排序……" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="io" className="flex items-center gap-1"><Braces aria-hidden className="h-3 w-3" />输入输出 schema</Label>
          <Textarea id="io" data-testid="skill-editor-io" rows={2}
            placeholder='{ "input": ["hypotheses","criteria"], "output": ["ranked","rationale"] }' />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="scope" className="flex items-center gap-1"><DatabaseZap aria-hidden className="h-3 w-3" />数据范围声明（与 MCP 授权范围求交，上界=提交人权限）</Label>
          <Textarea id="scope" data-testid="skill-editor-scope" rows={1} placeholder="项目库 · 组织公共库" />
        </div>
        <p className="rounded-md border border-border-subtle bg-panel px-2 py-1.5 text-10 text-muted-foreground">
          提交后系统跑静态契约校验（必填齐全、schema 可解析自洽、数据范围不越权）与安全扫描，
          结论三态：通过 / 有风险项待确认 / 拒绝。<strong className="text-foreground">声明读原始转写但未授权 → 校验失败、不进待审核队列。</strong>
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" data-testid="skill-editor-submit">提交校验</Button>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="skill-editor-cancel">取消</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ContractViewer({ skill, onClose }: { skill: SkillRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-background/60 backdrop-blur-sm" data-testid="skill-contract-viewer" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col gap-3 overflow-y-auto border-l border-border bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-13 font-semibold">{skill.name} · 只读契约</h3>
          <Button size="xs" variant="ghost" onClick={onClose} data-testid="skill-contract-viewer-close">关闭</Button>
        </div>
        <ContractBlock label="提示词模板" body={skill.contract.template} />
        <ContractBlock label="输入输出 schema" body={`input: ${skill.contract.io.input.join(", ")}\noutput: ${skill.contract.io.output.join(", ")}`} />
        <ContractBlock label="数据范围声明" body={skill.contract.dataScope} />
      </div>
    </div>
  );
}

function ContractBlock({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-3">
      <span className="text-10 uppercase tracking-wide text-muted-foreground">{label}</span>
      <pre className="whitespace-pre-wrap font-mono text-11 text-foreground">{body}</pre>
    </div>
  );
}

function TryRunPanel({ bad }: { bad: boolean }) {
  return (
    <div className="mt-2 flex w-full flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-3" data-testid="skill-tryrun-panel">
      <span className="text-10 uppercase tracking-wide text-muted-foreground">试跑（样例输入 · 不落库）</span>
      <pre className="whitespace-pre-wrap font-mono text-10 text-muted-foreground">{TRY_RUN_SAMPLE.input}</pre>
      {bad ? (
        <div className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-2">
          <p role="alert" className="text-10 text-destructive">{TRY_RUN_SAMPLE.bad.reason}</p>
          <pre className="whitespace-pre-wrap font-mono text-9 text-muted-foreground">{TRY_RUN_SAMPLE.bad.log}</pre>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <pre className="whitespace-pre-wrap font-mono text-10 text-foreground">{TRY_RUN_SAMPLE.ok.output}</pre>
          <p className="text-9 text-muted-foreground">{TRY_RUN_SAMPLE.ok.note}</p>
        </div>
      )}
    </div>
  );
}
