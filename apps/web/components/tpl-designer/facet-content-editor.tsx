"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 蓝本设计器**真实**可编辑面板（解开 D-05 二级 sign-off 之后的第一个实现增量）。
 *
 * ## 本文件今天装的是什么
 *
 * 两样东西：① `FacetTextEditor`——通用自由文本编辑器，现在**只作兜底**
 * （见 `facet-editor-registry.ts`：15 个 designFacetKey 一个都不会落到它）；
 * ② `PermissionMatrixEditor`——「角色与权限」的权限矩阵。
 *
 * ⚠ 别把下面的历史读成现状：F193 落地时 16 项确实统一走 `FacetTextEditor`
 * （只有权限矩阵是例外），但 F204–F207 已把 15 项**全部**换成专属结构化编辑器。
 * `updateDesignFacet` 的 `content` 字段仍是**不透明字符串**（BP-02/F174 签核形状，
 * `design-deltas/blueprint-design-facet-panels/` 明确"本变更不改动任何已签核契约操作的形状"）
 * ——变的只是前端往这个字符串里写什么（现在写的是各面板的结构化 JSON），契约一字未改。
 *
 * ## 乐观并发
 *
 * `expectedItemRevision` 用调用方传入的当前值；空字符串哨兵表示"以为还没人填过"，
 * 与后端 `updateDesignFacet` 的既有约定一致。保存失败若是 `VERSION_CHANGED`
 * （并发冲突），提示用户刷新，不静默覆盖、不重试。
 */
export interface FacetSaveResult {
  readonly itemRevision: string;
  readonly completeness: { readonly done: number; readonly denominator: number };
}

export type FacetSaveFn = (
  designFacetKey: string,
  value: string,
  expectedItemRevision: string,
) => Promise<FacetSaveResult>;

