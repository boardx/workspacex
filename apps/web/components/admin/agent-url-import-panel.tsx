"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { importAgentFromUrl } from "@/lib/agent-url-import";
import { selfPublishAgent, setAgentInstructions } from "@/lib/agent-definition";
import { runAgentTrialRun } from "@/lib/agent-trial-run";

/**
 * #1415 —— agent 版的 `SkillUrlImportPanel`：从 GitHub URL 导入一个 agent，
 * 然后在同一块面板里走完"编辑指令 → 发布 → 试跑"三步，与 skill 侧
 * （`SkillUrlImportPanel` + `AgSkillEditor` 的试跑按钮）同一条主流程，
 * 只是三步收在一个面板里——`listAgents` 读路径 #1915 起已经接线
 * （`AgentDefinitionListPanel`），但本面板导入成功后仍然就地展示三步，不额外跳转到
 * 那个列表：导入完立刻编辑指令/发布/试跑是同一个操作序列，中途跳走会打断它。
 *
 * ## 为什么 `instructions` 的初始值来自导入响应，不是再读一次
 *
 * 这一阶段没有 `GET /agents/:id` 定义读接口，`importAgentFromUrl` 的响应体
 * 里直接回显了刚写入的指令全文（契约 `AgentUrlImportResult.instructions` 头注）。
 * 界面因此不会在导入成功的瞬间对着一个空文本框——那会让人以为"导入了但没内容"。
 *
 * ## 三步为什么不合并成一次请求
 *
 * 与 `AgentDefinitionCreatePanel` 的"创建 → 写指令"、`AgSkillEditor` 的
 * "编辑 → 保存并发布"同一条既有纪律：编辑、发布、试跑各自独立可失败、各自
 * 独立可重试，合并成一次请求会让"哪一步失败了"这件事无法回答。
 */
type ImportResultState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | {
      readonly status: "success";
      readonly agentId: string;
      readonly instructions: string;
      readonly replayed: boolean;
    }
  | { readonly status: "error"; readonly message: string };

type PublishState =
  | { readonly status: "unpublished" }
  | { readonly status: "publishing" }
  | { readonly status: "published" }
  | { readonly status: "error"; readonly message: string };

type TrialRunState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly steps: readonly { ordinal: number; text: string }[] }
  | { readonly status: "error"; readonly message: string };

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.reasonCode ?? `HTTP ${error.status}`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}

