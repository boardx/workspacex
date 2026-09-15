"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Loader2, Send, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentDirectoryEntry } from "@/lib/ic-review/agent-directory";
import { FIXTURE_PACKS } from "@/lib/ic-review/fixtures";
import { intakeFiles, intakeTexts } from "@/lib/ic-review/intake";
import { launchReviewThread } from "@/lib/ic-review/launch-review-thread";
import type { ReviewDocument, UnparsedFile } from "@/lib/ic-review/types";

/**
 * `/agent/team1` 工作区 —— MVP 架构第二版：只做材料预处理与发起，
 * 不自建分析结果面板；审阅结果出现在真实 chat 线程里（跳转后可见）。
 */
export function IcReviewLauncher({ agent }: { agent: AgentDirectoryEntry }) {
  const router = useRouter();
  const [files, setFiles] = React.useState<File[]>([]);
  const [fixtureDocs, setFixtureDocs] = React.useState<ReviewDocument[]>([]);
  const [unparsed, setUnparsed] = React.useState<UnparsedFile[]>([]);
  const [selectedPackId, setSelectedPackId] = React.useState<string | null>(null);
  const [launching, setLaunching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const intake = await intakeFiles(Array.from(list));
    setFiles((prev) => [...prev, ...intake.documents.map((d) => new File([d.text], d.name))]);
    setUnparsed((prev) => [...prev, ...intake.unparsed]);
  };

  const loadPack = async (packId: string) => {
    const pack = FIXTURE_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    setSelectedPackId(packId);
    setFixtureDocs(await intakeTexts(pack.files));
  };

  const totalCount = files.length + fixtureDocs.length;

  const start = async () => {
    if (!agent.agentId || launching || totalCount === 0) return;
    setLaunching(true);
    setError(null);
    try {
      const { threadId } = await launchReviewThread({ agentId: agent.agentId, files, extraDocuments: fixtureDocs });
      router.push(`/chat?thread=${encodeURIComponent(threadId)}`);
    } catch {
      setError("发起审阅失败：无法创建对话或上传材料，请稍后重试。");
      setLaunching(false);
    }
  };

  return (
    <div data-testid="agent-ic-review-launcher" className="space-y-6">
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
              该 Agent 尚未在后台发布，暂时无法发起真实审阅对话。发布步骤见
              <code className="mx-1 rounded-control bg-muted px-1 py-0.5 text-11">docs/agents/team1-ic-review-mvp.md</code>。
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-14">上传本次上会材料</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()} data-testid="agent-upload-trigger">
              <Upload aria-hidden className="size-3.5" />选择文件
            </Button>
            <input ref={fileRef} type="file" multiple className="hidden" aria-label="上传上会材料"
              onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
            {FIXTURE_PACKS.map((p) => (
              <Button key={p.id} variant={selectedPackId === p.id ? "primary" : "outline"} size="sm"
                onClick={() => void loadPack(p.id)} data-testid={`agent-fixture-${p.id}`}>
                {p.label}
              </Button>
            ))}
          </div>
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-2 text-11 text-muted-foreground">
                <FileText aria-hidden className="size-3.5" /><span className="text-card-foreground">{f.name}</span>
              </li>
            ))}
            {fixtureDocs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-11 text-muted-foreground">
                <FileText aria-hidden className="size-3.5" /><span className="text-card-foreground">{d.name}</span>
                <Badge tone="outline">示例</Badge>
              </li>
            ))}
          </ul>
          {unparsed.length > 0 && (
            <div data-testid="agent-unparsed-list" className="rounded-card border border-border bg-muted p-3">
              <p className="text-12 font-medium">未能解析清单（「我没读到」不等于「材料里没有」）</p>
              <ul className="mt-1 space-y-1">
                {unparsed.map((u) => <li key={u.name} className="text-11 text-muted-foreground">· {u.name}：{u.reason}</li>)}
              </ul>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button variant="ai" size="sm" onClick={() => void start()} disabled={!agent.agentId || totalCount === 0 || launching}
              data-testid="agent-start-review">
              {launching ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Send aria-hidden className="size-3.5" />}
              开始审阅（{totalCount} 份，将进入真实项目对话）
            </Button>
            {error && <span className="text-11 text-destructive-foreground">{error}</span>}
          </div>
          <p className="text-11 text-muted-foreground">
            点击后会新建一条项目对话，把材料作为附件发送并附上审阅任务说明；后续的提纲、缺失清单、
            风险标注与两轮人工确认都在那条对话里进行——本页不重复渲染这些内容。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
