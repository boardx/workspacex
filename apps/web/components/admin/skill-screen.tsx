"use client";
import * as React from "react";
import { Plus, FileCode2, Braces, DatabaseZap, Ban } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { VisibilityBadge } from "./scope-badges";
import { AdminDrawer, AdminModal, Toast, Field } from "./panel";
import { DisableDialog, type DisableMode } from "./disable-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SKILLS, SKILL_STATUS_LABEL, inFlightOf, type SkillStatusView, type SkillRow } from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";

const STATUS_TONE: Record<SkillStatusView, "primary" | "warning" | "neutral" | "outline"> = {
  enabled: "primary",
  review: "warning",
  draft: "neutral",
  disabled: "outline",
};

const CONTRACT_SAMPLE = `{
  "name": "假设优先级排序",
  "prompt_template": "对 {{hypotheses}} 按 {{criteria}} 排序…",
  "io_schema": { "input": ["hypotheses", "criteria"], "output": ["ranked", "rationale"] },
  "data_scope": "项目库"
}`;

export function SkillScreen({ state }: { state: UiState }) {
  const [importOpen, setImportOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [contract, setContract] = React.useState("");
  const [disabledIds, setDisabledIds] = React.useState<Set<string>>(new Set());
  const [disableOf, setDisableOf] = React.useState<SkillRow | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

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
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} data-testid="admin-skill-import">导入契约</Button>
            <Button size="sm" variant="primary" onClick={() => setAddOpen(true)} data-testid="admin-skill-add">
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
          {SKILLS.map((s) => {
            const isDisabled = disabledIds.has(s.id) || s.status === "disabled";
            const canTakeDown = s.status === "enabled" && !disabledIds.has(s.id);
            return (
            <Card key={s.id} data-testid={`admin-skill-row-${s.id}`}>
              <CardContent className="flex flex-col gap-2.5 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-13 font-medium">{s.name}</span>
                  <Badge tone="outline" className="font-mono">{s.version}</Badge>
                  <Badge tone={isDisabled ? "outline" : STATUS_TONE[s.status]} data-testid={`admin-skill-status-${s.id}`}>
                    {isDisabled ? SKILL_STATUS_LABEL.disabled : SKILL_STATUS_LABEL[s.status]}
                  </Badge>
                  <VisibilityBadge scope={s.visibility} team={s.team} data-testid={`admin-skill-visibility-${s.id}`} />
                  {s.origin === "方法晋升" && <Badge tone="ai">方法晋升</Badge>}
                  <div className="ml-auto flex items-center gap-4 text-11 text-muted-foreground">
                    <span>{s.calls.toLocaleString()} 次调用</span>
                    {s.satisfaction > 0 && <span>满意度 {s.satisfaction}%</span>}
                  </div>
                  {canTakeDown && (
                    <Button size="xs" variant="outline" onClick={() => setDisableOf(s)} data-testid={`admin-skill-disable-${s.id}`}>
                      <Ban aria-hidden className="h-3 w-3" />
                      下线
                    </Button>
                  )}
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
            );
          })}
        </div>
      </div>

      {/* 导入契约 */}
      {importOpen && (
        <AdminModal
          testid="admin-skill-import-dialog"
          width="lg"
          title="导入 skill 契约"
          subtitle="粘贴声明式契约 JSON（不接受可执行代码包，D-06）"
          onClose={() => setImportOpen(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)} data-testid="admin-skill-import-cancel">取消</Button>
              <Button
                size="sm"
                variant="primary"
                disabled={contract.trim().length < 10}
                onClick={() => { setImportOpen(false); setContract(""); setToast("契约已解析，数据范围声明将与提交人权限求交后进待审核队列"); }}
                data-testid="admin-skill-import-submit"
                title={contract.trim().length < 10 ? "先粘贴契约内容" : undefined}
              >
                解析并送审
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <textarea
              rows={10}
              value={contract}
              onChange={(e) => setContract(e.currentTarget.value)}
              placeholder={CONTRACT_SAMPLE}
              data-testid="admin-skill-import-textarea"
              className="rounded-md border border-border bg-card px-3 py-2 font-mono text-11 text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-11 text-muted-foreground">导入只做静态解析与权限求交，不执行任何代码。</p>
          </div>
        </AdminModal>
      )}

      {/* 新建 skill */}
      {addOpen && (
        <AdminDrawer
          testid="admin-skill-panel"
          title="新建 skill"
          subtitle="三段契约：模板 · schema · 数据范围"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)} data-testid="admin-skill-panel-cancel">取消</Button>
              <Button size="sm" variant="primary" onClick={() => { setAddOpen(false); setToast("已创建 skill 草稿，安全扫描与方法论审核通过后才可启用"); }} data-testid="admin-skill-panel-save">创建草稿</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field id="admin-skill-field-name" label="名称" placeholder="如 假设优先级排序" />
            <Field id="admin-skill-field-duty" label="职责一句话" placeholder="它替顾问做的那件事" />
            <div className="flex flex-col gap-1">
              <label htmlFor="admin-skill-field-template" className="text-11 font-medium text-muted-foreground">提示词模板（可带 {"{{变量}}"}）</label>
              <textarea
                id="admin-skill-field-template"
                rows={4}
                placeholder="对 {{hypotheses}} 按 {{criteria}} 排序，并给出理由…"
                data-testid="admin-skill-field-template"
                className="rounded-md border border-border bg-card px-2.5 py-1.5 text-12 text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Field id="admin-skill-field-schema" label="输入输出 schema（字段数）" placeholder="如 输入 2 · 输出 3" />
            <Field id="admin-skill-field-scope" label="数据范围声明（与 MCP 授权范围求交）" placeholder="如 项目库 ＋ 转写" />
          </div>
        </AdminDrawer>
      )}

      {/* 下线二选一确认（D-U5）*/}
      {disableOf && (
        <DisableDialog
          testid="admin-skill-disable-dialog"
          verb="下线"
          capabilityName={disableOf.name}
          inFlight={inFlightOf(disableOf.id)}
          interruptEffect={`正在引用此 skill 的 ${inFlightOf(disableOf.id)} 个 agent 调用会被立即中断，返回「该能力已被管理员停用」。`}
          drainEffect={`已发起的 ${inFlightOf(disableOf.id)} 个调用跑完当前一轮，此刻起 agent 白名单不再可绑定此 skill。`}
          onCancel={() => setDisableOf(null)}
          onConfirm={(mode: DisableMode) => {
            setDisabledIds((prev) => new Set(prev).add(disableOf.id));
            setToast(
              mode === "interrupt"
                ? `已下线 skill「${disableOf.name}」，并立即中断 ${inFlightOf(disableOf.id)} 个进行中的调用`
                : `已下线 skill「${disableOf.name}」；${inFlightOf(disableOf.id)} 个进行中的调用将跑完当前一轮，新调用即刻被拒`,
            );
            setDisableOf(null);
          }}
        />
      )}

      <Toast message={toast} testid="admin-skill-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}
