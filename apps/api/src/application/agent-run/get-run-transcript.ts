/**
 * `getRunTranscript` -- Phase 14 F15's audit-only read (R3'/R6, `error-observability`
 * contract bundle, `packages/contracts/src/error-observability.ts`'s `operations.
 * getRunTranscript`).
 *
 * ## RBAC: "运维/开发角色" maps to `admin`, following existing precedent
 *
 * `OrgRole` (`packages/contracts/src/identity.ts`) has no literal "ops/dev" role. The
 * existing audit-read precedent, `admin-audit-read.ts`'s `isAuditReader`, already answers the
 * adjacent question ("who may read once-private content for audit purposes") by narrowing to
 * `admin` alone -- explicitly excluding `compliance` ("合规官拿的是审计链本身，不是项目
 * 内容"). This use case reads FULL prompt/response content, a strictly more sensitive
 * surface than that precedent's chat messages, so the same narrowing applies at least as
 * tightly: `admin` only, not `compliance`.
 *
 * ## FORBIDDEN is checked before RUN_NOT_FOUND, unconditionally
 *
 * `usecases.md`'s UC-2 keeps the two error codes distinct on purpose: "审计接口的调用者本就
 * 是可信角色，探针风险低于普通用户可见接口" -- unlike the Chat "one refusal for three
 * situations" rule the OTHER `agent-run.controller.ts` endpoints follow (see that
 * controller's file head). But that reduced probing concern only holds once the caller has
 * already been confirmed to BE that trusted role. A caller who is not an `admin` at all must
 * never be able to use this endpoint to learn whether a given `runId` exists -- so the role
 * check runs first and always, and only a caller who passes it can turn a missing run into
 * `RUN_NOT_FOUND` rather than `FORBIDDEN`.
 *
 * ## Current scope: only `model_call` steps carry real full content
 *
 * `tool_call` steps today only have truncated summaries (`tool_args_summary`/
 * `tool_result_summary`, `agent_run_steps`' existing columns) -- the untruncated
 * args/results this feature's R6 asks for are not yet exposed by the model-call boundary
 * (`deep-agent-model-provider.ts`), so capturing them is explicit, visible follow-up work,
 * not a swallowed gap. Until then, every `tool_call` row this endpoint returns has
 * `decryptStatus: "unreadable"` -- an honest "no full content recorded for this step", never
 * a fabricated value pretending the truncated summary is the full one.
 */
import { errorObservability as EO } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { IdentityRepository } from "../identity/ports";
import type { AgentRunStore } from "./ports";

export type GetRunTranscriptOutput = z.infer<typeof EO.GetRunTranscriptOutput>;

/** 调用者不具备运维/开发角色（本用例的映射：仅 `admin`，见文件头）。 */
export class RunTranscriptForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
  }
}

/** runId 在调用者所在组织内不存在（RLS 已让"别的组织的 run"与"根本没有这个 run"不可区分，
 * 这里也不需要区分——探针风险已经由角色检查先一步挡住，见文件头）。 */
export class RunTranscriptNotFoundError extends Error {
  constructor() {
    super("RUN_NOT_FOUND");
  }
}

export interface GetRunTranscriptDeps {
  readonly repo: IdentityRepository;
  readonly runs: AgentRunStore;
}

/** 用例层输入——比契约 `GetRunTranscriptInput`（只有 wire 上的 `runId`）多出
 * `callerId`/`orgId` 两个调用方上下文字段，不是同一份 DTO，故不与契约同名
 * （`lint-contract-source` 只禁止用 `interface` 重述契约本身那份结构）。 */
export interface GetRunTranscriptUseCaseInput {
  readonly callerId: string;
  readonly orgId: OrgId;
  readonly runId: string;
}

/**
 * 仅 `admin` 通过。刻意**不**包含 `compliance`——同 `admin-audit-read.ts` 的
 * `isAuditReader` 一致边界，且这里是完整内容（比该文件的项目消息更敏感），边界只能更紧
 * 不能更松。
 */
function isTranscriptAuditor(role: OrgRole | null): boolean {
  return role === "admin";
}

export async function getRunTranscript(
  deps: GetRunTranscriptDeps,
  input: GetRunTranscriptUseCaseInput,
): Promise<GetRunTranscriptOutput> {
  // 角色检查先于任何存在性判断——见文件头「FORBIDDEN 无条件先查」。
  const membership = await deps.repo.findOrgMembership(input.callerId, input.orgId);
  if (!isTranscriptAuditor(membership?.orgRole ?? null)) throw new RunTranscriptForbiddenError();

  const steps = await deps.runs.readRunTranscriptSteps(input.orgId, input.runId);
  if (steps === null) throw new RunTranscriptNotFoundError();
  return { runId: input.runId, steps: [...steps] };
}
