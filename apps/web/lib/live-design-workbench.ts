/**
 * UC-17.8 B4.5 —— PM 设计工作台的真实 API 薄封装（契约 `designWorkbench`，
 * `packages/contracts/src/design-workbench.ts`）。
 *
 * 类型全部走 `z.infer`（`lint-contract-source` 要求）：这里**不重新声明**任何字段名或
 * 枚举值。`ProjectTemplate`/`DesignProject`/`DesignProjectChatTurn` 的唯一事实源是
 * 契约文件，本文件只是薄薄一层 `apiRequest` 封装，同 `live-inbox.ts`/`live-feedback.ts`
 * 的成例。
 *
 * ⚠ `deepenFeedback`（`POST /feedback/:feedbackId/deepen`）**不在本文件**——它已经在
 *   B4.4（`lib/live-feedback.ts`）里薄封装过一次，路由虽然挂在这份契约上，但调用方
 *   （收件箱屏）不是设计工作台屏，跟着"谁在用它"放，不重复导出第二份。
 *
 * ⚠ 契约没有单条 `getProject` 操作（见文件头【待确认点 1】：读操作对全组织放开，
 *   `listMyProjects` 是唯一的读入口）。`detail-screen.tsx` 需要单条项目时复用
 *   `listMyProjects()` 后在客户端按 `id` 查找——这不是绕开契约多造一个操作，而是
 *   契约本来就没打算为"查一条"单独开一条路由（同一批 items 反正都要能被组织内其他
 *   人看到）。真要给单条查询单独开销的场景（比如项目量级变大后分页），再加操作，
 *   不在这里"顺手"发明。
 */
import { designAiCollab, designWorkbench, designPrototype } from "@repo/contracts";
import type { z } from "zod";
import { ApiError, apiRequest, apiUrl, getStoredSessionToken } from "./api-client";

export type ProjectTemplate = z.infer<typeof designWorkbench.ProjectTemplate>;
export type DesignProjectChatTurn = z.infer<typeof designWorkbench.DesignProjectChatTurn>;
export type DesignProject = z.infer<typeof designWorkbench.DesignProject>;
export type CreateProjectOut = z.infer<typeof designWorkbench.operations.createProject.out>;
export type ListMyProjectsOut = z.infer<typeof designWorkbench.operations.listMyProjects.out>;
export type UpdateProjectOut = z.infer<typeof designWorkbench.operations.updateProject.out>;
export type AppendProjectChatOut = z.infer<typeof designWorkbench.operations.appendProjectChat.out>;
/** B5.2：模型回复可写回的字段闭集——契约 `designAiCollab.DesignWritebackField` 派生，不手写。 */
export type DesignWritebackField = z.infer<typeof designAiCollab.DesignWritebackField>;
/** B5.3：原型画布组件树节点——契约 `designPrototype.PrototypeNode` 派生，渲染表见 `components/design-loop/prototype-canvas.tsx`。 */
export type PrototypeNode = z.infer<typeof designPrototype.PrototypeNode>;
/** 迭代 11（待签核）：页与页之间的跳转关系，挂在屏上。 */
export type PrototypeLink = z.infer<typeof designPrototype.PrototypeLink>;
export const linkSlotsOf = designPrototype.linkSlotsOf;
export type DeleteProjectOut = z.infer<typeof designWorkbench.operations.deleteProject.out>;
export type PushToInboxOut = z.infer<typeof designWorkbench.operations.pushToInbox.out>;
export type CreateDesignGithubIssueOut = z.infer<typeof designWorkbench.operations.createDesignGithubIssue.out>;
/** 建 issue 的草稿形状——与 `triageFeedback` 的 `issueDraft` 逐字相同，见契约头注。 */
export type DesignIssueDraft = z.infer<typeof designWorkbench.operations.createDesignGithubIssue.in>["draft"];

