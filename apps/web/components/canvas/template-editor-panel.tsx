"use client";
import * as React from "react";
import { GripVertical, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  updateCanvasTemplateDraft,
  TEMPLATE_STATUS_LABEL,
  type CanvasTemplate,
} from "@/lib/live-canvas";
import { TemplateCanvasGrid } from "./template-canvas-grid";
import { TemplateDisplayPanel } from "./template-display-panel";
import { TemplatePromptDrawer, type ExtractedField } from "./template-prompt-drawer";
import {
  toDraft, toContractSections, defaultLayoutAt, clampLayout, checkTemplateHealth,
  FIELD_TYPES,
  type SectionDraft, type SectionFieldType, type SectionLayoutDraft, type TemplateHealth,
} from "./template-editor-model";

/**
 * 模板编辑器（R3-R5，2026-08-26）——`Design.pdf` §4「界面二：拖拽式画布编辑器」。
 *
 * 顶栏：面包屑「模板库 / {模板名} · 模板编辑」+ A1 规格徽章 + 三步指示器 + 「发布模板」。
 * 三栏布局固定 **290 / 自适应 / 276**（§4 原话）。
 *
 * ## 只有草稿可编内容，这是刻意的
 *
 * `updateTemplateDraft`（唯一的内容写入口）只对 `status === "draft"` 生效——已发布/
 * 已归档版本仍是不可变快照。非草稿行是**只读预览 + 生命周期动作**；改内容只能先
 * 「基于此开新版」开出一个新草稿。
 * ⚠ 改**名字与标签**不受此限（走 `updateTemplateMetadata`，R2），那是元数据不是内容。
 *
 * ## 三步是"跳转"不是"向导"
 *
 * §4 原话「步骤指示器可点击跳转」——三步都在同一屏上同时可见（左中右三栏），
 * 指示器只是把注意力引到某一栏并给一句说明，不隐藏另外两栏。做成不可跳的向导会
 * 让"改完第三步回头看第一步"变成一次重走流程。
 */
const STEP_HINTS: Record<1 | 2 | 3, string> = {
  1: "① 写提示词、定字段 —— 先说清要 AI 干什么，再从提示词里提取字段；一个字段 = AI 返回的一个键 = 画布上的一块地方。",
  2: "② 从左边把字段拖到画布上，落点就是它在 A1 纸上的位置；拖动已放置的区块可以换位置。",
  3: "③ 选中区块，右边决定这份数据怎么显示：几列、最多几条、什么颜色、占多大。设置只影响呈现，不影响字段本身。",
};

