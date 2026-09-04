/**
 * FB-2 —— 反馈的真实 API 薄封装（契约 `feedback-loop`）。
 *
 * 类型全部走 `z.infer`（`lint-contract-source` 要求）：这里**不重新声明**任何一个
 * 字段名或枚举值。反馈的类型/状态/目标三件事只在契约里写过一遍。
 *
 * ⚠ **请求体里没有 `submittedBy`、没有 `status`**，这不是省略。契约的
 *   `submitFeedback.in` 是 `.strict()` 的，提交人从 principal 取、状态恒 `待处理`。
 *   前端能传状态，就等于任何人能把自己的反馈直接标成「已修复」。
 *   所以这个函数的签名里**不存在**那两个参数——不是「传了会被忽略」。
 */
import { feedbackLoop, designWorkbench } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest, apiUrl, ApiError, getStoredSessionToken } from "./api-client";

export type FeedbackKind = z.infer<typeof feedbackLoop.FeedbackKind>;
export type FeedbackStatus = z.infer<typeof feedbackLoop.FeedbackStatus>;
export type FeedbackTarget = z.infer<typeof feedbackLoop.FeedbackTarget>;
export type FeedbackItem = z.infer<typeof feedbackLoop.FeedbackItem>;
export type SubmitFeedbackOut = z.infer<typeof feedbackLoop.operations.submitFeedback.out>;
export type VoteFeedbackOut = z.infer<typeof feedbackLoop.operations.voteFeedback.out>;
export type FeedbackCounts = z.infer<typeof feedbackLoop.operations.getFeedbackCounts.out>;
export type TriageFeedbackOut = z.infer<typeof feedbackLoop.operations.triageFeedback.out>;
export type FeedbackGithubIssueStatus = z.infer<typeof feedbackLoop.operations.getFeedbackGithubIssue.out>;
export type FeedbackStatusEvent = z.infer<
  typeof feedbackLoop.operations.listFeedbackStatusEvents.out
>["events"][number];
export type GithubIssueLinkedPullRequest = z.infer<typeof feedbackLoop.GithubIssueLinkedPullRequest>;
/** UC-17.8 D1：结构化补充字段（缺陷 4 项 / 需求 3 项的判别联合）。 */
export type FeedbackStructured = z.infer<typeof feedbackLoop.FeedbackStructured>;
export type BugStructuredFields = z.infer<typeof feedbackLoop.BugStructuredFields>;
export type ReqStructuredFields = z.infer<typeof feedbackLoop.ReqStructuredFields>;
export type CommentOnFeedbackGithubIssueOut = z.infer<
  typeof feedbackLoop.operations.commentOnFeedbackGithubIssue.out
>;
/** UC-17.8 B4.4——「用 PM 设计工作台深化」。契约在 `design-workbench.ts`（路由挂 `/feedback`，见该文件头注）。 */
export type DeepenFeedbackOut = z.infer<typeof designWorkbench.operations.deepenFeedback.out>;
/**
 * "转开发"弹层里管理员编辑之后提交的 GitHub issue 最终文案。
 * ⚠ 类型从契约的 `in.shape.issueDraft` 派生,不是手写——见文件头纪律。
 */
export type FeedbackIssueDraft = NonNullable<
  z.infer<typeof feedbackLoop.operations.triageFeedback.in>["issueDraft"]
>;

/** 枚举的**唯一来源**——下拉框、徽标色映射、测试断言都从这里取，不各写一份数组。 */
export const FEEDBACK_KINDS = feedbackLoop.FeedbackKind.options;
export const FEEDBACK_STATUSES = feedbackLoop.FeedbackStatus.options;

