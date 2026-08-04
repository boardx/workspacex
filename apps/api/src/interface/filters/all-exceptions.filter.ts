/**
 * Error boundary -- one of the three mandatory runtime gates in `architecture.md`.
 *
 * Contract: the response body carries only an error code and a traceId; detail goes to
 * the log. `err.message` routinely contains SQL fragments, table names and connection
 * strings, none of which may reach the response body.
 *
 * But returning only `internal_error` is not enough either: that would make production
 * issues undiagnosable, trading security for unoperability. Hence the mandatory traceId,
 * with the full detail available in the log under the same id (I-11).
 *
 * Error codes come from a CLOSED mapping off the status code, never from the exception
 * message -- using messages as codes turns internal strings into a public contract.
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import {
  artifact,
  auth,
  canvas,
  chat,
  files,
  identity,
  interview,
  orgAdmin,
  project,
  wave2Runtime,
} from "@repo/contracts";
import type { Response } from "express";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { ContractValidationError } from "../pipes/zod-body.pipe";
import { traceIdOf } from "../middleware/trace";

/** status code -> public error code. Closed set: additions go through review. */
const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  /**
   * F32: a short-lived download URL that has aged out.
   *
   * Distinct from 409 on purpose -- 「过期了，重新点一次下载」 and 「这条链接已经被用掉了」 send
   * the user to two different places, and without an entry here a 410 would be rendered
   * `internal_error`: a correct status paired with a body claiming the server broke.
   */
  410: "gone",
  422: "unprocessable",
  503: "dependency_unavailable",
};

/**
 * The ONE piece of exception detail allowed into a response body: `reasonCode`.
 *
 * This looks like the thing the file's header forbids, so here is the distinction. The ban
 * is on using exception MESSAGES as codes -- arbitrary internal strings becoming a public
 * contract by accident. `PermissionReason` is the opposite: a closed enum in
 * `@repo/contracts` that the frontend already renders against, and it is parsed against
 * that enum here, so nothing outside it can pass through no matter what an exception
 * carries.
 *
 * It has to be here because UC-0.3 R8 requires a denial to say WHICH LAYER refused --
 * "org-level restriction: this resource is limited to the energy team" versus "you have no
 * role in this project". Four different problems rendered as one bare 403 send the user
 * hunting for a permission that was never the issue.
 *
 * ## Two enums, both closed (F19)
 *
 * `auth.AuthReason` joins `identity.PermissionReason` here because the auth bundle's
 * failures are the same kind of thing: a closed enum in `@repo/contracts` that the frontend
 * renders against. Without it an `INVITE_CODE_INVALID` would be silently DROPPED by the
 * parse below and the caller would receive a bare `bad_request` -- the registration wizard
 * could not tell an unusable invite code from a malformed request body, and nothing would
 * report the loss because dropping is this function's normal behaviour for anything it does
 * not recognise.
 *
 * ⚠ Tried in order, and the union is still CLOSED: a value outside both enums cannot pass,
 * no matter what an exception carries. Adding a third enum here should be a deliberate act;
 * adding a free string must never be one.
 */
