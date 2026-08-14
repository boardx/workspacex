"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Link2, Info, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionTitle, StatChip } from "./parts";
import { ApiError } from "@/lib/api-client";
import { useSession } from "@/components/session/session-provider";
import { createProject } from "@/lib/live-projects";
import { listBlueprints, BLUEPRINT_STATE_LABEL, DURATION_TIER_LABEL, type BlueprintRow } from "@/lib/live-blueprints";
import { NEWPROJECT } from "@/lib/mock/project";
import { INIT_CATEGORIES } from "@/lib/mock/tpl";
import { Badge } from "@/components/ui/badge";

/**
 * 新建项目向导（原型 wsCreateView）—— PJ-01：从纯 mock 切到真实 `POST /projects`。
 *
 * ## 这次改了什么（以及为什么不是「保留原型、只换数据源」）
 *
 * 本文件此前的头注逐字写着「不接后端」：点「创建项目」只把本地状态翻成已提交，
 * 什么都没建。后端其实早就是真的（`createProject` 控制器 + 真 INSERT + 迁移，
 * F116 那批），缺的只是这一侧的接线。现在接上，并且**只接契约真的收的东西**：
 *
 *   `createProject.in` 是 `.strict()` 的四个字段 —— `orgId` / `name` / `kind` /
 *   `blueprintVersionId`。原型步骤 2 的时长档位、日期时间、参与人数、关联研究来源
 *   都**不在**其中。把它们画成可填的输入框会让人以为填了就存了 —— 那是本仓
 *   AGENTS.md 点名的「编一个看起来算过的数」的同一类事故。故这四项保持只读展示，
 *   并各挂一句「本版不写入后端」的旁注，等各自的契约有了出处再接。
 *
 * ## 蓝本目录为什么改成真数据了、又为什么选择依然禁用
 *
 * `GET /blueprints`（F175 / BP-01）已经是真控制器 + pg 仓储（`blueprint.controller.ts`），
 * 不再是「契约签核、后端零实现」——本区块因此从 `BLUEPRINT_CATALOG`（mock 目录）
 * 切到 `listBlueprints()`（`@/lib/live-blueprints`），展示这个组织**真实存在**的蓝本。
 *
 * 但选择依然禁用：能被这里真正用上的是**已发布版本**的 `blueprintVersionId`
 * （`POST /blueprints/:id/versions` 发布版本端点），而这条端点**还没实现**——
 * `listBlueprints` 返回的 `BlueprintRow` 里根本没有 `blueprintVersionId` 这个字段。
 * 所以本版一律仍走契约明写的**空白新建路径**（`blueprintVersionId: null`，
 * Q-1 裁决 C 逐字：此时六类初始化**跳过而非写空值**）。目录卡片保留真实渲染但
 * 整体禁用 + 如实说明「有蓝本、没有可套用的发布版本」，不是继续显示假数据，
 * 也不是假装能选。接「选蓝本真正建项目」是 PJ-12（依赖发布版本端点先落地）。
 *
 * ## 幂等
 * 契约 `applyBlueprint` 的幂等（V13）由后端 `idempotencyKey` 保证；界面这一侧只负责
 * 不让同一次点击意图发两次请求 —— 提交期间按钮禁用，**失败后恢复可点**
 * （旧实现一点就永久锁死，那样用户遇到 403/网络错误就再也建不了项目了）。
 */
