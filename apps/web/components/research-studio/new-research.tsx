"use client";
import * as React from "react";
import { Bot, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProjectRole } from "@/lib/mock/project";
import {
  RS_KINDS, RS_DEPTHS, RS_SOURCES, RS_INTERNAL_SOURCES, RS_DELIVERABLES,
  RS_GROUPS, RS_NODES, RS_CONFIG_DEFAULT, buildPreview, type RsConfig,
} from "@/lib/mock/research-studio";
import {
  RESEARCH_ENTRY_POINTS, researchEntryTestId, canStartResearch,
  validateResearchConfig, isResearchConfigValid,
  type ResearchEntryAt,
} from "@/lib/research-new";

/**
 * F144 · 新建深度研究配置面板（`uc-24-1` / D-20 逐字点名的那一块）
 *
 * 与同目录 `rs-screens.tsx` 的 `RsNewScreen` 的关系：那一屏是 **UI 先行原型的截图机位**
 * （`defaultValue` + `data-selected`，静态，供 `ui-preview/research/` 取证）。
 * 本文件是**可交互的实现**：受控状态、预览句实时重算、三处入口、创建后落地。
 * 两者共用同一份枚举与默认值（`lib/mock/research-studio.ts`），**不各写一份**。
 *
 * ## 三条最容易做丢的
 * 1. **默认值逐项照 R3 表**（R7.5）。本仓已因「默认值画反」判过一次重做
 *    （`PROTOTYPE-SWEEP-UI.md` P-05），而**看截图看不出来默认值画反**——
 *    所以默认值不在本文件里写死，只从 `RS_CONFIG_DEFAULT` 取。
 * 2. **观察者的入口不渲染**（E5 / N-10）。见 `NewResearchEntry` 的 `return null`。
 * 3. **E1：Scout 不可用不得让创建失败**。契约面的表达是 `createResearch.err` 里
 *    **没有** `MODEL_UNAVAILABLE`（它属 `runResearch`）。界面面的表达是本文件的
 *    `scoutAvailable === false` 分支：研究**已创建**、停在待运行、给重试。
 */

/* ─────────────────────────── 入口（三处）─────────────────────────── */

/**
 * 三处入口共用的按钮。
 *
 * ⚠ **`canStartResearch` 为假时返回 `null`** —— 不是 `hidden`、不是 `disabled`、
 *   不是 `display:none`。`uc-24-1` E5 逐字「入口按钮**不渲染**（不是渲染后禁用）」。
 *   改成 `disabled` 的那一刻，`research-entry-observer-absent` 会当场红。
 */
export function NewResearchEntry({
  role, at, onOpen, className, icon,
}: {
  role: ProjectRole;
  at: ResearchEntryAt;
  onOpen?: () => void;
  className?: string;
  /** 仅装饰（Studio 侧原型带一个放大镜）。**不参与任何断言**，只为不改动已产出的截图像素。 */
  icon?: React.ReactNode;
}) {
  if (!canStartResearch(role)) return null;
  const point = RESEARCH_ENTRY_POINTS.find((p) => p.at === at)!;
  return (
    <Button
      size="sm"
      variant="primary"
      className={className}
      data-testid={researchEntryTestId(at)}
      onClick={onOpen}
    >
      {icon}{point.label}
    </Button>
  );
}

/* ─────────────────────────── 七组字段 ─────────────────────────── */

