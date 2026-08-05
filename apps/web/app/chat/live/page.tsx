"use client";

/**
 * F368 —— `/chat/live`：对话束的第一条真实端到端路径。
 *
 * ## 为什么是新路由，不是把 `/chat` 接上真数据
 *
 * `/chat` 是已签核的原型屏（七态门控、三栏布局、`ChatMain`/`ChatLeftPanel`/
 * `ChatRightPanel` 全部吃 mock 展示字段），与 F122 之前 `/projects` 的处境完全
 * 一样——硬接会逼着现在就给一堆展示字段编出处。这里复用 F122/`/project/live`
 * 立下的先例：开一条干净路由，只证明「真实 HTTP + 真实 Postgres」这条路径成立。
 *
 * ## 范围：只接有真实仓储支撑的用例（见 `lib/live-chat.ts` 头部的核实结论）
 *
 * 列线程、看线程详情（含消息，`getThread.out.messages` 是真实 SQL 查出来的）、
 * 建线程、预设三件套（编写/下发/开始实例/用量）。
 *
 * ⚠ **本页没有「发消息」输入框 —— 但这不是因为契约缺口。**
 *
 *   这里原先写着「契约里没有这个写端口」。那句话**现在是假的**，而且已经造成过实际
 *   损害：有 coordinator 据它建了一个不必要的 design-delta issue、派了不必要的高优先级
 *   任务、还重排了两条链的优先级。写端口一直都在，逐个定位过：
 *     · 契约：      `chat.operations.createMessage`   packages/contracts/src/chat.ts:567
 *     · 前端薄封装：`createMessage`                    apps/web/lib/live-chat.ts
 *       （该文件头部**已经**把 `listMessages / createMessage` 列在「已封装」那一栏，
 *         所以上面那句旧注释连它引用的出处都对不上了）
 *     · 已交付的真实 UI：`chat-message-input` / `chat-message-submit`
 *       apps/web/components/chat/chat-live-message-panel.tsx:202 / :213，
 *       挂在 `/chat`（`ChatReadScreen` → `ChatLiveMessagePanel`）。
 *     · 端到端证据：`apps/web/e2e/chat-read.spec.ts`
 *       （填内容 → 提交 → 202 → `page.reload()` → 消息仍在）。
 *
 *   本页依然不提供输入框，那是**范围选择**而不是能力缺失：`/chat/live` 只用来证明
 *   「真实 HTTP + 真实 Postgres」这条路径成立，发消息的正式界面在 `/chat` 上。
 *   要发消息请去 `/chat`；**不要因为这里空着就断定契约缺了一块。**
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, clearStoredSessionToken, getStoredSessionToken, storeSessionToken } from "@/lib/api-client";
import { login } from "@/lib/live-projects";
import {
  CHAT_VISIBILITY_OPTIONS,
  createThread,
  dispatchPreset,
  getPresetUsage,
  getThread,
  listThreads,
  startPresetInstance,
  upsertPreset,
  type GetThreadOut,
  type ListThreadsOut,
} from "@/lib/live-chat";

export default function ChatLivePage() {
  const [sessionToken, setSessionToken] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [loginBusy, setLoginBusy] = React.useState(false);

  const [projectId, setProjectId] = React.useState("");
  const [threads, setThreads] = React.useState<ListThreadsOut | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [listBusy, setListBusy] = React.useState(false);

  const [newTitle, setNewTitle] = React.useState("");
  const [newVisibility, setNewVisibility] = React.useState<(typeof CHAT_VISIBILITY_OPTIONS)[number]>(
    CHAT_VISIBILITY_OPTIONS[0],
  );
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [createBusy, setCreateBusy] = React.useState(false);

  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null);
  const [threadDetail, setThreadDetail] = React.useState<GetThreadOut | null>(null);
  const [threadDetailError, setThreadDetailError] = React.useState<string | null>(null);
  const [threadDetailBusy, setThreadDetailBusy] = React.useState(false);

  const [presetPrompt, setPresetPrompt] = React.useState("");
  const [presetId, setPresetId] = React.useState<string | null>(null);
  const [presetError, setPresetError] = React.useState<string | null>(null);
  const [presetBusy, setPresetBusy] = React.useState(false);
  const [dispatchResult, setDispatchResult] = React.useState<string | null>(null);
  const [instanceResult, setInstanceResult] = React.useState<string | null>(null);
  const [usageResult, setUsageResult] = React.useState<number | null>(null);

  React.useEffect(() => {
    setSessionToken(getStoredSessionToken());
  }, []);

  const refreshThreads = React.useCallback(async (proj: string) => {
    setListBusy(true);
    setListError(null);
    try {
      const out = await listThreads(proj);
      setThreads(out);
    } catch (e) {
      setListError(describeError(e));
      setThreads(null);
    } finally {
      setListBusy(false);
    }
  }, []);

  async function handleLogin(ev: React.FormEvent) {
    ev.preventDefault();
    setLoginBusy(true);
    setLoginError(null);
    try {
      const out = await login(email, password);
      storeSessionToken(out.sessionToken);
      setSessionToken(out.sessionToken);
    } catch (e) {
      setLoginError(describeError(e));
    } finally {
      setLoginBusy(false);
    }
  }

  function handleLogout() {
    clearStoredSessionToken();
    setSessionToken(null);
    setThreads(null);
    setThreadDetail(null);
  }

  async function handleCreateThread(ev: React.FormEvent) {
    ev.preventDefault();
    if (projectId === "" || newTitle.trim() === "") return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createThread({
        projectId,
        groupId: null,
        title: newTitle.trim(),
        visibilityScope: newVisibility,
      });
      setNewTitle("");
      await refreshThreads(projectId);
    } catch (e) {
      setCreateError(describeError(e));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleSelectThread(threadId: string) {
    setSelectedThreadId(threadId);
    setThreadDetailBusy(true);
    setThreadDetailError(null);
    try {
      const out = await getThread(threadId, projectId);
      setThreadDetail(out);
    } catch (e) {
      setThreadDetailError(describeError(e));
      setThreadDetail(null);
    } finally {
      setThreadDetailBusy(false);
    }
  }

  async function handleUpsertPreset(ev: React.FormEvent) {
    ev.preventDefault();
    if (projectId === "" || presetPrompt.trim() === "") return;
    setPresetBusy(true);
    setPresetError(null);
    try {
      const out = await upsertPreset({
        projectId,
        presetId,
        openingPrompt: presetPrompt.trim(),
        skills: [],
        agents: [],
        expectedVersion: null,
      });
      setPresetId(out.presetId);
    } catch (e) {
      setPresetError(describeError(e));
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleDispatch() {
    if (presetId === null) return;
    setPresetBusy(true);
    setPresetError(null);
    try {
      const out = await dispatchPreset(presetId, { plenary: true, groupIds: null, roles: null });
      setDispatchResult(`dispatchId=${out.dispatchId} targetCount=${out.targetCount}`);
    } catch (e) {
      setPresetError(describeError(e));
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleStartInstance() {
    if (presetId === null) return;
    setPresetBusy(true);
    setPresetError(null);
    try {
      const out = await startPresetInstance(presetId);
      setInstanceResult(`threadId=${out.threadId} instanceId=${out.instanceId}`);
    } catch (e) {
      setPresetError(describeError(e));
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleGetUsage() {
    if (presetId === null) return;
    setPresetBusy(true);
    setPresetError(null);
    try {
      const out = await getPresetUsage(presetId);
      setUsageResult(out.usageCount);
    } catch (e) {
      setPresetError(describeError(e));
    } finally {
      setPresetBusy(false);
    }
  }

  return (
    <div data-testid="chat-live-page" className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-16 font-semibold">对话（真实数据，F368）</h1>

      {sessionToken === null ? (
        <Card data-testid="chat-live-login-card">
          <CardHeader>
            <CardTitle>登录</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-2" onSubmit={handleLogin}>
              <Input
                data-testid="chat-live-login-email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                data-testid="chat-live-login-password"
                placeholder="密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button data-testid="chat-live-login-submit" type="submit" disabled={loginBusy}>
                {loginBusy ? "登录中…" : "登录"}
              </Button>
              {loginError !== null ? (
                <p data-testid="chat-live-login-error" className="text-12 text-destructive">
                  {loginError}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Input
              data-testid="chat-live-project-id"
              placeholder="项目 id"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="max-w-xs"
            />
            <Button
              data-testid="chat-live-refresh"
              onClick={() => refreshThreads(projectId)}
              disabled={projectId === "" || listBusy}
            >
              {listBusy ? "加载中…" : "刷新线程列表"}
            </Button>
            <Button data-testid="chat-live-logout" variant="ghost" onClick={handleLogout}>
              退出登录
            </Button>
          </div>

          {listError !== null ? (
            <p data-testid="chat-live-list-error" className="text-12 text-destructive">
              {listError}
            </p>
          ) : null}

          {threads !== null ? (
            <div data-testid="chat-live-thread-groups" className="flex flex-col gap-3">
              {threads.groups.length === 0 ? (
                <p data-testid="chat-live-thread-groups-empty" className="text-12 text-muted-foreground">
                  空列表
                </p>
              ) : (
                threads.groups.map((group) => (
                  <div key={group.label}>
                    <h2 className="mb-1 text-13 font-medium text-muted-foreground">{group.label}</h2>
                    <ul className="flex flex-col gap-1">
                      {group.cards.map((card) => (
                        <li key={card.id}>
                          <button
                            type="button"
                            data-testid={`chat-live-thread-${card.id}`}
                            className="w-full rounded-md border border-border px-3 py-2 text-left text-13 transition-colors hover:bg-muted"
                            onClick={() => handleSelectThread(card.id)}
                          >
                            {card.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          ) : (
            <p data-testid="chat-live-list-empty-state" className="text-12 text-muted-foreground">
              还没有加载列表——填项目 id 后点「刷新线程列表」。
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>新建线程</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-2" onSubmit={handleCreateThread}>
                <Input
                  data-testid="chat-live-create-title"
                  placeholder="线程标题"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
                <select
                  data-testid="chat-live-create-visibility"
                  className="h-8 rounded-md border border-input bg-card px-2.5 text-13"
                  value={newVisibility}
                  onChange={(e) =>
                    setNewVisibility(e.target.value as (typeof CHAT_VISIBILITY_OPTIONS)[number])
                  }
                >
                  {CHAT_VISIBILITY_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <Button
                  data-testid="chat-live-create-submit"
                  type="submit"
                  disabled={createBusy || projectId === ""}
                >
                  {createBusy ? "创建中…" : "创建"}
                </Button>
                {createError !== null ? (
                  <p data-testid="chat-live-create-error" className="text-12 text-destructive">
                    {createError}
                  </p>
                ) : null}
              </form>
            </CardContent>
          </Card>

          {selectedThreadId !== null ? (
            <Card data-testid="chat-live-thread-detail">
              <CardHeader>
                <CardTitle>线程详情：{selectedThreadId}</CardTitle>
              </CardHeader>
              <CardContent>
                {threadDetailBusy ? (
                  <p className="text-12 text-muted-foreground">加载中…</p>
                ) : threadDetailError !== null ? (
                  <p data-testid="chat-live-thread-detail-error" className="text-12 text-destructive">
                    {threadDetailError}
                  </p>
                ) : threadDetail !== null ? (
                  <ul data-testid="chat-live-messages" className="flex flex-col gap-1">
                    {threadDetail.messages.length === 0 ? (
                      <li data-testid="chat-live-messages-empty" className="text-12 text-muted-foreground">
                        暂无消息
                      </li>
                    ) : (
                      threadDetail.messages.map((m) => (
                        <li key={m.id} className="rounded-md border border-border px-3 py-2 text-13">
                          <span className="text-12 text-muted-foreground">
                            {m.authorKind === "agent" ? `agent:${m.agentId ?? "?"}` : "human"}
                          </span>{" "}
                          {m.card ?? m.thinkingSummary ?? m.toolCallSummary ?? "（无正文投影字段——见 F368 消息形状说明）"}
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card data-testid="chat-live-preset-card">
            <CardHeader>
              <CardTitle>预设（编写 / 下发 / 开始实例 / 用量）</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-2" onSubmit={handleUpsertPreset}>
                <Input
                  data-testid="chat-live-preset-prompt"
                  placeholder="开场提示"
                  value={presetPrompt}
                  onChange={(e) => setPresetPrompt(e.target.value)}
                />
                <Button
                  data-testid="chat-live-preset-upsert"
                  type="submit"
                  disabled={presetBusy || projectId === ""}
                >
                  {presetBusy ? "保存中…" : "保存预设"}
                </Button>
              </form>
              {presetId !== null ? (
                <div className="mt-2 flex flex-col gap-2">
                  <p data-testid="chat-live-preset-id" className="text-12 text-muted-foreground">
                    presetId={presetId}
                  </p>
                  <div className="flex gap-2">
                    <Button data-testid="chat-live-preset-dispatch" onClick={handleDispatch} disabled={presetBusy}>
                      下发
                    </Button>
                    <Button
                      data-testid="chat-live-preset-start"
                      onClick={handleStartInstance}
                      disabled={presetBusy}
                    >
                      开始实例
                    </Button>
                    <Button data-testid="chat-live-preset-usage" onClick={handleGetUsage} disabled={presetBusy}>
                      读用量
                    </Button>
                  </div>
                  {dispatchResult !== null ? (
                    <p data-testid="chat-live-preset-dispatch-result" className="text-12">
                      {dispatchResult}
                    </p>
                  ) : null}
                  {instanceResult !== null ? (
                    <p data-testid="chat-live-preset-start-result" className="text-12">
                      {instanceResult}
                    </p>
                  ) : null}
                  {usageResult !== null ? (
                    <p data-testid="chat-live-preset-usage-result" className="text-12">
                      usageCount={usageResult}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {presetError !== null ? (
                <p data-testid="chat-live-preset-error" className="text-12 text-destructive">
                  {presetError}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}
