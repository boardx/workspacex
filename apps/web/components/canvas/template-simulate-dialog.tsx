"use client";

/**
 * chat 模拟弹窗 —— 人类原话：「这个界面需要有测试的功能，做好了设置以后，需要有一个
 * chat 界面模拟，输出过程，可以输入一段提示词，需要出来实际的结果」。
 *
 * ## R1（2026-08-27，devapp 实测反馈）：从抽屉改成弹窗
 *
 * 首版是嵌进三栏网格第 4 列的抽屉。人类实测要求「弹出一个新的 popup，不要再是一个
 * drawer」——改成 `Dialog`。
 *
 * ## R2（2026-08-28，devapp 实测反馈）：结果渲染改回真实 fabric.js 引擎
 *
 * R1 当时把结果渲染从生产 chat 的 `ChatCanvasFabric`（fabric.js）换成了编辑器自己的
 * HTML/CSS 网格 `TemplateCanvasGrid`，理由是内置模板恒用写死几何、看不见未保存的改动。
 * 人类实测反馈两点：①「看起来很丑，UX 很差」——`{{key}}` 徽章、溢出裁字这些本是**编辑态**
 * 的调试信息，混进"看模型输出"的场景观感很差；②「可视化的界面必须用 fabricjs 来渲染，
 * 这样的话可以修改」——「后台设计页面用 html，但是在渲染出来的界面上用 fabricjs」。
 *
 * 修法：**编辑态**（②③栏拖拽画布）继续走 HTML/CSS 网格 `TemplateCanvasGrid`，一个字不动；
 * 只有**这个弹窗的结果预览**改回真实 `CanvasStage`（fabric.js，可编辑，同生产 chat 最大化
 * 编辑用的组件）。
 *
 * ## ⚠ R2.1（2026-08-28，同日复核发现）：内置模板必须走真实几何，不能套自动布局
 *
 * R2 落地时头注写着「本弹窗只会对着组织自建模板跑，不可能是内置 key」——**这句话是错
 * 的**，复核时对着 `template-admin.tsx` 卡片列表实测发现：内置模板（`t.builtin===true`）
 * 与组织自建模板走的是**同一张卡片列表、同一个编辑器、同一个「chat 模拟」按钮**，
 * 没有任何一行代码把内置模板排除在外（`template-editor-panel.tsx` 全文搜不到
 * `builtin` 这个词）。人类原话（同日）：「设计好的 html 模板可以通过提示词渲染出来
 * fabricjs 的画布并保持 ratio 和大小的一致」——如果对内置模板也套 `buildAutoTemplateSpec`
 * 自动布局，画出来的位置/比例会与那 19 个模板真实的手工排版（`packages/fabric-markdown/
 * src/diagrams/templates-*.ts` 里的 `registerTemplate({...})`）完全对不上，正是这句话
 * 点名要防止的事。
 *
 * 修法：先判定 `templateKey` 是不是内置 key（`canvas.builtinDisplayName`，与
 * `fence-template-resolver.ts` 判定"内置恒赢"用的**同一个**函数，不是另写一份枚举）。
 * 是内置 ⇒ 不注册任何东西、不重写围栏里的 `模板:` 行——19 个内置 spec 在
 * `@repo/fabric-markdown` 模块加载时已经用它们**真实的 key** 自行 `registerTemplate`
 * 过了（见 `templates-entry.ts`），原样喂给 `CanvasStage` 就会解析到那份真实几何。
 * 只有非内置（组织自建）key 才用 `buildAutoTemplateSpec` 现拼一份 spec——那条路径的
 * 理由不变：与生产 chat 对组织自建模板的渲染是同一个函数，用当前编辑器里的草稿分区
 * 结构，让「chat 模拟看到的」与「保存发布后真实 chat 会渲染的」保持一致。
 *
 * ⚠ 组织自建 key 的分支里，注册进 `fabric-markdown` 全局模板表时**不用真实 key**，
 *   用一个命名空间化的 `${templateKey}__simulate-preview`——原因见
 *   `rewriteTemplateKeyLine` 头注。内置 key 的分支不走这条路径，天然不受影响。
 *
 * ## ⚠ R2.2（2026-08-29，人类实测反馈）：内置模板一旦被组织自定义过，也要用当前分区
 *
 * R2.1 漏了一件事：内置 key**可以被组织自定义**（编辑器允许对着一个内置模板加/删
 * 字段、改布局，保存后铸新版本），`fence-template-resolver.ts` 用 `layoutSource` 这一列
 * 判定"这一行是不是真被人改过"（`"user-edited"` vs `"builtin-derived"`，issue #2221）。
 * R2.1 只查了 key 是不是内置，没有查这一列——于是人类改了一个内置模板（如「价值主张
 * 宣言」`adlib`）、保存发布后，chat 模拟仍然回退到 package 里那份**原始**几何（19 个
 * 字段/布局都是发布时写死的），编辑器里刚加的新字段在 chat 模拟里完全不出现。人类原话：
 * 「我更改了模板，保存了，之后用测试功能，发现用的还是旧的模板」。
 *
 * 修法：判据从"是不是内置 key"改成与 `fence-template-resolver.ts` 第 163 行**逐字同一个
 * 条件**：`isBuiltinKey && layoutSource !== "user-edited"` 才用 package 静态几何；
 * 只要这一行被标成 `"user-edited"`（不管是不是内置 key），都用当前分区结构现拼 spec。
 * `layoutSource` 由调用方（`template-editor-panel.tsx`）透传 `row.layoutSource`
 * （`listTemplates.out` 契约字段），不是本组件自己查库——与"编辑面板已经有这份数据，
 * 不重新发起一次请求"同一条既有纪律。
 *
 * ## ⚠ R2.3（2026-08-29，人类实测反馈）：还没保存过的改动也要算数
 *
 * `layoutSource` 是**持久化**字段——只在保存成功那一刻才可能翻成 `"user-edited"`。
 * 一个从没被定制过的内置模板（`layoutSource` 仍是 `"builtin-derived"` 或
 * `undefined`），在编辑器里当场拖动/新增/删除区块、**还没点保存**，此时弹窗顶部
 * 文案明明写着「结果按当前分区结构渲染（含未保存的分区改动）」——但 R2.2 的判据
 * 只认持久化的 `layoutSource`，会照样走 package 里那份原始几何，把这一刻刚做的
 * 改动整个吃掉。人类原话：「我在②画布里的改动没生效」，另外也点出了同一根因的
 * 两个外显症状——「⇄连接符号缺失」「配色/样式对不上」：那两者其实是「真实几何走
 * fabric.js 手工排版+专属装饰」与「当前草稿走 `buildAutoTemplateSpec` 通用网格」
 * 两条本就不同的渲染路径，只有当误判成"没改过"、错误地选中了前一条路径时，才会
 * 显得"和②画布里看到的不一样"——一旦按下面这条判据走上正确的路径，两边就都是
 * 同一份 `buildAutoTemplateSpec` 产出，天然一致。
 *
 * 修法：新增 `sectionsDirty` 参数——调用方（`template-editor-panel.tsx`）传入
 * "当前草稿分区结构是否已经偏离 `row.sections`"（与顶部「有未保存的改动」横幅
 * 复用同一次 `JSON.stringify` 比较，不是另起一套判据）。`sectionsDirty` 为真时，
 * 不管 `layoutSource` 是什么，都走当前分区结构那条分支——这与"这一行迟早会在保存后
 * 变成 `user-edited`"是同一件事实的两个时间点，提前生效不是新发明的规则。
 */

