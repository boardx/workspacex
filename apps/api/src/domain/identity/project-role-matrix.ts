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
  "content.renameFile",   // 改文件名（改名走契约，见 N-23）
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
    "agendaSegment.bindTemplate",
    "group.submitOutput", "group.confirmNode",
    "content.postNote", "content.speak", "content.vote", "content.renameFile", "member.manage",
    "artifact.requestDeletion", "artifact.complianceOps",
    "read.ownGroup", "read.allHands", "read.published", "read.rawTranscript", "read.privateChat",
  ],
  // Runs their own group. No room control: they cannot advance the stage for everyone.
  groupLead: [
    "group.submitOutput", "group.confirmNode",
    "content.postNote", "content.speak", "content.vote", "content.renameFile",
    "read.ownGroup", "read.allHands", "read.published",
  ],
  // Participates. Cannot submit on the group's behalf or confirm its nodes.
  member: [
    "content.postNote", "content.speak", "content.vote", "content.renameFile",
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
