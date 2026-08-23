"use client";
import * as React from "react";
import {
  X, Plus, GripVertical, ChevronUp, ChevronDown, Save, Rocket, Archive, RotateCcw,
  FlaskConical, Pencil,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  suggestCanvasTemplateSections,
  updateCanvasTemplateDraft,
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_VISIBILITY_LABEL,
  TEMPLATE_VISIBILITY_OPTIONS,
  type CanvasTemplate,
  type TemplateVisibility,
} from "@/lib/live-canvas";
import { CanvasStage } from "./canvas-stage";
import { buildTemplateEditorPreviewMarkdown } from "@/lib/canvas/template-editor-preview";

/**
 * 2026-08-23 —— 模板管理的**真正编辑界面**（人类原话「新建画布，的时候，不要在这里放
 * 分区设计，也不要放key，只需要一个名字就可以，需要发布的生命周期的管理，所有的内容
 * 进入编辑的界面来管理」）。
 *
 * ## 只有草稿可编内容，这是刻意的
 *
 * `updateTemplateDraft`（唯一的写入口）只对 `status === "draft"` 生效——已发布/已归档
 * 版本仍是不可变快照（`template-ports.ts` 文件头「这条不变量没有被推翻」）。所以本面板
 * 对非草稿行是**只读预览 + 生命周期动作**：显示名/可见范围/分区列表全部禁用，
 * 唯一能做的是发布/归档/恢复/基于此开新版——改内容只能先「基于此开新版」开出一个新
 * 草稿，再回到这个面板编辑那个新草稿。
 *
 * ## 预览用的是与 chat 围栏渲染**同一条**引擎
 *
 * `buildTemplateEditorPreviewMarkdown` 复用 `auto-template-layout.ts` 的
 * `buildAutoTemplateSpec`——组织自建模板在 chat 里长什么样，这里编辑时就长什么样，
 * 不是另一套"编辑器专用"的示意图。
 *
 * ## 生命周期动作是父组件传下来的回调，不是本面板自己再实现一遍
 *
 * `onPublish`/`onArchive`/`onRestore`/`onTrial`/`onMintVersion` 复用 `template-admin.tsx`
 * 里已经在用的那几个函数（写完 `await load()` 重读列表的纪律也在那边，不在这里重复）。
 */