import * as React from "react";
import { MousePointer2, StickyNote, Trash2, Maximize, Scan } from "lucide-react";
import { extractMermaidBlocks, wrapAsMermaidBlock, registerTemplate } from "@repo/fabric-markdown";
import { isCanvasFenceLang } from "@/lib/canvas/canvas-fence";
import { canvas } from "@repo/contracts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { simulateCanvasTemplateRun } from "@/lib/live-canvas";
import { ApiError } from "@/lib/api-client";
import { buildAutoTemplateSpec } from "@/lib/canvas/auto-template-layout";
import { buildExplicitTemplateSpec, allSectionsPlaced } from "@/lib/canvas/explicit-template-layout";
import { CanvasStage, type CanvasStageHandle } from "./canvas-stage";
import type { CanvasTool } from "./canvas-toolbar";
import type { SectionDraft } from "./template-editor-model";
import { toContractSections } from "./template-editor-model";

/** 全局注册表里的命名空间后缀——见文件头「不用真实 key」。 */
const PREVIEW_KEY_SUFFIX = "__simulate-preview";

const TOOLS: { readonly key: CanvasTool; readonly label: string; readonly icon: typeof MousePointer2 }[] = [
  { key: "select", label: "选择", icon: MousePointer2 },
  { key: "sticky", label: "＋便签", icon: StickyNote },
  { key: "delete", label: "删除便签", icon: Trash2 },
];

