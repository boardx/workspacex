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
  /* groupLead row: "runs their own group" */
  "group.submitOutput",   // 提交本组产出
  "group.confirmNode",    // 确认本组节点
  /* member row: "participates" */
  "content.postNote",     // 贴便签
  "content.speak",        // 发言
  "content.vote",         // 投票
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
    "group.submitOutput", "group.confirmNode",
    "content.postNote", "content.speak", "content.vote",
    "read.ownGroup", "read.allHands", "read.published", "read.rawTranscript", "read.privateChat",
  ],
  // Runs their own group. No room control: they cannot advance the stage for everyone.
  groupLead: [
    "group.submitOutput", "group.confirmNode",
    "content.postNote", "content.speak", "content.vote",
    "read.ownGroup", "read.allHands", "read.published",
  ],
  // Participates. Cannot submit on the group's behalf or confirm its nodes.
  member: [
    "content.postNote", "content.speak", "content.vote",
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
