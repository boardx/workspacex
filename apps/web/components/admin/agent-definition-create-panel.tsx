"use client";

/**
 * #617 —— 新建一个 F55 「执行侧」 agent 定义（不是上面 F15 能力目录的"新增"入口）。
 * #1915 —— 补两件事：① 建成后交给外层刷新 `listAgents`（不再自己拼假记录）；
 * ② 加"从已有 agent 克隆"选择器，接上契约/domain 早就支持、前端一直没接的 `cloneFrom`。
 *
 * 与 `capability-mutate.tsx` 的 `CapabilityCreatePanel` 同一条纪律：
 * · 没有权限判断——按钮按缓存的 `orgRole` 挂载只是降噪，真正的拒绝在服务端
 *   （`POST /agents` → `createAgent`：403 / ROLE_INSUFFICIENT；`GET /agents` →
 *   `listAgents` 同理，见 `list-agents.ts` 头注）。
 * · 没有乐观更新——成功后不在本地拼一行"看起来像"的记录；建成后通过 `onCreated`
 *   回调让**外层**（`AgentDefinitionListPanel`）打一次真实的 `listAgents` 重新拉取，
 *   而不是本组件自己往一个本地数组里 push 一行。
 *
 * ## 克隆选择器为什么是"选中后预填表单"，不是"选中就直接提交"
 *
 * `domain/agent/clone.ts` 的 `NewAgentIdentity` 虽然把 name/initials/role/roleLabel/
 * visibility 都设计成 optional（"不填就继承源"），但 `create-agent.ts` 这个用例从不
 * 省略任何一个——它总是把 controller 收到的这五个字段原样传给 `cloneAgentDefinition`。
 * 也就是说"继承"这件事在当前落地里从未真的发生过：前端不预填，克隆出来的字段
 * 就是空字符串，不是源的值。所以选中源之后必须把它的 name/initials/role/roleLabel/
 * visibility 复制进输入框——用户仍然可以改（"复制一个改改用"），但起点不是空白。
 *
 * instructions 是唯一一个服务端**真的会继承**的字段（`CLONE_INHERITED_FIELDS` 含
 * `instructions`），`AgentRow`（`listAgents` 的返回形状）里没有这个字段（契约没暴露
 * 指令原文），前端拿不到源的指令文本去预填，因此克隆模式下"这个 Agent 执行什么"
 * 改为选填——留空时不发 `PATCH`，让服务端在 `createAgent` 那一步继承来的指令保持原样；
 * 填了就按用户新写的覆盖（当场发 `PATCH`）。
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import {
  createAgentFromScratch,
  listAgents,
  selfPublishAgent,
  setAgentInstructions,
  type AgentListRow,
  type AgentVisibility,
  type CreateAgentResult,
} from "@/lib/agent-definition";
// #1705（#728 D-1）：故意不导入 `setAgentRoleLabel` 到本文件——建 agent 时 `roleLabel`
// 随 `createAgentFromScratch` 一次性提交（见下方表单新增的输入框），不需要建完再补
// 一次 PATCH。`setAgentRoleLabel` 是给"编辑既有 agent"用的，那条 UI 落在 agent 详情/
// 编辑页（`apps/web/app/admin/agent/[id]/page.tsx`），本轮尚未接线——同 `setAgentInstructions`
// 目前也只在"新建"这条路径上接线、编辑页还没有 PATCH 入口的既有范围边界一致，
// 不是本 feature 新开的缺口。

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

/**
 * 人类反馈（2026-08-17）：Agent 的新建/导入不能摆在主界面顶部——要跟 Skill 一样
 * 收进一个弹层。本组件因此不再自己维护"折叠/展开"状态（`open`），那由外层的
 * `Modal`（`agent-screen.tsx`）负责；本组件只管"表单 → 提交 → 建成后发布"这条
 * 内容本身，与是否可见无关。
 */