export async function submitFeedback(input: {
  readonly kind: FeedbackKind;
  readonly target: FeedbackTarget;
  readonly title: string;
  readonly detail: string;
  readonly occurredRoute: string | null;
  readonly appVersion: string | null;
  /** FB-5——提交前已经 `uploadFeedbackAttachment` 过的附件 id。缺省/空 = 不带附件。 */
  readonly attachmentIds?: readonly string[];
  /** UC-17.8 D1——按 `kind` 组好的结构化字段。全空 = 不带这个键（同 `attachmentIds`）。 */
  readonly structured?: FeedbackStructured;
}): Promise<SubmitFeedbackOut> {
  return apiRequest<SubmitFeedbackOut>("/feedback", { method: "POST", body: input });
}

/**
 * ⚠ query 是**拍平的**（`scope` / `targetKind` / `targetId`），服务端再组装回契约的
 *   判别联合并重新校验。URL query 只能是平的键值对，这是 HTTP 的限制，不是契约的让步。
 */
export async function listFeedback(
  scope:
    | { readonly kind: "mine" }
    | { readonly kind: "org" }
    | { readonly kind: "target"; readonly target: FeedbackTarget },
): Promise<readonly FeedbackItem[]> {
  const query: Record<string, string | undefined> = { scope: scope.kind };
  if (scope.kind === "target") {
    query.targetKind = scope.target.kind;
    query.targetId =
      scope.target.kind === "agent"
        ? scope.target.agentId
        : scope.target.kind === "skill"
          ? scope.target.skillId
          : undefined;
  }
  const out = await apiRequest<{ items: FeedbackItem[] }>("/feedback", { query });
  return out.items;
}

/**
 * ⚠ 用服务端回的 `votes` 覆盖本地，**不做乐观 +1**。票数的口径是 `COUNT(*)`；
 *   本地加一在并发下就是错的，而错的那个数字看起来完全正常。
 */
/**
 * UC-17.8 B4.4——收件箱条目「用 PM 设计工作台深化」。服务端建（或幂等复用）一个设计项目，
 * `name`/`problem`/`template` 都是服务端从这条反馈自己填的，调用方只给 `feedbackId`——
 * 同 `submitFeedback` 的纪律：不接受调用方各自拼一份可能对不上的值。
 * ⚠ `out.project.id` 才是跳转目标（`/platform-admin/design-workbench/<id>`），
 *   不是这条反馈的 `feedbackId`——两者是两个不同资源的 id。
 */
export async function deepenFeedback(feedbackId: string): Promise<DeepenFeedbackOut> {
  return apiRequest<DeepenFeedbackOut>(`/feedback/${encodeURIComponent(feedbackId)}/deepen`, {
    method: "POST",
  });
}

export async function voteFeedback(feedbackId: string, voted: boolean): Promise<VoteFeedbackOut> {
  return apiRequest<VoteFeedbackOut>(`/feedback/${encodeURIComponent(feedbackId)}/vote`, {
    method: "POST",
    body: { feedbackId, voted },
  });
}

/**
 * ⚠ `issueDraft` 只在转「已进入迭代」("转开发")且管理员走了那个弹层时才非 null——
 *   其余转移传 `null`(而不是省略这个参数):见 `live-feedback.ts` 头注,契约里
 *   `.optional()` 只是为了兼容"根本不知道这个字段"的旧调用方,本文件永远显式传值。
 */
export async function triageFeedback(
  feedbackId: string,
  status: FeedbackStatus,
  reason: string | null,
  issueDraft: FeedbackIssueDraft | null = null,
): Promise<TriageFeedbackOut> {
  return apiRequest(`/feedback/${encodeURIComponent(feedbackId)}/status`, {
    method: "PUT",
    body: { feedbackId, status, reason, issueDraft },
  });
}

export async function getFeedbackCounts(): Promise<FeedbackCounts> {
  return apiRequest<FeedbackCounts>("/feedback/counts");
}

/**
 * 现查这条反馈挂着的 GitHub issue：开/关状态 + 关联它的 PR。**不落库**——每次调用
 * 都是一次真实的 GitHub API 往返，见契约 `getFeedbackGithubIssue` 头注。只在管理员
 * 真的展开一条反馈的 GitHub 状态时调用，不要跟着 `listFeedback` 批量拉。
 */
