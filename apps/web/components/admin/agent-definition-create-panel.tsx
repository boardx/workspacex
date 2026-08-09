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
  type AgentVisibility,
  type CreateAgentResult,
} from "@/lib/agent-definition";

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
    setVisibility("全组织可用");
    setError(null);
  };

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedInitials = initials.trim();
    const trimmedRole = role.trim();
    if (!trimmedName || !trimmedInitials || !trimmedRole) {
      setError("名称、缩写角标、职责一句话均不能为空。");
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
          建成后可直接&ldquo;发布&rdquo;——一个不带任何工具的 agent 没有可被评审的权限面；
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