/**
 * 模型回复文本 → 可喂给 `CanvasStage` 的 markdown，附带把这一版分区结构注册进
 * `fabric-markdown` 的全局模板表。
 *
 * ## 为什么注册在一个**命名空间化**的 key 下，不直接用 `templateKey`
 *
 * `registerTemplate` 写的是模块级全局 `Map`，同一个 key 全应用共享——生产 chat 的
 * `ensureCanvasFenceTemplate`（`fence-template-resolver.ts`）也会往这张表里写**真实
 * 发布过**的这个 key。如果本弹窗直接用 `templateKey` 注册当前**未保存**的分区结构，
 * 同一个浏览器标签页里只要打开过一次 chat 模拟，这个 key 的"真实版本"就会被这份
 * 草稿数据永久覆盖——SPA 不刷新的话，随后任何真实渲染同一个 key 的地方（哪怕是另一
 * 个标签页共享的 service worker 缓存，或本页面自己后续渲染逻辑的假设）都可能读到
 * 一份从未发布过的草稿。命名空间隔离这份风险，代价只是围栏文本里的 `模板: <key>` 那
 * 一行需要重写成预览 key（`rewriteTemplateKeyLine`），模型/前端其余解析逻辑不受影响。
 */
export function rewriteTemplateKeyLine(fenceBody: string, previewKey: string): string {
  return fenceBody.replace(/^(\s*模板\s*:\s*).+$/m, `$1${previewKey}`);
}

/**
 * 见文件头 R2.1/R2.2——单独导出成一个纯函数，不内联在 `run()` 里，是为了能在不起真栈
 * 的情况下直接单测覆盖全部 19 个内置 key（`tests/lib/template-simulate-dialog.test.ts`）：
 * 「未被自定义过的内置模板永远不走自动布局分支，被自定义过的（不管是不是内置 key）
 * 永远走」这条不变量，机械门控住，不必每加一个新内置模板都重新手工验证一遍 chat 模拟。
 *
 * ⚠ 判据必须与 `fence-template-resolver.ts` 第 163 行逐字同一个条件——同一件事实两处
 *   声明是本仓已经栽过五次的形状，这里不是巧合对齐，是刻意抄同一行判断。`sectionsDirty`
 *   是这条判据之外**唯一**加的一层（见文件头 R2.3）：它不改变"内置且未定制过 ⇒ 用真实
 *   几何"这条基线，只是把"未定制过"的时间窗口从"从未保存过"提前到"这一刻的草稿也没
 *   偏离已保存版本"。
 */
export function usesAutoLayoutSpec(
  templateKey: string,
  layoutSource: string | undefined,
  sectionsDirty = false,
): boolean {
  const isBuiltinKey = canvas.builtinDisplayName(templateKey) !== undefined;
  return sectionsDirty || !(isBuiltinKey && layoutSource !== "user-edited");
}

