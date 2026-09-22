/**
 * `listSegmentSkills`（#1468 / F107 · uc-7-4 V3、uc-7-1 V6）—— 左栏第三区：某议程环节的
 * skill 白名单。
 *
 * ## 它和 `bindSkillToSegment` 是同一件事的两半
 *
 * 绑定写进 `canvas_segment_skill_bindings`，这条操作把那张表读回来。没有它，
 * 「绑了 → 刷新 → 还在」这条闭环做不出来，而绑定本身也就无从验证——#1468 因此
 * 一次交付这两条，而不是先落一个只写不读的端点。
 *
 * ## 权限：`read.published`，与 `listAgendaSegments` 同一个字面量
 *
 * `pre:` 逐字是「调用者在该项目有读权限」，契约 `err` 是
 * `NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE`——注意**没有** `PROJECT_ROLE_INSUFFICIENT`。
 * `read.published` 是四种项目角色（含观察者）唯一共同持有的读动作，所以在这条操作上
 * 「角色不够」确实不可达，全部拒绝折成 `NO_PROJECT_ROLE`，与
 * `application/project/list-agenda-segments.ts` 的处置逐字同型（那份文件头写全了理由，
 * 这里不复述第二遍；两处各自声明各自的常量，不跨束 import）。
 *
 * ## 名字查不到的绑定**不丢行**
 *
 * 判定在 `domain/canvas/segment-binding.ts` 的 `projectSegmentSkillWhitelist`——
 * 绑定表对 `skills` 没有外键（契约的 `bindSkillToSegment.err` 里没有 `SKILL_NOT_FOUND`，
 * 见那份迁移的文件头），所以一条绑定可能指向今天查不到名字的 `skillKey`。
 * 白名单必须恒等于绑定集合：`runSegmentSkill` 判的是绑定（I-32「未绑定即拒绝」），
 * 少一行就会出现「列表里没有、却能跑」的 skill。本文件一条 `if` 都不复述那段判据。
 *
 * ## `lastRunAt` 今天恒为 `null`，而这不是一个假字段
 *
 * 契约要求它存在且可空，写它的操作是 `runSegmentSkill`（需要 context pack + 后台任务
 * 运行时，不在 #1468 范围内）。库里那一列是真的、只是还没有写入方——同
 * `canvas_template_bindings` 当初「建一张空表让计数从第一天起就是真的」的理由
 * （`20260805030000_canvas_template_registry.sql` 文件头）。
 */
import { projectSegmentSkillWhitelist, type SegmentSkillListing } from "../../domain/canvas/segment-binding";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { CanvasError } from "./errors";
import { CanvasSegmentNotFoundError } from "./segment-binding-errors";
import type { CanvasSegmentSkillRepository } from "./segment-skill-ports";
import type { CanvasTemplateRepository } from "./template-ports";

/** 见文件头「权限」——与 `list-agenda-segments.ts` 的 `LIST_AGENDA_SEGMENTS_ACTION` 同一字面量。 */
export const LIST_SEGMENT_SKILLS_ACTION = "read.published" as const;

export interface ListSegmentSkillsDeps {
  readonly auth: AuthorizeDeps;
  /** 只为 `findSegmentWorkshopId` 一条查询而持有，同 `bind-skill-to-segment.ts`。 */
  readonly templates: CanvasTemplateRepository;
  readonly skills: CanvasSegmentSkillRepository;
}

export interface ListSegmentSkillsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly agendaSegmentId: string;
}

export async function listSegmentSkills(
  deps: ListSegmentSkillsDeps,
  input: ListSegmentSkillsInput,
): Promise<{ readonly skills: readonly SegmentSkillListing[] }> {
  const workshopId = await deps.templates.findSegmentWorkshopId(input.orgId, input.agendaSegmentId);
  if (workshopId === null) throw new CanvasSegmentNotFoundError(input.agendaSegmentId);

  const decision = await authorize(deps.auth, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: workshopId,
    object: { kind: "project", id: workshopId },
    action: LIST_SEGMENT_SKILLS_ACTION,
  });
  if (!decision.allowed) throw new CanvasError("NO_PROJECT_ROLE");

  const guarded = await deps.skills.listBindings(input.orgId, input.agendaSegmentId, workshopId);

  // 解封走 `discloseDecided` + 上面那次 `authorize()` 的决定：议程环节没有 `acl_bindings`
  // 行，交给 `disclose()` 会查不到绑定、退回宽松默认 scope（同 `permission-filter` 文件头
  // 对 capability / organization 的论证）。
  const rows = guarded
    .map((row) => discloseDecided(row, decision))
    .filter(isDisclosed)
    .map((row) => row.payload);

  // ⚠ `decision.allowed` 已经是 true，所以上面的 `filter` 在今天不会丢任何一行——
  //   它在这里不是过滤器，是 `Disclosed | Withheld` 的类型收窄（`discloseDecided` 的
  //   签名两种都可能）。真要有一行被扣下，说明决定对象与守卫对象对不上，那是 bug，
  //   不是「这个人看不到这条」——所以不静默补一个空名字，让它少一行并在测试里露出来。
  return { skills: projectSegmentSkillWhitelist(rows) };
}
