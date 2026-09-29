/**
 * What each project role may do. Single source for the four-role permission matrix
 * (UC-0.3 R5, acceptance V4).
 *
 * ## Why this lives in the domain and not (yet) in `@repo/contracts`
 *
 * The frontend will eventually need it, to render affordances per role. When that day
 * comes the correct move is to MOVE it into `packages/contracts` -- never to copy it.
 * A second copy on the frontend is precisely how "the same fact in two places" starts, and
 * a permission matrix drifting between UI and server does not fail loudly: the UI simply
 * offers a button the server rejects, or hides one the server would have allowed.
 * `no-frontend-copy` in the F01 tests guards that.
 *
 * It is not in the contract today because the API contract types `action` as an open
 * string, and tightening that to a closed enum would amend a bundle that has already been
 * signed. Widening the contract is a sign-off decision, not an implementation one.
 */
import type { project } from "@repo/contracts";
import type { z } from "zod";
import type { ProjectRole } from "./roles";

/**
 * The action vocabulary, transcribed from UC-0.3 R5. Each entry cites the row it came from,
 * so a future reader can check the transcription rather than trust it.
 */
export const PROJECT_ACTIONS = [
  /* facilitator row: "controls the room" */
  "agendaSegment.advance",        // 推进环节
  "agendaSegment.broadcast",      // 广播
  "agendaSegment.timer",          // 计时
  "agendaSegment.group",          // 分组
  "agendaSegment.bulkConfirm",    // 批量确认
  /**
   * #493 (canvas 束 · uc-7-2 `bindTemplateToSegment`)：把一个画布模板绑到某个议程环节。
   * ⚠ `usecases.md` 的 `pre:` 逐字只有「引导师」一个角色，所以这一条**只**进 facilitator
   *   行——与同一束的 `bindSkillToSegment` 注明的「组员不可自行加挂（uc-7-4 R7）」同一条
   *   判据。它属于 `agendaSegment.*` 而不是 `content.*`：绑定改的是**环节的编排**，
   *   与「贴便签」那一类现场参与不是同一件事，把它归进 content.* 就等于让组员也能改编排。
   * ⚠ 归本矩阵、不另起一个 canvas 专用谓词：模板注册表的写操作（publish/archive…）判的是
   *   org admin（`canMutateCapabilities`），而**用**一个模板判的是项目里的引导师——两件事
   *   两个判据，但都必须落在已有的单一事实源上，不是第三份角色表。
   */
  "agendaSegment.bindTemplate",   // 绑定画布模板到环节（#493）
  /**
   * #1468 (canvas 束 · uc-7-4 R7 `bindSkillToSegment`)：把一个 skill 挂到某个议程环节。
   * ⚠ 与上面那条同组、同一行，理由也逐字相同——`usecases.md` 的 `pre:` 写的是
   *   「引导师（**组员不可自行加挂**，uc-7-4 R7）」，括号里那半句是这条动作**唯一**
   *   被逐字写下来的否定面，所以它只进 facilitator 行。绑定改的是环节的编排，
   *   不是现场参与，因此归 `agendaSegment.*` 而不是 `content.*`。
   * ⚠ 这是**转录，不是类推**（对照下面 `agendaSegment.create` 那条注释的处境）：
   *   UC 表格里有这一行，不需要延伸任何惯例。
   */
  "agendaSegment.bindSkill",      // 绑定 skill 到环节（#1468）
  /**
   * #627（`createAgendaSegment`，`usecases.md` UC-P6）：⚠ **这条不是转录，是类推**——
   * 与本文件其余条目不同，UC-P6 的表格**没有「权限」行**（对照 UC-P7 有），signed-off
   * 的用例文本对「谁能新建环节」本身沉默。没有行可转录时，本文件已有先例是延伸一个
   * 已有惯例而不是发明一条新裁决（见下面 `content.renameFile` 那条注释——"不是对
   * 『谁能』的裁决，是既有惯例的延伸"）。这里延伸的是同一个 `agendaSegment.*` 分组
   * 已经确立的逻辑：`bindTemplate` 那条注释说"绑定改的是环节的编排"——新建一条环节
   * 本身比"绑定到已有环节"更直接地属于编排,没有理由比它更宽松。⇒ 归 facilitator，
   * 与该分组其余动作同一行。**这是实现者的类推,不是人类的裁决**——UC-P6 权限行的
   * 空白本身仍然存在,如果人类核对后认为应该更宽（比如 groupLead 也能建）,这一行
   * 需要改,而不是把类推误读成已经问过。
   */
  "agendaSegment.create",
  /* groupLead row: "runs their own group" */
  "group.submitOutput",   // 提交本组产出
  "group.confirmNode",    // 确认本组节点
  /* member row: "participates" */
  "content.postNote",     // 贴便签
  "content.speak",        // 发言
  "content.vote",         // 投票
  /**
   * F34 (files 束 · uc-22-1 `renameArtifact`): 「调用者有写权限」的具体形状。
   * ⚠ 没有一份已签核的 UC 把「谁能改文件名」钉到某个角色——`usecases.md` 只写
   * 「pre: 调用者有写权限」。这里按现有 content.* 三项的先例（facilitator/groupLead/member
   * 皆可写，observer 皆不可写）取同样的分组，**不是**对「谁能上传/改名」的裁决，
   * 是「非 observer 即可写」这个已有惯例的延伸。F35（uploadArtifact）落地时如果需要
   * 更细的角色区分，应在这里改，而不是另建一个不经过本矩阵的判定。
   */
  "content.indexFile",    // Rebuild derived search index; follows the same existing file-write roles.
  "content.renameFile",   // 改文件名（改名走契约，见 N-23）
  /**
   * #4615（PROP-PROJECT-WORKSPACE-001 §3.2，2026-09-29 人类裁决 ④「项目成员自动可编辑挂在项目上的白板」）：
   * 挂在项目上的白板，项目层给出的**编辑**来源。与白板自己的成员表取并集（`domain/whiteboard/access-decision.ts`
   * 的 `projectWhiteboardRole` / `unionWhiteboardRole`），不是替代它。
   * ⚠ 为什么不复用 `content.postNote`：那一条是工作坊**现场参与**（贴便签），刻意不进非工作坊白名单；
   *   把它放开会顺带打开现场画布那一族端点。白板编辑是通用项目的内容写，单独一个动作词、单独一行白名单。
   * 分组按 content.* 既有惯例：facilitator / groupLead / member 可写，observer 不可写（旁观者只读，
   * 读用 `read.published`）。
   */
  "content.editWhiteboard",
  /**
   * F45（files 束 · uc-22-4 `previewDeleteImpact`/`requestDeletion`）：「调用者是项目负责人」
   * 的具体形状。⚠ usecases.md 的 `pre` 写的是「项目负责人」，四值角色枚举里没有这个名字——
   * 按本文件 `facilitator` row 既有的定性（「controls the room」，本文件头一行）取
   * facilitator = 项目负责人，这是延伸既有惯例，**不是**对 R10「引导师/组长能否发起删除
   * [待定]」的裁决。groupLead 今天**没有**这个动作，是保守默认（与 UI 版本列表「只给下载不给
   * 删除此版本」同一处置，`files.KNOWN_CONTRACT_GAPS.FS5` 的姊妹判断），裁决落地时若反向，
   * 应在这里改，而不是另建一条不经过本矩阵的判定。
   */
  "artifact.requestDeletion", // 发起删除 / 预览删除影响面（F45）
  /**
   * F46（files 束 · uc-22-4 `listTrashQueue`/`retryCascade`/`revokeDeletion`/
   * `applyLegalHold`/`releaseLegalHold`）：「调用者是合规负责人」的具体形状。
   * ⚠ `usecases.md` 五个操作的 `pre` 都写着「合规负责人」，四值项目角色枚举里没有这个
   * 名字，且它与 `identity.OrgRole` 里的 `compliance`（组织角色）不是同一层——
   * 见 `files.KNOWN_CONTRACT_GAPS.FS9`（本文件不发明第五个项目角色）。这里按
   * `artifact.requestDeletion` 已经取的先例（facilitator = 项目负责人 = 本文件头一行
   * 「controls the room」的定性）做**同一处延伸**，不是对 FS9 的裁决：facilitator 是
   * 今天唯一在四值枚举里、语义上离"对项目内容负最终责任"最近的角色，且待删除队列本来
   * 就要求"发起删除"与"处置删除任务"是同一批人能看到的两个视角（一个人申请了删除、
   * 另一个人才能管理这个队列，在没有第五个角色的世界里无法同时成立而不产生死锁）。
   * FS9 裁决落地（若引入第五个项目角色）时，应把这个动作从 facilitator 移到新角色，
   * 而不是另建一条不经过本矩阵的判定。
   */
  "artifact.complianceOps", // 待删除队列 / legal hold 施加解除 / 重试级联 / 撤销删除（F46）
  /**
   * F125（project 束 · UC-P9 `addProjectMember`/`changeProjectRole`/`removeProjectMember`）：
   * 「谁能加人/改角色/移除人」的项目层那一半。UC-00.3 R1 把「引导师」列为本用例的 actor
   * 之一（「控场者」），且 R3 步骤 1 的措辞是「授予者操作」——没有一份已签核的 UC 把这个
   * 动作词写进 R5 的表，这里按 facilitator「控场」的既有定性（本文件头「facilitator row:
   * controls the room」）延伸，同 `content.renameFile` 那条注释同型的判断，不是裁决。
   * ⚠ 只属 facilitator：groupLead/member/observer 管不了别人的项目成员身份，
   *   这与 Q-4②「组织角色 `lead` 对自建未加入的项目持管理权」并不冲突——
   *   lead 的那条路径**不经过本矩阵**，见 `application/project/member-authorization.ts`
   *   的「两层 OR」判定：这里只回答项目层内谁能做，组织层的旁路在那个文件里单独判。
   */
  "member.manage",        // 加人 / 改角色 / 移除人（F125）
  /**
   * #4584：项目配置（今天只有 AI 权限 `updateProjectAiSettings`）的项目层那一半。
   * ⚠ 此前 AI 权限的写门直接复用 `member.manage`（「本项目引导师或组织 lead/admin」，
   *   B2-S5 #4429）。拆出这一条的唯一理由是研究项目 / 用户洞察两类容器：它们的负责人要能
   *   改 AI 权限，却**不能**管工作坊四角色名单（那张表对这两类容器在数据库层就写不进去，
   *   F128 复合外键；两类容器的名单走 T5 `/collaborators` 自己的判据）。两件事共用一个动作词，
   *   就只能在用例里按 kind 分叉——正是 #4584 要避免的。
   * ⚠ 对工作坊**零行为变化**：只进 facilitator 行，与 `member.manage` 同一行同一处延伸。
   */
  "settings.manage",      // 改项目配置（AI 权限，#4584）
  /* read surfaces, split by what each role may see */
  "read.ownGroup",        // 本组内容
  "read.allHands",        // 全场已共享
  "read.published",       // 已发布且已脱敏
  "read.rawTranscript",   // 原始转写（观察者禁止，单独授权除外）
  "read.privateChat",     // 私聊（观察者禁止）
] as const;

