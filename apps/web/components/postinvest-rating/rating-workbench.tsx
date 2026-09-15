"use client";

import * as React from "react";
import {
  AlertTriangle, CheckCircle2, Circle, Download, FileText, FileSpreadsheet, Image as ImageIcon,
  Loader2, RefreshCw, ShieldCheck, Upload, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { DataQualityFlag, PostinvestRatingRecord } from "@repo/contracts/postinvest-rating";
import { resolveGradeVisual } from "@/lib/postinvest-rating/grade-visual";
import {
  CURRENT_RECORD, RATING_VERSIONS, TRUSTED_WHITELIST, PROJECT_OPTIONS, UPLOAD_ROWS,
  RUN_STEPS, FEEDBACK_TYPE_OPTIONS, MISSING_REASON_OPTIONS,
} from "@/lib/postinvest-rating/mock";

const kebab = (code: string): string => code.replace(/_/g, "-");

const FLAG_LABEL: Readonly<Record<DataQualityFlag, string>> = {
  normal: "正常",
  incomplete: "数据不完整",
  estimated: "数据暂估",
  business_abnormal: "公司经营异常",
  suspected_abnormal: "数据疑似异常",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function formatYuan(v: number | null): string {
  if (v === null) return "—（缺失）";
  return `${(v / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 万元`;
}

export type WorkbenchState =
  | "default" | "loading" | "empty" | "running" | "hitl"
  | "result" | "validation" | "dependency" | "forbidden";
export type WorkbenchDialog = "none" | "feedback" | "recorded" | "confirm";
export type PreviewRoleCode = "consultant" | "lead" | "admin" | "compliance";

const ROLE_OPTIONS: readonly { code: PreviewRoleCode; label: string; note: string }[] = [
  { code: "consultant", label: "投资经理", note: "本项目成员：可上传、复核、反馈、采纳" },
  { code: "lead", label: "组长（lead）", note: "同上 + 跨项目查看 + 建新项目" },
  { code: "admin", label: "组织管理员", note: "维护 skill/白名单；不能替成员采纳" },
  { code: "compliance", label: "合规（只读）", note: "审计视角：只读，不能创建/反馈/采纳" },
];

export function RatingWorkbench({
  initialState = "default",
  initialDialog = "none",
  initialRole = "consultant",
}: {
  initialState?: WorkbenchState;
  initialDialog?: WorkbenchDialog;
  initialRole?: PreviewRoleCode;
}): JSX.Element {
  const [role, setRole] = React.useState<PreviewRoleCode>(initialRole);
  const [dialog, setDialog] = React.useState<WorkbenchDialog>(initialDialog);
  const [projectId, setProjectId] = React.useState<string>("");
  const [reasons, setReasons] = React.useState<ReadonlySet<string>>(new Set());
  const [feedbackType, setFeedbackType] = React.useState<string>("");
  const [feedbackTypeError, setFeedbackTypeError] = React.useState(false);

  const readOnly = role === "compliance";
  const canConfirm = role === "consultant" || role === "lead";
  const state = initialState;

  return (
    <div
      data-testid="rating-workbench"
      className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5 px-5 py-6 md:px-8 lg:px-10"
    >
      <WorkbenchHeader role={role} onRole={setRole} readOnly={readOnly} />

      {state === "loading" ? (
        <LoadingSkeleton />
      ) : state === "forbidden" ? (
        <ForbiddenPanel />
      ) : state === "dependency" ? (
        <DependencyErrorPanel />
      ) : state === "running" || state === "hitl" ? (
        <RunningPanel showHitl={state === "hitl"} />
      ) : state === "result" ? (
        <ResultPanel
          record={CURRENT_RECORD}
          readOnly={readOnly}
          canConfirm={canConfirm}
          onFeedback={() => { setFeedbackType(""); setFeedbackTypeError(false); setDialog("feedback"); }}
          onConfirm={() => setDialog("confirm")}
        />
      ) : (
        <SupplyPanel
          state={state}
          role={role}
          projectId={projectId}
          onProject={setProjectId}
          reasons={reasons}
          onToggleReason={(code) => {
            setReasons((prev) => {
              const next = new Set(prev);
              next.has(code) ? next.delete(code) : next.add(code);
              return next;
            });
          }}
        />
      )}

      {/* ── 反馈弹层（结果态触发）─────────────────────────────── */}
      <Dialog open={dialog === "feedback"} onOpenChange={(o) => !o && setDialog("none")}>
        <DialogContent data-testid="rating-feedback-dialog">
          <DialogHeader>
            <DialogTitle>反馈修正 · 依据行「净利润（本年）」</DialogTitle>
            <DialogDescription>先选错误类型（单选、必填），再填修正依据。主观偏差类只记录、不重算。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5" role="radiogroup" aria-label="错误类型">
              {FEEDBACK_TYPE_OPTIONS.map((opt) => {
                const active = feedbackType === opt.code;
                return (
                  <button
                    key={opt.code}
                    type="button"
                    data-testid={`rating-feedback-type-${kebab(opt.code)}`}
                    aria-checked={active}
                    role="radio"
                    onClick={() => { setFeedbackType(opt.code); setFeedbackTypeError(false); }}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-control border px-3 py-2 text-left transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "border-primary bg-accent" : "border-border bg-card hover:bg-muted",
                    )}
                  >
                    <span className={cn("mt-0.5 size-3.5 shrink-0 rounded-full border", active ? "border-primary bg-primary" : "border-border")} />
                    <span className="min-w-0">
                      <span className="block text-13 font-medium text-card-foreground">{opt.label}</span>
                      <span className="block text-11 text-muted-foreground">{opt.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {feedbackTypeError ? (
              <p data-testid="rating-feedback-type-error" className="text-11 font-medium text-destructive">
                请先选择错误类型再提交（FEEDBACK_TYPE_REQUIRED）。
              </p>
            ) : null}
            <div className="space-y-1">
              <label htmlFor="rating-feedback-basis" className="text-12 font-medium text-card-foreground">修正依据</label>
              <Textarea id="rating-feedback-basis" rows={3} placeholder="说明正确口径 / 数值来源；可附新材料（信息缺失类）。" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDialog("none")}>取消</Button>
            <Button
              variant="primary"
              size="sm"
              data-testid="rating-feedback-submit"
              onClick={() => {
                if (!feedbackType) { setFeedbackTypeError(true); return; }
                if (feedbackType === "subjective") { setDialog("recorded"); return; }
                setDialog("none");
              }}
            >
              提交反馈
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 主观偏差回显：已记录，评级不变 ─────────────────────── */}
      <Dialog open={dialog === "recorded"} onOpenChange={(o) => !o && setDialog("none")}>
        <DialogContent data-testid="rating-feedback-recorded-dialog">
          <DialogHeader>
            <DialogTitle>已记录，评级不变</DialogTitle>
          </DialogHeader>
          <p data-testid="rating-feedback-recorded-only" className="rounded-control bg-warning-tint px-3 py-2 text-12 text-warning-tint-foreground">
            主观偏差类反馈只记录、不重算、不改规则、不改权重（R7-6）。本条已写入修正历史，当前版本结论保持不变。
          </p>
          <DialogFooter>
            <Button variant="primary" size="sm" onClick={() => setDialog("none")}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 采纳二次确认（危险动作，规则 ⑦）─────────────────────── */}
      <Dialog open={dialog === "confirm"} onOpenChange={(o) => !o && setDialog("none")}>
        <DialogContent data-testid="rating-confirm-dialog">
          <DialogHeader>
            <DialogTitle>采纳本版本评级结论？</DialogTitle>
            <DialogDescription>这是不可逆动作。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-12 text-card-foreground">
            <p className="flex items-start gap-2 rounded-control bg-warning-tint px-3 py-2 text-warning-tint-foreground">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>采纳后本版本状态由 <strong className="font-medium">draft</strong> 变为 <strong className="font-medium">confirmed</strong> 并永久只读，不能再改；如需修改只能新开一轮评级。将记录采纳人与时间。</span>
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              <li>影响版本：v3（当前 draft）</li>
              <li>采纳人：{ROLE_OPTIONS.find((r) => r.code === role)?.label}</li>
              <li>下游：评级记录发布为可检索产出物，进入项目历史。</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDialog("none")}>取消</Button>
            <Button variant="destructive" size="sm" data-testid="rating-confirm-submit" onClick={() => setDialog("none")}>
              确认采纳（不可逆）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────────── 子面板 ─────────────────────────────── */

function WorkbenchHeader({
  role, onRole, readOnly,
}: { role: PreviewRoleCode; onRole: (r: PreviewRoleCode) => void; readOnly: boolean }): JSX.Element {
  return (
    <header className="space-y-3">
      <div className="space-y-1">
        <p className="text-11 font-medium text-muted-foreground">Studio / 海创汇 / Team2</p>
        <h1 className="text-24 font-semibold tracking-tight">投后财务项目评级 Agent</h1>
        <p className="max-w-3xl text-12 leading-relaxed text-muted-foreground">
          上传财务报表 / 审计报告 / 访谈录音，Agent 自动生成带依据、带不确定性标注的 A–E 评级；人只做数据供给与结果复核。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="预览视角切换">
        <span className="text-11 font-medium text-muted-foreground">预览视角</span>
        {ROLE_OPTIONS.map((opt) => {
          const active = role === opt.code;
          return (
            <button
              key={opt.code}
              type="button"
              data-testid={`rating-role-${opt.code}`}
              aria-pressed={active}
              title={opt.note}
              onClick={() => onRole(opt.code)}
              className={cn(
                "rounded-control border px-2.5 py-1 text-11 font-medium transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {opt.label}
            </button>
          );
        })}
        {readOnly ? <Badge tone="outline">只读视角</Badge> : null}
      </div>
    </header>
  );
}

function SupplyPanel({
  state, role, projectId, onProject, reasons, onToggleReason,
}: {
  state: WorkbenchState;
  role: PreviewRoleCode;
  projectId: string;
  onProject: (v: string) => void;
  reasons: ReadonlySet<string>;
  onToggleReason: (code: string) => void;
}): JSX.Element {
  const isEmptyProject = state === "empty";
  const uploadRows = isEmptyProject ? [] : UPLOAD_ROWS;
  const nothingToRun = uploadRows.length === 0;
  const showValidation = state === "validation";

  const projectOptions = PROJECT_OPTIONS.map((p) => ({ value: p.value, label: p.label }));
  const canNewProject = role === "lead";

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-14">1 · 选择项目</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Select
              data-testid="rating-project-picker"
              options={projectOptions}
              value={projectId}
              onValueChange={onProject}
              placeholder="选择投后项目…"
            />
            <Button variant="outline" size="xs" disabled={!canNewProject} data-testid="rating-new-project-button">
              + 新项目（仅填名称）
            </Button>
            {!canNewProject ? (
              <p className="text-11 text-muted-foreground">仅组长（lead）可新建项目。</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-14">2 · 上传数据</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              data-testid="rating-upload-dropzone"
              className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border bg-muted/40 px-4 py-8 text-center"
            >
              <Upload aria-hidden className="size-6 text-muted-foreground" />
              <p className="text-12 font-medium text-card-foreground">拖入或点击上传</p>
              <p className="max-w-md text-11 leading-relaxed text-muted-foreground">
                财务报表（xlsx/pdf）、审计报告（pdf/docx）走聊天附件路径；访谈录音（mp3/m4a/wav）统一走原件上传（不可变 + SHA-256 + 版本，D5）。
              </p>
            </div>

            {showValidation ? (
              <p data-testid="rating-upload-validation-error" className="flex items-start gap-2 rounded-control bg-destructive/10 px-3 py-2 text-11 font-medium text-destructive">
                <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>录音 <code>访谈.m4a</code> 误走了聊天附件路径：<code>AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD</code>。请改用原件上传（D5）。</span>
              </p>
            ) : null}

            {uploadRows.length === 0 ? (
              <p data-testid="rating-upload-empty" className="rounded-control bg-muted px-3 py-4 text-center text-11 text-muted-foreground">
                还没有文件。上传至少一份财务报表后即可开始评级。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {uploadRows.map((row, i) => (
                  <li
                    key={row.fileId}
                    data-testid={`rating-upload-item-${i + 1}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-border bg-card px-3 py-2"
                  >
                    <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-12 font-medium text-card-foreground">{row.filename}</span>
                    <span className="text-11 text-muted-foreground">{formatBytes(row.sizeBytes)}</span>
                    <span className="font-mono text-10 text-muted-foreground">{row.sha256.slice(0, 10)}…</span>
                    <Badge tone={row.kind === "recording" ? "ai" : "neutral"}>
                      {row.kind === "statement" ? "报表" : row.kind === "audit_report" ? "审计报告" : row.kind === "recording" ? "录音" : "未识别"}
                    </Badge>
                    {row.viaArtifactUpload ? <Badge tone="outline">原件上传</Badge> : null}
                    {row.parseStatus === "parsed" ? (
                      <Badge tone="primary"><CheckCircle2 aria-hidden className="size-3" />已解析</Badge>
                    ) : row.parseStatus === "parsing" ? (
                      <Badge tone="neutral"><Loader2 aria-hidden className="size-3 animate-spin" />解析中</Badge>
                    ) : (
                      <Badge tone="danger"><AlertTriangle aria-hidden className="size-3" />解析失败</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-14">3 · 数据缺失说明</CardTitle>
          </CardHeader>
          <CardContent>
            <fieldset data-testid="rating-missing-reason-form" className="space-y-2">
              <legend className="text-11 text-muted-foreground">人工确认事实，Agent 不得自行推断（R7-5）。可多选。</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {MISSING_REASON_OPTIONS.map((opt) => (
                  <Checkbox
                    key={opt.code}
                    data-testid={`rating-missing-reason-${kebab(opt.code)}`}
                    label={opt.label}
                    checked={reasons.has(opt.code)}
                    onChange={() => onToggleReason(opt.code)}
                  />
                ))}
              </div>
              {reasons.has("other") ? (
                <Textarea rows={2} placeholder="其他原因说明…" data-testid="rating-missing-reason-other-text" />
              ) : null}
              <Separator />
              <div className="grid gap-1.5 sm:grid-cols-3">
                <Checkbox data-testid="rating-missing-standalone-only" label="仅有单体报表" />
                <Checkbox data-testid="rating-missing-operating-only" label="仅有经营报告" />
                <Checkbox data-testid="rating-missing-no-prior-year" label="无上年对比数据" />
              </div>
            </fieldset>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button
            data-testid="rating-start-button"
            variant="primary"
            disabled={nothingToRun}
            title={nothingToRun ? "上传至少一份文件或选择历史项目后可开始" : undefined}
          >
            开始评级
          </Button>
          {nothingToRun ? (
            <span className="text-11 text-muted-foreground">无文件且无历史，暂不能开始。</span>
          ) : (
            <span className="text-11 text-muted-foreground">将创建一次 agent run（绑定 postinvest-rating agent）。</span>
          )}
        </div>
      </div>

      <div className="space-y-5">
        <HistoryCard empty={isEmptyProject} />
      </div>
    </div>
  );
}

function HistoryCard({ empty }: { empty: boolean }): JSX.Element {
  return (
    <Card>
      <CardHeader><CardTitle className="text-14">历史评级</CardTitle></CardHeader>
      <CardContent>
        {empty ? (
          <p className="rounded-control bg-muted px-3 py-4 text-center text-11 text-muted-foreground">
            本项目尚无评级记录。首次评级完成后，这里会出现版本链。
          </p>
        ) : (
          <ul className="space-y-1.5">
            {RATING_VERSIONS.map((v) => (
              <li key={v.id} className="flex items-center justify-between rounded-control border border-border px-3 py-1.5">
                <span className="text-12 font-medium">v{v.version} · {v.grade ?? "—"}</span>
                <Badge tone={v.status === "confirmed" ? "primary" : "outline"}>{v.status === "confirmed" ? "已采纳" : "草稿"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton(): JSX.Element {
  return (
    <div data-testid="rating-loading" className="space-y-4" aria-busy="true" aria-label="加载中">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-card border border-border bg-card p-5">
          <div className="mb-3 h-4 w-40 rounded-control bg-muted" />
          <div className="space-y-2">
            <div className="h-3 w-full rounded-control bg-muted" />
            <div className="h-3 w-2/3 rounded-control bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RunningPanel({ showHitl }: { showHitl: boolean }): JSX.Element {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card data-testid="rating-run-progress">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-14 flex items-center gap-2">
              <Loader2 aria-hidden className="size-4 animate-spin text-primary" />评级运行中
            </CardTitle>
            <Button variant="outline" size="xs" data-testid="rating-run-cancel">取消运行</Button>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {RUN_STEPS.map((step) => (
                <li key={step.tool} className="flex items-start gap-2.5">
                  {step.status === "done" ? (
                    <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : step.status === "running" ? (
                    <Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p className={cn("text-12 font-medium", step.status === "pending" ? "text-muted-foreground" : "text-card-foreground")}>{step.label}</p>
                    <p className="font-mono text-10 text-muted-foreground">{step.tool}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-5">
        {showHitl ? <HitlCard /> : (
          <Card>
            <CardHeader><CardTitle className="text-14">运行说明</CardTitle></CardHeader>
            <CardContent className="text-11 leading-relaxed text-muted-foreground">
              事件流复用既有 agent workbench 的进度 / 工具调用可见性；关闭页面后 run 继续在后端执行，回来可从记录恢复（A6）。
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function HitlCard(): JSX.Element {
  return (
    <Card data-testid="rating-hitl-card" className="border-warning">
      <CardHeader>
        <CardTitle className="text-14 flex items-center gap-2 text-warning-foreground">
          <AlertTriangle aria-hidden className="size-4" />需要你确认
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-12 leading-relaxed text-card-foreground">
          触发降级条件：<strong className="font-medium">净资产 &lt; 0</strong>（-4,120 万元，来源：2025 合并资产负债表·所有者权益合计）。
          正式落库前请确认触发依据是否属实。
        </p>
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" data-testid="rating-hitl-approve">确认属实，直接判 E</Button>
          <Button variant="outline" size="sm" data-testid="rating-hitl-reject">驳回并说明</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ResultPanel({
  record, readOnly, canConfirm, onFeedback, onConfirm,
}: {
  record: PostinvestRatingRecord;
  readOnly: boolean;
  canConfirm: boolean;
  onFeedback: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const visual = resolveGradeVisual(record.gradeMeta?.colorToken);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {/* 结论卡 */}
        <Card data-testid="rating-result-card" className="overflow-hidden">
          <div className="flex gap-4 p-5">
            <div className={cn("flex w-20 shrink-0 flex-col items-center justify-center rounded-card py-4", visual.chipClass)}>
              <span className="text-30 font-semibold leading-none">{record.grade ?? "—"}</span>
              <span className="mt-1 text-10">{visual.colorName}</span>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-16 font-semibold">评级 {record.grade}（{visual.colorName}）</h2>
                <Badge data-testid="rating-status-badge" tone={record.status === "confirmed" ? "primary" : "outline"}>
                  {record.status === "confirmed" ? "已采纳 confirmed" : "草稿 draft"}
                </Badge>
                <span className="text-11 text-muted-foreground">总分 {record.scores.total ?? "—"} · 脚本 {record.scores.scriptVersion}</span>
              </div>
              <p className="text-12 leading-relaxed text-card-foreground"><strong className="font-medium">含义：</strong>{record.gradeMeta?.meaning}</p>
              <p className="text-12 leading-relaxed text-card-foreground"><strong className="font-medium">投后管理建议：</strong>{record.gradeMeta?.advice}</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {record.flags.map((flag) => (
                  <Badge
                    key={flag}
                    data-testid={`rating-flag-${kebab(flag)}`}
                    tone={flag === "business_abnormal" ? "danger" : flag === "normal" ? "primary" : "warning"}
                  >
                    {FLAG_LABEL[flag]}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className={cn("h-1", visual.barClass)} />
        </Card>

        {/* 三个 Tab */}
        <Tabs defaultValue="evidence">
          <TabsList>
            <TabsTrigger value="evidence" data-testid="rating-tab-evidence">依据</TabsTrigger>
            <TabsTrigger value="uncertainty" data-testid="rating-tab-uncertainty">不确定性</TabsTrigger>
            <TabsTrigger value="reports" data-testid="rating-tab-reports">报告下载</TabsTrigger>
          </TabsList>

          <TabsContent value="evidence">
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full text-12">
                <thead className="bg-muted text-11 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">字段</th>
                    <th className="px-3 py-2 text-right font-medium">数值</th>
                    <th className="px-3 py-2 text-left font-medium">来源</th>
                    <th className="px-3 py-2 text-left font-medium">分项</th>
                    <th className="px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {record.evidence.map((row, i) => (
                    <tr key={i} data-testid={`rating-evidence-row-${i + 1}`} className="border-t border-border align-top">
                      <td className="px-3 py-2 font-medium text-card-foreground">{row.field}</td>
                      <td className={cn("px-3 py-2 text-right", row.value === null ? "text-warning-foreground" : "text-card-foreground")}>
                        {row.unit === "元" ? formatYuan(row.value) : row.value === null ? "—（缺失）" : row.value}
                      </td>
                      <td className="px-3 py-2 text-11 text-muted-foreground">{row.sourceLocator}</td>
                      <td className="px-3 py-2"><Badge tone="outline">{row.scoreComponent}</Badge></td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          data-testid={`rating-feedback-button-${i + 1}`}
                          disabled={readOnly}
                          onClick={onFeedback}
                        >
                          反馈
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="uncertainty">
            <div data-testid="rating-tab-uncertainty-panel" className="space-y-3">
              <ul className="space-y-1.5">
                {record.uncertainties.map((u, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-control border border-border bg-card px-3 py-2 text-12 text-card-foreground">
                    <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
                    <span>{u}</span>
                  </li>
                ))}
              </ul>
              <TrustedWhitelistPanel discarded={record.discardedOffWhitelistCount} />
            </div>
          </TabsContent>

          <TabsContent value="reports">
            <div className="grid gap-2 sm:grid-cols-3">
              {record.reports.map((rep) => {
                const Icon = rep.kind === "pdf" ? FileText : rep.kind === "xlsx" ? FileSpreadsheet : ImageIcon;
                return (
                  <div
                    key={rep.artifactId}
                    data-testid={`rating-report-${rep.kind}`}
                    aria-disabled={!rep.verified}
                    className={cn(
                      "flex items-center gap-2 rounded-card border border-border bg-card p-3",
                      !rep.verified && "opacity-100",
                    )}
                  >
                    <Icon aria-hidden className={cn("size-5 shrink-0", rep.verified ? "text-primary" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-12 font-medium text-card-foreground">
                        评级{rep.kind === "pdf" ? "报告.pdf" : rep.kind === "xlsx" ? "明细表.xlsx" : "趋势图.png"}
                      </p>
                      <p className="text-10 text-muted-foreground">{rep.verified ? "校验通过" : "未验证，暂不可下载（E9）"}</p>
                    </div>
                    <Button variant="outline" size="xs" disabled={!rep.verified}>
                      <Download aria-hidden className="size-3" />下载
                    </Button>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* 右栏：版本链 + 采纳 */}
      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle className="text-14">版本链</CardTitle></CardHeader>
          <CardContent>
            <ul data-testid="rating-version-list" className="space-y-1.5">
              {RATING_VERSIONS.map((v) => (
                <li
                  key={v.id}
                  data-testid={`rating-version-${v.version}`}
                  className={cn(
                    "flex items-center justify-between rounded-control border px-3 py-2",
                    v.id === record.id ? "border-primary bg-accent" : "border-border",
                  )}
                >
                  <div>
                    <p className="text-12 font-medium">v{v.version} · 评级 {v.grade ?? "—"}</p>
                    <p className="text-10 text-muted-foreground">
                      {v.corrections.length > 0 ? `因「${v.corrections[0]!.type}」重算` : "初评"}
                    </p>
                  </div>
                  <Badge tone={v.status === "confirmed" ? "primary" : "outline"}>{v.status === "confirmed" ? "已采纳" : "草稿"}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-14">采纳结论</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              data-testid="rating-confirm-button"
              disabled={readOnly || !canConfirm}
              onClick={onConfirm}
            >
              采纳本版本（v3）
            </Button>
            {!canConfirm ? (
              <p data-testid="rating-confirm-blocked" className="text-11 text-muted-foreground">
                {readOnly ? "合规视角只读，不能采纳。" : "管理员不是超级用户，不能替项目成员采纳（ADMIN_CANNOT_CONFIRM）。"}
              </p>
            ) : (
              <p className="text-11 text-muted-foreground">采纳需二次确认，且不可逆（R7-7）。</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TrustedWhitelistPanel({ discarded }: { discarded: number }): JSX.Element {
  return (
    <Card data-testid="rating-trusted-source-panel">
      <CardHeader>
        <CardTitle className="text-13 flex items-center gap-2">
          <ShieldCheck aria-hidden className="size-4 text-primary" />可信渠道白名单（只读）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-11 text-muted-foreground">
          仅白名单域名的检索结果参与行业背景；本次<strong className="font-medium text-warning-foreground"> 已丢弃 {discarded} 条</strong>非白名单来源。行业背景只影响文字评价，不改分数（R7-8）。
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TRUSTED_WHITELIST.domains.map((d) => (
            <Badge key={d} tone="outline"><span className="font-mono">{d}</span></Badge>
          ))}
        </div>
        <p className="text-10 text-muted-foreground">最近修改：{TRUSTED_WHITELIST.updatedBy}（{TRUSTED_WHITELIST.updatedAt.slice(0, 10)}）· 编辑入口仅组织管理员可见。</p>
      </CardContent>
    </Card>
  );
}

function ForbiddenPanel(): JSX.Element {
  return (
    <Card data-testid="rating-forbidden" className="mx-auto max-w-lg">
      <CardContent className="space-y-3 py-8 text-center">
        <XCircle aria-hidden className="mx-auto size-8 text-muted-foreground" />
        <h2 className="text-14 font-semibold">无权访问</h2>
        <p className="text-12 leading-relaxed text-muted-foreground">
          你不是本项目成员，或所属组织看不到「海创汇」入口。直达该地址返回 404（NO_PROJECT_ROLE / ORG_NOT_ELIGIBLE）。
        </p>
        <Button asChild variant="outline" size="sm"><a href="/agent">返回海创汇</a></Button>
      </CardContent>
    </Card>
  );
}

function DependencyErrorPanel(): JSX.Element {
  return (
    <Card data-testid="rating-dependency-error" className="mx-auto max-w-lg border-destructive">
      <CardContent className="space-y-3 py-8 text-center">
        <AlertTriangle aria-hidden className="mx-auto size-8 text-destructive" />
        <h2 className="text-14 font-semibold">服务暂不可用</h2>
        <p className="text-12 leading-relaxed text-muted-foreground">
          deep-agent-service 健康检查未通过（KERNEL_UNAVAILABLE），或沙箱不可用（SANDBOX_UNAVAILABLE）。评级未启动，未产生任何记录。
        </p>
        <Button variant="primary" size="sm" data-testid="rating-dependency-retry">
          <RefreshCw aria-hidden className="size-3.5" />重试
        </Button>
      </CardContent>
    </Card>
  );
}
