"use client";
import * as React from "react";
import { Plus, Plug, Wrench, ShieldCheck, Check, Ban } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { AuthScopeBadge, ReviewBadge } from "./scope-badges";
import { AdminDrawer, ConfirmDialog, Toast, Field, KV } from "./panel";
import { DisableDialog, type DisableMode } from "./disable-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import {
  MCP_SERVERS, MCP_SUMMARY, MCP_CONN_LABEL, MCP_TOOLS, MCP_AUTH_LABEL, inFlightOf,
  type McpConnStatus, type McpRow,
} from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";

const CONN_TONE: Record<McpConnStatus, "primary" | "warning" | "danger"> = {
  connected: "primary",
  throttled: "warning",
  isolated: "danger",
};

type Panel = { mode: "add" } | { mode: "config" | "tools"; server: McpRow } | null;

export function McpScreen({ state }: { state: UiState }) {
  const [defaultIsolation, setDefaultIsolation] = React.useState(true);
  const [panel, setPanel] = React.useState<Panel>(null);
  const [reviewOf, setReviewOf] = React.useState<McpRow | null>(null);
  const [cleared, setCleared] = React.useState<Set<string>>(new Set());
  const [revoked, setRevoked] = React.useState<Set<string>>(new Set());
  const [disableOf, setDisableOf] = React.useState<McpRow | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  return (
    <AdminScreen
      state={state}
      moduleLabel="MCP"
      title="MCP 服务器"
      intro="注册服务器、设定授权范围、默认隔离。新注册的服务器默认隔离、工具不可被调用，须经人工评审放行。工具随授权范围被 agent 白名单引用。"
      emptyHint="还没有注册任何 MCP 服务器"
      errors={{ endpoint: "工具发现失败：端点握手成功但未返回工具清单；服务器保持已隔离，不放行" }}
      depFailure="工具发现与连接状态监测依赖 MCP 网关；网关不可达，无法确认工具数与连接状态。"
      denialReason="只有组织管理员能注册、配置授权范围；能力维护者只读服务器名与工具清单，看不到端点与凭据。"
      successMessage="服务器『欧盟法规库』维持隔离；授权范围已设为全体成员，评审状态待安全评审"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-12 text-muted-foreground">
            {MCP_SUMMARY.total} 台 · {MCP_SUMMARY.connected} 台已连接 · {MCP_SUMMARY.isolated} 台已隔离
          </p>
          <Button size="sm" variant="primary" onClick={() => setPanel({ mode: "add" })} data-testid="admin-mcp-add">
            <Plus aria-hidden className="h-3.5 w-3.5" />
            添加服务器
          </Button>
        </div>

        {/* 默认隔离安全策略（UC-21.2） */}
        <Card data-testid="admin-mcp-policy">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-start gap-2">
              <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="flex flex-col">
                <span className="text-12 font-medium">新服务器默认隔离，需人工评审后放行</span>
                <span className="text-11 text-muted-foreground">开启后，任何新注册服务器的工具在放行前都不可被任何 agent 调用。</span>
              </div>
            </div>
            <Toggle
              checked={defaultIsolation}
              onCheckedChange={setDefaultIsolation}
              label="新服务器默认隔离"
              data-testid="admin-mcp-policy-toggle"
            />
          </CardContent>
        </Card>

        {/* 两套枚举的界面澄清 —— 授权范围 ≠ 可见性范围；授权范围 ⊥ 评审状态 */}
        <div className="rounded-md border border-border-subtle bg-panel px-3 py-2.5 text-11 text-muted-foreground" data-testid="admin-mcp-scope-note">
          <p>
            这里的<strong className="text-background-foreground">「授权范围」</strong>（钥匙徽标）回答「谁能通过 agent 调用这台服务器的工具」，
            取值「仅项目负责人 / 仅某团队 / 全体成员」。它与 Agent/Skill 页的
            <strong className="text-background-foreground">「可见性范围」</strong>（眼睛徽标，全组织可用 / 仅某组）
            是两个不同维度——一个管「工具能不能被调」，一个管「能力能不能被看到」，不要合并。
          </p>
          <p className="mt-1.5">
            另外，<strong className="text-background-foreground">「评审状态」</strong>（盾牌徽标，待安全评审 / 已放行）
            与授权范围<strong className="text-background-foreground">正交</strong>：一台服务器可以同时「授权范围＝全体成员」且「评审状态＝待安全评审」，
            所以它们是两个并列的字段，不是一个。
          </p>
        </div>

        {/* 服务器清单：服务器 ｜ 端点 ｜ 工具 ｜ 授权范围 ｜ 评审 ｜ 状态 */}
        <div className="flex flex-col gap-1.5" data-testid="admin-mcp-list">
          {MCP_SERVERS.map((s) => {
            const isRevoked = revoked.has(s.id);
            const isCleared = !isRevoked && (cleared.has(s.id) || s.reviewStatus === "cleared");
            return (
              <Card key={s.id} data-testid={`admin-mcp-row-${s.id}`}>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <Plug aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-12 font-medium">{s.name}</span>
                      <span className="text-11 text-muted-foreground">{s.note}</span>
                      {s.touchesClientData && <Badge tone="warning">涉客户数据</Badge>}
                    </div>
                    <span className="font-mono text-10 text-muted-foreground">{s.endpoint}</span>
                  </div>

                  <div className="flex items-center gap-1 text-11 text-muted-foreground">
                    <Wrench aria-hidden className="h-3 w-3" />
                    {s.tools} 工具
                  </div>

                  {/* 授权范围（枚举②） */}
                  <AuthScopeBadge scope={s.authScope} team={s.authTeam} data-testid={`admin-mcp-authscope-${s.id}`} />

                  {/* 评审状态（枚举③，与授权范围并列） */}
                  <ReviewBadge status={isCleared ? "cleared" : "pending"} data-testid={`admin-mcp-review-${s.id}`} />

                  {/* 连接状态 */}
                  <Badge tone={CONN_TONE[s.conn]} data-testid={`admin-mcp-conn-${s.id}`}>
                    {MCP_CONN_LABEL[s.conn]}
                  </Badge>

                  {isRevoked && <Badge tone="danger" data-testid={`admin-mcp-revoked-${s.id}`}>已撤销授权</Badge>}

                  <div className="ml-auto flex gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => setPanel({ mode: "config", server: s })} data-testid={`admin-mcp-config-${s.id}`}>配置</Button>
                    {!isCleared ? (
                      <Button size="xs" variant="primary" onClick={() => setReviewOf(s)} data-testid={`admin-mcp-review-action-${s.id}`} disabled={isRevoked}>放行评审</Button>
                    ) : (
                      <>
                        <Button size="xs" variant="ghost" onClick={() => setPanel({ mode: "tools", server: s })} data-testid={`admin-mcp-tools-${s.id}`}>看工具</Button>
                        <Button size="xs" variant="outline" onClick={() => setDisableOf(s)} data-testid={`admin-mcp-revoke-${s.id}`}>
                          <Ban aria-hidden className="h-3 w-3" />
                          撤销授权
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* 添加 / 配置 / 看工具 抽屉 */}
      {panel?.mode === "add" && (
        <AdminDrawer
          testid="admin-mcp-panel"
          title="添加 MCP 服务器"
          subtitle="注册后默认隔离，工具须评审放行"
          onClose={() => setPanel(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)} data-testid="admin-mcp-panel-cancel">取消</Button>
              <Button size="sm" variant="primary" onClick={() => { setPanel(null); setToast("已注册服务器（默认隔离），工具发现将在放行后进行"); }} data-testid="admin-mcp-panel-save">注册（保持隔离）</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field id="admin-mcp-field-name" label="服务器名" placeholder="如 欧盟法规库" />
            <Field id="admin-mcp-field-endpoint" label="端点" placeholder="mcp://host:port" />
            <div className="flex flex-col gap-1">
              <span className="text-11 font-medium text-muted-foreground">授权范围（谁能通过 agent 调它的工具）</span>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(MCP_AUTH_LABEL) as (keyof typeof MCP_AUTH_LABEL)[]).map((k) => (
                  <Badge key={k} tone="outline">{MCP_AUTH_LABEL[k]}</Badge>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5">
              <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-11">按默认隔离策略，注册后工具对任何 agent 不可用，直到安全评审放行。</p>
            </div>
          </div>
        </AdminDrawer>
      )}

      {panel?.mode === "config" && (
        <AdminDrawer
          testid="admin-mcp-panel"
          title={`配置 · ${panel.server.name}`}
          subtitle="端点与凭据仅组织管理员可见"
          onClose={() => setPanel(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)} data-testid="admin-mcp-panel-cancel">取消</Button>
              <Button size="sm" variant="primary" onClick={() => { setPanel(null); setToast(`已保存「${(panel as { server: McpRow }).server.name}」的配置改动，已写审计`); }} data-testid="admin-mcp-panel-save">保存</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field id="admin-mcp-config-endpoint" label="端点" defaultValue={panel.server.endpoint} />
            <div className="flex flex-col divide-y divide-border-subtle">
              <KV k="授权范围" v={MCP_AUTH_LABEL[panel.server.authScope] + (panel.server.authTeam ? ` · ${panel.server.authTeam}` : "")} />
              <KV k="工具数" v={`${panel.server.tools} 个`} />
              <KV k="连接状态" v={MCP_CONN_LABEL[panel.server.conn]} />
              <KV k="涉客户数据" v={panel.server.touchesClientData ? "是（受出域红线约束）" : "否"} />
            </div>
          </div>
        </AdminDrawer>
      )}

      {panel?.mode === "tools" && (
        <AdminDrawer testid="admin-mcp-tools-drawer" title={`工具清单 · ${panel.server.name}`} subtitle="工具随授权范围被 agent 白名单引用；写操作单独标注" onClose={() => setPanel(null)}>
          <div className="flex flex-col gap-1.5" data-testid="admin-mcp-tools-list">
            {(MCP_TOOLS[panel.server.id] ?? []).map((t) => (
              <div key={t.name} className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-panel p-2.5" data-testid="admin-mcp-tool-row">
                <div className="flex items-center gap-2">
                  <Wrench aria-hidden className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono text-12 font-medium">{t.name}</span>
                  {t.writes && <Badge tone="warning">写操作</Badge>}
                </div>
                <p className="text-11 text-muted-foreground">{t.desc}</p>
              </div>
            ))}
          </div>
        </AdminDrawer>
      )}

      {/* 放行评审（危险动作二次确认） */}
      {reviewOf && (
        <ConfirmDialog
          testid="admin-mcp-review-dialog"
          title={`放行安全评审 · ${reviewOf.name}`}
          tone="destructive"
          requireReason
          reasonPlaceholder="例如：已核对端点归属与工具清单，无写操作越权，同意放行。"
          confirmLabel="确认放行"
          impact={
            <div className="flex flex-col gap-1">
              <p>放行后该服务器的 <strong className="text-background-foreground">{reviewOf.tools} 个工具</strong>将可被授权范围内（{MCP_AUTH_LABEL[reviewOf.authScope]}）的 agent 调用。</p>
              {reviewOf.touchesClientData && <p className="text-destructive">该服务器涉客户数据，放行即打开一条出域通道，请确认必要性。</p>}
              <p className="text-muted-foreground">放行是「默认隔离」策略的唯一出口，本次确认写入审计。</p>
            </div>
          }
          onCancel={() => setReviewOf(null)}
          onConfirm={() => {
            setCleared((s) => new Set(s).add(reviewOf.id));
            setToast(`已放行「${reviewOf.name}」，工具进入可被调用状态`);
            setReviewOf(null);
          }}
        />
      )}

      {/* 撤销授权二选一确认（D-U5）—— 撤销后该服务器的工具回到隔离、不可被调用 */}
      {disableOf && (
        <DisableDialog
          testid="admin-mcp-disable-dialog"
          verb="撤销授权"
          capabilityName={disableOf.name}
          inFlight={inFlightOf(disableOf.id)}
          interruptEffect={`正经此服务器发起、尚未返回的 ${inFlightOf(disableOf.id)} 个工具调用会被立即中断；工具回到隔离、不可被任何 agent 调用。`}
          drainEffect={`已发起的 ${inFlightOf(disableOf.id)} 个工具调用跑完当前一轮，此刻起新调用一律被拒、工具回到隔离。`}
          onCancel={() => setDisableOf(null)}
          onConfirm={(mode: DisableMode) => {
            setRevoked((prev) => new Set(prev).add(disableOf.id));
            setCleared((prev) => { const n = new Set(prev); n.delete(disableOf.id); return n; });
            setToast(
              mode === "interrupt"
                ? `已撤销「${disableOf.name}」授权并回到隔离，立即中断 ${inFlightOf(disableOf.id)} 个进行中的工具调用`
                : `已撤销「${disableOf.name}」授权；${inFlightOf(disableOf.id)} 个进行中的工具调用将跑完当前一轮，新调用即刻被拒`,
            );
            setDisableOf(null);
          }}
        />
      )}

      <Toast message={toast} testid="admin-mcp-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}
