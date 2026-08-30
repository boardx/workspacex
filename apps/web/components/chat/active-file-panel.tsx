"use client";
import * as React from "react";
import { FileText, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, type AttachmentIconKind } from "@/lib/chat-attachment-format";
import { useProducedFileDownload } from "@/lib/use-produced-file-download";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { AssetCodeEditor, monacoLanguageFromPath } from "@/components/asset-governance/asset-code-editor";
import { Button } from "@/components/ui/button";
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
 * issue #2321 round 4 —— `source === "agent_run_output"`（`run-skill-script.ts` 的
 * 沙箱产出，真实的 PDF/DOCX/XLSX 二进制文件，不是 agent 拿来临时编辑的文本/代码）走
 * 第四条渲染分支，且**先于**上面三条判断：`file_content_delta` 目前没有任何生产者
 * 会对这类来源的文件发出（真实产物是二进制字节，从来就不该被当文本流式），所以
 * `file.content` 对这类文件永远是空字符串——此前会一路落到 `<pre>` 分支，渲染出一个
 * 看起来"生成完了却什么都没有"的空白 tab，用户找不到刚生成的 PDF 在哪。这个来源改成
 * 图标 + 文件名 + 字节数 + 下载按钮，复用 `chat-attachment-preview-modal.tsx` 同一条
 * 已鉴权路由与同一个 `useAuthedImageSrc`（尽管名字带 Image，本就是任意字节通用的）
 * ——不新造第二套下载机制。`threadId` 由调用方（`copilotkit-v2-panel.tsx`）传入：这类
 * 文件必然已经挂在一条真实线程上（产物落库时线程已经存在），`null` 只应该出现在还没
 * 解析出线程 id 的极短窗口，此时禁用按钮而不是拼一个指向不存在线程的 URL。
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

export function ActiveFilePanel(
  { files, threadId }: { files: readonly ActiveFile[]; threadId: string | null },
): JSX.Element | null {
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
        <ActiveFileContent file={selected} threadId={threadId} />
      </div>
    </div>
  );
}

function ActiveFileContent({ file, threadId }: { file: ActiveFile; threadId: string | null }): JSX.Element {
  if (file.source === "agent_run_output") {
    return <ProducedFileDownloadCard file={file} threadId={threadId} />;
  }
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

/** issue #2321 round 4 —— 见本文件头注该节。`useAuthedImageSrc` 拿 `url === null` 时
 *  什么都不拉（它自己的实现），所以 `threadId`/`attachmentId` 任一缺失时安全地停在
 *  「按钮禁用」态，不会拼出一个指向不存在资源的请求。 */
function ProducedFileDownloadCard({ file, threadId }: { file: ActiveFile; threadId: string | null }): JSX.Element {
  const { src, failed, iconKind } = useProducedFileDownload(file, threadId);

  return (
    <div
      data-testid="active-file-produced-download-card"
      className="flex flex-col items-center justify-center gap-2 py-8 text-center"
    >
      <FileIconFor kind={iconKind} />
      <span className="max-w-full truncate text-13 font-medium text-card-foreground">{file.name}</span>
      {file.bytes !== null ? (
        <span className="text-11 text-muted-foreground">{formatBytes(file.bytes)}</span>
      ) : null}
      {failed ? (
        <span className="text-11 text-destructive" data-testid="active-file-produced-download-failed">
          下载失败，请稍后重试。
        </span>
      ) : (
        <Button asChild size="sm" variant="outline" disabled={src === null}>
          <a
            href={src ?? undefined}
            download={file.name}
            data-testid="active-file-produced-download-link"
            aria-disabled={src === null}
          >
            <Download aria-hidden className="h-3.5 w-3.5" />
            下载
          </a>
        </Button>
      )}
    </div>
  );
}

/** 复用 `chat-attachment-preview-modal.tsx` 同一套图标族——不是本文件自己发明的映射。 */
function FileIconFor({ kind }: { kind: AttachmentIconKind }): JSX.Element {
  return <FileText aria-hidden className={cn("h-8 w-8 shrink-0", kind === "file" ? "text-muted-foreground" : "text-primary")} />;
}
