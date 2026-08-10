"use client";

/**
 * #617 —— 新建一个 F55 「执行侧」 agent 定义（不是上面 F15 能力目录的"新增"入口）。
 *
 * 与 `capability-mutate.tsx` 的 `CapabilityCreatePanel` 同一条纪律：
 * · 没有权限判断——按钮按缓存的 `orgRole` 挂载只是降噪，真正的拒绝在服务端
 *   （`POST /agents` → `createAgent`：403 / ROLE_INSUFFICIENT）。
 * · 没有乐观更新——成功后不在本地拼一行"看起来像"的记录；这个面板本身也不维护列表
 *   （`agents` 表还没有对应的 `listAgents` 读路径挂线，见组件下方成功态的说明文字）。
 *
 * ## 范围（#617 报告里也会写一遍）
 *
 * 只做"从零新建"：`cloneFrom` 恒为 `null`，`source` 恒为 `"self"`。
 * "复制一个现成的"（需要一个可选源 agent 选择器）未做——契约层已经支持，
 * 但选择器需要一条"可复制的源列表从哪读"的读路径，`listAgents` 同样零挂载，
 * 留给后续把两者一起接的人。
 */
import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import {
  createAgentFromScratch,
  selfPublishAgent,
  setAgentInstructions,
  type AgentVisibility,
  type CreateAgentResult,
} from "@/lib/agent-definition";

const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-card px-2.5 py-2 text-13 " +
  "text-card-foreground transition-all duration-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:bg-disabled disabled:text-disabled-foreground";

const SELECT_CLASS =
  "h-8 w-full appearance-none rounded-md border border-input bg-card px-2.5 text-13 " +
  "text-card-foreground transition-all duration-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:bg-disabled disabled:text-disabled-foreground";

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.reasonCode ?? `HTTP ${error.status}`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}