/** 导入成功后的三步面板：编辑指令 → 发布 → 试跑。与导入表单本身分开渲染。 */
function ImportedAgentPanel({
  agentId,
  initialInstructions,
}: {
  agentId: string;
  /** 导入响应回显的指令全文（见本文件头注"为什么 instructions 的初始值来自导入响应"）。 */
  initialInstructions: string;
}) {
  const [instructions, setInstructions] = React.useState(initialInstructions);
  const [savedInstructions, setSavedInstructions] = React.useState(initialInstructions);
  const [savingInstructions, setSavingInstructions] = React.useState(false);
  const [instructionsError, setInstructionsError] = React.useState<string | null>(null);
  const dirty = instructions !== savedInstructions;

  const [publish, setPublish] = React.useState<PublishState>({ status: "unpublished" });

  const [scenario, setScenario] = React.useState("");
  const [trialRun, setTrialRun] = React.useState<TrialRunState>({ status: "idle" });

  const saveInstructions = async () => {
    setSavingInstructions(true);
    setInstructionsError(null);
    try {
      await setAgentInstructions(agentId, instructions);
      setSavedInstructions(instructions);
    } catch (error) {
      setInstructionsError(describeError(error));
    } finally {
      setSavingInstructions(false);
    }
  };

  const doPublish = async () => {
    setPublish({ status: "publishing" });
    try {
      await selfPublishAgent(agentId);
      setPublish({ status: "published" });
    } catch (error) {
      setPublish({ status: "error", message: describeError(error) });
    }
  };

  const runTrial = async () => {
    const trimmed = scenario.trim();
    if (!trimmed) return;
    setTrialRun({ status: "running" });
    try {
      const result = await runAgentTrialRun(agentId, trimmed);
      setTrialRun({ status: "done", steps: result.steps });
    } catch (error) {
      setTrialRun({ status: "error", message: describeError(error) });
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3" data-testid="agent-url-import-post-panel">
      <div className="flex flex-col gap-1">
        <p className="text-11 font-medium text-foreground">① 编辑导入的指令（草稿态，未发布前可反复改）</p>
        <textarea
          data-testid="agent-url-import-instructions"
          className="min-h-[140px] w-full rounded-md border border-input bg-card px-2.5 py-2 text-13 text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={savingInstructions}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="agent-url-import-save-instructions"
            disabled={!dirty || savingInstructions}
            onClick={() => void saveInstructions()}
          >
            {savingInstructions ? "保存中…" : "保存指令"}
          </Button>
          {!dirty && savedInstructions !== "" ? (
            <span className="text-10 text-muted-foreground">已保存</span>
          ) : null}
        </div>
        {instructionsError ? (
          <p data-testid="agent-url-import-instructions-error" className="text-12 text-destructive">
            {instructionsError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 border-t border-border-subtle pt-2">
        <p className="text-11 font-medium text-foreground">② 发布（草稿 → 运行中，发布后指令铸成不可变快照）</p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            data-testid="agent-url-import-publish"
            disabled={publish.status === "publishing" || publish.status === "published"}
            onClick={() => void doPublish()}
          >
            {publish.status === "publishing" ? "发布中…" : publish.status === "published" ? "已发布" : "发布"}
          </Button>
        </div>
        {publish.status === "error" ? (
          <p data-testid="agent-url-import-publish-error" className="text-12 text-destructive">
            {publish.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 border-t border-border-subtle pt-2">
        <p className="text-11 font-medium text-foreground">③ 试跑（需先发布——试跑读的是已发布版本，不是草稿）</p>
        <Input
          data-testid="agent-url-import-trialrun-scenario"
          value={scenario}
          placeholder="试跑场景，例如：帮我总结这段话"
          onChange={(e) => setScenario(e.target.value)}
          disabled={publish.status !== "published" || trialRun.status === "running"}
        />
        <div>
          <Button
            size="sm"
            variant="outline"
            data-testid="agent-url-import-trialrun-run"
            disabled={publish.status !== "published" || scenario.trim() === "" || trialRun.status === "running"}
            onClick={() => void runTrial()}
          >
            {trialRun.status === "running" ? "试跑中…" : "运行一次"}
          </Button>
        </div>
        {trialRun.status === "done" ? (
          <div data-testid="agent-url-import-trialrun-result" className="flex flex-col gap-1 text-12 text-foreground">
            {trialRun.steps.map((step) => (
              <p key={step.ordinal} className="font-mono text-11">{step.ordinal}. {step.text}</p>
            ))}
          </div>
        ) : null}
        {trialRun.status === "error" ? (
          <p data-testid="agent-url-import-trialrun-error" className="text-12 text-destructive">
            {trialRun.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 人类反馈（2026-08-17）：与 `AgentDefinitionCreatePanel` 同一条纪律——本组件
 * 不再自己维护"折叠/展开"状态，可见性交给外层 `Modal`（`agent-screen.tsx`）。
 */
export function AgentUrlImportPanel() {
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [idempotencyKey, setIdempotencyKey] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportResultState>({ status: "idle" });
  const active = React.useRef(true);
  const requestGeneration = React.useRef(0);

  React.useEffect(() => () => {
    active.current = false;
    requestGeneration.current += 1;
  }, []);

  const changeField = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    value: string,
  ) => {
    setter(value);
    setIdempotencyKey(null);
    setResult({ status: "idle" });
  };

  const submit = async () => {
    const trimmedUrl = sourceUrl.trim();
    const trimmedName = name.trim();
    if (!trimmedUrl || !trimmedName) return;
    const requestKey = idempotencyKey ?? window.crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    const request = ++requestGeneration.current;
    setResult({ status: "submitting" });
    try {
      const imported = await importAgentFromUrl({
        sourceUrl: trimmedUrl,
        name: trimmedName,
        idempotencyKey: requestKey,
      });
      if (!active.current || request !== requestGeneration.current) return;
      setResult({
        status: "success",
        agentId: imported.agentId,
        instructions: imported.instructions,
        replayed: imported.replayed,
      });
    } catch (failure) {
      if (!active.current || request !== requestGeneration.current) return;
      setResult({ status: "error", message: describeError(failure) });
    }
  };

  const submitting = result.status === "submitting";
  const canSubmit = sourceUrl.trim() !== "" && name.trim() !== "" && !submitting;

  return (
    <Card data-testid="agent-url-import-panel">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-13">从 URL 导入 Agent</CardTitle>
          <CardDescription className="text-11">
            服务端会抓取该地址的内容作为这个 agent 的指令，落一个新草稿 agent；
            出站地址受 SSRF 门限制，失败会如实告诉你原因。导入后可编辑指令、发布、试跑。
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        <label className="text-10 text-muted-foreground" htmlFor="agent-url-import-url">
          来源 URL（https，单个文件——不是目录）
        </label>
        <Input
          id="agent-url-import-url"
          data-testid="agent-url-import-url"
          value={sourceUrl}
          placeholder="https://example.com/some-agent.md"
          onChange={(e) => changeField(setSourceUrl, e.target.value)}
        />
        <label className="text-10 text-muted-foreground" htmlFor="agent-url-import-name">
          导入后的显示名
        </label>
        <Input
          id="agent-url-import-name"
          data-testid="agent-url-import-name"
          value={name}
          onChange={(e) => changeField(setName, e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            data-testid="agent-url-import-confirm"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {submitting ? "导入中…" : "确认导入"}
          </Button>
        </div>
        {result.status === "success" ? (
          <>
            <p data-testid="agent-url-import-result" className="text-12 text-success">
              {result.replayed
                ? `这次是重放：该 idempotencyKey 之前已导入过，未重复落库（${result.agentId}）`
                : `已建成草稿 agent（${result.agentId}）`}
            </p>
            <ImportedAgentPanel
              key={result.agentId}
              agentId={result.agentId}
              initialInstructions={result.instructions}
            />
          </>
        ) : null}
        {result.status === "error" ? (
          <p data-testid="agent-url-import-result" className="text-12 text-destructive">
            导入失败：{result.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
