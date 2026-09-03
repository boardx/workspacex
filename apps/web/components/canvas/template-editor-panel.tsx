"use client";
import * as React from "react";
import { GripVertical, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  updateCanvasTemplateDraft,
  mintCanvasTemplateVersion,
  publishCanvasTemplate,
  updateCanvasTemplateMetadata,
  TEMPLATE_STATUS_LABEL,
  type CanvasTemplate,
} from "@/lib/live-canvas";
import { TemplateCanvasGrid } from "./template-canvas-grid";
import { TemplateDryRunDrawer, buildDryRunSkeleton } from "./template-dry-run-drawer";
import { TemplateSimulateDialog } from "./template-simulate-dialog";
import { TemplateDisplayPanel } from "./template-display-panel";
import { TemplatePromptDrawer, type ExtractedField } from "./template-prompt-drawer";
import {
  toDraft, toContractSections, defaultLayoutAt, clampLayout, checkTemplateHealth, autoFillLayout,
  collidesWithOthers, FIELD_TYPES,
  type SectionDraft, type SectionFieldType, type SectionLayoutDraft, type TemplateHealth,
} from "./template-editor-model";
import { PAPER_SIZE_MM, type PaperSizeKey } from "@/lib/canvas/explicit-template-layout";
import { canvas } from "@repo/contracts";