function permissionReasonOf(exception: HttpException): { reasonCode?: string } {
  const body = exception.getResponse();
  if (typeof body !== "object" || body === null) return {};
  const raw = (body as { reasonCode?: unknown }).reasonCode;
  const permission = identity.PermissionReason.safeParse(raw);
  if (permission.success) return { reasonCode: permission.data };

  // F20/F21: `auth.AuthReason` passes for the same reason and under the same restriction.
  //
  // It is a closed enum in `@repo/contracts`, parsed against that enum here, so nothing
  // outside it reaches a response no matter what an exception carries. The frontend renders
  // against it directly (the login screen's error copy is per-code).
  //
  // ⚠ Two codes appear in BOTH enums (`AUTH_SERVICE_UNAVAILABLE`). That is not a
  // duplicated fact -- `identity`'s means "the authorization service is unreachable" and
  // `auth`'s means "the session store is unreachable", and both must reach the client as
  // "refuse", never as a degraded allow. Ordering matters only in that the first match wins,
  // and for that code the rendered result is identical either way.
  const authReason = auth.AuthReason.safeParse(raw);
  if (authReason.success) return { reasonCode: authReason.data };

  /**
   * F16: `identity.LocalOrgReason`, the third and last closed enum here.
   *
   * Same restriction, same reasoning -- a closed enum in `@repo/contracts`, parsed against
   * that enum, so nothing outside it reaches a response. It is separate from
   * `PermissionReason` because it answers a different question: `PermissionReason` says WHO
   * was refused and at which layer, while these say the local runtime is down, the endpoint
   * is off-machine, or this route only serves personal-local organizations. Rendering a
   * dependency failure as a permission denial sends the user to ask an administrator for
   * access they already have.
   *
   * ⚠ Note what does NOT pass: the startup hint. It is a contract CONSTANT
   * (`LOCAL_RUNTIME_STARTUP_HINT`) the frontend reads directly, so the server never carries
   * the sentence across the wire -- carrying it would be the same fact in two places, which
   * is the failure this project has had five times.
   */
  const localOrg = identity.LocalOrgReason.safeParse(raw);
  if (localOrg.success) return { reasonCode: localOrg.data };

  /**
   * F17: `identity.LocalExportReason`, the fourth closed enum.
   *
   * ⚠ Added because its two codes were being SILENTLY DROPPED here. They are declared in the
   * contract (`previewExport.err` / `exportToOrganization.err`) but belonged to no enum, so
   * the parses above all failed and the caller got a bare `conflict`. The status code was
   * right and the reason was gone -- and the UI needs the reason, because "you have not
   * previewed" and "this request does not match the list you confirmed" ask the user for
   * different things.
   *
   * Same shape of exemption as the three above, same restriction: a closed enum in
   * `@repo/contracts`, parsed against that enum, nothing else passes.
   */
  const localExport = identity.LocalExportReason.safeParse(raw);
  if (localExport.success) return { reasonCode: localExport.data };

  /**
   * F80: `interview.InterviewError`, the fifth closed enum —— 加它的理由与上一条**逐字相同**，
   * 而且是同一个 bug 又发生了一次。
   *
   * `SCOPE_NOT_VISIBLE` 声明在契约的 `listInterviews.err` 里，却不属于上面任何一个枚举，
   * 于是四次 safeParse 全部失败，调用方收到一个光秃秃的 `{"error":"forbidden"}`。
   * 状态码对，原因没了 —— 而 uc-6-0/V7 要求「本范围无访谈」与「无权查看本范围」
   * **文案不同**，前端唯一能据以分辨的就是这个码。丢掉它，那条验收线索在实现上无法满足。
   *
   * ⚠ 这不是给异常开的口子：`InterviewError` 是 `@repo/contracts` 里的封闭枚举，
   * 在这里对着那个枚举 parse，枚举之外的任何字符串都过不来。
   *
   * ⚠ 注意 `NO_INTERVIEW_ACCESS` **不走这条路**：它必须与「不存在」逐字节不可区分，
   * 所以那条路径抛的是不带 `reasonCode` 的裸 404（见 `interview-scope.controller.ts`）。
   * 一个「顺手把 reasonCode 带上」的改动会当场打开 uc-6-0/E3 的枚举探测面。
   */
  const interviewError = interview.InterviewError.safeParse(raw);
  if (interviewError.success) return { reasonCode: interviewError.data };

  /**
   * F10: `orgAdmin.OrgAdminError`, the SIXTH closed enum.
   *
   * Added for the same reason `LocalExportReason` was: without it, `INVITE_NOT_FOUND` and
   * `INVITE_DUPLICATE` are declared in the contract (`activateOrgMember.err` /
   * `inviteOrgMember.err`) but belong to no enum here, so every parse above fails and the
   * caller gets a bare `bad_request`. The status would be right and the reason gone -- and
   * the reason is the whole interface: "this link is no longer usable" and "your request
   * body was malformed" send the user to two completely different places.
   *
   * ⚠ Same restriction as the five above: a closed enum in `@repo/contracts`, parsed against
   * that enum, nothing outside it passes. ⚠ It OVERLAPS `identity.PermissionReason` by
   * design (`PROJECT_ROLE_INSUFFICIENT`, `AUTH_SERVICE_UNAVAILABLE`, ...) -- `org-admin`'s
   * usecases.md says in its first section that permission failures REUSE identity's codes
   * rather than growing a second set, so the earlier parse winning is the contracted
   * outcome, not a collision to be broken.
   */
  const orgAdminReason = orgAdmin.OrgAdminError.safeParse(raw);
  if (orgAdminReason.success) return { reasonCode: orgAdminReason.data };

  /**
   * F117: `project.ProjectReason`, the SEVENTH closed enum —— 又是同一个 bug 的第四次。
   *
   * ⚠ 「第七」是 **rebase 到 F49 之后重新数的**（`grep -c "safeParse(raw)"` = 7），
   *   不是沿用写这段话时的序号。F80 加过第五个、F10 加过第六个，两次都是并行开发；
   *   本轮 F49 没有动这个函数，所以序号没变——**没变这件事也是量出来的**。
   *
   * `ORG_ROLE_INSUFFICIENT` 与 `INVALID_KIND` 声明在 `createProject.err` 里，
   * 而它们**不属于**上面任何一个枚举（`ORG_ROLE_INSUFFICIENT` 是本束的第一处声明，
   * 见 `KNOWN_CONTRACT_GAPS.P1`）。少了这一段，六次 safeParse 全部失败，
   * 调用方收到一个光秃秃的 `{"error":"forbidden"}` —— 而「你的组织角色不够」
   * 与「你不在这个组织里」把用户送去两个完全不同的地方（前者找 lead，后者找 admin）。
   *
   * ⚠ 与 `orgAdmin` 一样与 `PermissionReason` **有意重叠**
   *   （`NO_PROJECT_ROLE` / `ADMIN_NOT_SUPERUSER` / `AUTH_SERVICE_UNAVAILABLE` …）：
   *   契约里 `_sharedWithIdentity` 那道编译期门控钉死了「同名是刻意的」，
   *   所以前面的 parse 先赢是**契约要的结果**，不是一次要去掉的碰撞。
   */
  const projectReason = project.ProjectReason.safeParse(raw);
  if (projectReason.success) return { reasonCode: projectReason.data };

  /**
   * F32: `files.FilesError`, the EIGHTH closed enum —— 加它的理由与前三条**逐字相同**，
   * 这是同一个 bug 第四次发生。
   *
   * ⚠ 「第八」是 **rebase 到同时含 F49 / F117 / F81 的 main 之后重新数的**
   *   （`grep -c "^  const .*safeParse(raw);" ` = 8 —— 数**调用点**，不是数提及；
   *   本段与 F117 那段各自提了一次 `safeParse(raw)`，裸 grep 会报 10），
   *   不是沿用写这段话时的序号。
   *   写这段话时 F117 还没合入，F32 数出来的是「第七」；合流后 F117 占了第七。
   *   两次都是实测，而**第一次已经作废** —— 与 `verify-rls.sh` 那个 ratchet 是同一件事的
   *   第二种形态：并行分支各自数到同一个序号，合流后必须重数，否则文件里会出现两个「第七」。
   *
   * `DOWNLOAD_URL_EXPIRED` / `DOWNLOAD_URL_CONSUMED` 声明在契约的 `issueDownloadUrl.err` 里，
   * 却不属于上面任何一个枚举，于是前七次 safeParse 全部失败，调用方收到一个光秃秃的
   * `{"error":"gone"}` / `{"error":"conflict"}`。状态码对，原因没了 —— 而这两件事对用户的
   * 出口完全不同：「过期了，重新点一次下载」 vs 「这条链接已经被别人用掉了，这值得你查一下」。
   * 前者是重试，后者可能是一次转发泄露。丢掉这个码，第二种情况在界面上不存在。
   *
   * ⚠ 不是给异常开的口子：`FilesError` 是 `@repo/contracts` 里的封闭枚举，
   *   在这里对着那个枚举 parse，枚举之外的任何字符串都过不来。
   * ⚠ 注意 `ARTIFACT_NOT_FOUND` **不走这条路**，虽然它就在这个枚举里：契约对它有一条更严的
   *   要求——与「真的不存在」**逐字节同响应**（N-25 / V6·22-1）。所以 `files-delivery.controller.ts`
   *   那条路径抛的是**不带 reasonCode 的裸 404**。一个「顺手把 reasonCode 带上」的改动
   *   会当场把整个组织的 artifact id 变成可探测的存在性预言机。
   */
  const filesError = files.FilesError.safeParse(raw);
  if (filesError.success) return { reasonCode: filesError.data };

  const skillStarterImport = wave2Runtime.SkillStarterImportError.safeParse(raw);
  if (skillStarterImport.success) return { reasonCode: skillStarterImport.data };

  const agentStarterImport = wave2Runtime.AgentStarterImportError.safeParse(raw);
  if (agentStarterImport.success) return { reasonCode: agentStarterImport.data };

  /**
   * F109: `chat.ChatError`, the NINTH closed enum —— 同一个 bug 第五次发生。
   *
   * ⚠ 「第九」是 **rebase 到同时含 F49 / F117 / F81 / F18 / F32 的 main 之后重新数的**
   *   （`grep -c "^  const .*safeParse(raw);"` = 8，本条是第 9 个）。
   *   **数调用点，不是数提及**：本段与 F117 / F32 那两段各自提了一次 `safeParse(raw)`，
   *   裸 `grep -c 'safeParse(raw)'` 会报 11。前一位 F32 已经踩过这个坑并写在上面，
   *   这里照它的方法数了一遍，而不是把它的「第八」加一。
   *
   * `mutateThread.err` 里的 `NO_WRITE_ROLE` / `THREAD_ARCHIVED_READONLY` /
   * `VERSION_CHANGED` / `TITLE_INVALID` 声明在契约里，却不属于上面任何一个枚举，
   * 于是前八次 safeParse 全部失败，调用方收到光秃秃的 `{"error":"forbidden"}` /
   * `{"error":"conflict"}`。状态码对，原因没了 —— 而这四件事的出口完全不同：
   *   · `NO_WRITE_ROLE` 找人要权限；
   *   · `THREAD_ARCHIVED_READONLY` 先解归档，**要权限没有用**（uc-8-1 R7：归档只读）；
   *   · `VERSION_CHANGED` 刷新后重试，且必须提示「别人改过了」而不是「你没权限」（V7 / E2）；
   *   · `TITLE_INVALID` 改输入。
   * 把前两个都渲染成一个 403，用户会去找管理员要一个他早就有的权限。
   *
   * ⚠ **`NOT_VISIBLE` 刻意不走这条路**，虽然它就在这个枚举里 —— 与上面 `ARTIFACT_NOT_FOUND`
   *   同型同理由：I-3 要求「不可见」与「不存在」**逐字节相同**，所以 `chat.controller.ts`
   *   那条路径抛的是**不带 reasonCode 的裸 404**。一次「顺手把 reasonCode 带上」的改动
   *   会把每一条私聊/别组线程的 id 变成可探测的存在性预言机，而状态码看起来毫无变化。
   *   反证在 `visibility-two-layer-intersection.test.ts` 与
   *   `messages-jsonl-file-granularity.test.ts` 的两条「逐字节相同」断言上。
   */
  const chatError = chat.ChatError.safeParse(raw);
  if (chatError.success) return { reasonCode: chatError.data };

  /**
   * #463: `canvas.CanvasError`，第十个闭集枚举 —— 同一个 bug 第六次发生。
   *
   * ⚠ 「第十」是**数调用点数出来的**，不是把上一条的「第九」加一：
   *   `grep -c "^  const .*safeParse(raw);"` 在本改动前报 9，本条是第 10 个。
   *   上面 F32 与 F109 两段各自记过一次「裸 grep 会多报，因为注释里也提到了它」，
   *   这里照它们的方法重数了一遍。
   *
   * `canvas.ts` 的五个注册表操作声明了 `TEMPLATE_NOT_FOUND` / `ROLE_INSUFFICIENT` /
   * `BUILTIN_TEMPLATE_UNDELETABLE` / `NO_PROJECT_ROLE` / `DEPENDENCY_UNAVAILABLE`，
   * 而它们不属于上面任何一个枚举 —— 于是前九次 safeParse 全部失败，调用方收到光秃秃的
   * `{"error":"forbidden"}`。状态码对，原因没了，而这几件事的出口互不相同：
   *   · `ROLE_INSUFFICIENT` 去找管理员；
   *   · `BUILTIN_TEMPLATE_UNDELETABLE` **找谁都没用**，19 个内置模板本来就不可归档；
   *   · `NO_PROJECT_ROLE` 是「你根本不在这个组织」。
   * 把前两个都渲染成同一个 403，用户会去要一个不存在的权限。
   *
   * ⚠ `TEMPLATE_NOT_FOUND` **走这条路是安全的**，与 `chat.NOT_VISIBLE` / `ARTIFACT_NOT_FOUND`
   *   那两条刻意不走的不同：`canvas-template.controller.ts` 里权限判定在存在性查询**之前**
   *   （见 `publish-template.ts` 的那条注释），所以一个无权者永远拿不到 404 与 403 的
   *   差别，这个码只可能出现在一个已经被授权的管理员眼前。反证在
   *   `template-lifecycle-http.test.ts` 的「普通成员发布」与「租户隔离」两条断言上：
   *   前者收到的是 403 而不是 404，后者收到的是 404 而不是别的组织的存在性。
   */
  const canvasError = canvas.CanvasError.safeParse(raw);
  return canvasError.success ? { reasonCode: canvasError.data } : {};
}

