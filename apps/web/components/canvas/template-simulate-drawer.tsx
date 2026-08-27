"use client";

/**
 * chat 模拟抽屉 —— 人类原话：「这个界面需要有测试的功能，做好了设置以后，需要有一个
 * chat 界面模拟，输出过程，可以输入一段提示词，需要出来实际的结果」。
 *
 * ## 与「试运行」是两件不同的事，别混
 *
 * 试运行（`TemplateDryRunDrawer`）喂的是使用者**手填的 JSON**，跳过模型，验证的是
 * 「这份数据画布装得下吗」。这个抽屉调的是**真实模型**（`simulateCanvasTemplateRun`），
 * 喂的是使用者的一句自然语言提示词，走的是与真实 chat 生成完全同一条 system 指引
 * （`buildCanvasTemplateGuidance`），验证的是「模型看着这份模板结构，真的会写出对得上的
 * 围栏吗」。两者互不替代，工具条上并排放着两个按钮，不是一个按钮的两种模式。
 *
 * ## 渲染复用 `MarkdownMessage`——不是另起一份围栏解析
 *
 * 模型回复是自由文本，可能含 ```` ```canvas ```` 围栏也可能没有。`MarkdownMessage`
 * 正是生产 chat 气泡用的那个组件：文本走 ReactMarkdown，围栏走 `ChatCanvasFabric`。
 * 这里不传 `threadId`/`messageId`/`bearer`/`projectId`——模拟结果不落库、没有真实消息
 * 可挂，`ChatCanvasFabric` 对缺失这些 props 的处理是优雅退化成只读预览，不会崩
 * （同一份精确到组件层的复用，不是照着抄一份新逻辑）。
 *
 * ## 提示词默认带上①栏正文，不强制留白
 *
 * 打开抽屉时若使用者还没打字，预填 `promptText`（①栏「提示词」正是编辑器里已经写好的
 * 那段，让使用者一开始就能测「我已经写好的这段提示词，模型真的听得懂吗」，而不是
 * 每次都要重新打一遍）。使用者仍可以清空改打别的临时提示词。
 */

import * as React from "react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { simulateCanvasTemplateRun } from "@/lib/live-canvas";
import { ApiError } from "@/lib/api-client";
import type { SectionDraft } from "./template-editor-model";
import { toContractSections } from "./template-editor-model";

export function TemplateSimulateDrawer({
  templateKey, sections, promptText, onClose,
}: {
  readonly templateKey: string;
  readonly sections: readonly SectionDraft[];
  /** ①栏当前的提示词正文——打开抽屉时用来预填，见文件头。 */
  readonly promptText: string;
  readonly onClose: () => void;
}) {
  const [prompt, setPrompt] = React.useState(promptText);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<{ readonly text: string } | null>(null);
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
      setResult({ text: out.text });
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
    <aside
      className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card p-4"
      data-testid="tpladmin-editor-simulate-drawer"
      aria-label="chat 模拟"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-13 font-bold">chat 模拟</h3>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="tpladmin-editor-simulate-close"
        >
          关闭
        </button>
      </div>

      <p className="text-11 leading-relaxed text-muted-foreground">
        真调模型跑一次当前分区结构——不是手填数据，是像真实 chat 一样给一句提示词，
        看模型真的会写出什么。
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="如：帮我画一份新用户画像，产品是一款效率工具"
        spellCheck={false}
        className="h-[120px] w-full resize-none rounded-control border border-border bg-background p-2 text-11 leading-relaxed transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="tpladmin-editor-simulate-input"
        aria-label="模拟提示词"
      />

      <div className="flex gap-2">
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
        <div
          className="min-h-0 flex-1 overflow-auto rounded-control border border-border bg-background p-2"
          data-testid="tpladmin-editor-simulate-result"
        >
          <MarkdownMessage text={result.text} />
        </div>
      )}
    </aside>
  );
}