/**
 * 模板编辑器（R3-R5，2026-08-26）——`Design.pdf` §4「界面二：拖拽式画布编辑器」。
 *
 * 顶栏：面包屑「模板库 / {模板名} · 模板编辑」+ A1 规格徽章 + 三步指示器 + 「发布模板」。
 * 三栏布局固定 **290 / 自适应 / 276**（§4 原话）。
 *
 * ## 本组件只认识 `lib/live-canvas.ts` 的客户端包装，不认识端点
 *
 * 契约端点的路径拼接**全仓只有一个出口**（`canvas-template-routes-no-mock.test.ts` 机械
 * 断言）。所以这里连注释都称呼包装函数的名字——写裸端点名会让那条门控红，而它红得对：
 * 一个知道端点长什么样的组件，离自己手抄一条路径只差一步。
 *
 * ## 已发布的也能编，改动落到**新版本**、内容干净就当场发布
 *
 * 人类 2026-08-26 截图实测：「画布模板的配置，对于已发布的模板也需要可以编辑」。
 * 表单对 draft / trial / published 一律开放，`save()` 按状态分岔到两条真实写路径：
 * 草稿走 `updateCanvasTemplateDraft` 原地改，非草稿走 `mintCanvasTemplateVersion` 把改完的内容
 * 铸成下一版草稿。已发布那一版原封不动——它的 `sections` 是不可变快照（I-4），
 * 原地改会让**已经用它开过的画布**在下次渲染时悄悄换版式，那是历史篡改不是编辑。
 *
 * ⚠ 2026-08-26 第二轮实测反馈：「编辑以后保存，刷新再次打开发现没有保存成功数据。
 *   对于旧的已经发布的版本，可以修改」——铸出的新版本本身没丢数据（真库测试验证过），
 *   丢的是「体感」：它默认是草稿，需要再点一次发布才生效，刷新后人类多半点开的还是
 *   熟悉的旧「已发布」卡片。修法是 `save()` 铸完新版后若 `health.publishClean` 就
 *   **立即发布**——`publishTemplate` 会自动归档旧版（既有行为），所以这不是把 I-4
 *   拆了：旧版本内容仍然是不可变快照，只是不再被标为「当前」。编辑已发布模板在体感上
 *   因此等同直接改。内容不干净（有溢出/未放置字段）时仍然停在草稿，不静默发布。
 *
 * ⚠ 归档行仍然只读：在被主动收起来的东西上开新版，会让「归档」这个动作失去意义。
 *   要改先「恢复」，那是个显式动作。
 * ⚠ 改**名字与标签**一直不受此限（走 `updateTemplateMetadata`，R2），那是元数据不是内容。
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
  /**
   * 能不能编内容。**已发布/已试跑的行也能编**（人类 2026-08-26：「对于已发布的模板
   * 也需要可以编辑」）——改动落到哪里由 `save()` 分岔：草稿原地改，非草稿铸新版。
   *
   * ⚠ 归档行仍然不可编：它是被主动收起来的东西，在它上面开新版会让「归档」这个动作
   *   失去意义（刚归档就冒出一个新草稿）。要改先「恢复」，那是个显式动作。
   * ⚠ `readOnly`（观察者视角）压过一切，与原先一致。
   */
  const editable = row.status !== "archived" && !readOnly;

  const [displayName, setDisplayName] = React.useState(row.displayName);
  // 版面装帧（A1 纸上的大标题 / 底部署名）。⚠ 它们**不进** `sections`：sections 是
  // 「AI 要填什么」，装帧是纸本身长什么样。混进去模型会试图去"填标题"。
  const [title, setTitle] = React.useState(row.title);
  const [footer, setFooter] = React.useState(row.footer);
  // ⚠ 提示词从这里初始化，**不是**从下面那个后来才声明的 `promptText` state 起点 `""`
  //   ——2026-08-26 第三轮实测反馈「现有的历史数据，我看还没有提示词」，根因就是这里
  //   原先恒等于空串，从没读过 `row.promptText`：编辑器打开一次，提示词就"看起来"是空的，
  //   而库里其实存着（或者也是空的，因为写入端同样从没把它存过——两头都空）。
  const [sections, setSections] = React.useState<SectionDraft[]>(() => toDraft(row));
  const [step, setStep] = React.useState<1 | 2 | 3>(() => (toDraft(row).some((s) => s.layout) ? 2 : 1));
  const [gridCols, setGridCols] = React.useState<6 | 12>(12);
  // 纸张尺寸——2026-08-27 人类原话：「模板可以选择 A1，A3，A4 等大小」。内容相关
  // 字段（同 sections），不是装帧：影响 mm 换算，因此进体检、进脏检查、进保存。
  const [paperSize, setPaperSize] = React.useState<PaperSizeKey>((row.size ?? "A1") as PaperSizeKey);
  const [showSample, setShowSample] = React.useState(true);
  // 试运行是**两个**状态，不是一个：抽屉开着 ≠ 已经渲染。人类可以开着抽屉边改边看，
  // 也可以关掉抽屉留着渲染结果继续调版式——合成一个状态就会让"关抽屉"顺手把结果清掉。
  const [dryRunOpen, setDryRunOpen] = React.useState(false);
  const [dryRunText, setDryRunText] = React.useState("");
  const [dryRunData, setDryRunData] = React.useState<Record<string, unknown> | null>(null);
  // chat 模拟弹窗——与试运行是独立的一对开关（两件不同的事，见 `TemplateSimulateDialog`
  // 文件头），不共用 `dryRunOpen`。是弹窗不是抽屉，不占三栏网格。
  const [simulateOpen, setSimulateOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [promptOpen, setPromptOpen] = React.useState(false);
  // `?? ""` 是防御性兜底，不是常态：契约 `.strict()` 保证服务端一定给这个字段。
  // 留着这一手是为了不让"响应体缺一个字段"从一次异常变成整个编辑面板崩溃——
  // `template-prompt-drawer.tsx` 会对它调用 `.trim()`。
  const [promptText, setPromptText] = React.useState(row.promptText ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [newField, setNewField] = React.useState<{ key: string; name: string; type: SectionFieldType }>(
    { key: "", name: "", type: "便利贴列表" },
  );
  /** 非 null = 发布前置检查没过，正在等二次确认（§6 规则⑦：允许强制发布）。 */
  const [publishBlockers, setPublishBlockers] = React.useState<TemplateHealth | null>(null);

  // ⚠ `promptText` 必须进体检：§6 规则③ 的可达形态是「提示词里写了字段表没有的
  //   占位符」，见 `TemplateHealth.danglingPlaceholders` 的文档。
  const health = React.useMemo(
    () => checkTemplateHealth(sections, gridCols, promptText, paperSize),
    [sections, gridCols, promptText, paperSize],
  );
  const selected = sections.find((s) => s.sectionId === selectedId) ?? null;

  // 分区结构（含布局）是否已经偏离已保存的版本——`dirty` 的一个子集，单独抽出来是
  // 因为「chat 模拟」只关心这一件事（见 `template-simulate-dialog.tsx` 文件头 R2.3）：
  // 标题/页脚/提示词这些改动不影响画布几何，不该逼一个从没改过布局的内置模板提前
  // 切到自动布局分支。
  const sectionsDirty = JSON.stringify(toContractSections(sections)) !== JSON.stringify(row.sections);

  // 「②画布」这块是分区结构的示意网格（`buildAutoTemplateSpec` 通用布局 + 4 色轮转），
  // 不是像素预览——一个从未被定制过的内置模板，「chat 模拟」渲染的是它在
  // `packages/fabric-markdown` 里那份手工排版的真实几何（颜色/专属装饰如 ⇄ 都来自那份
  // spec，见 `template-simulate-dialog.tsx` 文件头 R2.1/R2.3）。两条路径本就不同源，
  // 只在这里当场提醒，不去假装网格能画出真实像素效果。
  const showsSampleGeometryOnly = canvas.builtinDisplayName(row.key) !== undefined
    && row.layoutSource !== "user-edited"
    && !sectionsDirty;

  const dirty = editable && (
    displayName !== row.displayName
    || title !== row.title
    || footer !== row.footer
    || promptText !== row.promptText
    || paperSize !== (row.size ?? "A1")
    || sectionsDirty
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

  /**
   * 就地修改已有字段的类型（issue #2369）——此前类型只在创建时（`addField`/
   * `addExtracted`）赋一次值，此后没有任何入口能改，想换类型只能删了重建，
   * 会连带丢掉已放置的画布位置。
   *
   * 已放置的字段（`layout` 非空）改类型时，用 `defaultLayoutAt` 按新类型重新算
   * 一份默认布局（列表型默认更高更多列，非列表型默认矮一行三列）——位置
   * （`col`/`row`）保留，只刷新跟类型强相关的尺寸/列数，避免改成短文本后还占着
   * 一大块列表型的高度。未放置的字段直接改 `type`，没有布局需要同步。
   */
  function changeFieldType(sectionId: string, type: SectionFieldType): void {
    setSections((prev) => prev.map((s) => {
      if (s.sectionId !== sectionId || s.type === type) return s;
      if (!s.layout) return { ...s, type };
      const next = defaultLayoutAt(type, s.layout.col, s.layout.row, gridCols, paperSize);
      return { ...s, type, layout: clampLayout(next, gridCols) };
    }));
  }

  /**
   * issue #2564：`clampLayout` 只把布局夹回画布边界，从不检查是否与另一个**已放置**
   * 分区重叠——`patchLayout`/`place`/`move` 三个入口原先对夹好的结果照单全收，允许
   * 把一个分区的位置/宽高改到直接压住旁边的分区，两块几何区间重叠，画出来就是
   * 标题条互相压住、便签溢出到相邻分区（根因见 `rectsOverlap` 文档）。这里统一收口：
   * 夹完边界之后，若还与别的分区重叠，就放弃这次改动、维持改动前的布局——同 Stepper
   * 既有的「每次只挪一格、永远合法」约定，不静默产出一个会画错的状态。
   */
  /**
   * `compute` 拿到改动前那个分区本身，算出提议的新布局；夹完边界之后若与另一个
   * 已放置分区重叠就整体放弃、维持改动前的布局。`compute` 与重叠检查都在同一次
   * `setSections` 更新里对 `prev` 现算现比，不读组件闭包里可能过期的 `sections`。
   * `compute` 返回 `null` 表示这个分区本来就不该被改（如未放置的分区收到 `move`）。
   */
  function applyLayoutIfFree(
    sectionId: string, compute: (current: SectionDraft) => SectionLayoutDraft | null,
  ): void {
    setSections((prev) => {
      const current = prev.find((s) => s.sectionId === sectionId);
      if (!current) return prev;
      const proposed = compute(current);
      if (!proposed) return prev;
      const next = clampLayout(proposed, gridCols);
      if (collidesWithOthers(prev, sectionId, next)) return prev;
      return prev.map((s) => (s.sectionId === sectionId ? { ...s, layout: next } : s));
    });
  }

  function patchLayout(sectionId: string, patch: Partial<SectionLayoutDraft>): void {
    applyLayoutIfFree(sectionId, (current) => (current.layout ? { ...current.layout, ...patch } : null));
  }

  function place(sectionId: string, col: number, row_: number): void {
    applyLayoutIfFree(sectionId, (current) => defaultLayoutAt(current.type, col, row_, gridCols, paperSize));
    // 放下后自动选中该区块并跳到第三步（§4.2 原话）。
    setSelectedId(sectionId);
    setStep(3);
  }

  function move(sectionId: string, col: number, row_: number): void {
    applyLayoutIfFree(sectionId, (current) => (current.layout ? { ...current.layout, col, row: row_ } : null));
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

  /**
   * 保存 —— 人类 2026-08-26 截图实测：「画布模板的配置，对于已发布的模板也需要可以编辑」。
   *
   * ## 已发布也能编，但**不是**去改那份已发布的快照
   *
   * 已发布版本的 `sections` 是不可变快照（I-4：已建实例不被改动）。真去原地改它，
   * 所有**已经用这个模板开过的画布**会在下一次渲染时悄悄换掉版式——那是一次没人
   * 察觉的历史篡改，而不是一次编辑。
   *
   * 所以这里按行的状态分岔，**同一个「保存」按钮，两条真实写路径**：
   *
   * · `draft` → `updateTemplateDraft`，原地改这份草稿。
   * · 其余（published / trial / archived）→ `mintCanvasTemplateVersion`，把**改完的内容**
   *   直接铸成下一个版本的草稿。已发布的那一版原封不动留着。
   *
   * ⚠ 铸新版**不是**"先开一个空版本再保存两次"：那条端点的 `in` 本来就收
   *   `sections`，所以这是一次请求。分两步做会在中间留下一个内容为空的版本，
   *   而那个版本在别人眼里是一个真实存在的、坏掉的草稿。
   *
   * 使用者感受到的是「我编辑了这个已发布的模板」，而库里发生的是一次合法的开新版——
   * 与人类手点「基于此开新版」完全同一条路径，不是给它开的后门。
   */
  /**
   * 装帧走 `updateTemplateMetadata`，与内容分开写。
   *
   * ⚠ 两条写路径**不能合并**：改内容的那两条端点的 `in` 里
   *   没有 `title`/`footer`（它们不是内容），而 `updateTemplateMetadata` 物理上碰不到
   *   `sections`（它对任何状态生效正是靠这一点）。硬塞进任何一边，都会让"改装帧"
   *   与"改内容"之一获得对方的状态限制。
   * ⚠ `tags` 必须原样带回去——本操作是**全量替换**不是 patch，省略等于清空标签，
   *   而清空不会报错，只会让筛选栏少一类。
   */
  async function saveChrome(version = row.version): Promise<void> {
    if (
      title === row.title && footer === row.footer
      && promptText === row.promptText && version === row.version
    ) return;
    await updateCanvasTemplateMetadata({
      key: row.key, version,
      displayName: displayName.trim(),
      tags: [...(row.tags ?? [])],
      title, footer, promptText,
    });
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const contractSections = toContractSections(sections);
      if (isDraft) {
        const out = await updateCanvasTemplateDraft({
          key: row.key,
          version: row.version,
          displayName: displayName.trim(),
          sections: contractSections,
          visibility: row.visibility,
          tags: [...(row.tags ?? [])],
          size: paperSize,
        });
        await saveChrome();
        await onSaved(
          `已保存「${out.displayName}」的改动`,
          // ⚠ `platform: false` 是写死的字面量，不是从响应里读来的：这个面板打开的
          //   永远是本组织自己的行（`listTemplates` 用 `platform` 区分平台母版与
          //   组织自有行，平台母版对本组件不可编辑，走不到这条保存路径）。
          // `createdAt: row.createdAt` —— 改草稿不是新造一行，创建时间不变（还是打开
          //   这个面板时那份 `listTemplates` 行带来的值）；`updatedAt` 才是这次写入
          //   真的改变的那一栏。`updateTemplateDraft.out` 契约没有这两栏（DB 有 `updated_at`
          //   但 RETURNING 没取），同 `usageCount`/`title` 等字段一样，是本地按"刚发生了
          //   什么"合理推出来的，不是瞎猜。
          { ...out, usageCount: 0, title, footer, promptText, platform: false, createdAt: row.createdAt, updatedAt: new Date().toISOString() },
        );
        return;
      }

      const minted = await mintCanvasTemplateVersion({
        key: row.key,
        displayName: displayName.trim(),
        underlyingType: row.underlyingType,
        sections: contractSections,
        visibility: row.visibility,
        tags: [...(row.tags ?? [])],
        size: paperSize,
      });
      await saveChrome(minted.version);

      /*
       * 人类 2026-08-26 实测反馈：「编辑以后保存，刷新再次打开发现没有保存成功数据。
       * 对于旧的已经发布的版本，可以修改。」
       *
       * ## 数据其实没丢——问题是「保存」把改动放进了一个看不见的地方
       *
       * 铸新版本本身没有 bug（`mint-template-version-http.test.ts` 已经在真库上验证过）。
       * 真正的问题是语义：铸出来的 vN+1 是**草稿**，默认不发布。人类点的是「保存」，
       * 得到的却是一份需要再点一次「发布」才会生效的东西；刷新页面后，默认视图里
       * 新旧两个版本的卡片并存，人类多半点开的还是那张熟悉的「已发布」旧卡片——
       * 看起来就是「编辑没生效」。
       *
       * ## 修法：内容干净就**当场发布**，让「编辑已发布模板」在体感上等于直接改
       *
       * `publishTemplate` 发布新版本时会**自动归档旧版**（三段发布流程既有行为）——
       * 所以这里不是把 I-4「已发布内容不可变快照」这条不变量拆了：已经用旧版本
       * 开过的画布，实例数据仍然指着那个不可变的旧版本号，不受影响；变的只是
       * 「哪个版本被标记为当前活跃版本」。旧版本变成「已归档」，与新的「已发布」
       * 版本不再靠版本号才分得清谁是谁——这也顺带解决了「刷新后分不清点哪张卡」。
       *
       * ⚠ 只有 `health.publishClean` 时才自动发布：与显式点「发布」按钮的
       *   `requestPublish()` 走的是同一份体检结果（§6 规则⑤同源计算），不健康的
       *   内容不会被静默推上线——那种情况仍然停在草稿，并把原因如实说清楚，
       *   而不是自动发布一份有溢出/未放置字段的东西。
       */
      if (health.publishClean) {
        await publishCanvasTemplate({ key: minted.key, version: minted.version, visibility: row.visibility });
        await onSaved(
          `已保存并发布为 v${minted.version}——v${row.version} 已自动归档` +
          `（不可变快照，用它开过的画布不受影响）。`,
          // 铸新版本是新造一行——`createdAt`/`updatedAt` 都是"此刻"，同上一处
          // `updateTemplateDraft` 分支的理由对称（那边是改行，这里是新行）。
          { ...minted, status: "published", usageCount: 0, title, footer, promptText, platform: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        );
      } else {
        const reasons = [
          ...health.unplaced.map((s) => `「${s.name}」未放到画布上`),
          ...health.overflowing.map((o) => `「${o.section.name}」装不下（最多 ${o.max} 条，位置只够 ${o.fits} 条）`),
        ];
        await onSaved(
          `已铸出 v${minted.version} 草稿并保存改动，但「未发布」——` +
          `${reasons.join("；")}。修好后再点「发布模板」，v${row.version} 保持原样。`,
          // 同上——铸新版本是新造一行。
          { ...minted, usageCount: 0, title, footer, promptText, platform: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        );
      }
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
          {paperSize} 横版 {PAPER_SIZE_MM[paperSize].w}×{PAPER_SIZE_MM[paperSize].h}mm ·
          内容区 {PAPER_SIZE_MM[paperSize].w - 20}×{PAPER_SIZE_MM[paperSize].h - 20}
        </span>
        {/*
          纸张尺寸选择器——2026-08-27 人类原话：「模板可以选择 A1，A3，A4 等大小」。
          只在 `editable` 时给：只读态（已归档/无权限）不该有任何会改数据的控件。
          ⚠ 切尺寸不会自动重排现有区块——12×8 网格坐标不变，变的只是每格代表的
          物理 mm 数（同一个 col/row/w/h，在 A4 上贴纸实尺比 A1 上小）。若切完之后
          贴纸装不下，体检会如实报「溢出」，不会静默吞掉——这与"选择了这个尺寸就必须
          覆盖这个区域"并不矛盾：网格本身恒是 12×8 全覆盖，缺的是"贴得下多少内容"，
          不是"占不占得满网格"，两件事分开由体检各自的规则判。
        */}
        {editable && (
          <div className="flex items-center gap-1" data-testid="tpladmin-editor-papersize-picker">
            {(Object.keys(PAPER_SIZE_MM) as PaperSizeKey[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setPaperSize(s)}
                className={`rounded-control border px-2 py-0.5 text-10 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  paperSize === s ? "border-inverse bg-inverse text-inverse-foreground" : "border-border text-muted-foreground hover:bg-muted"
                }`}
                aria-pressed={paperSize === s}
                data-testid={`tpladmin-editor-papersize-${s}`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
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
              className={`flex items-center gap-1.5 rounded-control px-1 py-0.5 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                step === n ? "text-foreground" : "text-muted-foreground"
              }`}
              aria-current={step === n ? "step" : undefined}
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

      {/*
        非草稿行照样能编，但要「提前」说清改动会落到哪里——等人点了保存才发现"怎么多出
        一个 v3"，那是一次意外而不是一次编辑。归档行仍然只读，文案分开写。
      */}
      {!isDraft && (
        <p className="flex-none border-b border-warning/40 bg-warning/5 px-5 py-1.5 text-11 text-muted-foreground" data-testid="tpladmin-editor-immutable-note">
          {row.status === "archived"
            ? "已归档版本只能预览。要改先「恢复」，那是个显式动作。"
            : `v${row.version} 已发布。你在这里的改动保存时会自动铸成 v${row.version + 1} ` +
              `并立即发布（旧版内容作为不可变快照自动归档，已经用它开过的画布不受影响）。`}
        </p>
      )}

      {/* 三栏：290 / 自适应 / 276 */}
      {/* ⚠ 栏定义必须跟着抽屉变：容器是**固定**三栏网格，多出来的第 4 个子元素会被塞进
          隐式列，宽度不受控（实测抽屉会把 ③ 挤出可视区）。开抽屉时它是自成一栏的第 4 列。 */}
      <div
        className={`grid min-h-0 flex-1 grid-cols-1 ${
          dryRunOpen ? "lg:grid-cols-[290px_1fr_320px_276px]" : "lg:grid-cols-[290px_1fr_276px]"
        }`}
      >
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
                    {editable ? (
                      <select
                        className="whitespace-nowrap rounded-control border border-transparent bg-transparent px-1 py-0.5 text-10 text-muted-foreground outline-none transition-colors duration-fast hover:border-border focus:border-border focus:bg-background focus-visible:ring-2 focus-visible:ring-ring"
                        value={s.type}
                        onChange={(e) => changeFieldType(s.sectionId, e.target.value as SectionFieldType)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`字段 ${s.name} 的类型`}
                        data-testid={`tpladmin-editor-section-${i}-type`}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="whitespace-nowrap text-10 text-muted-foreground">
                        {s.type === "便利贴列表" ? "多条 · 贴纸" : s.type}
                      </span>
                    )}
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
                    className={`whitespace-nowrap rounded-control border px-2 py-1 text-10 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      newField.type === t ? "border-inverse bg-inverse text-inverse-foreground" : "border-border text-muted-foreground hover:bg-muted"
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
            {showsSampleGeometryOnly && (
              <span
                className="text-11 text-muted-foreground"
                data-testid="tpladmin-editor-sample-geometry-hint"
                title="这里是分区结构的示意网格，不是像素预览；颜色/专属装饰（如价值主张画布中间的 ⇄）以「chat 模拟」的真实渲染为准"
              >
                ·仅示意结构，真实版式见「chat 模拟」
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-11 text-muted-foreground">网格</span>
              {([12, 6] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGridCols(g)}
                  className={`rounded-control border px-2 py-0.5 text-10 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    gridCols === g ? "border-inverse bg-inverse text-inverse-foreground" : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  data-testid={`tpladmin-editor-grid-${g}`}
                >
                  {g} 列
                </button>
              ))}
              {/*
                「不要手工排版」（2026-08-27 人类原话）。全量重排——覆盖所有已放置区块的
                位置，不是只补未放置的（见 `autoFillLayout` 文件头「全量重排，不是补齐」）。
                只在 `editable` 时给：只读态（已归档/无权限）不该有任何会改数据的按钮。
              */}
              {editable && (
                <button
                  type="button"
                  onClick={() => setSections((prev) => autoFillLayout(prev, gridCols, paperSize))}
                  className="rounded-control border border-border px-2 py-0.5 text-10 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="tpladmin-editor-autolayout"
                >
                  一键排版
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowSample((v) => !v)}
                className={`rounded-control border border-border px-2 py-0.5 text-10 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  showSample ? "bg-warning/30" : "bg-transparent"
                }`}
                aria-pressed={showSample}
                data-testid="tpladmin-editor-sample-toggle"
              >
                样例数据
              </button>
              <button
                type="button"
                onClick={() => {
                  // 首次打开时把骨架填好——空文本框加一句"请输入 JSON"等于把
                  // 「它要什么形状」这个问题原样丢回给人类，而答案就在模板里。
                  setDryRunOpen((v) => {
                    if (!v && dryRunText.trim() === "") setDryRunText(buildDryRunSkeleton(sections));
                    return !v;
                  });
                }}
                className={`rounded-control border border-border px-2 py-0.5 text-10 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  dryRunOpen ? "bg-primary text-primary-foreground" : "bg-transparent"
                }`}
                aria-pressed={dryRunOpen}
                data-testid="tpladmin-editor-dryrun-toggle"
              >
                试运行
              </button>
              {/* chat 模拟是弹窗（Dialog，见 template-simulate-dialog.tsx 文件头 R1），
                  不占三栏网格的位置，所以与试运行不互斥、按钮不需要 aria-pressed 常驻态。 */}
              <button
                type="button"
                onClick={() => setSimulateOpen(true)}
                className="rounded-control border border-border bg-transparent px-2 py-0.5 text-10 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="tpladmin-editor-simulate-toggle"
              >
                chat 模拟
              </button>
            </div>
          </div>
          {/*
            版面装帧的两个入口，紧挨着画布放——它们改的是「这张纸」长什么样，
            放进右栏「显示方式」会让人以为是选中区块的属性（那一栏是按区块作用的）。

            ⚠ 留空就是"不画那一带"，占位符里明说，免得人以为忘填了。
          */}
          <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-2">
            <label className="shrink-0 text-11 text-muted-foreground" htmlFor="tpl-title">纸面标题</label>
            <input
              id="tpl-title"
              value={title}
              disabled={!editable}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：用户画像 User Persona（留空则不画标题带）"
              className="min-w-0 flex-1 rounded-control border border-border bg-background px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground"
              data-testid="tpladmin-editor-title-input"
            />
            <label className="shrink-0 text-11 text-muted-foreground" htmlFor="tpl-footer">页脚署名</label>
            <input
              id="tpl-footer"
              value={footer}
              disabled={!editable}
              onChange={(e) => setFooter(e.target.value)}
              placeholder="如：本工具基于 XXX（留空则不画页脚带）"
              className="min-w-0 flex-1 rounded-control border border-border bg-background px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground"
              data-testid="tpladmin-editor-footer-input"
            />
          </div>
          <div className="flex min-h-0 flex-1 justify-center overflow-auto p-4">
            <div className="w-full max-w-4xl">
              <TemplateCanvasGrid
                sections={sections}
                gridCols={gridCols}
                showSample={showSample}
                runData={dryRunData}
                title={title}
                footer={footer}
                selectedId={selectedId}
                editable={editable}
                paperSize={paperSize}
                onSelect={(id) => { setSelectedId(id); setStep(3); }}
                onPlace={place}
                onMove={move}
              />
            </div>
          </div>
        </div>

        {dryRunOpen && (
          <TemplateDryRunDrawer
            sections={sections}
            text={dryRunText}
            onTextChange={setDryRunText}
            onRun={setDryRunData}
            onClose={() => setDryRunOpen(false)}
          />
        )}

        {simulateOpen && (
          <TemplateSimulateDialog
            templateKey={row.key}
            layoutSource={row.layoutSource}
            sectionsDirty={sectionsDirty}
            sections={sections}
            gridCols={gridCols}
            title={title}
            footer={footer}
            promptText={promptText}
            onClose={() => setSimulateOpen(false)}
          />
        )}

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
            sections={sections}
            gridCols={gridCols}
            health={health}
            editable={editable}
            paperSize={paperSize}
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
              {publishBlockers.danglingPlaceholders.length > 0 && (
                <span data-testid="tpladmin-editor-publish-blocker-dangling">
                  · <strong>提示词里有 {publishBlockers.danglingPlaceholders.length} 个占位符在字段表里不存在</strong>
                  （{publishBlockers.danglingPlaceholders.map((k) => `{{${k}}}`).join("、")}）
                  —— AI 会被要求产出这些键，而输出结构里没有它们，那部分数据会被丢弃。
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
