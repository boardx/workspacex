"use client";
import * as React from "react";
import { Wrench, ShieldQuestion, KeyRound, Check, X } from "lucide-react";
import { RuntimeShell, SectionTitle, DecisionNote } from "./runtime-shell";
import { ConfirmDialog, Toast } from "@/components/admin/panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { UiState } from "@/lib/ui-state";
import {
  FORGE_WHITELIST, THREE_LAYER_CASES, effectiveAllowed, denialLayer,
  RUNTIME_ROLE_LABEL, type RuntimeRole, type ThreeLayerDecision,
} from "@/lib/mock/agent-runtime";

const ROLES: RuntimeRole[] = ["maintainer", "securityReviewer", "admin", "methodReviewer", "facilitator"];

export function PermissionScreen({ role, state }: { role: RuntimeRole; state: UiState }) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(FORGE_WHITELIST.map((e) => [e.toolFullName, e.checked])),
  );
  const [cosign, setCosign] = React.useState(false);
  const [signOpen, setSignOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  // 越权申请 = 勾选了但不在授权范围内的条目
  const overreach = FORGE_WHITELIST.filter((e) => e.checked && !e.inScope);
  const readOnly = role === "methodReviewer" || role === "facilitator"; // 方法论审核人看方法不看权限；引导师只用不配

  return (
    <RuntimeShell
      screen="permission"
      role={role}
      state={state}
      roles={ROLES}
      title="三层权限 · 工具白名单编辑器"
      intro="有效权限 = ① MCP 授权范围 ∩ ② agent 工具白名单 ∩ ③ 任务权限包（收紧优先，下层不得放宽）。白名单里的越权申请须安全评审人 + 组织管理员会签。"
      emptyHint="这个 agent 还没配任何工具，白名单为空 —— 未配工具白名单不得发布"
      errors={{ toolWhitelist: "会签校验失败：仍有 1 条越权申请（mcp:客户 CRM.query_contact）未获组织管理员会签，不能保存为可发布状态。" }}
      depFailure="工具白名单的候选池来自 MCP 服务器清单（UC-21.1）；MCP 网关不可达，无法核对『在授权范围内 / 越权』。"
      denialReason="工具白名单与三层权限配置仅能力维护者可编辑；越权裁决仅安全评审人 + 组织管理员。"
      successMessage="Forge 的越权申请已会签放行，工具白名单定稿，agent 可提交发布"
    >
      <div className="flex flex-col gap-5">
        {/* A · 工具白名单编辑器（MCP 服务器 → 工具 两级树） */}
        <section className="flex flex-col gap-2" data-testid="perm-whitelist">
          <SectionTitle hint="按 MCP 服务器 → 工具两级呈现；每个工具标『在授权范围内 / 越权申请』，与授权范围实时对照。" testid="perm-whitelist-title">
            ② Agent 工具白名单 · Forge（自建 · 待审核）
          </SectionTitle>

          {groupByServer(FORGE_WHITELIST).map(([serverName, tools]) => (
            <Card key={serverName} data-testid={`perm-server-${serverName}`}>
              <CardContent className="flex flex-col gap-1.5 py-3">
                <div className="flex items-center gap-1.5">
                  <KeyRound aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-12 font-medium">{serverName}</span>
                </div>
                {tools.map((t) => (
                  <div key={t.toolFullName} className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-2" data-testid={`perm-tool-${t.toolFullName}`}>
                    <Checkbox
                      checked={checked[t.toolFullName] ?? false}
                      onChange={readOnly ? undefined : (e) => setChecked((p) => ({ ...p, [t.toolFullName]: e.currentTarget.checked }))}
                      disabled={readOnly}
                      label=""
                      aria-label={`白名单勾选 ${t.toolFullName}`}
                      data-testid={`perm-tool-check-${t.toolFullName}`}
                    />
                    <Wrench aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="font-mono text-12">{t.toolFullName}</span>
                    {t.writes && <Badge tone="warning">写操作</Badge>}
                    <span className="text-11 text-muted-foreground">{t.desc}</span>
                    <div className="ml-auto">
                      {t.inScope ? (
                        <Badge tone="outline" data-testid={`perm-scope-${t.toolFullName}`}>
                          <Check aria-hidden className="h-3 w-3" /> 在授权范围内
                        </Badge>
                      ) : (
                        <Badge tone="danger" data-testid={`perm-overreach-${t.toolFullName}`}>
                          <ShieldQuestion aria-hidden className="h-3 w-3" /> 越权申请
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          {/* 越权申请会签闸门 */}
          {overreach.length > 0 && (
            <Card data-testid="perm-cosign">
              <CardContent className="flex flex-col gap-2 py-3">
                <div className="flex items-start gap-2">
                  <ShieldQuestion aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <p className="text-12">
                    白名单里有 <strong>{overreach.length}</strong> 条越权申请。它实际在<strong>扩大 MCP 授权范围（第 ① 层）</strong>，
                    须 <strong>安全评审人 + 组织管理员会签</strong>；未逐条裁决不得批准发布。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {role === "admin" && (
                    <label className="flex items-center gap-1.5 text-11">
                      <Checkbox checked={cosign} onChange={(e) => setCosign(e.currentTarget.checked)} label="" aria-label="组织管理员会签" data-testid="perm-cosign-admin" />
                      组织管理员会签
                    </label>
                  )}
                  <Button
                    size="xs"
                    variant="primary"
                    disabled={role !== "securityReviewer" && role !== "admin"}
                    onClick={() => setSignOpen(true)}
                    data-testid="perm-cosign-action"
                    title={role === "securityReviewer" || role === "admin" ? undefined : "仅安全评审人 / 组织管理员可裁决越权申请"}
                  >
                    逐条裁决越权申请
                  </Button>
                  <span className="text-11 text-muted-foreground">当前视角：{RUNTIME_ROLE_LABEL[role]}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <DecisionNote testid="perm-note-clone">
            我替 UC 定的：<strong>复制现成 agent 时白名单不随复制继承</strong>（O-22① 避免权限静默扩散），
            故复制出的 agent 白名单为空、落在「未配白名单不得发布」闸门下。此处 Forge 是自建、非复制。
          </DecisionNote>
        </section>

        {/* B · 三层求交矩阵 */}
        <section className="flex flex-col gap-2" data-testid="perm-three-layer">
          <SectionTitle hint="同一个工具，换一层收紧就被拒；服务端可解释『卡在哪一层』。下层写了也不放宽上层。" testid="perm-three-layer-title">
            三层权限求交 · 「为什么被拒」可解释
          </SectionTitle>
          {THREE_LAYER_CASES.map((c) => (
            <ThreeLayerRow key={c.id} c={c} />
          ))}
          <DecisionNote tone="ai" testid="perm-note-compose">
            三层合成规则 = <strong>取交集（收紧优先）</strong>，与 UC-4.2 的三个 AI 权限粒度同构（O-23）。
            界面把三层画成并列三格，是为了让「下层不能放宽上层」一眼可见——这条是安全上唯一可辩护的合成方式。
          </DecisionNote>
        </section>
      </div>

      {signOpen && (
        <ConfirmDialog
          testid="perm-sign-dialog"
          title="裁决越权申请 · mcp:客户 CRM.query_contact"
          tone="destructive"
          requireReason
          reasonPlaceholder="例如：仅授予只读 query_contact，剔除 create_task 写权限，限本项目。"
          confirmLabel={role === "admin" ? "会签并放行" : "安全评审通过（待管理员会签）"}
          impact={
            <div className="flex flex-col gap-1">
              <p>放行后 Forge 可在<strong>仅项目负责人</strong>授权范围内调用该只读工具，等同扩大第 ① 层 MCP 授权范围。</p>
              <p className="text-destructive">写操作 create_task 未勾选、不在本次裁决内。</p>
              <p className="text-muted-foreground">越权申请须安全评审人 + 组织管理员双签方生效；审核人 ≠ 提交人。</p>
            </div>
          }
          onCancel={() => setSignOpen(false)}
          onConfirm={() => {
            setSignOpen(false);
            setToast(role === "admin" ? "已会签放行越权申请，白名单定稿" : "安全评审已通过，等待组织管理员会签");
          }}
        />
      )}
      <Toast message={toast} testid="perm-toast" onDismiss={() => setToast(null)} />
    </RuntimeShell>
  );
}

function ThreeLayerRow({ c }: { c: ThreeLayerDecision }) {
  const allowed = effectiveAllowed(c);
  const blocked = denialLayer(c);
  return (
    <Card data-testid={`perm-case-${c.id}`}>
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-12 font-medium">{c.scenario}</span>
          <Badge tone="outline" className="font-mono">{c.tool}</Badge>
          <div className="ml-auto">
            {allowed ? (
              <Badge tone="primary" data-testid={`perm-verdict-${c.id}`}><Check aria-hidden className="h-3 w-3" /> 放行</Badge>
            ) : (
              <Badge tone="danger" data-testid={`perm-verdict-${c.id}`}><X aria-hidden className="h-3 w-3" /> 拒绝 · 卡在 {blocked} 层</Badge>
            )}
          </div>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-3">
          <LayerCell tag="①" name="MCP 授权范围" v={c.mcpScope} testid={`perm-l1-${c.id}`} />
          <LayerCell tag="②" name="工具白名单" v={c.whitelist} testid={`perm-l2-${c.id}`} />
          <LayerCell tag="③" name="任务权限包" v={c.taskPack} testid={`perm-l3-${c.id}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function LayerCell({ tag, name, v, testid }: { tag: string; name: string; v: { passed: boolean; detail: string }; testid: string }) {
  return (
    <div className={`flex flex-col gap-1 rounded-md border p-2 ${v.passed ? "border-border-subtle bg-panel" : "border-destructive/30 bg-destructive/5"}`} data-testid={testid}>
      <div className="flex items-center gap-1 text-11 font-medium">
        <span className="text-muted-foreground">{tag}</span>
        {name}
        {v.passed ? <Check aria-hidden className="ml-auto h-3 w-3 text-success" /> : <X aria-hidden className="ml-auto h-3 w-3 text-destructive" />}
      </div>
      <p className="text-10 text-muted-foreground">{v.detail}</p>
    </div>
  );
}

function groupByServer(entries: typeof FORGE_WHITELIST): [string, typeof FORGE_WHITELIST][] {
  const map = new Map<string, typeof FORGE_WHITELIST>();
  for (const e of entries) {
    const arr = map.get(e.serverName) ?? [];
    arr.push(e);
    map.set(e.serverName, arr);
  }
  return [...map.entries()];
}