export function NewProjectFlow() {
  const router = useRouter();
  const { session } = useSession();
  if (!session) throw new Error("NewProjectFlow requires an authenticated session");
  const orgId = session.currentOrgId;

  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const d = NEWPROJECT.defaults;
  const src = NEWPROJECT.linkedSources;

  // 蓝本目录：真实 `GET /blueprints`，见文件头注「蓝本目录为什么改成真数据了」。
  const [blueprints, setBlueprints] = React.useState<BlueprintRow[] | null>(null);
  const [blueprintsError, setBlueprintsError] = React.useState<string | null>(null);
  const [blueprintsBusy, setBlueprintsBusy] = React.useState(false);

  const refreshBlueprints = React.useCallback(async (org: string, isCancelled: () => boolean) => {
    if (org === "") return;
    setBlueprintsBusy(true);
    setBlueprintsError(null);
    try {
      const out = await listBlueprints(org);
      if (isCancelled()) return;
      setBlueprints(out);
    } catch (e) {
      if (isCancelled()) return;
      setBlueprintsError(describeError(e));
      setBlueprints(null);
    } finally {
      if (!isCancelled()) setBlueprintsBusy(false);
    }
  }, []);

  React.useEffect(() => {
    // 组件在 fetch 落地前卸载（路由跳走、测试提前拆卸环境）时不再 setState——
    // 不加这道门槛会在卸载后的 `finally` 里调用 `setBlueprintsBusy`，React 会尝试
    // 在已拆卸的环境上调度更新；jsdom 测试环境下这不只是警告，是真的
    // `ReferenceError: window is not defined`（`tests/ui/new-project-wizard.test.tsx`
    // 实测撞到过，见 `git blame` 附近提交）。
    let cancelled = false;
    void refreshBlueprints(orgId, () => cancelled);
    return () => { cancelled = true; };
  }, [orgId, refreshBlueprints]);

  const trimmed = name.trim();
  const canSubmit = trimmed !== "" && !busy;

  const handleCreate = React.useCallback(async () => {
    if (trimmed === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await createProject({
        orgId,
        name: trimmed,
        // 本屏就是「新建项目（工作坊）」；研究项目 / 用户洞察是另外两类容器，不在这里建。
        kind: "workshop",
        blueprintVersionId: null,
      });
      router.push(`/projects/${encodeURIComponent(out.id)}?org=${encodeURIComponent(orgId)}`);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }, [trimmed, busy, orgId, router]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6" data-testid="project-new">
      <header className="flex flex-col gap-2">
        <Button asChild size="sm" variant="outline" className="self-start" data-testid="project-new-back">
          <a href="/projects"><ChevronLeft aria-hidden className="h-3.5 w-3.5" />全部项目</a>
        </Button>
        <h1 className="text-20 font-semibold tracking-tight" data-testid="project-new-title">新建项目（工作坊）</h1>
        <p className="text-12 text-muted-foreground">
          一个项目就是一场工作坊：先选一套蓝本骨架，再填这一场的主题与时长。工作坊有四种项目角色；
          研究项目 / 用户洞察是另外两类独立容器，不在这里创建。
        </p>
      </header>

      <div className="flex flex-col gap-5">
        {/* 步骤 1：选蓝本 —— 后端未实现，整体禁用，走契约的空白新建路径 */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <StepDot n={1} />
            <SectionTitle className="mb-0" meta="蓝本决定环节骨架 · 每环节绑哪张画布 · AI 权限">选一套蓝本</SectionTitle>
          </div>
          <div
            data-testid="project-new-blueprint-unavailable"
            className="mb-2.5 flex items-start gap-2 rounded-md border border-border bg-muted px-2.5 py-2 text-10 leading-relaxed text-muted-foreground"
          >
            <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {blueprintsBusy
                ? "蓝本目录加载中…"
                : blueprintsError !== null
                  ? `蓝本目录加载失败：${blueprintsError}`
                  : blueprints !== null && blueprints.length > 0
                    ? `已有 ${blueprints.length} 个蓝本，但还没有可套用的已发布版本（发布版本端点未实现），下面的蓝本目录暂不可选。`
                    : "这个组织还没有人建过蓝本，下面暂时没有目录可看。"}{" "}
              本版一律以<strong className="font-medium text-foreground">空白骨架</strong>创建项目：
              不套用蓝本时六类初始化会整体跳过，而不是写入空值。
            </span>
          </div>
          {blueprintsError !== null ? (
            <div className="mb-2.5 flex items-center gap-2" data-testid="project-new-blueprints-error">
              <Button size="sm" variant="outline" onClick={() => void refreshBlueprints(orgId, () => false)} disabled={blueprintsBusy}>
                重试
              </Button>
            </div>
          ) : null}
          {blueprints !== null && blueprints.length > 0 ? (
            <div
              className="grid grid-cols-1 gap-2.5 opacity-50 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="project-new-blueprints"
            >
              {blueprints.map((b) => (
                <button
                  key={b.blueprintId}
                  type="button"
                  disabled
                  aria-disabled="true"
                  aria-pressed="false"
                  data-testid={`project-new-blueprint-${b.blueprintId}`}
                  className="flex cursor-not-allowed flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left"
                >
                  <span className="text-12 font-medium">{b.name}</span>
                  <span className="text-10 text-muted-foreground">
                    {BLUEPRINT_STATE_LABEL[b.state]} · {DURATION_TIER_LABEL[b.durationTier]}
                  </span>
                  <span className="mt-1 font-mono text-9 text-muted-foreground">
                    {b.agendaSegmentCount} 环节 · 完成度 {b.completeness.done}/{b.completeness.denominator} · 用过{" "}
                    {b.appliedProjectCount} 次
                  </span>
                </button>
              ))}
            </div>
          ) : blueprintsBusy ? (
            <div
              className="grid grid-cols-1 gap-2.5 opacity-50 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="project-new-blueprints-loading"
            >
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg border border-dashed border-border bg-muted" />
              ))}
            </div>
          ) : null}
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2" data-testid="project-new-scratch">
            {NEWPROJECT.scratchOptions.map((o) => {
              // 「从空白开始」是本版真实走的那条路径；「复制一场」同样没有后端。
              const active = o.id === "scratch";
              return (
                <div
                  key={o.id}
                  aria-pressed={active}
                  role="button"
                  aria-disabled={!active}
                  data-testid={`project-new-scratch-${o.id}`}
                  className={[
                    "flex flex-col gap-0.5 rounded-lg border border-dashed p-3 text-left",
                    active ? "border-primary bg-primary/5" : "border-border bg-panel opacity-50",
                  ].join(" ")}
                >
                  <span className="text-12 font-medium">{o.title}</span>
                  <span className="text-10 text-muted-foreground">
                    {active ? o.desc : `${o.desc}（暂不可用：复制一场需要蓝本/快照能力）`}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-10 leading-relaxed text-muted-foreground">{NEWPROJECT.blueprintNote}</p>
        </section>

        {/* 步骤 2：主题与时长 */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <StepDot n={2} />
            <SectionTitle className="mb-0" meta="选完蓝本，把骨架伸缩成这一场的议程">主题与时长</SectionTitle>
          </div>
          <Card><div className="flex flex-col gap-3.5 p-4" data-testid="project-new-details">
            <Field label="项目名称">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={d.name}
                aria-label="项目名称"
                data-testid="project-new-name"
                className="h-9 text-12"
              />
            </Field>

            {/* 契约 createProject.in 收不到下面这些字段，故只读展示 + 明示不写入 */}
            <Field label={src.label}>
              <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 opacity-60" data-testid="project-new-linked-source">
                <Link2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-12">{src.value}</span>
              </div>
              <div
                data-testid="project-new-linked-source-note"
                className="mt-1.5 flex items-start gap-2 rounded-md border border-ai/30 bg-ai-tint px-2.5 py-2 text-10 leading-relaxed text-ai-tint-foreground"
              >
                <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{src.note}</span>
              </div>
            </Field>

            <Field label="时长档位">
              <div className="flex flex-wrap gap-1.5 opacity-60" data-testid="project-new-duration">
                {d.durationTiers.map((t) => {
                  const dashed = "dashed" in t && t.dashed;
                  return (
                    <span
                      key={t.id}
                      data-testid={`project-new-duration-${t.id}`}
                      className={[
                        "grid h-7 place-items-center rounded-md border px-3 text-11",
                        dashed ? "border-dashed border-border text-muted-foreground" : "",
                        t.on ? "border-primary bg-primary text-primary-foreground font-medium" : "border-border",
                      ].join(" ")}
                    >
                      {t.label}
                    </span>
                  );
                })}
              </div>
            </Field>

            <div className="flex flex-col gap-3.5 sm:flex-row">
              <Field label="日期与开始时间" className="flex-1">
                <div className="flex h-8 items-center rounded-md border border-border bg-card px-3 font-mono text-11 opacity-60" data-testid="project-new-datetime">{d.datetime}</div>
              </Field>
              <Field label="参与人数（决定分几组）" className="flex-1">
                <div className="flex h-8 items-center rounded-md border border-border bg-card px-3 text-11 opacity-60" data-testid="project-new-headcount">{d.headcount}</div>
              </Field>
            </div>

            <p data-testid="project-new-unpersisted-note" className="text-10 leading-relaxed text-muted-foreground">
              关联研究来源、时长档位、日期时间、参与人数<strong className="font-medium text-foreground">本版不写入后端</strong> —— 创建项目的契约
              （POST /projects）只收组织、名称、容器类型与蓝本版本四项。这几项各自的写入路径
              还没有契约出处，先如实标注为不可编辑，不做「填了像存了」的假输入框。
            </p>
          </div></Card>
        </section>

        {/* 六类初始化一览（F23 AC2「逐项对得上」）——复用蓝本设计器同一份数据，不另开一份清单 */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <StepDot n={3} />
            <SectionTitle className="mb-0" meta="要么全部成功、要么整体回滚，不建半成品">套用蓝本后将初始化什么（六类）</SectionTitle>
          </div>
          <Card><ul className="flex flex-col gap-1.5 p-3" data-testid="project-new-init-preview">
            {INIT_CATEGORIES.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-11" data-testid="project-new-init-item">
                <Badge tone="primary">{c.label}</Badge>
                <span className="text-muted-foreground">{c.writes}</span>
              </li>
            ))}
          </ul></Card>
          <p className="mt-1.5 text-10 text-muted-foreground">
            以空白骨架创建时这六类<strong className="font-medium text-foreground">整体跳过</strong>，项目建成后为空 —— 不写入空值占位。
          </p>
        </section>

        {error !== null ? (
          <p data-testid="project-new-error" className="text-12 text-destructive">
            创建失败：{error}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => void handleCreate()}
            disabled={!canSubmit}
            data-testid="project-new-create"
          >
            {busy ? "创建中…" : "创建项目"}
          </Button>
          <Button asChild size="sm" variant="ghost" className="transition-colors" data-testid="project-new-cancel">
            <a href="/projects">取消</a>
          </Button>
          <span className="flex-1" />
          <StatChip tone="ai">以空白骨架创建</StatChip>
        </div>
      </div>
    </div>
  );
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}

function StepDot({ n }: { n: number }) {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-inverse font-mono text-10 text-inverse-foreground">{n}</span>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 text-10 text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