export function TemplateEditorPanel({
  row, readOnly, onClose, onSaved,
  onPublish, onArchive, onRestore, onTrial, onMintVersion,
}: {
  readonly row: CanvasTemplate;
  /** 观察者视角——降噪，同 `RowActions` 的既有理由，见 `template-admin.tsx` 文件头。 */
  readonly readOnly: boolean;
  readonly onClose: () => void;
  /**
   * 保存成功后：父组件重读列表（同 `create`/`applied` 那段「不本地拼一行」的理由），
   * `updated` 是这次 `updateTemplateDraft` 真实回来的行——面板留在原地继续编辑，
   * 用它刷新 `row`，不是本地拼一行冒充。
   */
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
  const [visibility, setVisibility] = React.useState<TemplateVisibility>(row.visibility);
  const [sectionNames, setSectionNames] = React.useState<readonly string[]>(
    row.sections.length > 0 ? row.sections.map((s) => s.name) : [],
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * 2026-08-23——「输入一个常用的管理模板……系统可以自动创建可视化的模板」（人类原话）。
   * AI 起草的家从新建对话框搬到这里：新建时不再有分区表单可回填，编辑界面才是
   * 「有分区列表可以被回填」的地方。只提议、不自动保存——回填后仍要点下面的
   * 「保存改动」，同 `suggestTemplateSections` 契约文件头「为什么不直接写库」。
   */
  const [aiPrompt, setAiPrompt] = React.useState("");
  const [aiSuggesting, setAiSuggesting] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);

  async function suggestFromAi() {
    if (aiPrompt.trim().length === 0) return;
    setAiSuggesting(true);
    setAiError(null);
    try {
      const out = await suggestCanvasTemplateSections({ prompt: aiPrompt });
      setDisplayName(out.suggestedDisplayName);
      setSectionNames(out.sections.map((s) => s.name));
    } catch (e) {
      setAiError(describeEditorError(e));
    } finally {
      setAiSuggesting(false);
    }
  }

  const dirty = editable && (
    displayName !== row.displayName
    || visibility !== row.visibility
    || sectionNames.length !== row.sections.length
    || sectionNames.some((n, i) => n !== row.sections[i]?.name)
  );

  // 迭代 3/3——Esc 关面板，同 `chat-diagram-canvas-modal.tsx` 等其它全屏编辑面板
  // 已有的既定约定，不是本面板自创一套。⚠ 不拦截 `dirty`：本仓「未保存改动」的
  // 既定处理方式是**展示**一个提示（标题旁的徽章，见下方 JSX，抄
  // `chat-diagram-canvas-modal.tsx`「有未保存的改动」那一句），不是拦一个原生
  // `confirm()` 弹窗——那是这个代码库里从来没出现过的交互模式，本面板不该带头
  // 造一个新的。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 预览随「显示名 + 分区名列表」实时重算——纯前端、不发请求，同 `CreateDialog` 的
  // AI 起草那段「生成后仍在这个表单里，不自动提交」同一个哲学：所见即将要提交的东西。
  const preview = React.useMemo(
    () => buildTemplateEditorPreviewMarkdown({
      realKey: row.key,
      realVersion: row.version,
      displayName,
      sectionNames,
    }),
    [row.key, row.version, displayName, sectionNames],
  );

  /**
   * 2026-08-23 ——「真正的可视化画布编辑器」（人类明确要求）第一步：点击画布上的
   * 分区框，联动高亮 + 定位左侧对应的输入框。分区框在引擎里是锁死的（不能拖、不能
   * 缩放——`fabric-markdown` 的 `template-engine.ts` 文件头逐字写着"locked frame"，
   * vendor 纪律不许改），所以"真正编辑"落在能做到的那一半：点哪个框，就知道在改
   * 哪个分区，光标直接过去，不用在一串同样长相的文本框里自己去数第几个。
   */
  const sectionInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const [highlightedSection, setHighlightedSection] = React.useState<number | null>(null);

  // 命中测试逻辑点击/悬停共用一份——两处此前各写一遍同样的矩形范围判断，
  // 容易改一处漏一处（gutter 判定这类细节尤其容易漂移）。
  function hitTestSection(point: { x: number; y: number }): number {
    return sectionNames.findIndex((name) => {
      const cell = preview.cells.find((c) => c.name === name);
      if (!cell) return false;
      // 命中测试用的是矩形范围，不是"点最近哪个中心"——分区框之间有 gutter 间隙，
      // 点在间隙里应该"没点中任何框"，而不是被归给最近的那个（那会让点空白处
      // 也意外跳去改某个分区，行为看起来随机）。
      return Math.abs(point.x - cell.x) <= cell.w / 2 && Math.abs(point.y - cell.y) <= cell.h / 2;
    });
  }

  function handleCanvasClick(point: { x: number; y: number }) {
    const hitIndex = hitTestSection(point);
    if (hitIndex < 0) return;
    setHighlightedSection(hitIndex);
    const input = sectionInputRefs.current[hitIndex];
    // jsdom（测试环境）没有实现 `scrollIntoView`——不是这段逻辑该在乎的事，
    // 真浏览器里永远有，这里只是不让测试环境的空缺变成一次真崩溃。
    if (typeof input?.scrollIntoView === "function") {
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    input?.focus();
  }

  /**
   * 迭代 4——「点了才知道点中了什么」在真拖拽框体不可行的前提下，是这个编辑器
   * 里最接近"直接操作"体验的短板：点之前完全没有反馈，使用者只能靠试。悬停
   * 高亮补上这一半——鼠标移到框上先亮一圈（不抢焦点、不滚动），点下去才真正
   * 聚焦输入框。与 `highlightedSection`（点击后落地、驱动 focus/scroll）是两个
   * 独立的状态：悬停是"预告"，点击才是"确认"，一个 hover 态叫 focus 属实过界。
   */
  const [hoveredSection, setHoveredSection] = React.useState<number | null>(null);
  function handleCanvasHover(point: { x: number; y: number } | null) {
    if (point === null) {
      setHoveredSection(null);
      return;
    }
    const hitIndex = hitTestSection(point);
    setHoveredSection(hitIndex >= 0 ? hitIndex : null);
  }

  function addSection() {
    setSectionNames([...sectionNames, ""]);
  }
  function renameSection(i: number, name: string) {
    setSectionNames(sectionNames.map((n, j) => (j === i ? name : n)));
  }
  function removeSection(i: number) {
    setSectionNames(sectionNames.filter((_, j) => j !== i));
  }
  function moveSection(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= sectionNames.length) return;
    const next = [...sectionNames];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSectionNames(next);
  }
  function reorderSection(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= sectionNames.length || to >= sectionNames.length) return;
    const next = [...sectionNames];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setSectionNames(next);
  }

  /**
   * 迭代 2/3——拖拽手柄（`GripVertical` 图标）直接拖动一行到目标位置，同 canvas
   * 上分区框的顺序会跟着实时重排（`preview` 随 `sectionNames` 重算）。up/down
   * 按钮**不撤**：拖拽是键盘用户够不到的操作，两条路径并存，不是二选一。
   */
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const out = await updateCanvasTemplateDraft({
        key: row.key,
        version: row.version,
        displayName: displayName.trim(),
        sections: sectionNames
          .map((name, i) => ({ name: name.trim(), order: i }))
          .filter((s) => s.name.length > 0)
          .map((s, i) => ({ sectionId: `s${i + 1}`, name: s.name, order: i, required: false, capacity: null })),
        visibility,
      });
      // usageCount 恒 0：`updateTemplateDraft` 只对 status='draft' 生效，而绑定的判定
      // 只接受 published（`domain/canvas/segment-binding.ts`），draft 不可能已被绑定。
      await onSaved(`已保存「${out.displayName}」的改动`, { ...out, usageCount: 0 });
    } catch (e) {
      setError(describeEditorError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tpladmin-editor-title"
      data-testid="tpladmin-editor-panel"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2.5">
        <Button size="icon" variant="ghost" aria-label="返回列表" onClick={onClose} data-testid="tpladmin-editor-close">
          <X aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 id="tpladmin-editor-title" className="truncate text-14 font-semibold">
            {editable ? "编辑模板" : "查看模板"}
          </h1>
          <span className="font-mono text-10 text-muted-foreground">{row.key} v{row.version}</span>
          <Badge tone={row.status === "published" ? "primary" : row.status === "draft" ? "warning" : row.status === "trial" ? "outline" : "neutral"}>
            {TEMPLATE_STATUS_LABEL[row.status]}
          </Badge>
          {/* 迭代 4——`dirty` 此前只在「保存改动」按钮文案里间接体现（disabled + 换字），
              标题旁没有任何提示；关闭按钮就在正左边，点错一下改动就没了却毫无预警。
              抄 `chat-diagram-canvas-modal.tsx` 同款「有未保存的改动」纯文字徽章，
              不拦截关闭——同一套「展示不拦截」的既定约定，见上面 Esc 那段注释。 */}
          {dirty && !saving && (
            <span className="text-11 text-muted-foreground" data-testid="tpladmin-editor-dirty">
              有未保存的改动
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1.5">
            {row.status === "draft" && (
              <Button size="xs" variant="outline" onClick={onTrial} data-testid="tpladmin-editor-trial">
                <FlaskConical aria-hidden className="h-3 w-3" /> 试跑
              </Button>
            )}
            {(row.status === "draft" || row.status === "trial") && (
              <Button size="xs" variant="primary" onClick={onPublish} data-testid="tpladmin-editor-publish">
                <Rocket aria-hidden className="h-3 w-3" /> 发布（{TEMPLATE_VISIBILITY_LABEL[visibility]}）
              </Button>
            )}
            {row.status === "published" && (
              <Button size="xs" variant="ghost" className="text-destructive" onClick={onArchive} data-testid="tpladmin-editor-archive">
                <Archive aria-hidden className="h-3 w-3" /> 归档
              </Button>
            )}
            {row.status === "archived" && (
              <Button size="xs" variant="outline" onClick={onRestore} data-testid="tpladmin-editor-restore">
                <RotateCcw aria-hidden className="h-3 w-3" /> 恢复
              </Button>
            )}
            {row.status !== "draft" && (
              <Button size="xs" variant="outline" onClick={onMintVersion} data-testid="tpladmin-editor-mint">
                <Pencil aria-hidden className="h-3 w-3" /> 基于此开新版
              </Button>
            )}
          </div>
        )}
      </header>

      {!isDraft && (
        <p className="border-b border-warning/40 bg-warning/5 px-4 py-1.5 text-11 text-muted-foreground" data-testid="tpladmin-editor-immutable-note">
          已发布/已归档版本是不可变快照——这里只能预览，改内容请先「基于此开新版」。
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_1fr]">
        <div className="flex min-h-0 flex-col gap-3 overflow-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
          <label className="flex flex-col gap-1 text-11">
            <span className="text-muted-foreground">显示名</span>
            <input
              className="rounded-md border border-border bg-background px-2 py-1.5 text-12 disabled:bg-disabled disabled:text-disabled-foreground"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={!editable}
              data-testid="tpladmin-editor-name"
            />
          </label>

          <label className="flex flex-col gap-1 text-11">
            <span className="text-muted-foreground">可见范围</span>
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-12 disabled:bg-disabled disabled:text-disabled-foreground"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as TemplateVisibility)}
              disabled={!editable}
              data-testid="tpladmin-editor-visibility"
            >
              {TEMPLATE_VISIBILITY_OPTIONS.map((v) => (
                <option key={v} value={v}>{TEMPLATE_VISIBILITY_LABEL[v]}</option>
              ))}
            </select>
          </label>

          {editable && (
            <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-2.5" data-testid="tpladmin-editor-ai-suggest">
              <span className="text-11 text-muted-foreground">
                AI 起草——打一个常用模板名字（如「商业模式画布」），自动提议显示名与分区
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-12"
                  placeholder="例如：商业模式画布 / 团队复盘 retro"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  disabled={aiSuggesting}
                  // 迭代 3/3：刚新建出来的空白草稿（还没有任何分区）自动把光标放在这里——
                  // 建完立刻打开面板的整套流程里，"打个模板名字试试 AI 起草"是最快填上
                  // 内容的一步，不该还要使用者自己点一下才能开始打字。已有分区的草稿
                  // （重新打开来改）不抢焦点，那时使用者大概率是来改具体某个分区的。
                  autoFocus={sectionNames.length === 0}
                  data-testid="tpladmin-editor-ai-prompt"
                />
                <Button
                  size="xs"
                  variant="outline"
                  disabled={aiPrompt.trim().length === 0 || aiSuggesting}
                  onClick={() => void suggestFromAi()}
                  data-testid="tpladmin-editor-ai-generate"
                >
                  {aiSuggesting ? "生成中…" : "AI 生成"}
                </Button>
              </div>
              {aiError && (
                <span className="text-10 text-destructive" data-testid="tpladmin-editor-ai-error">{aiError}</span>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1" data-testid="tpladmin-editor-sections">
            <span className="text-11 text-muted-foreground">
              分区（导出为 ## 段落；留空即零分区{editable && "——也可以直接点右边画布上的框"}）
            </span>
            {sectionNames.map((name, i) => (
              <div
                key={i}
                className={
                  "flex items-center gap-1 rounded-md transition-[border-top-color] duration-150 "
                  + (dragOverIndex === i && dragIndex !== null && dragIndex !== i
                    ? "border-t-2 border-t-primary" : "border-t-2 border-t-transparent")
                }
                onDragOver={editable ? (e) => { e.preventDefault(); setDragOverIndex(i); } : undefined}
                onDrop={editable ? (e) => {
                  e.preventDefault();
                  if (dragIndex !== null) reorderSection(dragIndex, i);
                  setDragIndex(null);
                  setDragOverIndex(null);
                } : undefined}
              >
                <span
                  className={editable ? "cursor-grab active:cursor-grabbing" : undefined}
                  draggable={editable}
                  onDragStart={editable ? () => setDragIndex(i) : undefined}
                  onDragEnd={editable ? () => { setDragIndex(null); setDragOverIndex(null); } : undefined}
                  aria-label={editable ? `拖拽调整「${name || `分区 ${i + 1}`}」的顺序` : undefined}
                  data-testid={`tpladmin-editor-section-${i}-drag`}
                >
                  <GripVertical aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </span>
                <input
                  ref={(el) => { sectionInputRefs.current[i] = el; }}
                  className={
                    "min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-12 transition-colors duration-200 "
                    + "disabled:bg-disabled disabled:text-disabled-foreground "
                    + (highlightedSection === i
                      ? "border-primary ring-2 ring-primary/30"
                      // 悬停态比点击态弱一档（无 ring，只换边框色）——两者都用同一种
                      // "亮"会让使用者分不清"这是我刚点的"还是"鼠标刚好划过去而已"。
                      : hoveredSection === i ? "border-primary/60" : "border-border")
                  }
                  placeholder={`分区 ${i + 1}`}
                  value={name}
                  onChange={(e) => renameSection(i, e.target.value)}
                  onFocus={() => setHighlightedSection(i)}
                  disabled={!editable}
                  data-testid={`tpladmin-editor-section-${i}`}
                />
                {editable && (
                  <>
                    <Button size="icon" variant="ghost" aria-label={`分区 ${i + 1} 上移`} disabled={i === 0} onClick={() => moveSection(i, -1)} data-testid={`tpladmin-editor-section-${i}-up`}>
                      <ChevronUp aria-hidden className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`分区 ${i + 1} 下移`} disabled={i === sectionNames.length - 1} onClick={() => moveSection(i, 1)} data-testid={`tpladmin-editor-section-${i}-down`}>
                      <ChevronDown aria-hidden className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`删除分区 ${i + 1}`} onClick={() => removeSection(i)} data-testid={`tpladmin-editor-section-${i}-remove`}>
                      <X aria-hidden className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            ))}
            {editable && (
              <Button size="xs" variant="outline" className="self-start" onClick={addSection} data-testid="tpladmin-editor-add-section">
                <Plus aria-hidden className="h-3 w-3" /> 加一个分区
              </Button>
            )}
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-11 text-destructive" role="alert" data-testid="tpladmin-editor-error">
              {error}
            </p>
          )}

          {editable && (
            <Button
              size="sm"
              variant="primary"
              disabled={!dirty || saving || displayName.trim().length === 0}
              onClick={() => void save()}
              data-testid="tpladmin-editor-save"
            >
              <Save aria-hidden className="h-3.5 w-3.5" /> {saving ? "正在保存…" : dirty ? "保存改动" : "已保存"}
            </Button>
          )}
        </div>

        <div className="min-h-0 overflow-hidden bg-panel" data-testid="tpladmin-editor-preview">
          <CanvasStage
            readOnly
            tool="select"
            zoom={1}
            markdown={preview.markdown}
            onMarkdownChange={() => {}}
            onCanvasClick={handleCanvasClick}
            onCanvasHover={handleCanvasHover}
          />
        </div>
      </div>
    </div>
  );
}

/** 后端真实信封原样回显——同 `template-admin.tsx` 的 `describeError` 一贯做法。 */
function describeEditorError(error: unknown): string {
  if (error instanceof ApiError) return `${error.reasonCode ?? "无 reasonCode"}（HTTP ${error.status}）`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}