export type ProjectAction = (typeof PROJECT_ACTIONS)[number];

/**
 * The matrix itself.
 *
 * Note what the observer row is NOT: it is not "everything minus writes". Observers are
 * explicitly barred from raw transcripts and private chat even though those are reads --
 * "read-only" and "may read everything" are different claims, and conflating them is how a
 * read-only role ends up with the most sensitive material in the room.
 */
export const PROJECT_ROLE_MATRIX: Readonly<Record<ProjectRole, readonly ProjectAction[]>> = {
  // Controls the room; sees everything in it. Multiple instances allowed (O-03).
  facilitator: [
    "agendaSegment.advance", "agendaSegment.broadcast", "agendaSegment.timer", "agendaSegment.group", "agendaSegment.bulkConfirm",
    "agendaSegment.bindTemplate", "agendaSegment.bindSkill", "agendaSegment.create",
    "group.submitOutput", "group.confirmNode",
    "content.postNote", "content.speak", "content.vote", "content.renameFile", "content.indexFile", "content.editWhiteboard", "member.manage",
    "settings.manage",
    "artifact.requestDeletion", "artifact.complianceOps",
    "read.ownGroup", "read.allHands", "read.published", "read.rawTranscript", "read.privateChat",
  ],
  // Runs their own group. No room control: they cannot advance the stage for everyone.
  groupLead: [
    "group.submitOutput", "group.confirmNode",
    "content.postNote", "content.speak", "content.vote", "content.renameFile", "content.indexFile", "content.editWhiteboard",
    "read.ownGroup", "read.allHands", "read.published",
  ],
  // Participates. Cannot submit on the group's behalf or confirm its nodes.
  member: [
    "content.postNote", "content.speak", "content.vote", "content.renameFile", "content.indexFile", "content.editWhiteboard",
    "read.ownGroup", "read.allHands", "read.published",
  ],
  // Read-only, and narrower than "read": no raw transcript, no private chat, no own-group
  // internals -- only what has been published and redacted.
  observer: ["read.published"],
} as const;

