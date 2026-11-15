"use client";
import * as React from "react";
import { useOptionalSession } from "@/components/session/session-provider";
import { isProjectMemberChatEnabled } from "@/lib/project-member-chat-config";
import { listProjectMemberMessages, listProjectMemberReplies, postProjectMemberMessage, listProjectMemberNames, type ProjectMemberMessage, type ProjectMemberThreadUpdate, type MemberChatPost, type ProjectMemberStageReference } from "@/lib/live-project-member-chat";
import { TeamTextLiveConversation, type TeamTextLiveMessage } from "./team-text-live-conversation";

type Status = "loading" | "ready" | "error";
type Pending = { request: MemberChatPost; state: "sending" | "failed" | "unconfirmed"; failure?: string; retryable: boolean; order: number };
type Topic = { request?: AbortController; busy?: boolean; status: Status; error?: string; before: number | null; loadingOlder: boolean; loaded: boolean };
type Channel = { names: Map<string, string>; messages: Map<string, ProjectMemberMessage>; updates: Map<string, ProjectMemberThreadUpdate>; pending: Map<string, Pending>; drafts: Map<string, string>; stageChoices: Map<string, string>; topicId: string | null; topics: Map<string, Topic>; status: Status; error?: string; loaded: boolean; readable: boolean; verified: boolean; denied: boolean; canWrite: boolean; reason: string | null; before: number | null; after: number; syncing: boolean; loadingOlder: boolean };
function channel(): Channel { return { names: new Map(), messages: new Map(), updates: new Map(), pending: new Map(), drafts: new Map(), stageChoices: new Map(), topicId: null, topics: new Map(), status: "loading", loaded: false, readable: false, verified: false, denied: false, canWrite: false, reason: null, before: null, after: 0, syncing: false, loadingOlder: false }; }
function reason(error: unknown): string { return error && typeof error === "object" && "reasonCode" in error ? String(error.reasonCode) : ""; }
function denied(error: unknown): boolean { const code = reason(error); return ["NOT_FOUND", "MODULE_DISABLED"].includes(code) || (!!error && typeof error === "object" && "status" in error && [401, 404].includes(Number(error.status))); }
function clearAccess(store: Channel) { store.names.clear(); store.messages.clear(); store.updates.clear(); store.topics.clear(); store.topicId = null; store.loaded = false; store.readable = false; store.verified = false; store.canWrite = false; store.denied = true; store.after = 0; store.before = null; }
function merge(store: Channel, messages: ProjectMemberMessage[], userId: string) { for (const message of messages) { store.messages.set(message.id, message); if (message.authorId === userId) store.pending.delete(message.clientMessageId); } }
function mergeThreadUpdates(store: Channel, updates: readonly ProjectMemberThreadUpdate[]) {
  for (const update of updates) { const current = store.updates.get(update.rootMessageId); if (!current || update.lastSequence >= current.lastSequence) store.updates.set(update.rootMessageId, update); }
}
function failureText(error: unknown): string { switch (reason(error)) { case "IDEMPOTENCY_CONFLICT": return "请求标识冲突，请核对已有消息；本条不再自动重试。"; case "THREAD_ROOT_INVALID": return "原话题不可回复。"; case "INVALID_INPUT": case "MESSAGE_TOO_LARGE": return "消息或引用不符合要求。"; default: return "连接或服务暂不可用。"; } }
export type ProjectMemberChatProps = { projectId: string; compact?: boolean; onClose?: () => void; active?: boolean; stageReference?: ProjectMemberStageReference };
export function ProjectMemberChat(props: ProjectMemberChatProps): JSX.Element {
  const context = useOptionalSession();
  if (!isProjectMemberChatEnabled()) return <p className="p-4 text-13 text-muted-foreground">成员文字讨论尚未启用。</p>;
  if (context?.status !== "authenticated" || !context.session?.currentOrgId || !context.session.userId || !context.session.sessionToken) return <p role="status" className="p-4 text-13 text-muted-foreground">登录所属组织后可使用成员讨论。</p>;
  const { currentOrgId, userId, sessionToken } = context.session;
  return <AuthenticatedMemberChat key={JSON.stringify([currentOrgId, userId])} {...props} orgId={currentOrgId} userId={userId} sessionToken={sessionToken} />;
}
function AuthenticatedMemberChat({ projectId, compact = false, onClose, active = true, stageReference, orgId, userId, sessionToken }: ProjectMemberChatProps & { orgId: string; userId: string; sessionToken: string }): JSX.Element {
  const [, redraw] = React.useReducer((value: number) => value + 1, 0);
  const [refresh, refreshNow] = React.useReducer((value: number) => value + 1, 0);
  const [visible, setVisible] = React.useState(() => typeof document === "undefined" || !document.hidden);
  const [online, setOnline] = React.useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const stores = React.useRef(new Map<string, Channel>());
  const identity = React.useRef({ token: sessionToken, epoch: 0 });
  const writes = React.useRef(new Map<string, AbortController>());
  const mounted = React.useRef(true);
  if (identity.current.token !== sessionToken) {
    identity.current = { token: sessionToken, epoch: identity.current.epoch + 1 };
    for (const controller of writes.current.values()) controller.abort();
    writes.current.clear();
    for (const value of stores.current.values()) { value.names.clear(); value.readable = false; value.verified = false; value.canWrite = false; value.status = "loading"; for (const item of value.pending.values()) if (item.state === "sending") item.state = "unconfirmed"; }
  }
  const scope = JSON.stringify([orgId, userId, projectId]);
  let cached = stores.current.get(scope);
  if (!cached) { cached = channel(); stores.current.set(scope, cached); }
  const store = cached;
  const selected = React.useRef({ scope, generation: 0 });
  if (selected.current.scope !== scope) { selected.current = { scope, generation: selected.current.generation + 1 }; store.names.clear(); store.readable = false; store.verified = false; store.canWrite = false; store.status = "loading"; store.loadingOlder = false; for (const item of store.topics.values()) item.loadingOlder = false; }
  const epoch = identity.current.epoch, generation = selected.current.generation;
  const isCurrent = React.useCallback(() => mounted.current && identity.current.epoch === epoch && selected.current.scope === scope && selected.current.generation === generation, [epoch, generation, scope]);
  const stageKey = stageReference ? JSON.stringify(stageReference) : "";
  const draftKey = store.topicId ?? "main";
  const topicId = store.topicId;
  const notify = React.useCallback(() => { if (mounted.current) redraw(); }, []);
  React.useEffect(() => { mounted.current = true; const controllers = writes.current; return () => { mounted.current = false; for (const controller of controllers.values()) controller.abort(); }; }, []);
  React.useEffect(() => {
    const visibility = () => setVisible(!document.hidden), reconnect = () => { setOnline(navigator.onLine !== false); refreshNow(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("online", reconnect); window.addEventListener("offline", reconnect); window.addEventListener("focus", reconnect);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", reconnect); window.removeEventListener("offline", reconnect); window.removeEventListener("focus", reconnect); };
  }, []);
  const access = React.useCallback((value: { canWrite: boolean; readOnlyReason: string | null }) => { store.canWrite = value.canWrite; store.reason = value.readOnlyReason; store.readable = true; store.verified = true; store.denied = false; }, [store]);
  React.useEffect(() => {
    if (!active || !visible || !online) return;
    const controller = new AbortController(); let alive = true, busy = false;
    const valid = () => alive && isCurrent();
    async function pull() {
      if (busy || !valid() || store.denied) return;
      busy = true; store.syncing = true; if (!store.loaded) store.status = "loading"; notify();
      try {
        for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
          const initial = !store.loaded, cursor = store.after;
          const page = await listProjectMemberMessages({ projectId, limit: initial ? 30 : 100, ...(initial ? {} : { afterSequence: cursor }) }, { sessionToken, signal: controller.signal });
          if (!valid()) return;
          merge(store, page.items, userId); mergeThreadUpdates(store, page.threadUpdates);
          access(page); if (initial) store.before = page.nextBeforeSequence;
          if (!initial && page.nextAfterSequence < cursor) throw new Error("Member channel cursor regressed");
          store.after = page.nextAfterSequence; store.loaded = true; store.status = "ready"; store.error = undefined;
          if (page.nextAfterSequence >= page.latestSequence) break;
          if (!initial && page.nextAfterSequence <= cursor) throw new Error("Member channel cursor did not advance");
        }
      } catch (error) {
        if (!valid() || controller.signal.aborted) return;
        if (denied(error)) clearAccess(store);
        store.status = "error"; store.error = store.denied ? "无法访问此项目的成员讨论，请核对成员身份或功能配置。" : "消息读取失败，已有消息和未发送草稿保留。"; store.verified = false;
      } finally { busy = false; if (valid()) { store.syncing = false; notify(); } }
    }
    // Explicit retry/reopen rechecks authorization, including a previously denied channel.
    store.denied = false; void pull();
    const timer = window.setInterval(() => void pull(), 5000);
    return () => { alive = false; controller.abort(); window.clearInterval(timer); store.syncing = false; };
  }, [active, visible, online, refresh, projectId, sessionToken, userId, store, isCurrent, access, notify]);
  // Optional display metadata never governs channel access or changes message availability.
  React.useEffect(() => {
    if (!store.verified || !active || !visible || !online) return;
    const controller = new AbortController(); let alive = true;
    void listProjectMemberNames(projectId, { sessionToken, signal: controller.signal })
      .then((names) => { if (alive && isCurrent()) { store.names = names; notify(); } })
      .catch(() => { /* Directory failure keeps truthful member labels and actual message history. */ });
    return () => { alive = false; controller.abort(); };
  }, [store.verified, active, visible, online, projectId, sessionToken, store, isCurrent, notify]);
  React.useEffect(() => {
    // A topic request belongs to this panel visit, not to a later return to the same project.
    const cachedStores = stores.current;
    return () => { for (const cachedStore of cachedStores.values()) for (const cachedTopic of cachedStore.topics.values()) {
      cachedTopic.request?.abort(); cachedTopic.request = undefined; cachedTopic.busy = false; cachedTopic.loadingOlder = false;
    } };
  }, [active, visible, online, isCurrent, topicId]);
  async function loadTopic(rootId: string, older = false) {
    if (!active || !visible || !online || !store.verified || store.denied) return;
    const root = store.messages.get(rootId); if (root ? root.threadRootId !== null || root.projectId !== projectId : !store.updates.has(rootId)) return;
    const topic = store.topics.get(rootId) ?? { status: "loading" as Status, before: null, loaded: false, loadingOlder: false };
    if (topic.busy) return;
    const controller = new AbortController(); topic.request = controller; topic.busy = true;
    const validRead = () => !controller.signal.aborted && topic.request === controller && isCurrent();
    store.topics.set(rootId, topic); if (older) topic.loadingOlder = true; else topic.status = "loading"; notify();
    try {
      const result = await listProjectMemberReplies({ projectId, threadRootId: rootId, limit: 30, ...(older && topic.before !== null ? { beforeSequence: topic.before } : {}) }, { sessionToken, signal: controller.signal });
      if (!validRead()) return; merge(store, [result.root, ...result.items], userId); access(result); topic.before = result.nextBeforeSequence; topic.loaded = true; topic.status = "ready"; topic.error = undefined; store.status = "ready"; store.error = undefined;
    } catch (error) { if (!validRead()) return; if (denied(error)) { clearAccess(store); store.status = "error"; store.error = "无法访问此项目的成员讨论。"; } else { topic.status = "error"; topic.error = "话题读取失败，草稿保留，可重试。"; } }
    finally { if (topic.request === controller) { topic.request = undefined; topic.busy = false; topic.loadingOlder = false; if (isCurrent()) notify(); } }
  }
  // A closed topic can be reopened without losing its draft. Recheck the real root before replies.
  React.useEffect(() => { if (topicId && store.verified && active && visible && online) void loadTopic(topicId); /* loaded replies are also refreshed by channel deltas */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, active, visible, online, scope, sessionToken, store.verified]);
  async function loadOlder() {
    if (store.loadingOlder || store.before === null || !store.verified || !active || !online) return;
    store.loadingOlder = true; notify();
    try { const page = await listProjectMemberMessages({ projectId, beforeSequence: store.before, limit: 30 }, { sessionToken }); if (!isCurrent()) return; merge(store, page.items, userId); mergeThreadUpdates(store, page.threadUpdates); access(page); store.before = page.nextBeforeSequence; }
    catch (error) { if (!isCurrent()) return; if (denied(error)) clearAccess(store); store.status = "error"; store.error = "较早消息读取失败，请重试；草稿保留。"; }
    finally { if (isCurrent()) { store.loadingOlder = false; notify(); } }
  }
  async function transmit(pending: Pending) {
    if (!store.verified || !store.canWrite || !active || !visible || !online || writes.current.has(pending.request.clientMessageId)) return;
    const id = pending.request.clientMessageId, controller = new AbortController(), authEpoch = identity.current.epoch;
    writes.current.set(id, controller); pending.state = "sending"; pending.failure = undefined; notify();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const receipt = await postProjectMemberMessage(pending.request, { sessionToken, signal: controller.signal });
      if (!mounted.current || identity.current.epoch !== authEpoch) return;
      if (receipt.message.authorId !== userId) throw new Error("Member receipt actor mismatch");
      merge(store, [receipt.message], userId);
    } catch (error) {
      if (!mounted.current || identity.current.epoch !== authEpoch || !store.pending.has(id)) return;
      const code = reason(error), permanent = ["IDEMPOTENCY_CONFLICT", "THREAD_ROOT_INVALID", "INVALID_INPUT", "MESSAGE_TOO_LARGE"].includes(code);
      pending.state = permanent || code.startsWith("READ_ONLY") ? "failed" : "unconfirmed"; pending.retryable = !permanent; pending.failure = failureText(error);
      if (code.startsWith("READ_ONLY")) { store.canWrite = false; store.reason = code === "READ_ONLY_ARCHIVED" ? "archived" : code === "READ_ONLY_ORG_DISABLED" ? "org-disabled" : "role"; }
      if (denied(error)) { clearAccess(store); store.status = "error"; store.error = "无法访问此项目的成员讨论。"; }
    } finally { window.clearTimeout(timeout); if (writes.current.get(id) === controller) writes.current.delete(id); notify(); }
  }
  function send() {
    const key = store.topicId ?? "main", text = (store.drafts.get(key) ?? "").trim();
    if (!text || text.length > 4000 || !store.verified || !store.canWrite || !active || !visible || !online || store.status !== "ready") return;
    if (store.topicId) { const root = store.messages.get(store.topicId); if (!root || root.threadRootId !== null || store.topics.get(root.id)?.status !== "ready") return; }
    const request: MemberChatPost = { projectId, clientMessageId: crypto.randomUUID(), text, ...(store.topicId ? { threadRootId: store.topicId } : {}), ...(stageReference && store.stageChoices.get(key) === stageKey ? { stageReference: { ...stageReference } } : {}) };
    const item: Pending = { request, state: "sending", retryable: true, order: Date.now() }; store.pending.set(request.clientMessageId, item); store.drafts.set(key, ""); store.stageChoices.delete(key); notify(); void transmit(item);
  }
  function retry(id: string) { const item = store.pending.get(id); if (item?.retryable) void transmit(item); }
  function row(message: ProjectMemberMessage): TeamTextLiveMessage { return { id: message.id, text: message.text, authorLabel: message.authorId === userId ? "我" : store.names.get(message.authorId) ?? "小组成员", authorId: message.authorId, createdAt: message.createdAt, own: message.authorId === userId, state: "stored", replyCount: store.updates.get(message.id)?.replyCount ?? 0, stageReference: message.stageReference }; }
  function rows(rootId: string | null) { if (!store.readable) return []; return [...store.messages.values()].filter((item) => item.threadRootId === rootId).sort((a, b) => a.sequence - b.sequence).map(row).concat([...store.pending.values()].filter((item) => (item.request.threadRootId ?? null) === rootId).sort((a, b) => a.order - b.order).map((item) => ({ id: item.request.clientMessageId, text: item.request.text, authorLabel: "我", own: true, state: item.state, failure: item.failure, retryable: item.retryable, stageReference: item.request.stageReference }))); }
  const root = topicId && store.readable ? store.messages.get(topicId) : undefined, topic = topicId ? store.topics.get(topicId) : undefined;
  const readOnlyNotice = topicId && !root ? "正在读取话题，暂不可发送；可返回频道继续讨论。" : store.reason === "archived" ? "项目已归档，可查看历史，不能发送或重试。" : store.reason === "org-disabled" ? "组织当前只读，不能发送或重试。" : store.reason === "role" ? "当前项目角色只读，不能发送或重试。" : !store.verified ? "正在核对频道访问权限，暂不可发送。" : undefined;
  if (!store.verified && store.loaded && store.status === "loading") return <p role="status" className="p-4 text-13">正在核对频道访问权限…</p>;
  return <TeamTextLiveConversation key={scope} projectId={projectId} compact={compact} onClose={onClose} messages={rows(null)} draft={store.drafts.get("main") ?? ""} onDraftChange={(text) => { store.drafts.set("main", text); notify(); }} onSend={send} onRetry={retry} historyState={store.status} historyError={store.error} onRefresh={() => { if (topicId && !root) void loadTopic(topicId); else refreshNow(); }} readOnly={!store.verified || !store.canWrite || (!!topicId && !root)} readOnlyNotice={readOnlyNotice} offline={!online} syncing={store.syncing} hasOlder={store.before !== null} loadingOlder={store.loadingOlder} onLoadOlder={() => void loadOlder()} earlierTopics={[...(store.readable ? store.updates.values() : [])].filter((item) => item.replyCount > 0 && !store.messages.has(item.rootMessageId)).map((item) => ({ id: item.rootMessageId, replyCount: item.replyCount }))} topicPending={!!topicId && !root} pendingTopicError={!root ? topic?.error : undefined} onOpenTopic={(id) => { const item = store.messages.get(id); if ((item?.threadRootId === null && item.projectId === projectId) || (!item && store.updates.has(id))) { store.topicId = id; notify(); } }} onCloseTopic={() => { store.topicId = null; notify(); }} stageReference={stageReference} includeStageReference={!!stageKey && store.stageChoices.get(draftKey) === stageKey} onIncludeStageReference={(included) => { if (included) store.stageChoices.set(draftKey, stageKey); else store.stageChoices.delete(draftKey); notify(); }} topic={root && topic ? { root: row(root), replies: rows(root.id), draft: store.drafts.get(root.id) ?? "", historyState: topic.status, historyError: topic.error, hasOlder: topic.before !== null, loadingOlder: topic.loadingOlder, onDraftChange: (text) => { store.drafts.set(root.id, text); notify(); }, onSend: send, onRetry: retry, onRefresh: () => void loadTopic(root.id), onLoadOlder: () => void loadTopic(root.id, true) } : undefined} />;
}