export function TemplateEditorPanel({
  row, readOnly, onClose, onSaved,
  onPublish, onArchive, onRestore, onTrial, onMintVersion,
}: {
  readonly row: CanvasTemplate;
  readonly readOnly: boolean;
  readonly onClose: () => void;
  readonly onSaved: (message: string, updated: CanvasTemplate) => Promise<void> | void;
  readonly onPublish: () => void;
  readonly onArchive: () => void;
  readonly onRestore: () => void;
  readonly onTrial: () => void;
  readonly onMintVersion: () => void;
}) {
  const isDraft = row.status === "draft";
  const editable = isDraft && !readOnly;

  const [displayName, setDisplayName] = React.useState(row.displayName);
  const [sections, setSections] = React.useState<SectionDraft[]>(() => toDraft(row));
  const [step, setStep] = React.useState<1 | 2 | 3>(() => (toDraft(row).some((s) => s.layout) ? 2 : 1));
  const [gridCols, setGridCols] = React.useState<6 | 12>(12);
  const [showSample, setShowSample] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [promptText, setPromptText] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [newField, setNewField] = React.useState<{ key: string; name: string; type: SectionFieldType }>(
    { key: "", name: "", type: "便利贴列表" },
  );
  /** 非 null = 发布前置检查没过，正在等二次确认（§6 规则⑦：允许强制发布）。 */
  const [publishBlockers, setPublishBlockers] = React.useState<TemplateHealth | null>(null);

  const health = React.useMemo(() => checkTemplateHealth(sections, gridCols), [sections, gridCols]);
  const selected = sections.find((s) => s.sectionId === selectedId) ?? null;

  const dirty = editable && (
    displayName !== row.displayName
    || JSON.stringify(toContractSections(sections)) !== JSON.stringify(row.sections)
  );

  // Esc 关面板——同 `chat-diagram-canvas-modal.tsx` 等其它全屏编辑面板的既定约定。
  // ⚠ 提示词抽屉开着时先关抽屉，不直接关整个面板（否则一次 Esc 丢掉两层上下文）。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (promptOpen) setPromptOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, promptOpen]);

  function patchSection(sectionId: string, patch: Partial<SectionDraft>): void {
    setSections((prev) => prev.map((s) => (s.sectionId === sectionId ? { ...s, ...patch } : s)));
  }

  function patchLayout(sectionId: string, patch: Partial<SectionLayoutDraft>): void {
    setSections((prev) => prev.map((s) => {
      if (s.sectionId !== sectionId || !s.layout) return s;
      return { ...s, layout: clampLayout({ ...s.layout, ...patch }, gridCols) };
    }));
  }

  function place(sectionId: string, col: number, row_: number): void {
    setSections((prev) => prev.map((s) => {
      if (s.sectionId !== sectionId) return s;
      return { ...s, layout: clampLayout(defaultLayoutAt(s.type, col, row_, gridCols), gridCols) };
    }));
    // 放下后自动选中该区块并跳到第三步（§4.2 原话）。
    setSelectedId(sectionId);
    setStep(3);
  }

  function move(sectionId: string, col: number, row_: number): void {
    setSections((prev) => prev.map((s) => {
      if (s.sectionId !== sectionId || !s.layout) return s;
      return { ...s, layout: clampLayout({ ...s.layout, col, row: row_ }, gridCols) };
    }));
    setSelectedId(sectionId);
  }

  function addField(): void {
    const key = newField.key.trim();
    const name = newField.name.trim();
    if (key.length === 0 || name.length === 0) return;
    setSections((prev) => [...prev, {
      sectionId: `s${Date.now()}`,
      key, name, type: newField.type, aiHint: null,
      order: prev.length, required: false, capacity: null, layout: null,
    }]);
    setNewField({ key: "", name: "", type: newField.type });
    setStep(2);
  }

  function addExtracted(fields: readonly ExtractedField[]): void {
    setSections((prev) => {
      const have = new Set(prev.map((s) => s.key));
      const add = fields.filter((f) => !have.has(f.key)).map((f, i) => ({
        sectionId: `s${Date.now()}-${i}`,
        key: f.key, name: f.name, type: f.type, aiHint: f.why,
        order: prev.length + i, required: false, capacity: null, layout: null,
      }));
      return [...prev, ...add];
    });
  }

  /**
   * 发布前置检查（`Design.pdf` §6 规则⑦ / §7 第 9 条）。
   *
   * 「画布无溢出、无未放置字段——未满足时**列出**，允许强制发布但需**二次确认**」。
   * ⚠ 判据来自 `checkTemplateHealth`，与右栏体检面板**同一个函数**（§6 规则⑤逐字要求
   *   「体检、发布检查同源计算，不得留静态文案」）——绑定一个字段之后，两处的警告
   *   必然同时消失，因为它们读的是同一份计算结果。
   */
  function requestPublish(): void {
    if (health.publishClean) {
      onPublish();
      return;
    }
    setPublishBlockers(health);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const out = await updateCanvasTemplateDraft({
        key: row.key,
        version: row.version,
        displayName: displayName.trim(),
        sections: toContractSections(sections),
        visibility: row.visibility,
        tags: [...(row.tags ?? [])],
      });
      await onSaved(`已保存「${out.displayName}」的改动`, { ...out, usageCount: 0 });
    } catch (e) {
      setError(e instanceof ApiError ? `${e.reasonCode ?? "无 reasonCode"}（HTTP ${e.status}）` : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-labelledby="tpladmin-editor-title" data-testid="tpladmin-editor-panel">
      {/* 顶栏 */}
      <header className="flex flex-none flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-2.5">
        <Button size="icon" variant="ghost" aria-label="返回模板库" onClick={onClose} data-testid="tpladmin-editor-close">
          <X aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <button type="button" className="rounded-control text-11 text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClose}>模板库 ／</button>
        <h1 id="tpladmin-editor-title" data-testid="tpladmin-editor-title" className="truncate text-14 font-bold">
          {row.displayName} · 模板编辑
        </h1>
        <span className="whitespace-nowrap rounded-xl bg-muted px-2 py-0.5 text-10 font-semibold text-muted-foreground" data-testid="tpladmin-editor-a1-badge">
          A1 横版 841×594mm · 内容区 821×574
        </span>
        <Badge tone={row.status === "published" ? "primary" : row.status === "draft" ? "warning" : row.status === "trial" ? "outline" : "neutral"}>
          {TEMPLATE_STATUS_LABEL[row.status]}
        </Badge>
        {dirty && !saving && (
          <span className="text-11 text-muted-foreground" data-testid="tpladmin-editor-dirty">有未保存的改动</span>
        )}

        {/* 三步指示器——可点击跳转（§4 原话）。 */}
        <div className="ml-auto flex items-center gap-3">
          {([[1, "提示词与字段"], [2, "拖到画布"], [3, "设定显示"]] as const).map(([n, label]) => (
            <button
              key={n}
              type="button"
              className="flex items-center gap-1.5 transition-opacity duration-fast"
              style={{ opacity: step === n ? 1 : 0.62 }}
              onClick={() => { setStep(n); if (n === 1) setPromptOpen(true); }}
              data-testid={`tpladmin-editor-step-${n}`}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-10 font-bold"
                style={{ background: step === n ? "#14130F" : "#E7E5DE", color: step === n ? "#F7E96E" : "#8d8a82" }}
              >
                {n}
              </span>
              <span className={`text-11 ${step === n ? "font-bold" : ""}`}>{label}</span>
            </button>
          ))}
          {editable && (
            <Button size="sm" variant="outline" disabled={!dirty || saving || displayName.trim().length === 0} onClick={() => void save()} data-testid="tpladmin-editor-save">
              {saving ? "正在保存…" : dirty ? "保存改动" : "已保存"}
            </Button>
          )}
          {!readOnly && (row.status === "draft" || row.status === "trial") && (
            <Button size="sm" variant="primary" onClick={requestPublish} data-testid="tpladmin-editor-publish">发布模板</Button>
          )}
          {!readOnly && row.status === "draft" && (
            <Button size="sm" variant="outline" onClick={onTrial} data-testid="tpladmin-editor-trial">试跑</Button>
          )}
          {!readOnly && row.status === "published" && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onArchive} data-testid="tpladmin-editor-archive">归档</Button>
          )}
          {!readOnly && row.status === "archived" && (
            <Button size="sm" variant="outline" onClick={onRestore} data-testid="tpladmin-editor-restore">恢复</Button>
          )}
          {!readOnly && row.status !== "draft" && (
            <Button size="sm" variant="outline" onClick={onMintVersion} data-testid="tpladmin-editor-mint">基于此开新版</Button>
          )}
        </div>
      </header>

      {/* 当前步的一句说明（§4 原话「当前步在提示条里给一句话说明」）。 */}
      <p className="flex-none border-b border-warning/30 bg-warning/5 px-5 py-2 text-11 text-muted-foreground" data-testid="tpladmin-editor-step-hint">
        {STEP_HINTS[step]}
      </p>

      {!isDraft && (
        <p className="flex-none border-b border-warning/40 bg-warning/5 px-5 py-1.5 text-11 text-muted-foreground" data-testid="tpladmin-editor-immutable-note">
          已发布/已归档版本是不可变快照——这里只能预览，改内容请先「基于此开新版」。
        </p>
      )}

      {/* 三栏：290 / 自适应 / 276 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[290px_1fr_276px]">
        {/* ① 字段 */}
        <div className="flex min-h-0 flex-col border-b border-border bg-card lg:border-b-0 lg:border-r">
          <div className="flex flex-none items-center gap-2 px-3.5 pb-2 pt-3">
            <span className="text-12 font-bold">① 字段</span>
            <span className="text-11 text-muted-foreground" data-testid="tpladmin-editor-field-summary">
              {health.fieldCount} 个 · 已放 {health.placedCount} 个
            </span>
            <Button size="xs" variant="outline" className="ml-auto" onClick={() => { setPromptOpen(true); setStep(1); }} data-testid="tpladmin-editor-open-prompt">
              提示词
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto px-3.5 pb-3">
            {sections.map((s, i) => {
              const isPlaced = s.layout !== null;
              return (
                <div
                  key={s.sectionId}
                  draggable={editable && !isPlaced}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-tpl-drag", JSON.stringify({ id: s.sectionId, kind: "field" }));
                    setStep(2);
                  }}
                  onClick={() => { setSelectedId(s.sectionId); if (isPlaced) setStep(3); }}
                  className="flex cursor-pointer flex-col gap-1 rounded-card border p-2.5 transition-colors duration-fast"
                  style={{
                    borderColor: isPlaced ? "var(--border, #E3E1DA)" : "#E6C765",
                    background: selectedId === s.sectionId ? "#FBF7DC" : "var(--card, #fff)",
                  }}
                  data-testid={`tpladmin-editor-field-${s.key}`}
                >
                  <div className="flex items-center gap-1.5">
                    <GripVertical aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="font-mono text-10 font-bold text-primary">
                      {`{{${s.key}${s.type === "便利贴列表" ? "[]" : ""}}}`}
                    </span>
                    <span
                      className="ml-auto whitespace-nowrap rounded-full px-1.5 py-0.5 text-9 font-semibold"
                      style={{
                        background: isPlaced ? "#E7F0E8" : "#FBF3D4",
                        color: isPlaced ? "#33603F" : "#8a6a12",
                      }}
                      data-testid={`tpladmin-editor-field-state-${s.key}`}
                    >
                      {isPlaced ? "已放置" : "未放置"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      className="min-w-0 flex-1 rounded-control border border-transparent bg-transparent px-1 py-0.5 text-11 font-semibold outline-none transition-colors duration-fast focus:border-border focus:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                      value={s.name}
                      disabled={!editable}
                      onChange={(e) => patchSection(s.sectionId, { name: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`分区 ${i + 1} 的中文名`}
                      data-testid={`tpladmin-editor-section-${i}`}
                    />
                    <span className="whitespace-nowrap text-10 text-muted-foreground">
                      {s.type === "便利贴列表" ? "多条 · 贴纸" : s.type}
                    </span>
                    {editable && (
                      <button
                        type="button"
                        className="text-muted-foreground transition-colors duration-fast hover:text-destructive"
                        aria-label={`删除字段 ${s.name}`}
                        onClick={(e) => { e.stopPropagation(); setSections((prev) => prev.filter((x) => x.sectionId !== s.sectionId)); }}
                        data-testid={`tpladmin-editor-section-${i}-remove`}
                      >
                        <X aria-hidden className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {sections.length === 0 && (
              <p className="rounded-card border border-dashed border-border p-3 text-11 leading-relaxed text-muted-foreground" data-testid="tpladmin-editor-no-fields">
                还没有字段 —— 点右上角「提示词」，写清要 AI 干什么，再从提示词里提取字段。
              </p>
            )}
          </div>

          {/* 底部常驻「＋ 新增字段」快捷表单（§4.1 末条）。 */}
          {editable && (
            <div className="flex flex-none flex-col gap-2 border-t border-border bg-panel p-3.5">
              <span className="text-11 font-bold">＋ 新增字段</span>
              <div className="flex gap-1.5">
                <input
                  className="min-w-0 flex-1 rounded-control border border-border bg-background px-2 py-1.5 font-mono text-10 text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="key，如 gains"
                  value={newField.key}
                  onChange={(e) => setNewField((p) => ({ ...p, key: e.target.value }))}
                  data-testid="tpladmin-editor-new-key"
                />
                <input
                  className="w-20 rounded-control border border-border bg-background px-2 py-1.5 text-11 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="中文名"
                  value={newField.name}
                  onChange={(e) => setNewField((p) => ({ ...p, name: e.target.value }))}
                  data-testid="tpladmin-editor-new-name"
                />
              </div>
              <div className="flex items-center gap-1.5">
                {FIELD_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewField((p) => ({ ...p, type: t }))}
                    className={`whitespace-nowrap rounded-xl border px-2 py-1 text-10 transition-colors duration-fast ${
                      newField.type === t ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                    data-testid={`tpladmin-editor-new-type-${t}`}
                  >
                    {t}
                  </button>
                ))}
                <Button size="xs" variant="primary" className="ml-auto" disabled={newField.key.trim() === "" || newField.name.trim() === ""} onClick={addField} data-testid="tpladmin-editor-new-add">
                  加入
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ② 画布 */}
        <div className="flex min-h-0 min-w-0 flex-col bg-panel">
          <div className="flex flex-none items-center gap-2 border-b border-border bg-card px-4 py-2">
            <span className="text-12 font-bold">② 画布</span>
            <span className="text-11 text-muted-foreground">拖动区块换位置 · 点选区块调显示</span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-11 text-muted-foreground">网格</span>
              {([12, 6] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGridCols(g)}
                  className={`rounded-xl border px-2 py-0.5 text-10 transition-colors duration-fast ${
                    gridCols === g ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  data-testid={`tpladmin-editor-grid-${g}`}
                >
                  {g} 列
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowSample((v) => !v)}
                className="rounded-xl border border-border px-2 py-0.5 text-10 transition-colors duration-fast"
                style={{ background: showSample ? "#F7E96E" : "transparent" }}
                data-testid="tpladmin-editor-sample-toggle"
              >
                样例数据
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 justify-center overflow-auto p-4">
            <div className="w-full max-w-4xl">
              <TemplateCanvasGrid
                sections={sections}
                gridCols={gridCols}
                showSample={showSample}
                selectedId={selectedId}
                editable={editable}
                onSelect={(id) => { setSelectedId(id); setStep(3); }}
                onPlace={place}
                onMove={move}
              />
            </div>
          </div>
        </div>

        {/* ③ 显示方式 */}
        <div className="flex min-h-0 flex-col border-t border-border bg-card lg:border-l lg:border-t-0">
          <div className="flex flex-none items-center gap-2 px-3.5 pb-2 pt-3">
            <span className="text-12 font-bold">③ 显示方式</span>
            <span className="text-11 text-muted-foreground" data-testid="tpladmin-editor-selected-name">
              {selected ? selected.name : "未选中区块"}
            </span>
          </div>
          <TemplateDisplayPanel
            section={selected}
            gridCols={gridCols}
            health={health}
            editable={editable}
            onPatch={(patch) => { if (selectedId) patchLayout(selectedId, patch); }}
            onRemove={() => {
              if (!selectedId) return;
              // 「从画布移除（字段保留）」——§4.3 原话：只删 block，不删 field。
              patchSection(selectedId, { layout: null });
              setSelectedId(null);
            }}
          />
        </div>
      </div>

      {error && (
        <p className="flex-none border-t border-destructive/40 bg-destructive/5 px-5 py-2 text-11 text-destructive" role="alert" data-testid="tpladmin-editor-error">
          {error}
        </p>
      )}

      {/*
        发布前置检查没过时的二次确认（§6 规则⑦ / §7 第 9 条）。
        ⚠ 是「列出问题 + 允许强制发布」，不是「禁止发布」——规则原文是
        「允许强制发布但需二次确认」。把它做成硬拦截会让使用者在一个明知故犯的
        合理场景（先发布占位、之后再补齐）里无路可走。
      */}
      {publishBlockers && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" data-testid="tpladmin-editor-publish-confirm">
          <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-lg">
            <h2 className="text-14 font-bold">这个模板还有问题，确定要发布吗？</h2>
            <div className="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5 text-11 leading-relaxed">
              {publishBlockers.unplaced.length > 0 && (
                <span data-testid="tpladmin-editor-publish-blocker-unplaced">
                  · <strong>{publishBlockers.unplaced.length} 个字段没放到画布上</strong>
                  （{publishBlockers.unplaced.map((s) => s.key).join("、")}）—— AI 生成后这些数据会被丢弃。
                </span>
              )}
              {publishBlockers.overflowing.length > 0 && (
                <span data-testid="tpladmin-editor-publish-blocker-overflow">
                  · <strong>{publishBlockers.overflowing.length} 个区块容量不够</strong>
                  （{publishBlockers.overflowing.map((o) => `${o.section.key} 最多 ${o.max} 条 > 放得下 ${o.fits} 条`).join("；")}）
                  —— 超出的部分按各自的「超出时」策略处理。
                </span>
              )}
              {publishBlockers.duplicateKeys.length > 0 && (
                <span data-testid="tpladmin-editor-publish-blocker-dup">
                  · <strong>key 重复</strong>（{publishBlockers.duplicateKeys.join("、")}）
                  —— AI 返回的 JSON 里这些键会互相覆盖。
                </span>
              )}
            </div>
            <p className="text-11 text-muted-foreground">
              发布之后这一版的内容就是不可变快照了，要改只能「基于此开新版」。
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPublishBlockers(null)} data-testid="tpladmin-editor-publish-cancel">
                回去修
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => { setPublishBlockers(null); onPublish(); }}
                data-testid="tpladmin-editor-publish-force"
              >
                仍然发布
              </Button>
            </div>
          </div>
        </div>
      )}

      {promptOpen && (
        <TemplatePromptDrawer
          promptText={promptText}
          sections={sections}
          editable={editable}
          onPromptChange={setPromptText}
          onAddFields={addExtracted}
          onClose={() => { setPromptOpen(false); setStep(2); }}
        />
      )}
    </div>
  );
}
