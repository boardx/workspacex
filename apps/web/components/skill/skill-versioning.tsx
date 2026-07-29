"use client";
import * as React from "react";
import { GitBranch, Ban, RotateCcw, Trash2, ArrowUpCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { ScreenHead, RoleGate, NewScreenTag } from "./skill-shared";
import { VERSION_CHAIN, SKILLS, type SkillView, type VersionNode } from "@/lib/mock/skill";

const target = SKILLS.find((s) => s.id === "sk-mece")!;

export function SkillVersioning({ state, view }: { state: UiState; view: SkillView }) {
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-4">
      <ScreenHead title="Skill 版本与停用" uc="UC-3.4 R3 · F66">
        改契约提交为新版本草稿，不覆盖当前生效版；vN+1 发布后 vN 自动归档、已建实例锁定 vN。
        停用前列出三类引用与影响；对存在任何引用的 skill 硬删永久拒绝。
      </ScreenHead>

      <RoleGate view={view} allow={["maintainer", "reviewer"]} what="版本与停用（详情页区块）">
        <StateShell
          state={state}
          skeletonRows={4}
          emptyHint="这个 skill 还没有任何引用——可安全停用（空态）"
          errors={{ version: "新版本草稿校验失败：schema 破坏性改动未标注兼容级别（版本号语义待确认）" }}
          depFailure={{ what: "历史版本 v3 依赖的模型/MCP 不可用——进行中项目明确失败，不静默回退版本或换模型。" }}
          denial={{ layer: "organization", reason: "维护者可提交新版本草稿，但不能自行批准发布——门禁由审核人把关" }}
          successMessage="v5 发布成功 · v4 已自动归档；进行中项目的绑定快照仍指向锁定版本"
        >
          {/* 详情页头部元数据 */}
          <Card data-testid="skill-ver-header">
            <CardContent className="flex flex-wrap items-center gap-2 pt-4">
              <span className="text-13 font-medium">{target.name}</span>
              <Badge tone="primary">已启用 · v4 生效</Badge>
              <span className="text-10 text-muted-foreground">
                调用 {target.calls.toLocaleString()} · 来源 自建 · 可见性 全组织
              </span>
              {/* 蓝本侧升级提示（提示不阻断） */}
              <div className="flex w-full items-center justify-between rounded-md border border-primary/30 bg-accent/40 px-2 py-1.5">
                <span className="text-10">有新版本 v5 可用 —— 默认不自动跟随，由引导师显式升级</span>
                <Button size="xs" variant="primary" data-testid="skill-ver-upgrade">
                  <ArrowUpCircle aria-hidden className="h-3 w-3" /> 升级到 v5
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 版本链竖向时间线（真·未探明 → 补抽取；此处画出） */}
          <section className="flex flex-col gap-2" data-testid="skill-ver-chain">
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-1.5 text-13 font-semibold"><GitBranch aria-hidden className="h-4 w-4" />版本链</h2>
              <NewScreenTag>版本区块补抽取</NewScreenTag>
            </div>
            {VERSION_CHAIN.map((v) => <VersionRow key={v.version} v={v} />)}
          </section>

          {/* 危险动作区（与常规动作视觉分离） */}
          <section className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3" data-testid="skill-ver-danger">
            <div className="flex items-center gap-2">
              <h2 className="text-13 font-semibold text-destructive">危险动作</h2>
              <NewScreenTag>停用/恢复入口原型确认缺失</NewScreenTag>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="destructive" onClick={() => setDisableOpen(true)} data-testid="skill-ver-disable">
                <Ban aria-hidden className="h-3.5 w-3.5" /> 停用
              </Button>
              <Button size="sm" variant="outline" data-testid="skill-ver-restore">
                <RotateCcw aria-hidden className="h-3.5 w-3.5" /> 恢复（已停用的 skill 重新进入可绑定池）
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)} data-testid="skill-ver-harddelete">
                <Trash2 aria-hidden className="h-3.5 w-3.5" /> 硬删除
              </Button>
            </div>
            <p className="text-9 text-muted-foreground">
              停用 ≠ 删除；删除请求一律走合规删除流程（17-gov / UC-17.2）。
              停用是否需审核人签字待确认。
            </p>
          </section>
        </StateShell>
      </RoleGate>

      {disableOpen && <DisableDialog onClose={() => setDisableOpen(false)} />}
      {deleteOpen && <HardDeleteDialog onClose={() => setDeleteOpen(false)} />}
    </div>
  );
}