export function AgentDefinitionCreatePanel({
  prefix,
  onCreated,
}: {
  readonly prefix: string;
  /** #1915 —— 建成（`createAgent` 成功）后调用，让外层的 Agent 列表重新拉取。 */
  readonly onCreated?: () => void;
}) {
  const [name, setName] = React.useState("");
  const [initials, setInitials] = React.useState("");
  const [role, setRole] = React.useState("");
  /**
   * #1705（#728 D-1，人类裁决）—— 简短角色头衔（如「战略分析师」），与上面的 `role`
   * （「职责一句话」）是两个不同的输入框、两个不同的字段：D2 编制区渲染成
   * 「{name} · {roleLabel}」，`role` 仍走既有的「职责一句话」展示位（面板第二行）。
   * 建 agent 时必填——契约 `createAgent.in.roleLabel` 是 `.min(1)`。
   */
  const [roleLabel, setRoleLabel] = React.useState("");
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

  /* #1915 —— 克隆选择器状态。`cloneFrom` 非 null 时表单其余字段是"预填后可编辑"。 */
  const [cloneOpen, setCloneOpen] = React.useState(false);
  const [cloneOptions, setCloneOptions] = React.useState<readonly AgentListRow[] | null>(null);
  const [cloneLoading, setCloneLoading] = React.useState(false);
  const [cloneError, setCloneError] = React.useState<string | null>(null);
  const [cloneFrom, setCloneFrom] = React.useState<string | null>(null);
  const cloneSourceName = cloneOptions?.find((r) => r.agentId === cloneFrom)?.name ?? null;

  const reset = () => {
    setName("");
    setInitials("");
    setRole("");
    setRoleLabel("");
    setInstructions("");
    setVisibility("全组织可用");
    setError(null);
    setCloneFrom(null);
  };

  /** 懒加载——只有用户真的点开"从已有 agent 克隆"才打 `listAgents`，不在挂载时打。 */
  const openCloneSelector = async () => {
    setCloneOpen(true);
    if (cloneOptions !== null || cloneLoading) return;
    setCloneLoading(true);
    setCloneError(null);
    try {
      const rows = await listAgents();
      setCloneOptions(rows);
    } catch (e) {
      setCloneError(describeError(e));
    } finally {
      setCloneLoading(false);
    }
  };

  const applyCloneSource = (agentId: string) => {
    const source = cloneOptions?.find((r) => r.agentId === agentId);
    if (!source) return;
    setCloneFrom(agentId);
    setName(source.name);
    setInitials(source.initials);
    setRole(source.role);
    setRoleLabel(source.roleLabel);
    setVisibility(source.visibility);
    setError(null);
  };

  const clearCloneSource = () => {
    setCloneFrom(null);
    reset();
  };

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedInitials = initials.trim();
    const trimmedRole = role.trim();
    const trimmedRoleLabel = roleLabel.trim();
    const trimmedInstructions = instructions.trim();
    if (!trimmedName || !trimmedInitials || !trimmedRole || !trimmedRoleLabel) {
      setError("名称、缩写角标、职责一句话、角色头衔均不能为空。");
      return;
    }
    // ⚠ 克隆模式下 instructions 选填——服务端在 createAgent 那一步已经把源的指令继承
    // 过来（`CLONE_INHERITED_FIELDS` 含 instructions），留空不等于"没有可执行定义"。
    // 从零新建仍然必填——那种情况下没有任何来源可以继承。
    if (!trimmedInstructions && cloneFrom === null) {
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
        roleLabel: trimmedRoleLabel,
        visibility,
        cloneFrom,
      });
      // ⚠ 两次请求：createAgent 不收 instructions（它是 updateAgentDefinition 的字段），
      // 所以建完立刻把指令写进去。第二步失败时**不**把 created 置上——
      // 否则界面会显示一个"建好了"的 agent，而它其实发布不了。
      // ⚠ 克隆模式下留空 instructions ⇒ 不发 PATCH（不覆盖服务端刚继承过来的指令）。
      if (trimmedInstructions) {
        await setAgentInstructions(result.agentId, trimmedInstructions);
      }
      setCreated(result);
      setPublished(false);
      setPublishError(null);
      reset();
      setCloneOpen(false);
      onCreated?.();
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
      onCreated?.();
    } catch (e) {
      setPublishError(describeError(e));
    } finally {
      setPublishing(false);
    }
  };

  /*
   * 建成之后：不再收进"折叠态"，而是就地展示"已建成/已发布"通知——外层 Modal
   * 仍然开着（由 `agent-screen.tsx` 控制关闭），用户看得到结果、也能立刻点发布，
   * 或者接着往下滚看到表单再建一个。
   */
  const createdNotice = created ? (
    <div className="flex flex-col items-start gap-1.5 rounded-md border border-border bg-muted/40 p-3">
      <p data-testid={`${prefix}-add-notice`} className="text-12 text-muted-foreground">
        {published
          ? `已发布 agent ${created.agentId}（运行中）。现在可以在会话的 agent 下拉里选中它并发消息。`
          : `已建成草稿 agent ${created.agentId}（${created.publishState}）。草稿发不出消息——需要发布之后才能在会话里选用。`}
        {" "}
        已同步到下方 Agent 列表（`listAgents`）。
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
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      {createdNotice}
      <Card>
        <CardHeader>
          <CardTitle>新建 Agent</CardTitle>
          <CardDescription>
            {cloneFrom
              ? <>从「{cloneSourceName ?? cloneFrom}」复制出一个新草稿——名称/角标/职责/头衔/可见范围已预填，可以直接改。工具白名单不继承（复制不继承权限，I-30），执行指令若留空则沿用源 agent 的指令。</>
              : <>从零新建一个 agent 定义，落草稿态。工具白名单恒为空（复制不继承权限的同一条规则也适用于&ldquo;从零新建&rdquo;）。填好&ldquo;执行什么&rdquo;后可直接&ldquo;发布&rdquo;——一个不带任何工具的 agent 没有可被评审的权限面；之后若要给它配工具，就必须走完整的双人评审。</>}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
        {cloneFrom === null ? (
          cloneOpen ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-muted/20 p-2.5">
              <span className="text-12 font-medium">从已有 agent 克隆</span>
              {cloneLoading ? (
                <p className="text-11 text-muted-foreground" data-testid={`${prefix}-clone-loading`}>
                  加载 Agent 列表中…
                </p>
              ) : cloneError ? (
                <p className="text-11 text-destructive" data-testid={`${prefix}-clone-error`}>
                  {cloneError}
                </p>
              ) : cloneOptions && cloneOptions.length === 0 ? (
                <p className="text-11 text-muted-foreground" data-testid={`${prefix}-clone-empty`}>
                  组织内还没有其它 Agent，无法克隆——先从零新建一个。
                </p>
              ) : (
                <select
                  className={SELECT_CLASS}
                  defaultValue=""
                  disabled={busy}
                  onChange={(e) => e.target.value && applyCloneSource(e.target.value)}
                  data-testid={`${prefix}-clone-select`}
                >
                  <option value="" disabled>
                    选一个作为克隆源…
                  </option>
                  {cloneOptions?.map((row) => (
                    <option key={row.agentId} value={row.agentId}>
                      {row.name} · {row.roleLabel || row.role}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void openCloneSelector()}
              disabled={busy}
              data-testid={`${prefix}-clone-open`}
            >
              从已有 agent 克隆…
            </Button>
          )
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-muted/20 p-2.5">
            <span className="text-12" data-testid={`${prefix}-clone-selected`}>
              克隆自：{cloneSourceName ?? cloneFrom}
            </span>
            <Button
              size="xs"
              variant="outline"
              onClick={clearCloneSource}
              disabled={busy}
              data-testid={`${prefix}-clone-clear`}
            >
              改为从零新建
            </Button>
          </div>
        )}
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
            {/* #1705（#728 D-1，人类裁决）—— 与「职责一句话」是不同的字段、不同的
                展示位：这个是 D2 编制区渲染成「{name} · {roleLabel}」的短头衔。 */}
            <span>角色头衔（如「战略分析师」）</span>
            <Input
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              disabled={busy}
              autoComplete="off"
              data-testid={`${prefix}-add-role-label`}
            />
          </label>
          <label className="flex flex-col gap-1 text-12 sm:col-span-2">
            <span>这个 Agent 执行什么（系统提示词）{cloneFrom ? "（选填——留空则沿用源 agent 的指令）" : ""}</span>
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
            onClick={() => reset()}
            disabled={busy}
            data-testid={`${prefix}-add-cancel`}
          >
            重置
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy} data-testid={`${prefix}-add-submit`}>
            {busy ? "创建中…" : cloneFrom ? "克隆创建" : "创建"}
          </Button>
        </div>
        </CardContent>
      </Card>
    </div>
  );
}