export function AgentDefinitionCreatePanel({ prefix }: { prefix: string }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [initials, setInitials] = React.useState("");
  const [role, setRole] = React.useState("");
  /**
   * #660 候选 A —— 可执行定义。**与「职责一句话」是两件事**：
   * `role` 是给人看的标签，这段是 agent 运行时真的照着执行的系统提示词。
   * 界面上分成两个输入框、文案点明区别，正是为了不让人以为填了 role 就够了。
   */
  const [instructions, setInstructions] = React.useState("");
  const [visibility, setVisibility] = React.useState<AgentVisibility>("全组织可用");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<CreateAgentResult | null>(null);
  /* #660：发布这一步的独立状态——它与"创建"是两次请求，失败面也不同。 */
  const [publishing, setPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [published, setPublished] = React.useState(false);

  const reset = () => {
    setName("");
    setInitials("");
    setRole("");
    setInstructions("");
    setVisibility("全组织可用");
    setError(null);
  };

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedInitials = initials.trim();
    const trimmedRole = role.trim();
    const trimmedInstructions = instructions.trim();
    if (!trimmedName || !trimmedInitials || !trimmedRole) {
      setError("名称、缩写角标、职责一句话均不能为空。");
      return;
    }
    if (!trimmedInstructions) {
      // ⚠ 前端拦一道只是降噪：服务端在发布时会用 AGENT_NO_EXECUTABLE_DEFINITION 再拦一次。
      // 不写指令的 agent 建得出来，但发不出去——与其让人建完才发现，不如现在就说。
      setError("「这个 Agent 执行什么」不能为空——没有它，agent 建出来也发布不了。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createAgentFromScratch({
        name: trimmedName,
        initials: trimmedInitials,
        role: trimmedRole,
        visibility,
      });
      // ⚠ 两次请求：createAgent 不收 instructions（它是 updateAgentDefinition 的字段），
      // 所以建完立刻把指令写进去。第二步失败时**不**把 created 置上——
      // 否则界面会显示一个"建好了"的 agent，而它其实发布不了。
      await setAgentInstructions(result.agentId, trimmedInstructions);
      setCreated(result);
      setPublished(false);
      setPublishError(null);
      setOpen(false);
      reset();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * #660 —— 发布。**⚠⚠ 走的是尚未签核的草案边**（`selfPublishToollessAgent`）。
   *
   * ⚠ 与创建同一条纪律：没有乐观更新。`setPublished(true)` 只在请求**真的成功之后**
   * 才发生——一个"点了就变绿"的按钮会把 422 说成成功，而 #660 的整个症状就是
   * "界面看起来好了、发消息还是 422"。
   *
   * ⚠ 失败原样显示 `reasonCode`（`AGENT_NOT_TOOLLESS` / `AGENT_VISIBILITY_UNSUPPORTED`
   * 等），不翻译成"发布失败，请重试"——后者会让「这个 agent 有工具所以必须走评审」
   * 这个真实原因消失。
   */
  const publish = async (agentId: string) => {
    setPublishing(true);
    setPublishError(null);
    try {
      await selfPublishAgent(agentId);
      setPublished(true);
    } catch (e) {
      setPublishError(describeError(e));
    } finally {
      setPublishing(false);
    }
  };

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCreated(null);
            setOpen(true);
          }}
          data-testid={`${prefix}-add`}
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          新建 Agent
        </Button>
        {created ? (
          <div className="flex flex-col items-end gap-1.5">
            <p data-testid={`${prefix}-add-notice`} className="text-12 text-muted-foreground">
              {published
                ? `已发布 agent ${created.agentId}（运行中）。现在可以在会话的 agent 下拉里选中它并发消息。`
                : `已建成草稿 agent ${created.agentId}（${created.publishState}）。草稿发不出消息——需要发布之后才能在会话里选用。`}
              {" "}
              本屏当前没有把它列出来的读路径——`listAgents` 尚未挂线（#617 范围之外）。
            </p>
            {published ? null : (
              <Button
                size="sm"
                onClick={() => void publish(created.agentId)}
                disabled={publishing}
                data-testid={`${prefix}-publish`}
              >
                {publishing ? "发布中…" : "发布"}
              </Button>
            )}
            {publishError ? (
              <p data-testid={`${prefix}-publish-error`} className="text-12 text-destructive">
                {publishError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>新建 Agent</CardTitle>
        <CardDescription>
          从零新建一个 agent 定义，落草稿态。工具白名单恒为空（复制不继承权限的同一条规则也适用于&ldquo;从零新建&rdquo;）。
          填好&ldquo;执行什么&rdquo;后可直接&ldquo;发布&rdquo;——一个不带任何工具的 agent 没有可被评审的权限面；
          之后若要给它配工具，就必须走完整的双人评审。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-12">
            <span>名称</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              autoComplete="off"
              data-testid={`${prefix}-add-name`}
            />
          </label>
          <label className="flex flex-col gap-1 text-12">
            <span>缩写角标</span>
            <Input
              value={initials}
              onChange={(e) => setInitials(e.target.value)}
              disabled={busy}
              autoComplete="off"
              data-testid={`${prefix}-add-initials`}
            />
          </label>
          <label className="flex flex-col gap-1 text-12 sm:col-span-2">
            <span>职责一句话</span>
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={busy}
              autoComplete="off"
              data-testid={`${prefix}-add-role`}
            />
          </label>
          <label className="flex flex-col gap-1 text-12 sm:col-span-2">
            <span>这个 Agent 执行什么（系统提示词）</span>
            <textarea
              className={TEXTAREA_CLASS}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={busy}
              rows={5}
              maxLength={8000}
              placeholder="例：把用户说的每一件事整理成带编号的要点，最后一行给出下一步建议。"
              data-testid={`${prefix}-add-instructions`}
            />
            <span className="text-11 text-muted-foreground">
              ⚠ 与上面的「职责一句话」不同：那一句是给同事看的标签，这一段是 Agent 运行时真的照着执行的内容。
            </span>
          </label>
          <label className="flex flex-col gap-1 text-12">
            <span>可见范围</span>
            <select
              className={SELECT_CLASS}
              value={visibility}
              disabled={busy}
              onChange={(e) => setVisibility(e.target.value as AgentVisibility)}
              data-testid={`${prefix}-add-visibility`}
            >
              <option value="全组织可用">全组织可用</option>
              <option value="仅某组">仅某组</option>
            </select>
          </label>
        </div>
        {error ? (
          <p data-testid={`${prefix}-add-error`} className="text-12 text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(false);
              reset();
            }}
            disabled={busy}
            data-testid={`${prefix}-add-cancel`}
          >
            取消
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy} data-testid={`${prefix}-add-submit`}>
            {busy ? "创建中…" : "创建"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
