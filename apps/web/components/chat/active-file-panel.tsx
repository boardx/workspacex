"use client";
import * as React from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { AssetCodeEditor, monacoLanguageFromPath } from "@/components/asset-governance/asset-code-editor";
import type { ActiveFile } from "@/lib/agui-file-events";

/**
 * ActiveFilePanel（DA-13，双栏联动：Chat + 活动文件工作台）—— 右栏。
 *
 * ## 动作边界
 *
 * 左栏（`copilotkit-v2-panel.tsx` 现有的 `CopilotChatMessageView`）继续放流式对话与
 * 决策过程；长文档/代码不再塞进聊天气泡——本组件订阅 `useAguiFileEvents` 累积出的
 * `files`，agent "打开/写入文件"（`file_created`）时这里实时展开一个 tab，
 * `file_content_delta` 到达时对应 tab 的内容逐段增长。
 *
 * 不做（明确超出本条范围，见 backlog DA-13/DA-14/DA-16）：
 *   · `file_patch_applied` 的红绿 diff 高亮 + Accept/Reject —— DA-16。
 *   · `@` 引用/把右栏当前内容当上下文注入请求体 —— DA-14。
 *
 * ## 渲染管线复用，不重新发明
 *
 * · `mime`/文件名后缀能判断出是 markdown（`.md`/`text/markdown`）时用
 *   `MarkdownMessage`（同一套 react-markdown + mermaid fabric 渲染管线，与消息气泡
 *   一致）。
 * · 其余已知语言后缀（`.ts`/`.py`/`.json`/…）用 `AssetCodeEditor`（Monaco，只读态）
 *   ——`monacoLanguageFromPath` 是它自己导出的单一事实源，这里不重抄一份扩展名映射。
 * · 两者都不认得的内容（未知后缀、纯文本）退回 `<pre>` 原样展示，不假装是代码或
 *   markdown。
 *
 * 没有任何文件时整块不渲染（`null`）——与 `AgentPlanPanel` 同一条纪律：面板的缺席
 * 不该被"空状态占位"伪装成"agent 什么都没做"以外的东西。
 */

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

function isMarkdownFile(file: ActiveFile): boolean {
  if (file.mime !== null && file.mime.includes("markdown")) return true;
  const base = file.name.split("/").pop() ?? file.name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return MARKDOWN_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

export function ActiveFilePanel({ files }: { files: readonly ActiveFile[] }): JSX.Element | null {
  const [selectedUri, setSelectedUri] = React.useState<string | null>(null);

  // 新文件到达且此前没有任何选中 tab（或选中的 tab 已经不在列表里，理论上不会发生，
  // 因为本组件从不移除已有文件）时，自动选中最新到达的文件——这正是"右栏实时展开"
  // 该有的行为：agent 打开一个新文件，用户不需要手动点开才能看到。
  React.useEffect(() => {
    if (files.length === 0) return;
    setSelectedUri((prev) => {
      if (prev !== null && files.some((f) => f.uri === prev)) return prev;
      return files[files.length - 1]!.uri;
    });
  }, [files]);

  if (files.length === 0) return null;

  const selected = files.find((f) => f.uri === selectedUri) ?? files[files.length - 1]!;

  return (
    <div
      data-testid="active-file-panel"
      data-active-file-count={files.length}
      className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border-subtle px-2 py-1.5">
        {files.map((file, i) => (
          <button
            key={file.uri}
            type="button"
            data-testid={`active-file-tab-${i}`}
            data-active-file-tab-selected={file.uri === selected.uri}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded px-2 py-1 text-11 transition-colors duration-fast",
              file.uri === selected.uri
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60",
            )}
            onClick={() => setSelectedUri(file.uri)}
          >
            <FileText aria-hidden className="h-3 w-3 shrink-0" />
            <span className="max-w-[10rem] truncate">{file.name}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2" data-testid="active-file-content">
        <ActiveFileContent file={selected} />
      </div>
    </div>
  );
}

function ActiveFileContent({ file }: { file: ActiveFile }): JSX.Element {
  if (isMarkdownFile(file)) {
    return <MarkdownMessage text={file.content} />;
  }
  const language = monacoLanguageFromPath(file.name);
  if (language !== "plaintext") {
    return (
      <AssetCodeEditor
        path={file.name}
        value={file.content}
        onChange={() => {}}
        readOnly
        testid="active-file-code-editor"
        height="100%"
      />
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-11 text-foreground" data-testid="active-file-plaintext">
      {file.content}
    </pre>
  );
}