/** 首页三类模板入口的闭集顺序——同契约 `ProjectTemplate` 枚举顺序，供下拉框/网格复用。 */
export const PROJECT_TEMPLATE_OPTIONS = designWorkbench.ProjectTemplate.options;

/** 空状态引导语 / 固定回执——展示层文案，不落库（见契约文件头【待确认点 2】）。 */
export const DESIGN_WORKBENCH_CHAT_INTRO = designWorkbench.DESIGN_WORKBENCH_CHAT_INTRO;
/** 迭代 9：空项目起手模板（契约常量，展示层）。 */
export const DESIGN_WORKBENCH_STARTERS = designWorkbench.DESIGN_WORKBENCH_STARTERS;
export const DESIGN_WORKBENCH_CHAT_REPLY = designWorkbench.DESIGN_WORKBENCH_CHAT_REPLY;
/** 2026-09-07：退路原因闭集——前端按它给一句人话（`detail-screen.tsx` 的 `FALLBACK_REASON_TEXT`）。 */
export type DesignChatFallbackReason = z.infer<typeof designAiCollab.DesignChatFallbackReason>;

/** 迭代 13：按一句 brief 生成澄清问题。**从不失败**——模型不可用时服务端回退通用六问并置 `fallback`。 */
export type IntakeQuestionsOut = z.infer<typeof designWorkbench.operations.intakeQuestions.out>;
export async function intakeQuestions(brief: string): Promise<IntakeQuestionsOut> {
  return apiRequest<IntakeQuestionsOut>(designWorkbench.operations.intakeQuestions.path, {
    method: "POST",
    body: { brief },
  });
}

export async function createProject(input: {
  readonly name: string;
  readonly template: ProjectTemplate;
  readonly problem?: string;
  readonly linkedFeedbackId?: string;
  /** 迭代 13：澄清问答的结果；跳过的题不在数组里。 */
  readonly intake?: readonly { readonly question: string; readonly answer: string }[];
  /** 迭代 13（delta §4）：新建时就能打的标签。 */
  readonly tags?: readonly string[];
}): Promise<CreateProjectOut> {
  return apiRequest<CreateProjectOut>(designWorkbench.operations.createProject.path, {
    method: "POST",
    body: input,
  });
}

/**
 * 迭代 13（delta §4）：`tags` 过滤取交集，且**排序在服务端**（V65）——调用方拿到什么顺序
 * 就照什么顺序渲染，不要在组件里再 sort 一次。
 * 多个标签用逗号连成一个 query 参数（服务端两种形式都吃）。
 */
export async function listMyProjects(q?: string, tags?: readonly string[]): Promise<ListMyProjectsOut> {
  const wanted = (tags ?? []).map((t) => t.trim()).filter((t) => t !== "");
  return apiRequest<ListMyProjectsOut>(designWorkbench.operations.listMyProjects.path, {
    query: {
      q: q !== undefined && q.trim() !== "" ? q.trim() : undefined,
      tags: wanted.length > 0 ? wanted.join(",") : undefined,
    },
  });
}

export const DESIGN_PROJECT_MAX_TAGS = designWorkbench.DESIGN_PROJECT_MAX_TAGS;
export const DESIGN_PROJECT_TAG_MAX_CHARS = designWorkbench.DESIGN_PROJECT_TAG_MAX_CHARS;

export async function updateProject(
  projectId: string,
  patch: {
    readonly name?: string;
    readonly template?: ProjectTemplate;
    readonly problem?: string;
    readonly theme?: "light" | "dark";
    /** 迭代 13（delta §4）：**整份替换**标签。 */
    readonly tags?: readonly string[];
  },
): Promise<UpdateProjectOut> {
  return apiRequest<UpdateProjectOut>(
    designWorkbench.operations.updateProject.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "PATCH", body: patch },
  );
}