/**
 * The SECOND and last piece of exception detail allowed through: an `ArtifactError` code and
 * the artifact it is about (F07 / E1).
 *
 * Same shape of exemption as `permissionReasonOf`, and it needs the same justification.
 * `REQUIRES_PINNED` is not an internal string: it is a member of a closed enum in
 * `@repo/contracts`, it is parsed against that enum here, and nothing outside it passes no
 * matter what an exception carries. `artifactId` is parsed as a plain non-empty string and
 * is only ever the PARENT of a version the caller just addressed successfully -- it
 * discloses no resource the caller could not already name.
 *
 * It has to be here because AC1's refusal is required to be actionable: uc-0-1 E1 says the
 * denial must offer 一键定版, and an interface that receives `{"error":"conflict"}` has
 * nothing to offer it with. That is the difference between a gate and a dead end -- and a
 * dead end is what users route around by copying the content somewhere the gate is not.
 */
function artifactErrorOf(exception: HttpException): { artifactError?: string; artifactId?: string } {
  const body = exception.getResponse();
  if (typeof body !== "object" || body === null) return {};
  const raw = body as { artifactError?: unknown; artifactId?: unknown };
  const code = artifact.ArtifactError.safeParse(raw.artifactError);
  if (!code.success) return {};
  const id = typeof raw.artifactId === "string" && raw.artifactId.length > 0 ? raw.artifactId : undefined;
  return id === undefined ? { artifactError: code.data } : { artifactError: code.data, artifactId: id };
}

