"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, FileText, Loader2, Send, Upload } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PostInvestmentAgentEntry } from "@/lib/post-investment/agent-directory";
import { buildAnalysisPrompt } from "@/lib/post-investment/analysis-prompt";
import { FIXTURE_PACKS } from "@/lib/post-investment/fixtures";
import { intakeFiles, intakeTexts } from "@/lib/post-investment/intake";
import { launchAnalysisThread } from "@/lib/post-investment/launch-analysis-thread";
import type { ReportDocument, UnparsedFile } from "@/lib/post-investment/types";

/**
 * `/agent/team4` 工作区——同 team1 架构第三版：只做材料预处理与发起，不自建结果
 * 面板；分析结果出现在真实 chat 线程里（跳转后可见），可以用 chat 里全部能力
 * （消息流、附件、审批卡、产物、@提及、子任务面板……），本页不重复渲染任何一种。
 *
 * 「开始分析」不要求预先配置好的 `agentId`——点击时按需解析/发布
 * （`lib/post-investment/ensure-agent.ts`）。非 admin 用户第一次点击若撞上
 * `ROLE_INSUFFICIENT`，降级成「复制任务书」兜底。
 */
export function PostInvestmentLauncher({ agent }: { agent: PostInvestmentAgentEntry }) {
  const router = useRouter();
  const [files, setFiles] = React.useState<File[]>([]);
  const [fixtureDocs, setFixtureDocs] = React.useState<ReportDocument[]>([]);
  const [unparsed, setUnparsed] = React.useState<UnparsedFile[]>([]);
  const [selectedPackId, setSelectedPackId] = React.useState<string | null>(null);
  const [launching, setLaunching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [needsAdminInit, setNeedsAdminInit] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const intake = await intakeFiles(Array.from(list));
    setFiles((prev) => [...prev, ...intake.accepted]);
    setUnparsed((prev) => [...prev, ...intake.unparsed]);
  };

  const loadPack = async (packId: string) => {
    const pack = FIXTURE_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    setSelectedPackId(packId);
    setFixtureDocs(await intakeTexts(pack.files));
  };

  const totalCount = files.length + fixtureDocs.length;
  const materialNames = [...files.map((f) => f.name), ...fixtureDocs.map((d) => d.name)];

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildAnalysisPrompt(materialNames));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败：浏览器拒绝了剪贴板权限，请手动选中任务书文本复制。");
    }
  };

  const start = async () => {
    if (launching || totalCount === 0) return;
    setLaunching(true);
    setError(null);
    setNeedsAdminInit(false);
    try {
      const { threadId } = await launchAnalysisThread({ files, extraDocuments: fixtureDocs });
      router.push(`/chat?thread=${encodeURIComponent(threadId)}`);
    } catch (e) {
      if (e instanceof ApiError && e.reasonCode === "ROLE_INSUFFICIENT") {
        setNeedsAdminInit(true);
        setError("这个 Agent 在当前组织里还没有人发布过，需要一位组织管理员先打开本页点一次「开始分析」完成初始化——之后所有人都能直接用。");
      } else {
        setError("发起分析失败：无法创建对话或上传材料，请稍后重试。");
      }
      setLaunching(false);
    }
  };

  return (
    <div data-testid="agent-post-investment-launcher" className="space-y-6">
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

      {needsAdminInit && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 text-warning-foreground" />
              <p className="text-12 text-muted-foreground">
                这个组织还没有人初始化过该 Agent（需要一位组织管理员来打开本页点一次「开始分析」）。
                在此之前，你可以复制下面的任务书，手动粘到任意一条项目对话里、附上材料，照样能用。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void copyPrompt()} data-testid="agent-copy-prompt">
              {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
              {copied ? "已复制" : `复制投后报告任务书${materialNames.length ? `（含 ${materialNames.length} 份材料名）` : ""}`}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-14">上传本次投后材料</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()} data-testid="agent-upload-trigger">
              <Upload aria-hidden className="size-3.5" />选择文件
            </Button>
            <input ref={fileRef} type="file" multiple className="hidden" aria-label="上传投后材料"
              accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.wav,.mp3"
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
            <Button variant="ai" size="sm" onClick={() => void start()} disabled={totalCount === 0 || launching}
              data-testid="agent-start-analysis">
              {launching ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Send aria-hidden className="size-3.5" />}
              开始分析（{totalCount} 份，将进入真实项目对话）
            </Button>
            {error && <span className="text-11 text-destructive-foreground">{error}</span>}
          </div>
          <p className="text-11 text-muted-foreground">
            点击后会新建一条项目对话，把材料作为附件发送并附上投后报告任务说明；后续的
            财务分析、风险清单、外部对标、两轮人工确认与深挖都在那条对话里进行，可以用
            chat 里的全部能力——本页不重复渲染这些内容。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
