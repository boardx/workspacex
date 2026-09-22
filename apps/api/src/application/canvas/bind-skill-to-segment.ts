/**
 * `bindSkillToSegment`（#1468 / F102 · uc-7-4 R7）—— 把一个 skill 挂到某个议程环节。
 *
 * ## 契约签核已久，实现从来没有过
 *
 * `usecases.md` 二节逐字写着这条 UC（`in {agendaSegmentId, skillKey, runMode}` /
 * `out {bindingId}` / `pre 引导师（组员不可自行加挂，uc-7-4 R7）`），`coverage.md` 的
 * 端口对照表里它是 ✅。但在 #1468 之前：没有表、没有用例、没有路由——
 * `apps/web/components/canvas/segment-binding.tsx` 那一屏的「加挂 skill」全程是 mock。
 * 这个形状与 #493（`bindTemplateToSegment` 当时的处境）逐字同型。
 *
 * ## 权限：引导师，走同一张矩阵，不新造谓词
 *
 * `pre:` 逐字是「引导师（组员不可自行加挂）」⇒ `agendaSegment.bindSkill`，与
 * `agendaSegment.bindTemplate` 同组、同一行（`domain/identity/project-role-matrix.ts`）。
 * 理由与 `bind-template-to-segment.ts` 那条完全相同，不复述第二遍：绑定改的是**环节的
 * 编排**，不是现场参与，所以它属 `agendaSegment.*` 而不是 `content.*`。
 *
 * ⚠ 「不是项目成员」与「是成员但角色不够」抛**同一个** `ROLE_INSUFFICIENT`：契约的
 *   `err` 联合里只有这一个拒绝码，把非成员单独渲染成另一种拒绝，等于告诉一个陌生人
 *   「这个工作坊存在，只是你不在里面」。
 *
 * ## 重复绑定为什么不是错误
 *
 * 契约 `err` 只有 `ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE`——**没有**任何冲突码，
 * 也**没有**解绑操作。所以第二次绑同一个 skill 必须成功，而它落成什么由
 * `CanvasSegmentSkillRepository.upsertBinding` 的端口注释论证（改既有那一行的 `runMode`，
 * `bindingId` 不变）。本文件不在这里重复那段判据，也不先查后写：并发下的两次绑定由
 * 唯一约束判，同 `insertSegmentBinding` 的纪律。
 *
 * ## `skillKey` 不做存在性校验，这一点是说出来的
 *
 * 契约的 `err` 里没有 `SKILL_NOT_FOUND`（对照同一束的 `bindTemplateToSegment` 有
 * `TEMPLATE_NOT_FOUND`——两条操作的 err 集合是分别签核的，差异不是笔误）。加一次
 * 「这个 skill 存在吗」的查询，就必须为它的否定分支发明一个契约里没有的响应，
 * 所以这里不查。绑到一个查不到名字的 key 之后会发生什么，写在
 * `list-segment-skills.ts` 的文件头（不丢行，名字退回 key 本身）。
 */
import type { SegmentSkillRunMode } from "../../domain/canvas/segment-binding";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { CanvasError } from "./errors";
import { CanvasSegmentNotFoundError } from "./segment-binding-errors";
import type { CanvasSegmentSkillRepository } from "./segment-skill-ports";
import type { CanvasTemplateRepository } from "./template-ports";

/** 引用矩阵里实际存在的字面量，不新造常量值（同 `BIND_TEMPLATE_TO_SEGMENT_ACTION`）。 */
export const BIND_SKILL_TO_SEGMENT_ACTION = "agendaSegment.bindSkill" as const;

export interface BindSkillToSegmentDeps {
  readonly auth: AuthorizeDeps;
  /** 只为 `findSegmentWorkshopId` 一条查询而持有——不复制第二份「环节属于哪个工作坊」。 */
  readonly templates: CanvasTemplateRepository;
  readonly skills: CanvasSegmentSkillRepository;
  /** 绑定 id 的来源。注入是为了让测试能预测 id，同 `newBindingId` 那条。 */
  readonly newBindingId: () => string;
}

export interface BindSkillToSegmentInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly agendaSegmentId: string;
  readonly skillKey: string;
  readonly runMode: SegmentSkillRunMode;
}

export interface BindSkillToSegmentOutput {
  readonly bindingId: string;
}

export async function bindSkillToSegment(
  deps: BindSkillToSegmentDeps,
  input: BindSkillToSegmentInput,
): Promise<BindSkillToSegmentOutput> {
  // ① 环节在哪个工作坊。同 `bindTemplateToSegment`：先解析环节、再鉴权，因为项目角色
  //    挂在工作坊上，不知道工作坊就无从判起；`agenda_segments` 走 RLS，别的组织的环节
  //    在这条路径上本来就查不到，所以这个 404 不泄露跨组织的存在性。
  const workshopId = await deps.templates.findSegmentWorkshopId(input.orgId, input.agendaSegmentId);
  if (workshopId === null) throw new CanvasSegmentNotFoundError(input.agendaSegmentId);

  // ② 引导师判定。一次 `authorize()`，矩阵说了算。
  const decision = await authorize(deps.auth, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: workshopId,
    object: { kind: "project", id: workshopId },
    action: BIND_SKILL_TO_SEGMENT_ACTION,
  });
  if (!decision.allowed) throw new CanvasError("ROLE_INSUFFICIENT");

  // ③ 写入。新 id 只在真的插入时生效；命中既有行时仓储回的是那一行自己的 id。
  const outcome = await deps.skills.upsertBinding({
    orgId: input.orgId,
    bindingId: deps.newBindingId(),
    agendaSegmentId: input.agendaSegmentId,
    workshopId,
    skillKey: input.skillKey,
    runMode: input.runMode,
  });

  return { bindingId: outcome.bindingId };
}