function Field({ n, label, hint, children }: { n: number; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={`rs-field-${n}`}>
      <label className="text-12 font-medium text-foreground">
        {n}. {label}{hint && <span className="ml-1 font-normal text-muted-foreground">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** 单选/多选的选中态一律落在 `data-selected` 上——测试断的是它，不是 class。 */
function Chip({
  testid, selected, onClick, children, className,
}: {
  testid: string; selected: boolean; onClick: () => void; children: React.ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-selected={selected}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-11 transition-colors",
        selected ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/**
 * 七组字段 + 实时预览句。**受控**——每次改动都重算 `buildPreview(config)`，
 * 因此预览句是**算出来的**，不是写死的（N-12 / N-4，`uc-24-1` R12.3）。
 *
 * ⚠ 预览句里的深度用 `depthL`，选项卡片上用 `note`——两串在原型里是两个常量，
 *   **哪串权威 Q-1 未裁**。本文件两串都摆，不选权威（契约刻意一串都不落）。
 */
export function NewResearchPanel({
  initial = RS_CONFIG_DEFAULT,
  onCancel,
  onCreate,
}: {
  initial?: RsConfig;
  onCancel?: () => void;
  onCreate?: (config: RsConfig) => void;
}) {
  const [config, setConfig] = React.useState<RsConfig>(initial);
  const [submitted, setSubmitted] = React.useState(false);
  const patch = (p: Partial<RsConfig>) => setConfig((c) => ({ ...c, ...p }));
  const errors = validateResearchConfig(config);
  const preview = buildPreview(config);

  return (
    <div className="mx-auto w-full max-w-2xl rounded-xl border border-border bg-card shadow-lg" data-testid="rs-new-panel">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-16 font-semibold text-foreground">新建深度研究</h2>
          <p className="max-w-lg text-11 leading-relaxed text-muted-foreground">
            先说清要查什么场景下的什么问题，研究模块据此决定检索路数与来源。
          </p>
        </div>
        <button type="button" onClick={onCancel} data-testid="rs-new-close" aria-label="关闭"
          className="text-muted-foreground transition-colors hover:text-foreground">×</button>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        <Field n={1} label="研究场景" hint="在什么处境下要这个答案">
          <textarea
            data-testid="rs-input-scene" rows={2} value={config.scene}
            onChange={(e) => patch({ scene: e.target.value })}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-12 text-foreground"
          />
        </Field>

        <Field n={2} label="要回答的问题" hint="一句话，可判定">
          <textarea
            data-testid="rs-input-question" rows={2} value={config.question}
            onChange={(e) => patch({ question: e.target.value })}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-12 text-foreground"
          />
          {submitted && errors.question && (
            /* `err-` 是七态里 invalid 的保留前缀（`RESERVED_STATE_TESTID.invalid`）。 */
            <p className="text-11 text-destructive" data-testid="err-question" role="alert">{errors.question}</p>
          )}
        </Field>

        <Field n={3} label="研究类型">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" data-testid="rs-input-kind">
            {RS_KINDS.map((k) => (
              <button
                key={k.code} type="button" data-testid={`rs-kind-${k.code}`}
                data-selected={config.kind === k.code} aria-pressed={config.kind === k.code}
                onClick={() => patch({ kind: k.code })}
                className={cn("rounded-md border px-2 py-1.5 text-11",
                  config.kind === k.code ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted")}
              >{k.label}</button>
            ))}
          </div>
        </Field>

        <Field n={4} label="深度与时间盒">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3" data-testid="rs-input-depth">
            {RS_DEPTHS.map((d) => (
              <button
                key={d.code} type="button" data-testid={`rs-depth-${d.code}`}
                data-selected={config.depth === d.code} aria-pressed={config.depth === d.code}
                onClick={() => patch({ depth: d.code })}
                className={cn("flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left",
                  config.depth === d.code ? "border-primary bg-accent" : "border-border hover:bg-muted")}
              >
                <span className="text-12 font-medium text-foreground">{d.label}</span>
                {/* 卡片串 `note`；预览句用的是 `depthL`。两串并存 = Q-1 未裁 */}
                <span className="text-10 text-muted-foreground">{d.note}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field n={5} label="来源偏好" hint="可多选">
          <div className="flex flex-wrap gap-1.5" data-testid="rs-input-sources">
            {RS_SOURCES.map((s) => (
              <Chip key={s} testid={`rs-source-${s}`} selected={config.sources.includes(s)}
                onClick={() => patch({ sources: toggle(config.sources, s) })}>
                {s}{RS_INTERNAL_SOURCES.includes(s) && <Badge tone="outline" className="ml-1">内部</Badge>}
              </Chip>
            ))}
          </div>
          <p className="text-10 text-muted-foreground">
            全不选的行为未定（Q-5）——不代裁：提交时不拦，由预览句显式提示「未选来源」。
          </p>
        </Field>

        <Field n={6} label="交付形式" hint="可多选">
          <div className="flex flex-wrap gap-1.5" data-testid="rs-input-deliverables">
            {RS_DELIVERABLES.map((d) => (
              <Chip key={d} testid={`rs-deliverable-${d}`} selected={config.deliverables.includes(d)}
                onClick={() => patch({ deliverables: toggle(config.deliverables, d) })}>{d}</Chip>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field n={7} label="挂到哪一组">
            <select
              data-testid="rs-input-group" value={config.groupRef}
              onChange={(e) => patch({ groupRef: e.target.value })}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-12"
            >
              {RS_GROUPS.map((g) => <option key={g.ref} value={g.ref}>{g.label}</option>)}
            </select>
          </Field>
          <Field n={7} label="哪个决策节点">
            <select
              data-testid="rs-input-node" value={config.nodeRef}
              onChange={(e) => patch({ nodeRef: e.target.value })}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-12"
            >
              {RS_NODES.map((n) => <option key={n.ref} value={n.ref}>{n.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="rounded-md border border-ai/20 bg-ai-tint px-3 py-2" data-testid="rs-preview">
          <p className="text-11 leading-relaxed text-ai-tint-foreground">
            <Bot className="mr-1 inline h-3.5 w-3.5" aria-hidden />{preview}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" data-testid="rs-new-cancel" onClick={onCancel}>取消</Button>
          <Button
            size="sm" variant="primary" data-testid="rs-new-create"
            onClick={() => {
              setSubmitted(true);
              /* E2：只做非空校验。`uc-24-1` 逐字禁止发明「可判定性打分」。 */
              if (!isResearchConfigValid(config)) return;
              onCreate?.(config);
            }}
          >创建</Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── 创建后的落地屏 + 提示（R3.4 / E1）─────────────────── */

/** 提示前缀逐字来自 `[原型 @16,906,659B]`「研究已创建 · {深度档位完整描述} 正在跑」。 */
export const RESEARCH_CREATED_PREFIX = "研究已创建 · ";

export function researchCreatedToast(config: RsConfig, scoutAvailable: boolean): string {
  const depthL = RS_DEPTHS.find((d) => d.code === config.depth)?.depthL ?? config.depth;
  /* E1：跑不动时提示不能说「正在跑」——那是把待运行伪装成运行中（E3 同族的错）。 */
  return scoutAvailable ? `${RESEARCH_CREATED_PREFIX}${depthL} 正在跑` : `${RESEARCH_CREATED_PREFIX}待运行`;
}

function CreatedDetail({ config, scoutAvailable, onRetry }: { config: RsConfig; scoutAvailable: boolean; onRetry?: () => void }) {
  return (
    <div className="flex flex-col gap-3" data-testid="rs-created-detail">
      <div className="rounded-md border border-primary/30 bg-accent px-3 py-2" role="status" data-testid="rs-created-toast">
        <p className="text-12 text-accent-foreground">{researchCreatedToast(config, scoutAvailable)}</p>
      </div>
      <h2 className="text-16 font-semibold text-foreground">{config.question}</h2>
      <p className="text-11 text-muted-foreground">{config.scene}</p>
      {/* 七项配置已固化到该研究上——它是执行契约，不是文案（R6 后置条件 / N-12）。 */}
      <p className="text-11 leading-relaxed text-muted-foreground" data-testid="rs-created-contract">
        {buildPreview(config)}
      </p>
      {!scoutAvailable && (
        /*
         * **E1**：Scout 不可用 ⇒ 研究**仍然创建成功**并停在「待运行」，
         * 显示失败原因与重试；**不得**因为跑不动就丢弃用户填的七项配置。
         * 契约面：`createResearch.err` 里没有 `MODEL_UNAVAILABLE`（它在 `runResearch`）。
         */
        <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2.5" role="alert" data-testid="dep-failed">
          <p className="text-12 font-medium text-foreground" data-testid="rs-created-pending">待运行 · Scout 暂不可用（MODEL_UNAVAILABLE）</p>
          <p className="text-11 text-muted-foreground">研究已创建，七项配置已保存；只是这一轮没跑起来。</p>
          <Button size="xs" variant="outline" className="mt-1 w-fit" data-testid="rs-created-retry" onClick={onRetry}>
            <RefreshCw className="h-3 w-3" aria-hidden />重试
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── 编排 ─────────────────────────── */

/**
 * 入口 → 弹层 → 创建落地 的完整一条路径（`uc-24-1` R3 主流程 + A1 + E1 + E5）。
 *
 * `initial` 支持 **A1 从某组发起**：小组能力面进入时传 `{ ...RS_CONFIG_DEFAULT, groupRef: capGk }`
 * ——原型逐字 `() => this.set({ modal: "newRes", nrGrp: capGk })` `[原型 @16,930,955B]`。
 */
export function NewResearchFlow({
  role, at, initial = RS_CONFIG_DEFAULT, scoutAvailable = true, className, icon,
}: {
  role: ProjectRole;
  at: ResearchEntryAt;
  initial?: RsConfig;
  scoutAvailable?: boolean;
  className?: string;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [created, setCreated] = React.useState<RsConfig | null>(null);

  if (created) return <CreatedDetail config={created} scoutAvailable={scoutAvailable} />;
  if (open) {
    return (
      <NewResearchPanel
        initial={initial}
        onCancel={() => setOpen(false)}
        onCreate={(c) => { setOpen(false); setCreated(c); }}
      />
    );
  }
  return <NewResearchEntry role={role} at={at} className={className} icon={icon} onOpen={() => setOpen(true)} />;
}