function VersionRow({ v }: { v: VersionNode }) {
  const tone = v.status === "live" ? "primary" : v.status === "draft" ? "warning" : "outline";
  const label = v.status === "live" ? "生效" : v.status === "draft" ? "草稿" : "已归档";
  return (
    <Card data-testid={`skill-ver-node-${v.version}`}>
      <CardContent className="flex flex-wrap items-center gap-2 pt-4">
        <Badge tone="outline" className="font-mono">{v.version}</Badge>
        <Badge tone={tone}>{label}</Badge>
        <span className="text-10 text-muted-foreground">{v.publishedAt} · {v.publisher}</span>
        <span className="text-10 text-muted-foreground">· {v.gate}</span>
        {v.lockedBy > 0 && <Badge tone="neutral">被 {v.lockedBy} 处引用锁定</Badge>}
      </CardContent>
    </Card>
  );
}

/* ── 停用确认：引用清单三栏嵌入对话框（不跳转）───────────────────── */

function DisableDialog({ onClose }: { onClose: () => void }) {
  const refs = target.refs;
  return (
    <DialogShell testid="skill-disable-dialog" title={`停用「${target.name}」`} onClose={onClose}>
      <p className="text-11 text-muted-foreground">
        停用后：新蓝本 / 新项目 / 新对话不再能选到它；<strong className="text-foreground">进行中的继续按锁定版本跑完</strong>。确认前不执行。
      </p>
      <div className="grid grid-cols-3 gap-2" data-testid="skill-disable-refs">
        <RefCol title="进行中项目" n={refs.projects} sample={["欧洲市场进入", "能源转型咨询"]} />
        <RefCol title="蓝本绑定" n={refs.blueprints} sample={["设计冲刺 5 天", "战略假设复盘"]} />
        <RefCol title="agent 挂载" n={refs.agents} sample={["假设助手 Ava"]} />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="destructive" onClick={onClose} data-testid="skill-disable-confirm">确认停用</Button>
        <Button size="sm" variant="ghost" onClick={onClose} data-testid="skill-disable-cancel">取消</Button>
      </div>
    </DialogShell>
  );
}

function RefCol({ title, n, sample }: { title: string; n: number; sample: string[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-2">
      <span className="text-9 uppercase tracking-wide text-muted-foreground">{title} · {n}</span>
      {sample.slice(0, n).map((s) => <span key={s} className="text-10">· {s}</span>)}
      {n === 0 && <span className="text-9 text-muted-foreground">（无）</span>}
    </div>
  );
}

/* ── 硬删拒绝（永久拒绝 + 返回引用清单；内置不可删）───────────────── */

function HardDeleteDialog({ onClose }: { onClose: () => void }) {
  return (
    <DialogShell testid="skill-harddelete-dialog" title="硬删除被永久拒绝" onClose={onClose} danger>
      <p className="text-11 text-destructive" role="alert">
        「{target.name}」存在引用（含历史项目），硬删被<strong className="text-foreground">永久拒绝</strong>——历史项目在保留期内必须能解析其当时使用的契约。
      </p>
      <p className="rounded-md border border-border-subtle bg-panel p-2 text-10 text-muted-foreground">
        返回的引用清单：进行中项目 {target.refs.projects} · 蓝本 {target.refs.blueprints} · agent 挂载 {target.refs.agents}。
        快照与绑定关系属不可删对象，不受留存期约束（O-01）。
        来源标记为 CC 的内置 skill 亦不可删除，只能停用/隐藏。
      </p>
      <Button size="sm" variant="ghost" onClick={onClose} data-testid="skill-harddelete-close">我知道了（请改用停用）</Button>
    </DialogShell>
  );
}

function DialogShell({
  testid, title, onClose, children, danger,
}: {
  testid: string; title: string; onClose: () => void; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" data-testid={testid} onClick={onClose}>
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="flex items-center gap-1.5 text-13 font-semibold">
          {danger && <AlertTriangle aria-hidden className="h-4 w-4 text-destructive" />}{title}
        </h3>
        {children}
      </div>
    </div>
  );
}