export function FacetTextEditor({
  designFacetKey,
  content,
  itemRevision,
  onSave,
  placeholder,
}: {
  readonly designFacetKey: string;
  readonly content: string;
  readonly itemRevision: string;
  readonly onSave: FacetSaveFn;
  readonly placeholder?: string;
}) {
  const [value, setValue] = React.useState(content);
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  // 切换到另一个配置项（不同 designFacetKey）或外部刷新带来新内容时，同步本地态。
  React.useEffect(() => {
    setValue(content);
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function handleBlur(): Promise<void> {
    if (value === content) return; // 未改动，不发起写请求
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, value, revision);
      setRevision(out.itemRevision);
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      setError(describeSaveError(e));
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-border p-4" data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-13 font-semibold">内容</h3>
        <SaveStatusBadge status={status} />
      </div>
      <textarea
        className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void handleBlur()}
        placeholder={placeholder ?? "填写这一项的内容…"}
        data-testid={`bp-facet-content-${designFacetKey}`}
      />
      {error !== null && (
        <p role="alert" className="mt-1 text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}

function SaveStatusBadge({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  const label = status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败";
  return (
    <span
      className={cn(
        "text-11",
        status === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      data-testid="bp-facet-save-status"
    >
      {label}
    </span>
  );
}

function describeSaveError(e: unknown): string {
  const reasonCode = (e as { reasonCode?: unknown } | null)?.reasonCode;
  if (reasonCode === "VERSION_CHANGED") {
    return "这一项已被别处改动，你的输入未保存——请刷新页面后重新填写";
  }
  if (typeof reasonCode === "string" && reasonCode.length > 0) return `保存失败（${reasonCode}）`;
  if (e instanceof Error) return e.message;
  return "保存失败，请重试";
}

/* ══════════════════════════════════════════════════════════════════════════
 * 「角色与权限」——逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的
 * `RolesPanel` 与 `apps/web/lib/mock/tpl.ts` 的 `ROLES_PANEL` 重做
 * （2026-08-17 人类第二次强化指令：之前这里的锁定数据是占位符，是简化掉原型内容
 * 的失败案例，本次改成原型的真实 5 行 `permRows[].lockedFor` 数据，不再自己猜）。
 *
 * 灰色格子（`lockedFor` 命中的 (capability, role) 组合）只读——产品硬约束，界面禁用
 * 不可勾选，取值恒等于原型给定的 `vals`。其余格子可勾选，初始值取原型给定的默认
 * `vals`（不是全 false）——这是"套用蓝本时组长默认能写本组画布"这类默认权限的
 * 唯一事实源，用户可在未锁定的格子上自由改。
 *
 * 分组方式（职能混编/按议题自选）与组长产生方式（引导师指定/组内推举）是原型给的
 * 两个单选场景，本编辑器把它们做成真实可点的单选按钮；「邀请与进场」三行是原型的
 * 结构性事实（内部成员/外部参与者/观察者各自的进场方式），展示为只读参考。
 * ══════════════════════════════════════════════════════════════════════════ */

export const PERMISSION_CAPABILITIES = [
  "改议程",
  "写本组画布",
  "提交本组产出",
  "看别组过程",
  "看已发布结论",
] as const;
export type PermissionCapability = (typeof PERMISSION_CAPABILITIES)[number];

export const PERMISSION_ROLES = ["引导", "组长", "组员", "观察者"] as const;
export type PermissionRole = (typeof PERMISSION_ROLES)[number];

/** 原型 `ROLES_PANEL.permRows` 的逐字复制——默认勾选态 + 哪些角色对这项能力恒锁灰。 */
const PERM_ROWS: ReadonlyArray<{
  readonly cap: PermissionCapability;
  readonly vals: readonly boolean[]; // 对应 PERMISSION_ROLES 顺序
  readonly lockedFor: readonly PermissionRole[];
}> = [
  { cap: "改议程", vals: [true, false, false, false], lockedFor: ["组长", "组员", "观察者"] },
  { cap: "写本组画布", vals: [true, true, true, false], lockedFor: ["观察者"] },
  { cap: "提交本组产出", vals: [false, true, false, false], lockedFor: ["引导", "组员", "观察者"] },
  { cap: "看别组过程", vals: [true, false, false, false], lockedFor: ["组长", "组员", "观察者"] },
  { cap: "看已发布结论", vals: [true, true, true, true], lockedFor: [] },
];

const GROUPING_MODE_OPTIONS = ["职能混编", "按议题自选"] as const;
const GROUPING_MODE_NOTE = "每组必须同时有业务、财务、技术视角。AI 按名单自动排一版，引导师可改。";
const PER_GROUP_NOTE = "5 人（超 5 人自动拆组）";
const LEAD_FROM_OPTIONS = ["引导师指定", "组内推举"] as const;
const LOCK_NOTE = "灰色项不可在蓝本里放开——它们是产品的硬约束，不是默认值。";

const INVITE_ROWS = [
  { who: "内部成员", how: "SSO 免登直接进组" },
  { who: "外部参与者", how: "手机验证码 · 只核名单 · 令牌 24h（链接绑名单，参与者不需要注册）" },
  { who: "观察者", how: "独立只读链接 · 看原始内容需单独授权" },
] as const;

function cellKey(capability: PermissionCapability, role: PermissionRole): string {
  return `${capability}::${role}`;
}

function rowFor(capability: PermissionCapability) {
  return PERM_ROWS.find((r) => r.cap === capability)!;
}

function defaultCellValue(capability: PermissionCapability, role: PermissionRole): boolean {
  const row = rowFor(capability);
  const roleIndex = PERMISSION_ROLES.indexOf(role);
  return row.vals[roleIndex] ?? false;
}

function isLocked(capability: PermissionCapability, role: PermissionRole): boolean {
  return rowFor(capability).lockedFor.includes(role);
}

export interface PermissionMatrixValue {
  readonly groupingMode: (typeof GROUPING_MODE_OPTIONS)[number];
  readonly leadFrom: (typeof LEAD_FROM_OPTIONS)[number];
  /** 只存未锁定格子相对默认值的覆盖；缺省 = 用 `defaultCellValue`。 */
  readonly cells: Readonly<Record<string, boolean>>;
}

function emptyPermissionMatrixValue(): PermissionMatrixValue {
  return { groupingMode: GROUPING_MODE_OPTIONS[0], leadFrom: LEAD_FROM_OPTIONS[0], cells: {} };
}

/** 把矩阵值序列化成一段可存进 `content: string` 的文本（JSON），供 `updateDesignFacet` 使用。 */
export function serializePermissionMatrix(value: PermissionMatrixValue): string {
  return JSON.stringify(value);
}

/** 反序列化；空串/坏数据一律回退成"全未配置"（不抛错——不能因为一条坏数据把整个面板打崩）。 */
export function parsePermissionMatrix(content: string): PermissionMatrixValue {
  if (content.trim() === "") return emptyPermissionMatrixValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyPermissionMatrixValue();
    const p = parsed as Partial<PermissionMatrixValue>;
    return {
      groupingMode: GROUPING_MODE_OPTIONS.includes(p.groupingMode as never)
        ? (p.groupingMode as (typeof GROUPING_MODE_OPTIONS)[number])
        : GROUPING_MODE_OPTIONS[0],
      leadFrom: LEAD_FROM_OPTIONS.includes(p.leadFrom as never)
        ? (p.leadFrom as (typeof LEAD_FROM_OPTIONS)[number])
        : LEAD_FROM_OPTIONS[0],
      cells: typeof p.cells === "object" && p.cells !== null ? p.cells : {},
    };
  } catch {
    return emptyPermissionMatrixValue();
  }
}

export function PermissionMatrixEditor({
  designFacetKey,
  content,
  itemRevision,
  onSave,
}: {
  readonly designFacetKey: string;
  readonly content: string;
  readonly itemRevision: string;
  readonly onSave: FacetSaveFn;
}) {
  const [value, setValue] = React.useState<PermissionMatrixValue>(() => parsePermissionMatrix(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parsePermissionMatrix(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: PermissionMatrixValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializePermissionMatrix(next), revision);
      setRevision(out.itemRevision);
      setStatus("saved");
    } catch (e) {
      setValue(value); // 回滚本地乐观更新
      setStatus("error");
      setError(describeSaveError(e));
    }
  }

  function toggle(capability: PermissionCapability, role: PermissionRole): void {
    if (isLocked(capability, role)) return; // 灰色只读格：界面上禁用，点击直接不生效
    const key = cellKey(capability, role);
    const current = value.cells[key] ?? defaultCellValue(capability, role);
    const next = { ...value, cells: { ...value.cells, [key]: !current } };
    setValue(next);
    void persist(next);
  }

  function setGroupingMode(mode: (typeof GROUPING_MODE_OPTIONS)[number]): void {
    const next = { ...value, groupingMode: mode };
    setValue(next);
    void persist(next);
  }

  function setLeadFrom(lead: (typeof LEAD_FROM_OPTIONS)[number]): void {
    const next = { ...value, leadFrom: lead };
    setValue(next);
    void persist(next);
  }

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-roles-mode">
        <div className="mb-2 flex items-center gap-1.5">
          <h3 className="text-13 font-semibold">分组方式</h3>
          <SaveStatusBadge status={status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {GROUPING_MODE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setGroupingMode(option)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-12 font-medium transition-colors",
                value.groupingMode === option
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-muted",
              )}
              data-testid={`bp-roles-modeopt-${option}`}
            >
              {option}
            </button>
          ))}
          <span className="rounded border border-border px-1.5 py-0.5 text-11 text-muted-foreground">
            {PER_GROUP_NOTE}
          </span>
        </div>
        <p className="mt-1.5 text-11 text-muted-foreground">{GROUPING_MODE_NOTE}</p>
        <div className="mt-2 flex items-center gap-2 text-11">
          <span className="text-muted-foreground">组长产生：</span>
          {LEAD_FROM_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLeadFrom(option)}
              className={cn(
                "rounded border px-1.5 py-0.5 transition-colors",
                value.leadFrom === option
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
              data-testid={`bp-roles-leadfrom-${option}`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-roles-matrix">
        <h3 className="mb-2 text-13 font-semibold">角色权限默认值</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-12" data-testid="bp-permission-matrix">
            <thead>
              <tr className="border-b border-border text-11 text-muted-foreground">
                <th className="py-1.5 pr-2 text-left font-medium">能力</th>
                {PERMISSION_ROLES.map((role) => (
                  <th key={role} className="px-2 py-1.5 text-center font-medium" data-testid="bp-roles-col">
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_CAPABILITIES.map((capability) => (
                <tr key={capability} className="border-b border-border-subtle" data-testid="bp-roles-permrow">
                  <td className="py-1.5 pr-2 font-medium">{capability}</td>
                  {PERMISSION_ROLES.map((role) => {
                    const locked = isLocked(capability, role);
                    const key = cellKey(capability, role);
                    const checked = locked
                      ? defaultCellValue(capability, role)
                      : (value.cells[key] ?? defaultCellValue(capability, role));
                    return (
                      <td key={role} className="px-2 py-1.5 text-center" data-testid="bp-roles-cell">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={locked}
                          onChange={() => toggle(capability, role)}
                          aria-label={`${capability} · ${role}${locked ? "（锁定）" : ""}`}
                          data-testid={`bp-permission-cell-${capability}-${role}`}
                          className={cn(locked && "cursor-not-allowed opacity-50")}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-11 text-muted-foreground" data-testid="bp-roles-locknote">
          {LOCK_NOTE}
        </p>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-roles-invite">
        <h3 className="mb-2 text-13 font-semibold">邀请与进场</h3>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {INVITE_ROWS.map((row) => (
            <li key={row.who} className="flex items-center gap-2 p-2.5" data-testid="bp-roles-inviterow">
              <span className="w-24 shrink-0 text-12 font-medium">{row.who}</span>
              <span className="flex-1 text-11 text-muted-foreground">{row.how}</span>
            </li>
          ))}
        </ul>
      </div>

      {error !== null && (
        <p role="alert" className="text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