export async function getFeedbackGithubIssue(feedbackId: string): Promise<FeedbackGithubIssueStatus> {
  return apiRequest<FeedbackGithubIssueStatus>(`/feedback/${encodeURIComponent(feedbackId)}/github-issue`);
}

/**
 * 一条反馈完整的状态流水——含每一步「有没有真的发邮件通知提交人、发的是什么」。
 * 给后台看板的 detail 弹层用。只在管理员真的展开一条反馈的详情时调用，不要跟着
 * `listFeedback` 批量拉。见契约 `listFeedbackStatusEvents` 头注。
 */
export async function listFeedbackStatusEvents(feedbackId: string): Promise<readonly FeedbackStatusEvent[]> {
  const { events } = await apiRequest<{ events: readonly FeedbackStatusEvent[] }>(
    `/feedback/${encodeURIComponent(feedbackId)}/events`,
  );
  return events;
}

/**
 * 管理员手动往这条反馈挂着的 GitHub issue 下面发一条评论。**不是**状态转移的副作用——
 * 见 `triageFeedback` 头注的 best-effort 状态同步,那条是自动的,这条是手动补充说明。
 */
export async function commentOnFeedbackGithubIssue(
  feedbackId: string,
  body: string,
): Promise<CommentOnFeedbackGithubIssueOut> {
  return apiRequest<CommentOnFeedbackGithubIssueOut>(
    `/feedback/${encodeURIComponent(feedbackId)}/github-issue/comments`,
    { method: "POST", body: { feedbackId, body } },
  );
}

/**
 * 应用版本（I-F1 的一半）。
 *
 * ⚠ 读不到就是 `null`，**不编一个 `"unknown"` 或 `"0.0.0"`**：一个假的版本号会让
 *   「这个 bug 是哪个构建引入的」这类排查走进一条不存在的线索，
 *   而 `null` 至少诚实地说「这条反馈没带版本」。
 */
export function currentAppVersion(): string | null {
  return process.env.NEXT_PUBLIC_APP_VERSION ?? null;
}

/* ─────────────────────────── FB-5：图片附件 ─────────────────────────── */

export type FeedbackAttachment = z.infer<typeof feedbackLoop.FeedbackAttachment>;
export type FeedbackAttachmentMime = z.infer<typeof feedbackLoop.FeedbackAttachmentMime>;
export type UploadFeedbackAttachmentOut = z.infer<typeof feedbackLoop.operations.uploadFeedbackAttachment.out>;

/**
 * UC-17.8 D3——附件白名单与上限的**唯一前端出口**，都从契约派生：
 *   · `FEEDBACK_ATTACHMENT_ACCEPT` 直接喂 `<input accept>`；
 *   · `FEEDBACK_ATTACHMENT_LIMIT` 是「一条反馈最多几个附件」；
 *   · `resolveFeedbackAttachmentMime` 是客户端那道预检。
 * 加一种类型 = 改契约的 `FeedbackAttachmentMime`，这里没有第二份列表。
 */
export const FEEDBACK_ATTACHMENT_MIMES = feedbackLoop.FeedbackAttachmentMime.options;
export const FEEDBACK_ATTACHMENT_ACCEPT = FEEDBACK_ATTACHMENT_MIMES.join(",");
export const FEEDBACK_ATTACHMENT_LIMIT = feedbackLoop.FEEDBACK_ATTACHMENT_MAX;

/**
 * 浏览器对 `.md`（有些平台连 `.txt`）给出的 `File.type` 是空串——不是「类型不对」，是
 * 「浏览器不认识这个扩展名」。这里只在 `type` 为空时按扩展名**猜一次**，猜出来的值仍然
 * 必须落在契约白名单里；`type` 非空但不在白名单 ⇒ `null`，调用方据此拒收并说明原因。
 * ⚠ 扩展名表只是「扩展名 → 契约里的哪个值」的索引，不是第二份白名单：任何一个值都
 *   先经 `FeedbackAttachmentMime.safeParse` 验过才会返回。
 */
