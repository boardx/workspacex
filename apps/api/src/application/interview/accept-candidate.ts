/**
 * `acceptCandidate` —— 候选态三出口中的两个（加入表 / 编辑后加入），F98，uc-6-7 AC3。
 *
 * ## 为什么这里不可能自动写入联系方式
 *
 * 不是一条"记得别填"的运行时检查，是**类型层面不可达**：`SubjectCandidate`
 * （`candidate-ports.ts`）从生成的那一刻起就没有联系方式字段（见 `suggest-candidates.ts`
 * 文件头），`CreateSubjectInput.contact` 在这里恒传 `null`。要让联系方式进来，得先改
 * 两个类型的形状，而这本身就会是一次显眼的、需要评审的改动——这正是 AC3「不自动写入
 * 联系方式」想要的那种"想犯规也犯不成"，而不是"讲好了不要犯规"。
 *
 * ## 第三出口「忽略」为什么不在这里
 *
 * 「忽略」只是客户端不再展示这张候选卡，不需要改服务端任何状态——候选本来就没有
 * 进对象表，不接受它不产生任何需要撤销的效果。真正需要服务端参与的只有"确认"这一条，
 * 这也是契约只给了 `acceptCandidate`、没有 `rejectCandidate`/`ignoreCandidate` 的原因,
 * 不是遗漏。
 *
 * ## `edits` 是什么
 *
 * 契约的 `acceptCandidate.in` 只有一个 `edits: string | null` 字段（非结构化）。
 * 候选卡上人类最可能需要修正的是"对象"这一栏（AI 给的候选可能是匿名代称或占位名），
 * 其余字段（部门角色/来源）沿用候选本身——所以 `edits` 映到 `displayName`；
 * `edits === null` 就是三出口里的「加入表」（原样接受），非空就是「编辑后加入」。
 * 契约没有给这个字段更细的结构，这里不代它发明字段名去拆分，如实按现有形状实现。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { CandidateStore } from "./candidate-ports";
import type { SubjectRepository } from "./subject-ports";

export type AcceptCandidateResult = z.infer<typeof interview.operations.acceptCandidate.out>;
export type AcceptCandidateInputDto = z.infer<typeof interview.operations.acceptCandidate.in>;

export interface AcceptCandidateDeps {
  readonly store: CandidateStore;
  readonly repo: SubjectRepository;
}

export interface AcceptCandidateCommand {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly input: AcceptCandidateInputDto;
}

/**
 * 候选已不在（从未存在 / 已被接受过 / 已过期被清理）。契约的 `acceptCandidate` 错误集
 * 只有 `CONCURRENT_MODIFICATION` / `DEPENDENCY_UNAVAILABLE`，没有"候选不存在"这个码——
 * 与 `TemplateVersionChangedError` 同一立场：候选态是易变的、可能被并发接受或忽略的
 * 短生命周期状态,"你想接受的这条候选已经不在了"落在并发修改的语义里最合适，
 * 不发明契约没给的第三个码。
 */
export class CandidateNotFoundError extends Error {
  readonly code = "CONCURRENT_MODIFICATION" as const;
  constructor(readonly candidateId: string) {
    super(`CONCURRENT_MODIFICATION: candidate ${candidateId} no longer exists`);
  }
}

function toResult(r: Awaited<ReturnType<SubjectRepository["create"]>>): AcceptCandidateResult {
  return {
    subjectId: r.subjectId,
    displayName: r.displayName,
    roleTitle: r.roleTitle,
    orgName: r.orgName,
    groupId: r.groupId,
    contactMask: r.contactMask ?? "",
    sourceKind: r.sourceKind,
  };
}

export async function acceptCandidate(
  deps: AcceptCandidateDeps,
  cmd: AcceptCandidateCommand,
): Promise<AcceptCandidateResult> {
  const candidate = await deps.store.get(cmd.orgId, cmd.input.candidateId);
  if (candidate === null) throw new CandidateNotFoundError(cmd.input.candidateId);

  // `displayName` 是 `interview_subjects` 的 NOT NULL 列（F97）。契约的错误集里没有
  // "候选缺姓名"这个码，`acceptCandidate` 只有 `CONCURRENT_MODIFICATION` /
  // `DEPENDENCY_UNAVAILABLE` 两条，编一个第三条码是发明契约没给的接口。所以退到
  // R3-2 本就允许的"匿名代称"（访谈侧原型示例 `P-12 匿名`），而不是拒绝整个请求——
  // 人类之后仍可在对象表里逐行编辑改名（`updateSubject`）。
  const displayName = cmd.input.edits ?? candidate.name ?? "匿名候选";

  const record = await deps.repo.create({
    orgId: cmd.orgId,
    displayName,
    roleTitle: candidate.roleTitle,
    orgName: null,
    groupId: candidate.groupId,
    contact: null, // ⚠ 恒 null——见文件头「为什么这里不可能自动写入联系方式」。
    sourceKind: "human",
    createdBy: cmd.actorId,
  });

  // 候选态到此终结——同一张候选卡不能被接受第二次（不是可重复消费的状态）。
  await deps.store.remove(cmd.orgId, cmd.input.candidateId);

  return toResult(record);
}
