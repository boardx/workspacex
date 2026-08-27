"use client";

/**
 * chat 模拟弹窗 —— 人类原话：「这个界面需要有测试的功能，做好了设置以后，需要有一个
 * chat 界面模拟，输出过程，可以输入一段提示词，需要出来实际的结果」。
 *
 * ## R1（2026-08-27，devapp 实测反馈）：从抽屉改成弹窗，渲染改走编辑器自己的画布
 *
 * 首版是嵌进三栏网格第 4 列的抽屉，渲染直接复用生产 chat 的 `ChatCanvasFabric`。
 * 人类实测暴露两个问题：
 *
 * ① 「弹出一个新的 popup，不要再是一个 drawer」——改成 `Dialog`。
 * ② 「修改了模板的内容，比如颜色测试，发现没有生效」——根因是 `ChatCanvasFabric` 走
 *    `ensureCanvasFenceTemplate`，对 19 个内置 key **恒用 `fabric-markdown` 写死的原生
 *    几何**（`fence-template-resolver.ts` 文件头「内置恒赢」），完全不查这个组织当前
 *    的画布/颜色/列数设置，更不会看编辑器里**还没保存**的改动——这条链路结构上就
 *    回答不了「我这版设置好看吗」这个问题，不只是 chat 模拟一个人的 bug（真实 chat
 *    渲染同一个 key 也会是这个结果，是一个更大范围的既有缺口，另行报告，不在本次改动内）。
 *
 *    修法：**不走 `ChatCanvasFabric`**，改用编辑器自己的画布组件 `TemplateCanvasGrid`
 *    （试运行用的同一个），喂它当前**未保存**的 `sections`/`gridCols`/`title`/`footer`，
 *    把模型回复解析成 `runData` 灌进去——这样任何未保存的颜色/列数/布局改动，
 *    chat 模拟看到的立刻就是那一版，不必先保存。代价：渲染技术与真实 chat 不同
 *    （HTML/CSS grid vs fabric.js），肉眼观感可能有细微差异；但对「验证这版设置」
 *    这个目的而言，忠于**当前编辑状态**比忠于「与生产像素级一致」更要紧——后者
 *    连保存之后的版本都做不到（上面那个更大缺口）。
 */

import * as React from "react";
import { extractMermaidBlocks } from "@repo/fabric-markdown/markdown";
import { parseTemplateText } from "@repo/fabric-markdown";
import { isCanvasFenceLang } from "@/lib/canvas/canvas-fence";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { simulateCanvasTemplateRun } from "@/lib/live-canvas";
import { ApiError } from "@/lib/api-client";
import { TemplateCanvasGrid } from "./template-canvas-grid";
import type { SectionDraft } from "./template-editor-model";
import { toContractSections } from "./template-editor-model";

/**
 * 模型原始回复文本 → `TemplateCanvasGrid` 认的 `runData`（按分区 `key` 存，不是中文名）。
 *
 * 复用生产 chat 切段用的同一个抽取器 `extractMermaidBlocks`（不另写一份围栏正则），
 * 再用 `parseTemplateText`（与 `checkCanvasFence` 同一个解析器）拿到
 * `fields: Map<中文名, 值>` / `sections: Map<中文名, 字符串数组>`，按**当前**
 * `sections` 草稿的中文名找到对应 `key`。找不到围栏、或围栏里的名字一个都对不上
 * 当前分区，返回 `null`——调用方据此判断要不要退回显示原始文本。
 */
export function fenceTextToRunData(
  text: string,
  sections: readonly SectionDraft[],
): Record<string, unknown> | null {
  const blocks = extractMermaidBlocks(text).filter((b) => isCanvasFenceLang(b.lang));
  if (blocks.length === 0) return null;
  const parsed = parseTemplateText(blocks[0]!.code);
  const byName = new Map(sections.map((s) => [s.name, s.key] as const));
  const out: Record<string, unknown> = {};
  for (const [name, value] of parsed.fields) {
    const key = byName.get(name);
    if (key) out[key] = value;
  }
  for (const [name, items] of parsed.sections) {
    const key = byName.get(name);
    if (key) out[key] = items;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function TemplateSimulateDialog({
  templateKey, sections, gridCols, title, footer, promptText, onClose,
}: {
  readonly templateKey: string;
  readonly sections: readonly SectionDraft[];
  readonly gridCols: 6 | 12;
  readonly title: string;
  readonly footer: string;
  /** ①栏当前的提示词正文——打开弹窗时用来预填。 */
  readonly promptText: string;
  readonly onClose: () => void;
}) {
  const [prompt, setPrompt] = React.useState(promptText);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<{ readonly text: string; readonly runData: Record<string, unknown> | null } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
      setResult({ text: out.text, runData: fenceTextToRunData(out.text, sections) });
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
  }, [prompt, running, templateKey, sections]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="flex max-h-[88vh] w-full max-w-4xl flex-col gap-3 overflow-y-auto"
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
          看模型真的会写出什么。结果按你当前编辑器里的列数/颜色/布局渲染（含未保存的改动）。
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
          <div className="min-h-0 flex-1 overflow-auto rounded-control border border-border bg-muted/30 p-4" data-testid="tpladmin-editor-simulate-result">
            {result.runData ? (
              <div className="mx-auto w-full max-w-3xl">
                <TemplateCanvasGrid
                  sections={sections}
                  gridCols={gridCols}
                  showSample={false}
                  runData={result.runData}
                  title={title}
                  footer={footer}
                  selectedId={null}
                  editable={false}
                  onSelect={() => {}}
                  onPlace={() => {}}
                  onMove={() => {}}
                />
              </div>
            ) : (
              <div data-testid="tpladmin-editor-simulate-raw">
                <p className="mb-2 text-11 text-warning">
                  模型没有按格式产出能对上当前分区的 canvas 围栏，原始回复：
                </p>
                <pre className="whitespace-pre-wrap text-11">{result.text}</pre>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