/** Actions that write. Used to assert the observer row never gains one. */
export const WRITE_ACTIONS: readonly ProjectAction[] = PROJECT_ACTIONS.filter(
  (a) => !a.startsWith("read."),
);

export function roleAllows(role: ProjectRole, action: string): boolean {
  return (PROJECT_ROLE_MATRIX[role] as readonly string[]).includes(action);
}

/** Is this a known action? An unknown action must be DENIED, never waved through. */
export function isKnownAction(action: string): action is ProjectAction {
  return (PROJECT_ACTIONS as readonly string[]).includes(action);
}

/* ───────────────────── #4584：非工作坊容器能用到矩阵里的哪一部分 ───────────────────── */

export type ContainerKind = z.infer<typeof project.ProjectKind>;

/**
 * 非工作坊容器（#4615 起只有 `general`）里，项目层**可能**放行的动作——白名单，唯一一份。
 *
 * 非工作坊容器的身份（负责人 / 协作者两档，`general_project_members`）
 * 由 `application/identity/project-layer.ts` 映射到四角色矩阵的某一行（映射表在
 * `domain/project/non-workshop-member-access.ts`），然后**再与本白名单取交集**：
 * 映射只借用「这一档读写到什么深度」，不借用工作坊的现场机制。
 *
 * 不在单子上的（因此对两类容器恒 PROJECT_ROLE_INSUFFICIENT）：
 *   · `agendaSegment.*` —— 议程 / 环节 / 计时 / 广播 / 绑定，工作坊现场编排；
 *   · `group.*`、`read.ownGroup` —— 两类容器没有分组；
 *   · `content.postNote` / `content.speak` / `content.vote` —— 现场参与（贴便签 / 发言 / 投票）；
 *   · `member.manage` —— 工作坊四角色名单（两类容器的名单由 T5 `decideNonWorkshopMemberAccess` 判）。
 *
 * ⚠ 白名单而不是黑名单：以后矩阵里新增一个动作，默认对两类容器**关着**，要开得有人来这里写一行。
 */
export const NON_WORKSHOP_CONTAINER_ACTIONS: readonly ProjectAction[] = [
  "content.renameFile", "content.indexFile",
  // #4615：通用项目里挂载的白板，负责人 / 协作者可编辑（人类裁决 ④）。
  "content.editWhiteboard",
  "settings.manage",
  "artifact.requestDeletion", "artifact.complianceOps",
  "read.allHands", "read.published", "read.rawTranscript", "read.privateChat",
];

/** 该容器种类下，这个动作是否在项目层的考虑范围之内（工作坊：矩阵全集）。 */
export function containerAllows(kind: ContainerKind, action: string): boolean {
  if (kind === "workshop") return true;
  return (NON_WORKSHOP_CONTAINER_ACTIONS as readonly string[]).includes(action);
}