export function TemplateSimulateDialog({
  templateKey, layoutSource, sectionsDirty, sections, gridCols, title, footer, promptText, onClose,
}: {
  readonly templateKey: string;
  /**
   * `row.layoutSource`（`listTemplates.out` 契约字段）——决定内置模板要不要用当前
   * 分区结构，见文件头 R2.2。组织自建模板恒 `usesAutoLayoutSpec` 为真，这个值传
   * 什么都不影响它（`canvas.builtinDisplayName` 对非内置 key 恒返回 `undefined`）。
   */
  readonly layoutSource: string | undefined;
  /**
   * 当前草稿分区结构是否已经偏离 `row.sections`（见文件头 R2.3）——调用方直接复用
   * 顶部「有未保存的改动」横幅那次比较，不是本组件另起一套判据。
   */
  readonly sectionsDirty: boolean;
  readonly sections: readonly SectionDraft[];
  /**
   * 编辑器当前的网格制式（issue #2372）——`SectionDraft.layout.col/row/w/h` 是相对
   * 这个制式的网格坐标，`buildExplicitTemplateSpec` 换算 px 时需要它。与②画布用
   * 同一个 state，不另起一份。
   */
  readonly gridCols: 6 | 12;
  readonly title: string;
  /** 页脚署名——与保存/真实 chat 渲染同源，模拟里也要画出来（issue #2527）。 */
  readonly footer: string;
  /** ①栏当前的提示词正文——打开弹窗时用来预填。 */
  readonly promptText: string;
  readonly onClose: () => void;
}) {
  const [prompt, setPrompt] = React.useState(promptText);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<{
    readonly text: string;
    /** 是否解析出了能渲染的 canvas 围栏——真值时 `markdown` state 已经就绪。 */
    readonly hasCanvas: boolean;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [markdown, setMarkdown] = React.useState("");
  const [tool, setTool] = React.useState<CanvasTool>("select");
  const [zoom, setZoom] = React.useState(1);
  /**
   * 「可以修改」这条要求（人类原话）此前只验证到"canvas 挂载了、工具条在"，没有验证
   * 过在画布上真的拖/加/删有没有效果——`CanvasStage` 的 `onMarkdownChange` 只在
   * fabric 场景真的发生变化（新增/挪动/删除对象 → 序列化回写）时才触发，同
   * `chat-canvas-modal.tsx` 的 `dirty`/`chat-canvas-dirty` 同一条既有信号，这里照抄
   * 同一个信号，而不是新发明一套判据。
   */
  const [edited, setEdited] = React.useState(false);
  const stageRef = React.useRef<CanvasStageHandle>(null);

  const previewKey = `${templateKey}${PREVIEW_KEY_SUFFIX}`;

  const run = React.useCallback(async () => {
    if (prompt.trim() === "" || running) return;
    setRunning(true);
    setError(null);
    try {
      const out = await simulateCanvasTemplateRun({
        key: templateKey,
        prompt,
        // ⚠ 与「保存」用同一个转换函数——模拟的是「我现在正在改的这版分区结构」，
        //   不是库里已存的版本，见契约操作文件头「`sections` 由前端传入，不从库里读」。
        sections: toContractSections(sections),
      });
      const block = extractMermaidBlocks(out.text).find((b) => isCanvasFenceLang(b.lang));
      if (block) {
        // 见文件头 R2.1/R2.2：未被自定义过的内置模板走真实几何（模块加载时已用真实
        // key 自行注册过），不套自动布局、不重写围栏里的 key；被自定义过的（不管
        // 是不是内置 key）都用当前分区结构。
        if (usesAutoLayoutSpec(templateKey, layoutSource, sectionsDirty)) {
          // 组织自建：用**当前**（含未保存改动的）分区结构现拼一份 spec——与生产
          // chat 对组织自建模板的渲染同一条判据（见下方 `allSectionsPlaced` 分支），
          // 只是数据源从"库里已发布的版本"换成"这一刻编辑器里的草稿"。
          //
          // issue #2372：每个分区都已放置到画布上时，用 `buildExplicitTemplateSpec`
          // 忠实还原②画布里那份位置/列数/颜色——此前这里恒用 `buildAutoTemplateSpec`，
          // 把每个分区降维成 5 个字段，`layout`（位置/列数/颜色）在这一步就被丢了，
          // chat 模拟看到的与②画布里配的完全对不上。只要有一个分区还没放，退回
          // 原来的自动布局（`allSectionsPlaced` 头注解释了为什么不做部分合并）。
          const { spec } = allSectionsPlaced(sections)
            ? buildExplicitTemplateSpec({
              key: previewKey,
              displayName: title || templateKey,
              footer,
              gridCols,
              sections: sections.map((s) => (
                { sectionId: s.sectionId, name: s.name, layout: s.layout!, type: s.type }
              )),
            })
            : buildAutoTemplateSpec({
              key: previewKey,
              displayName: title || templateKey,
              footer,
              sections: sections.map((s) => ({
                sectionId: s.sectionId, name: s.name, order: s.order, required: s.required, capacity: s.capacity,
                type: s.type,
              })),
            });
          registerTemplate(spec);
          setMarkdown(wrapAsMermaidBlock(rewriteTemplateKeyLine(block.code, previewKey), block.lang));
        } else {
          setMarkdown(wrapAsMermaidBlock(block.code, block.lang));
        }
        setEdited(false);
        setResult({ text: out.text, hasCanvas: true });
      } else {
        setMarkdown("");
        setResult({ text: out.text, hasCanvas: false });
      }
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.reasonCode === "TEMPLATE_SIMULATION_UNAVAILABLE"
            ? "模型暂时调不通，稍后再试一次"
            : e.message)
          : "运行失败，请重试",
      );
    } finally {
      setRunning(false);
    }
  }, [prompt, running, templateKey, layoutSource, sectionsDirty, sections, gridCols, title, footer, previewKey]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        // 人类原话：「chat 模拟UI，默认是全屏，不是popup」——覆盖 `DialogContent` 默认的
        // 居中定宽弹窗（`fixed left-1/2 top-1/2 max-w-md -translate-x/y-1/2`），改成贴满
        // 视口四边，`rounded-none` 去掉弹窗圆角（全屏态没有"窗口边缘"这回事）。twMerge
        // 会按 class 分组去重，这里覆盖的每一组（position/inset/size/translate/radius）
        // 在基础样式里都恰好各出现一次，不会出现两条同组类互相打架、谁生效全看书写顺序
        // 的隐患。
        className="fixed inset-0 left-0 top-0 h-screen w-screen max-w-none max-h-none translate-x-0 translate-y-0 flex-col gap-3 rounded-none flex overflow-y-auto"
        data-testid="tpladmin-editor-simulate-dialog"
        // ⚠ 不传就是 `DialogContent` 的默认值 "dialog-close"——真栈 E2E 实测发现的真实
        //   缺口：写测试时想当然认为这里已经有一个 `tpladmin-editor-simulate-close`，
        //   实际上从没显式传过，`getByTestId` 稳定超时。见该 prop 的文件头「多个 Dialog
        //   同屏共存……需要各自可寻址」。
        closeTestId="tpladmin-editor-simulate-close"
      >
        <DialogHeader>
          <DialogTitle>chat 模拟</DialogTitle>
        </DialogHeader>

        <p className="text-11 leading-relaxed text-muted-foreground">
          真调模型跑一次当前分区结构——不是手填数据，是像真实 chat 一样给一句提示词，
          看模型真的会写出什么。结果按当前分区结构渲染（含未保存的分区改动），渲染引擎
          与真实 chat 完全一致（fabric.js），可以直接在下面拖动/编辑便签。
        </p>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="如：帮我画一份新用户画像，产品是一款效率工具"
          spellCheck={false}
          className="h-[100px] w-full flex-none resize-none rounded-control border border-border bg-background p-2 text-11 leading-relaxed transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="tpladmin-editor-simulate-input"
          aria-label="模拟提示词"
        />

        <div className="flex flex-none gap-2">
          <button
            type="button"
            disabled={prompt.trim() === "" || running}
            onClick={() => void run()}
            className="rounded-control bg-primary px-3 py-1.5 text-11 text-primary-foreground transition-colors duration-fast hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="tpladmin-editor-simulate-run"
          >
            {running ? "运行中…" : "运行"}
          </button>
        </div>

        {error && (
          <p className="text-11 text-destructive" data-testid="tpladmin-editor-simulate-error">
            {error}
          </p>
        )}

        {result && (
          <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="tpladmin-editor-simulate-result">
            {result.hasCanvas ? (
              <>
                <div className="flex flex-none items-center gap-1 rounded-control border border-border bg-card px-2 py-1.5">
                  {TOOLS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTool(t.key)}
                      data-testid={`tpladmin-editor-simulate-tool-${t.key}`}
                      className={`inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 transition-colors duration-fast ${
                        tool === t.key ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted"
                      } ${t.key === "delete" ? "text-destructive" : ""}`}
                    >
                      <t.icon aria-hidden className="h-3.5 w-3.5" />
                      {t.label}
                    </button>
                  ))}
                  <div className="mx-1 h-4 w-px bg-border" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    aria-label="适应画布（回到 100%）"
                    data-testid="tpladmin-editor-simulate-zoom-fit"
                    className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-muted"
                  >
                    <Maximize aria-hidden className="h-3.5 w-3.5" />
                  </button>
                  {/*
                    人类原话：「上面的按钮加一个：看到所有的内容的reset按钮」——与
                    `zoom-fit`（回到 100%，不管内容在不在视口里）不是同一件事：这个按钮
                    按当前全部对象的并集包围盒重算 zoom/pan，不管内容有多大/在哪，重置
                    完一定整张画布都在视口里。`CanvasStage.fitToContent` 见该方法头注，
                    是 `exportPNG` 那套并集包围盒算法的另一个用途，不是重新量一遍。
                  */}
                  <button
                    type="button"
                    onClick={() => stageRef.current?.fitToContent()}
                    aria-label="重置视图（看到全部内容）"
                    title="重置视图（看到全部内容）"
                    data-testid="tpladmin-editor-simulate-fit-content"
                    className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-muted"
                  >
                    <Scan aria-hidden className="h-3.5 w-3.5" />
                    看到全部
                  </button>
                  <span
                    className="w-10 text-center font-mono text-10 tabular-nums text-muted-foreground"
                    data-testid="tpladmin-editor-simulate-zoom-readout"
                  >
                    {Math.round(zoom * 100)}%
                  </span>
                  {edited && (
                    <span
                      className="ml-2 text-10 text-muted-foreground"
                      data-testid="tpladmin-editor-simulate-edited"
                    >
                      已编辑
                    </span>
                  )}
                </div>
                {/*
                  ⚠ 真栈 E2E 实测踩出的坑：`CanvasStage` 自己的根节点是
                  `flex-1 overflow-auto`（`canvas-stage.tsx`），`flex-1` 只在**父级是
                  flex 容器**时才生效——外层原先只有 `h-[480px]`，没有 `flex`，
                  `flex-1` 在这样的父级下不生效（CSS 规范：flex 属性只对 flex item
                  有意义），画布高度退回到浏览器算出的某个不可预期的值，导致
                  `boundingBox()` 量出来的尺寸与视觉上实际可见区域对不上——"点画布真的
                  会加便签"这条 E2E 断言首次实测就撞上了（见同 PR 的 R2 补测）。
                  照抄 `chat-canvas-modal.tsx` 证明可用的既有结构：`flex min-h-0` 的
                  外层 + `flex flex-col` 的内层，两层都是真 flex 容器，`flex-1` 才吃得上。
                */}
                {/*
                  全屏化之后（见 `DialogContent` 头注）不再用固定 `h-[480px]`——弹窗本身
                  贴满视口，画布区域应该占满弹窗剩余可用高度，而不是像 popup 时代那样
                  停在一个跟视口大小无关的定值。`flex-1` 在这一层生效同样要求父级
                  （上面 `result &&` 那个容器）是真 flex 容器，见下方两层结构与
                  `chat-canvas-modal.tsx` 同构那条既有注释。
                */}
                <div className="flex min-h-0 flex-1 overflow-hidden rounded-control border border-border">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <CanvasStage
                      ref={stageRef}
                      readOnly={false}
                      tool={tool}
                      zoom={zoom}
                      onZoomChange={setZoom}
                      markdown={markdown}
                      onMarkdownChange={(next) => { setMarkdown(next); setEdited(true); }}
                      // 人类原话：「画布默认要可以看到整体的画布，不需要经过缩放」——
                      // 每次模拟结果重新渲染（包括同一个弹窗里连续换提示词再运行）都
                      // 自动跑一次 `fitToContent`，不需要用户先手动点一次「看到全部」。
                      fitOnLoad
                    />
                  </div>
                </div>
              </>
            ) : (
              <div
                className="min-h-0 flex-1 overflow-auto rounded-control border border-border bg-muted/30 p-4"
                data-testid="tpladmin-editor-simulate-raw"
              >
                <p className="mb-2 text-11 text-warning">
                  模型没有按格式产出能对上当前分区的 canvas 围栏，原始回复：
                </p>
                <pre className="whitespace-pre-wrap text-11">{result.text}</pre>
              </div>
            )}

            {/* 原始回复正文——诊断用，同时也是「结果确实随这次提示词变化」的可核对依据
                （fabric 画的是像素，肉眼/自动化都读不到文字，靠这段兜底）。 */}
            {result.hasCanvas && (
              <div className="flex-none rounded-control border border-border-subtle bg-muted/30 p-2">
                <p className="mb-1 text-10 text-muted-foreground">模型原始回复</p>
                <pre
                  className="max-h-[120px] overflow-auto whitespace-pre-wrap text-10 leading-relaxed"
                  data-testid="tpladmin-editor-simulate-source"
                >
                  {result.text}
                </pre>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
