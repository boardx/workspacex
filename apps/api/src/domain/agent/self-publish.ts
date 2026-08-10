/**
 * #660 —— 「无能力面自助发布」的判定。**⚠⚠ 草案边，尚未经人类签核**
 * （契约 `selfPublishToollessAgent` 头注 / `KNOWN_CONTRACT_GAPS.AR11`）。
 *
 * ## 为什么它是独立文件，而不是 `publish-review.ts` 里多一个分支
 *
 * `publish-review.ts` 是**已签核**的双人评审路径（I-28 + O-21）。在它里面加一个
 * "如果没工具就直接放行"的分支，会让那两道门读起来像是"有条件的"——而它们不是：
 * 有能力面的 agent 仍然只有双人路径一条路。两个文件分开，是为了让
 * 「签核过的门」与「等待签核的例外」在代码里也分得开，删掉后者不会碰到前者。
 *
 * ## ⚠ 「空」这件事只有一个事实源
 *
 * 工具白名单是否为空，判据是 `lifecycle.ts` 的 `checkWhitelistConfigured`（I-28 的
 * 唯一实现）。本文件**调用它并取反**，而不是自己写 `toolWhitelist.length === 0`——
 * 后者就是本仓已经踩过五次的「同一事实声明在两处」：将来 I-28 若被裁定为
 * 「白名单非空 **或** 已显式声明无需工具」，这里会与那边悄悄分叉，
 * 而分叉的方向恰好是**放行**。
 *
 * ## 三道门的顺序
 *
 * `AGENT_NOT_DRAFT` 先于 `AGENT_NOT_TOOLLESS`：一个已在 `待审核` 的 agent，
 * 无论有没有能力面，都已经踏上评审路径，回答"你没工具所以可以自助发布"会把
 * 一条绕过 `decideAgentPublish` 的近道说成可行的。状态先答，能力面后答。
 */
import type { AgentDefinition } from "./definition";
import { checkWhitelistConfigured } from "./lifecycle";

export type SelfPublishGateResult =
  | { readonly ok: true; readonly publishState: "运行中" }
  | {
      readonly ok: false;
      readonly reason:
        | "AGENT_NOT_DRAFT"
        | "AGENT_NOT_TOOLLESS"
        | "AGENT_VISIBILITY_UNSUPPORTED"
        | "AGENT_NO_EXECUTABLE_DEFINITION";
    };

/** 自助发布只看 agent 自身的这五个字段——它刻意不接收任何"谁在调用"的信息。 */
export type SelfPublishCandidate = Pick<
  AgentDefinition,
  "publishState" | "toolWhitelist" | "skillMounts" | "visibility"
> & {
  /**
   * #660 候选 A —— 用户自己写的可执行定义（`agents.instructions`）。
   * `null` = 从没配过。⚠ 全空白字符串与 `null` 在这里**同等对待**：
   * 「配了个空的」和「没配」对运行时是同一件事（拼不出有意义的系统提示词），
   * 而把两者分开会诱导出一个"配了空串就算配过"的绕过口。
   */
  readonly instructions: string | null;
};

/**
 * `草稿 → 运行中`，当且仅当这个 agent **没有任何可被评审的能力面**。
 *
 * ⚠ 授权（调用者是不是本组织 admin）**不在这里**：那是 `create-agent.ts` 同一条纪律
 * 的授权门，属于用例层，先于本函数执行。本函数只回答"这个 **agent** 够不够格走
 * 这条边"，与"**谁**在按"正交——两者混在一起，就没法单测其中任何一半。
 */
export function checkToollessSelfPublish(
  agent: SelfPublishCandidate,
): SelfPublishGateResult {
  // ① 状态：起点只能是 `草稿`。
  //    ⚠ 诚实标注：`草稿 → 运行中` **不在** `PUBLISH_STATE_TRANSITIONS` 里
  //    （`草稿` 的合法出边只有 `待审核`）。本函数**新增**了一条状态机里没有的边，
  //    这正是它必须经人类签核的原因（AR11）。这里刻意**不**去改那张表、也不去
  //    调 `canTransition` 假装表里有这条边——那会让一条未签核的边伪装成既有事实。
  //    表被改动的那一天，应该是人类签核之后。
  //    这一条同时挡住 `待审核`（已在评审路径上）与 `已停用`（终态，自助发布不是复活路径）。
  if (agent.publishState !== "草稿") return { ok: false, reason: "AGENT_NOT_DRAFT" };

  // ② 能力面：工具白名单为空（I-28 的事实源取反）**且**没有 skill 挂载。
  //    两者是 AND：只挡住其中一半，另一半就是评审绕过路径。
  const whitelist = checkWhitelistConfigured(agent);
  const hasTools = whitelist.ok; // ok === 白名单**非空**
  if (hasTools || agent.skillMounts.length > 0) {
    return { ok: false, reason: "AGENT_NOT_TOOLLESS" };
  }

  // ③ 可见性：`仅某组` 没有"哪个组"的出处（`createAgent.in` 不收 team），
  //    `capability_listings` 又拒绝无 team 的 `team-only` 行。明确拒绝，
  //    **不**退化成 `org-wide`——那是把受限 agent 悄悄开放给全组织。
  if (agent.visibility !== "全组织可用") {
    return { ok: false, reason: "AGENT_VISIBILITY_UNSUPPORTED" };
  }

  // ④ 可执行定义：没有它就铸不出 `agent_versions` 行（那一列 NOT NULL），
  //    发布出去也是一个发消息照样 422 的"已发布"——比拒绝更糟。
  //    ⚠ 这里**不**用 `role`/`name` 兜底拼一段出来：`role` 是角色标签不是系统提示词，
  //      运行时会真的照着执行。`design-deltas/agent-instructions/design-signoff.md`
  //      逐字禁止过这条捷径（人类 2026-08-09 裁决），候选 A 给的是"加一个真字段"，
  //      不是"用现有字段凑合"。
  if ((agent.instructions ?? "").trim() === "") {
    return { ok: false, reason: "AGENT_NO_EXECUTABLE_DEFINITION" };
  }

  return { ok: true, publishState: "运行中" };
}
