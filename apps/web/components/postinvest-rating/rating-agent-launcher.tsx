"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Loader2, Send, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ATTACHMENT_MIME_ALLOWLIST } from "@/lib/live-chat";
import type { RatingAgentEntry } from "@/lib/postinvest-rating/agent-directory";
import { launchRatingThread } from "@/lib/postinvest-rating/launch-rating-thread";

/**
 * `/agent/team2` 工作区——同 team1（`components/agent/ic-review-chat-entry.tsx`）的架构：
 * 只做材料预处理与发起，不自建结果面板；评级结果出现在真实 chat 线程里（跳转后可见）。
 * 不客户端预解析文件：PDF/Excel/PPT/Word 直接作为真实附件上传，交给挂载的 Agent 用
 * `wx_document_parse` 自己读。
 */
export function RatingAgentLauncher({ agent }: { agent: RatingAgentEntry }) {
  const router = useRouter();
  const [files, setFiles] = React.useState<File[]>([]);
  const [launching, setLaunching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name));

  const start = async () => {
    if (!agent.agentId || launching || files.length === 0) return;
    setLaunching(true);
    setError(null);
    try {
      const { threadId } = await launchRatingThread({ agentId: agent.agentId, files });
      router.push(`/chat?thread=${encodeURIComponent(threadId)}`);
    } catch {
      setError("发起评级失败：无法创建对话或上传材料，请稍后重试。");
      setLaunching(false);
    }
  };

  return (
    <div data-testid="agent-rating-launcher" className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-18">{agent.name}</CardTitle>
            <Badge tone="ai">/agent/{agent.slug}</Badge>
          </div>
          <p className="mt-1 text-12 text-muted-foreground">{agent.tagline}</p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-12 font-semibold">能做什么</h3>
            <ul className="mt-2 space-y-1">
              {agent.capabilities.map((c) => <li key={c} className="text-11 text-muted-foreground">· {c}</li>)}
            </ul>
          </div>
          <div>
            <h3 className="text-12 font-semibold">不做什么</h3>
            <ul className="mt-2 space-y-1">
              {agent.boundaries.map((b) => <li key={b} className="text-11 text-muted-foreground">· {b}</li>)}
            </ul>
          </div>
        </CardContent>
      </Card>

      {!agent.agentId && (
        <Card>
          <CardContent className="flex items-start gap-2 py-4">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 text-warning-foreground" />
            <p className="text-12 text-muted-foreground">
              该 Agent 尚未在后台发布，暂时无法发起真实评级对话。发布步骤见
              <code className="mx-1 rounded-control bg-muted px-1 py-0.5 text-11">docs/agents/team2-postinvest-rating-mvp.md</code>。
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-14">上传本次投后项目材料</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()} data-testid="agent-rating-upload-trigger">
              <Upload aria-hidden className="size-3.5" />选择文件（Excel / PDF / PPT / Word / 录音）
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={[...ATTACHMENT_MIME_ALLOWLIST, "audio/*"].join(",")}
              className="hidden"
              aria-label="上传投后项目材料"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
          </div>
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-2 text-11 text-muted-foreground">
                <FileText aria-hidden className="size-3.5" />
                <span className="text-card-foreground">{f.name}</span>
                <button type="button" onClick={() => removeFile(f.name)} className="text-destructive-foreground underline" data-testid={`agent-rating-remove-${f.name}`}>
                  移除
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button variant="ai" size="sm" onClick={() => void start()} disabled={!agent.agentId || files.length === 0 || launching}
              data-testid="agent-rating-start">
              {launching ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Send aria-hidden className="size-3.5" />}
              开始评级（{files.length} 份，将进入真实项目对话）
            </Button>
            {error && <span data-testid="agent-rating-error" className="text-11 text-destructive-foreground">{error}</span>}
          </div>
          <p className="text-11 text-muted-foreground">
            点击后会新建一条项目对话，把材料作为附件发送并附上评级任务说明；评分脚本会在沙箱里真实
            执行，等级、依据表与不确定性标注都会出现在那条对话里——本页不重复渲染这些内容。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
