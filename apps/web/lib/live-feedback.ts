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
import { feedbackLoop } from "@repo/contracts";
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
export type CommentOnFeedbackGithubIssueOut = z.infer<
  typeof feedbackLoop.operations.commentOnFeedbackGithubIssue.out
>;
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
  /** FB-5——提交前已经 `uploadFeedbackAttachment` 过的图片 id。缺省/空 = 不带附件。 */
  readonly attachmentIds?: readonly string[];
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
export type UploadFeedbackAttachmentOut = z.infer<typeof feedbackLoop.operations.uploadFeedbackAttachment.out>;

/**
 * 图片附件上传走 `multipart/form-data`，同 `live-identity.ts` 的 `uploadOwnAvatar`
 * 既有先例（`apiRequest` 只封装 JSON body）：一个 `meta` 字段（JSON，须与
 * `uploadFeedbackAttachment.in` 一致）+ 一个 `file` 字段（二进制）。这一步先于
 * "提交反馈"发生——返回的 `attachmentId` 攒起来，随 `submitFeedback` 一起提交
 * （见该函数与后端用例头注：认领是 best-effort，不阻塞反馈本身）。
 */
export async function uploadFeedbackAttachment(file: File): Promise<UploadFeedbackAttachmentOut> {
  const meta = { sizeBytes: file.size, contentType: file.type };
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
