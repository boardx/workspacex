"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChatArtifactView } from "@/components/chat/chat-artifact-view";

/**
 * issue #2099 —— 右栏「产物」列表点了没反应的修复：只读预览。
 *
 * ## 2026-09-23：它不再是唯一的打开方式
 *
 * 人类交办「应该在右边可以打开结果」。产物现在**默认在右栏里打开**
 * （`ChatTaskInspector` 的产物详情态），模态退居「放大看」这一档——模态会挡住对话，
 * 而一边看结果一边追问正是 Claude Code / Codex 最常用的姿势。
 *
 * 取源与渲染搬进了 `ChatArtifactView`（两处共用同一遍），这里只剩一层 `Dialog` 外壳：
 * 同一份产物在右栏与在模态里渲染出来的东西**逐字一致**，不会因为摆在两个地方而长成两样。
 */
export function ChatArtifactPreviewDialog({
  threadId, projectId, artifactId, title, bearer, onClose,
}: {
  threadId: string;
  /** `null` = 个人线程——同 `getThreadArtifactSource` 同名参数注释。 */
  projectId: string | null;
  artifactId: string;
  title: string;
  bearer: string | undefined;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto" data-testid="chat-artifact-preview-dialog">
        <DialogHeader>
          <DialogTitle className="truncate">{title}</DialogTitle>
        </DialogHeader>
        <ChatArtifactView threadId={threadId} projectId={projectId} artifactId={artifactId} bearer={bearer} />
      </DialogContent>
    </Dialog>
  );
}