export function resolveFeedbackAttachmentMime(file: { readonly type: string; readonly name: string }): FeedbackAttachmentMime | null {
  const declared = file.type.trim().toLowerCase();
  const candidate = declared !== "" ? declared : guessMimeByExtension(file.name);
  const parsed = feedbackLoop.FeedbackAttachmentMime.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function guessMimeByExtension(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = {
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    log: "text/plain",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return byExt[ext] ?? "";
}

/** 附件是不是图片（决定缩略图用 `<img>` 还是文件类型图标）。 */
export function isImageAttachmentMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/**
 * 图片附件上传走 `multipart/form-data`，同 `live-identity.ts` 的 `uploadOwnAvatar`
 * 既有先例（`apiRequest` 只封装 JSON body）：一个 `meta` 字段（JSON，须与
 * `uploadFeedbackAttachment.in` 一致）+ 一个 `file` 字段（二进制）。这一步先于
 * "提交反馈"发生——返回的 `attachmentId` 攒起来，随 `submitFeedback` 一起提交
 * （见该函数与后端用例头注：认领是 best-effort，不阻塞反馈本身）。
 */
export async function uploadFeedbackAttachment(
  file: File,
  /** UC-17.8 D3：真实类型。缺省取 `file.type`；`.md` 之类浏览器给空串的场景由调用方先经 `resolveFeedbackAttachmentMime` 解出再传。 */
  contentType: string = file.type,
): Promise<UploadFeedbackAttachmentOut> {
  const meta = { sizeBytes: file.size, contentType };
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  form.set("file", file, file.name);

  const token = getStoredSessionToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(apiUrl(feedbackLoop.operations.uploadFeedbackAttachment.path), {
    method: "POST",
    headers,
    credentials: "include",
    body: form,
  });
  const text = await res.text();
  // 同 `uploadOwnAvatar` 的既有纪律：非 JSON 的错误正文不得抛原始 SyntaxError。
  let json: unknown;
  try {
    json = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(res.status, null, undefined, text.slice(0, 512));
  }
  if (!res.ok) {
    const reasonCode =
      typeof json === "object" && json !== null && "reasonCode" in json
        ? ((json as { reasonCode: unknown }).reasonCode as string | null)
        : null;
    throw new ApiError(res.status, reasonCode, json);
  }
  return json as UploadFeedbackAttachmentOut;
}

/**
 * 附件 `<img>` 不能直接用 `attachment.url`——下载路由要求 `Authorization` 头，浏览器
 * 的 `<img src>` 没有办法带自定义头。同 `fetchAvatarObjectUrl` 的既有先例：改用
 * `fetch` 取字节再转 `Blob URL`。
 */
export async function fetchFeedbackAttachmentObjectUrl(attachmentUrl: string): Promise<string> {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl(attachmentUrl), { headers, credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, null, null);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/* ─────────────────────────── FB-5：语音转结构化草稿 ─────────────────────────── */

export type StructureFeedbackDraftOut = z.infer<typeof feedbackLoop.operations.structureFeedbackDraft.out>;

/**
 * 把一段语音转录文字整理成 `{kind,title,detail}`，填进提交表单，人工再改再提交。
 * 语音→文字本身复用既有的 chat composer 麦克风通路（`use-asr-draft.ts`），本函数接手
 * 的起点是**转录已经完成之后**的一段文字——见后端用例 `structure-feedback-draft.ts` 头注。
 */
export async function structureFeedbackDraft(transcript: string): Promise<StructureFeedbackDraftOut> {
  return apiRequest<StructureFeedbackDraftOut>(feedbackLoop.operations.structureFeedbackDraft.path, {
    method: "POST",
    body: { transcript },
  });
}

/* ─────────────────────────── UC-17.8 B1：反馈草稿（提交人私有）─────────────────────────── */

export type FeedbackDraft = z.infer<typeof feedbackLoop.FeedbackDraft>;
export type FeedbackDraftChatTurn = z.infer<typeof feedbackLoop.FeedbackDraftChatTurn>;
export type CreateFeedbackDraftOut = z.infer<typeof feedbackLoop.operations.createFeedbackDraft.out>;
export type UpdateFeedbackDraftOut = z.infer<typeof feedbackLoop.operations.updateFeedbackDraft.out>;
export type DeleteFeedbackDraftOut = z.infer<typeof feedbackLoop.operations.deleteFeedbackDraft.out>;
export type SubmitFeedbackDraftOut = z.infer<typeof feedbackLoop.operations.submitFeedbackDraft.out>;
export type MyFeedbackDraftCount = z.infer<typeof feedbackLoop.operations.getMyFeedbackDraftCount.out>;
/** `updateFeedbackDraft.in` 去掉路径参数后的 patch 形状——类型从契约派生，不手写。 */
export type FeedbackDraftPatch = Omit<z.infer<typeof feedbackLoop.operations.updateFeedbackDraft.in>, "draftId">;

const DRAFTS_PATH = feedbackLoop.operations.listMyFeedbackDrafts.path;
const DRAFT_COUNT_PATH = feedbackLoop.operations.getMyFeedbackDraftCount.path;

function draftPath(draftId: string, suffix = ""): string {
  return `${DRAFTS_PATH}/${encodeURIComponent(draftId)}${suffix}`;
}

/**
 * 建草稿。⚠ `structured` / `attachmentIds` 同 `submitFeedback`：没有就**不带键**，
 * 不传 `undefined`（契约 `.strict()`，一个值为 undefined 的键在 `Object.keys` 上看得出来）。
 */
export async function createFeedbackDraft(input: {
  readonly kind: FeedbackKind;
  readonly target: FeedbackTarget;
  readonly detail: string;
  readonly occurredRoute: string | null;
  readonly appVersion: string | null;
  readonly structured?: FeedbackStructured;
  readonly attachmentIds?: readonly string[];
}): Promise<CreateFeedbackDraftOut> {
  return apiRequest<CreateFeedbackDraftOut>(DRAFTS_PATH, { method: "POST", body: input });
}

/** 我的草稿（服务端按 `updatedAt` 倒序）。没有 scope——草稿没有「全组织」口径。 */
export async function listMyFeedbackDrafts(): Promise<readonly FeedbackDraft[]> {
  const out = await apiRequest<{ items: FeedbackDraft[] }>(DRAFTS_PATH);
  return out.items;
}

/** 草稿数——导航徽标用（`live-admin-nav-counts.ts`），不拉整个列表。 */
export async function getMyFeedbackDraftCount(): Promise<number> {
  const out = await apiRequest<MyFeedbackDraftCount>(DRAFT_COUNT_PATH);
  return out.count;
}

/**
 * 改草稿 / 追加一条对话。`draftId` 只走 URL，**不进 body**（`lint-body-path-param-leak`）。
 * 返回服务端**整条**草稿：对话是服务端追加的（含它自己补的 AI 回执），前端拿回来整条重渲染，
 * 不在本地造任何一句 AI 文案。
 */
export async function updateFeedbackDraft(draftId: string, patch: FeedbackDraftPatch): Promise<FeedbackDraft> {
  const out = await apiRequest<UpdateFeedbackDraftOut>(draftPath(draftId), { method: "PATCH", body: patch });
  return out.draft;
}

export async function deleteFeedbackDraft(draftId: string): Promise<DeleteFeedbackDraftOut> {
  return apiRequest<DeleteFeedbackDraftOut>(draftPath(draftId), { method: "DELETE" });
}

/** 草稿 → 反馈（事务在服务端）。空正文回 `DRAFT_EMPTY`，调用方要把它翻成可行动的提示。 */
export async function submitFeedbackDraft(draftId: string): Promise<SubmitFeedbackDraftOut> {
  return apiRequest<SubmitFeedbackDraftOut>(draftPath(draftId, "/submit"), { method: "POST" });
}