/**
 * F11: `TEAM_IN_USE`'s occupancy payload — the THIRD and last piece of exception detail
 * allowed through, same shape of exemption as `artifactErrorOf`.
 *
 * `mutateTeam`'s design-signoff note is explicit: "占用项作为 out.blocked 返回同时抛该码：
 * 错误体带结构化数据是本束的形状" — a response that only says `{"error":"conflict",
 * "reasonCode":"TEAM_IN_USE"}` sends the admin to guess who is using the team. Structural
 * validation only (kind/id/label strings, two non-negative counts), not a full zod parse
 * against the contract's nested object literal — pulling that in here would let the filter
 * depend on the exact shape `mutateTeam.out.blocked` happens to have today rather than on a
 * named, reusable schema, and none exists yet for this one nested shape.
 */
function teamOccupancyOf(exception: HttpException): { blocked?: unknown } {
  const body = exception.getResponse();
  if (typeof body !== "object" || body === null) return {};
  const raw = body as { reasonCode?: unknown; blocked?: unknown };
  if (raw.reasonCode !== "TEAM_IN_USE") return {};
  const blocked = raw.blocked;
  if (typeof blocked !== "object" || blocked === null) return {};
  const b = blocked as { memberCount?: unknown; aclBindingCount?: unknown; items?: unknown };
  const itemsOk =
    Array.isArray(b.items) &&
    b.items.every(
      (it) =>
        typeof it === "object" &&
        it !== null &&
        typeof (it as Record<string, unknown>).kind === "string" &&
        typeof (it as Record<string, unknown>).id === "string" &&
        typeof (it as Record<string, unknown>).label === "string",
    );
  if (typeof b.memberCount !== "number" || typeof b.aclBindingCount !== "number" || !itemsOk) return {};
  return { blocked };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerPort) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const traceId = traceIdOf(http.getRequest());

    if (exception instanceof ContractValidationError) {
      // Field-level errors are PART OF THE CONTRACT, not internal detail:
      // a path plus a zod code, never the submitted value.
      this.logger.error("contract validation failed", { traceId, err: exception });
      res.status(HttpStatus.BAD_REQUEST).json({
        error: "validation_failed",
        traceId,
        fields: exception.fields,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      this.logger.error("http exception", { traceId, err: exception, status });
      res.status(status).json({
        error: CODE_BY_STATUS[status] ?? "internal_error",
        traceId,
        ...permissionReasonOf(exception),
        ...artifactErrorOf(exception),
        ...teamOccupancyOf(exception),
      });
      return;
    }

    this.logger.error("unhandled exception", { traceId, err: exception });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "internal_error", traceId });
  }
}