export async function appendProjectChat(
  projectId: string,
  text: string,
  focusNodeId?: string,
  signal?: AbortSignal,
  /** 迭代 13：这一轮要让模型看的参考图。空数组与不传等价——服务端不认空数组以外的差别。 */
  refImageIds?: readonly string[],
): Promise<AppendProjectChatOut> {
  return apiRequest<AppendProjectChatOut>(
    designWorkbench.operations.appendProjectChat.path.replace(":projectId", encodeURIComponent(projectId)),
    {
      method: "POST",
      body: {
        text,
        ...(focusNodeId !== undefined ? { focusNodeId } : {}),
        ...(refImageIds !== undefined && refImageIds.length > 0 ? { refImageIds: [...refImageIds] } : {}),
      },
      signal,
    },
  );
}

/* ── 迭代 13：从已有对话导入（delta `design-chat-inputs` §2）── */

export type ImportThreadOut = z.infer<typeof designWorkbench.operations.importThread.out>;
/** 一次导入的留痕元信息——契约派生，前端不手写这四个字段名。 */
export type ImportedThread = z.infer<typeof designWorkbench.ImportedThread>;
export const IMPORT_THREAD_MAX_MESSAGES = designWorkbench.IMPORT_THREAD_MAX_MESSAGES;

/**
 * 两个阶段一条路由（契约 `importThread` 头注）：
 *   · `problem` 不传 ⇒ **预览**：服务端摘要一段回来给用户改，项目一个字不写。
 *   · `problem` 传了 ⇒ **确认**：写入用户编辑之后的这段文本，并在 `chat` 里留痕。
 *
 * ⚠ 界面上「选中线程」只能走前者。选中即调后者 = 选中即写，会覆盖用户已经写好的
 *   `problem`（V58）——这不是一个可以"顺手省一次往返"的地方。
 */
export async function importThread(
  projectId: string,
  threadId: string,
  problem?: string,
): Promise<ImportThreadOut> {
  return apiRequest<ImportThreadOut>(
    designWorkbench.operations.importThread.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "POST", body: { threadId, ...(problem !== undefined ? { problem } : {}) } },
  );
}

/* ── 迭代 13：参考图（delta `design-chat-inputs` §1）── */

export type RefImage = z.infer<typeof designWorkbench.RefImage>;
export type UploadRefImageOut = z.infer<typeof designWorkbench.operations.uploadRefImage.out>;
export type DeleteRefImageOut = z.infer<typeof designWorkbench.operations.deleteRefImage.out>;

/** 契约常量原样再导出，界面上的提示语从这里取——不在组件里手写 "3 张" 和 "4MB"。 */
export const PROTOTYPE_MAX_REF_IMAGES = designWorkbench.PROTOTYPE_MAX_REF_IMAGES;
export const PROTOTYPE_REF_IMAGE_MAX_BYTES = designWorkbench.PROTOTYPE_REF_IMAGE_MAX_BYTES;
export const isImageMime = designWorkbench.isImageMime;

const refImagePath = (tpl: string, projectId: string, imageId?: string): string =>
  tpl.replace(":projectId", encodeURIComponent(projectId)).replace(":imageId", encodeURIComponent(imageId ?? ""));

/**
 * 参考图上传走 `multipart/form-data`，同 `live-feedback.ts` 的 `uploadFeedbackAttachment`
 * （`apiRequest` 只封装 JSON body）。`contentType` 只是**声明**——服务端按 magic byte 判，
 * 声明与字节不符照样拒。绝不手设 `Content-Type`：fetch 会从 `FormData` 自带 boundary。
 */
export async function uploadRefImage(projectId: string, file: File): Promise<UploadRefImageOut> {
  const form = new FormData();
  form.set("contentType", file.type);
  form.set("file", file, file.name);

  const token = getStoredSessionToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(apiUrl(refImagePath(designWorkbench.operations.uploadRefImage.path, projectId)), {
    method: "POST",
    headers,
    credentials: "include",
    body: form,
  });
  const text = await res.text();
  // 同 `uploadFeedbackAttachment` 的既有纪律：非 JSON 的错误正文不得抛原始 SyntaxError。
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
  return json as UploadRefImageOut;
}

export async function deleteRefImage(projectId: string, imageId: string): Promise<DeleteRefImageOut> {
  return apiRequest<DeleteRefImageOut>(
    refImagePath(designWorkbench.operations.deleteRefImage.path, projectId, imageId),
    { method: "DELETE" },
  );
}
/* ── 迭代 3：原型版本历史 ── */
export type PrototypeVersionSummary = z.infer<typeof designWorkbench.PrototypeVersionSummary>;
export type PrototypeVersion = z.infer<typeof designWorkbench.PrototypeVersion>;
export type ListPrototypeVersionsOut = z.infer<typeof designWorkbench.operations.listPrototypeVersions.out>;
export type GetPrototypeVersionOut = z.infer<typeof designWorkbench.operations.getPrototypeVersion.out>;
export type RestorePrototypeVersionOut = z.infer<typeof designWorkbench.operations.restorePrototypeVersion.out>;

const versionPath = (tpl: string, projectId: string, versionId?: string): string =>
  tpl.replace(":projectId", encodeURIComponent(projectId)).replace(":versionId", encodeURIComponent(versionId ?? ""));

export async function listPrototypeVersions(projectId: string): Promise<ListPrototypeVersionsOut> {
  return apiRequest<ListPrototypeVersionsOut>(versionPath(designWorkbench.operations.listPrototypeVersions.path, projectId));
}
export async function getPrototypeVersion(projectId: string, versionId: string): Promise<GetPrototypeVersionOut> {
  return apiRequest<GetPrototypeVersionOut>(versionPath(designWorkbench.operations.getPrototypeVersion.path, projectId, versionId));
}
export async function restorePrototypeVersion(projectId: string, versionId: string): Promise<RestorePrototypeVersionOut> {
  return apiRequest<RestorePrototypeVersionOut>(versionPath(designWorkbench.operations.restorePrototypeVersion.path, projectId, versionId), { method: "POST", body: {} });
}

/* ── 迭代 5：人直接改画布 ── */
export type PrototypePatchOp = z.infer<typeof designPrototype.PrototypePatchOp>;
export type PatchPrototypeOut = z.infer<typeof designWorkbench.operations.patchPrototype.out>;
export async function patchPrototype(projectId: string, ops: readonly PrototypePatchOp[], summary?: string): Promise<PatchPrototypeOut> {
  return apiRequest<PatchPrototypeOut>(versionPath(designWorkbench.operations.patchPrototype.path, projectId), {
    method: "POST", body: { ops, ...(summary !== undefined ? { summary } : {}) },
  });
}

/** 迭代 2：画布选中态用——契约里的路径查找与短标签，前端不另写遍历。 */
export const findPrototypeNodePath = designPrototype.findPrototypeNodePath;
export const prototypeNodeLabel = designPrototype.prototypeNodeLabel;

export async function deleteProject(projectId: string): Promise<DeleteProjectOut> {
  return apiRequest<DeleteProjectOut>(
    designWorkbench.operations.deleteProject.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "DELETE" },
  );
}

export async function pushToInbox(projectId: string, note?: string): Promise<PushToInboxOut> {
  return apiRequest<PushToInboxOut>(
    designWorkbench.operations.pushToInbox.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "POST", body: { note: note !== undefined && note.trim() !== "" ? note.trim() : undefined } },
  );
}

/**
 * 2026-09-05「转开发」——把一个已推送的设计方案变成一张 GitHub issue。
 * 不幂等：已经有 issue 时服务端回 409 `DESIGN_ISSUE_ALREADY_EXISTS`（见契约头注）。
 */
export async function createDesignGithubIssue(
  projectId: string,
  draft: DesignIssueDraft,
): Promise<CreateDesignGithubIssueOut> {
  return apiRequest<CreateDesignGithubIssueOut>(
    designWorkbench.operations.createDesignGithubIssue.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "POST", body: { draft } },
  );
}
