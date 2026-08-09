/**
 * #660 —— `checkToollessSelfPublish` 的三道门。**⚠⚠ 草案边**（`KNOWN_CONTRACT_GAPS.AR11`）。
 *
 * ## 这份文件真正要钉死的一件事
 *
 * 不是"无工具 agent 能发布"（那条已经由 `create-agent-publish-path.test.ts` 在真实
 * HTTP 栈上端到端证明了）。这里钉的是**反面**：这条例外边**不能**成为 I-28 / O-21
 * 的绕过路径。一个只测了 happy path 的门 = 没有门。
 *
 * ## ⚠ 与 `whitelist-required-to-publish.test.ts` 的关系
 *
 * 那份文件断言的是「白名单为空 ⇒ **不能**发布」（I-28），本文件断言的是
 * 「白名单为空 ⇒ **可以**走自助发布这条另设的边」。两句话不矛盾，因为它们说的是
 * **两条不同的边**——但它们看起来矛盾，所以这段话必须写在这里：读到其中任何一份
 * 的人都该知道另一份存在。⚠ 若人类裁定不接受 AR11，**先删本文件与那条边**，
 * `whitelist-required-to-publish.test.ts` 一个字都不用动——那才是签核过的事实。
 */
import { describe, expect, it } from "vitest";
import { checkToollessSelfPublish } from "../../../src/domain/agent/self-publish";
import type { SelfPublishCandidate } from "../../../src/domain/agent/self-publish";

function candidate(over: Partial<SelfPublishCandidate> = {}): SelfPublishCandidate {
  return {
    publishState: "草稿",
    toolWhitelist: [],
    skillMounts: [],
    visibility: "全组织可用",
    ...over,
  };
}

describe("#660 自助发布：放行条件", () => {
  it("草稿 + 零工具 + 零 skill + 全组织可用 ⇒ 运行中", () => {
    expect(checkToollessSelfPublish(candidate())).toEqual({ ok: true, publishState: "运行中" });
  });
});

describe("#660 自助发布：它不得成为 I-28 的绕过路径", () => {
  it("有工具白名单条目 ⇒ AGENT_NOT_TOOLLESS（必须走双人评审）", () => {
    const result = checkToollessSelfPublish(
      candidate({
        toolWhitelist: [{ toolFullName: "fs.read", state: "在授权范围内", elevationDecision: null }],
      }),
    );
    expect(result).toEqual({ ok: false, reason: "AGENT_NOT_TOOLLESS" });
  });

  it("⚠ 越权申请待确认的条目同样算「有能力面」——不是「还没生效所以不算」", () => {
    /* 一个 `越权申请待确认` 的条目若被当成"空"，等于让一个正在申请越权的 agent
     * 从自助发布这条边溜出去，而 `decideAgentPublish` 的 `ELEVATION_UNDECIDED`
     * 那道门根本没机会跑。 */
    const result = checkToollessSelfPublish(
      candidate({
        toolWhitelist: [
          { toolFullName: "mail.send", state: "越权申请待确认", elevationDecision: null },
        ],
      }),
    );
    expect(result).toEqual({ ok: false, reason: "AGENT_NOT_TOOLLESS" });
  });

  it("有 skill 挂载 ⇒ AGENT_NOT_TOOLLESS（工具为空不够，两者都得空）", () => {
    const result = checkToollessSelfPublish(
      candidate({ skillMounts: [{ skillId: "sk-1", skillVersion: 1 }] }),
    );
    expect(result).toEqual({ ok: false, reason: "AGENT_NOT_TOOLLESS" });
  });
});

describe("#660 自助发布：它只是 草稿 → 运行中 的一条边", () => {
  it("待审核 ⇒ AGENT_NOT_DRAFT——已在评审路径上的 agent 不得抄近道绕过 decideAgentPublish", () => {
    expect(checkToollessSelfPublish(candidate({ publishState: "待审核" }))).toEqual({
      ok: false,
      reason: "AGENT_NOT_DRAFT",
    });
  });

  it("已停用 ⇒ AGENT_NOT_DRAFT——自助发布不是复活路径（已停用是终态，O-22④）", () => {
    expect(checkToollessSelfPublish(candidate({ publishState: "已停用" }))).toEqual({
      ok: false,
      reason: "AGENT_NOT_DRAFT",
    });
  });

  it("运行中 ⇒ AGENT_NOT_DRAFT——重复发布不是幂等成功", () => {
    expect(checkToollessSelfPublish(candidate({ publishState: "运行中" }))).toEqual({
      ok: false,
      reason: "AGENT_NOT_DRAFT",
    });
  });

  it("状态先于能力面回答：待审核 + 有工具 ⇒ AGENT_NOT_DRAFT，不是 AGENT_NOT_TOOLLESS", () => {
    /* 顺序不是审美：先答 `AGENT_NOT_TOOLLESS` 等于告诉调用方"把工具清掉就能用这条边"，
     * 而那对一个已在评审路径上的 agent 恰恰是不该成立的建议。 */
    const result = checkToollessSelfPublish(
      candidate({
        publishState: "待审核",
        toolWhitelist: [{ toolFullName: "fs.read", state: "在授权范围内", elevationDecision: null }],
      }),
    );
    expect(result).toEqual({ ok: false, reason: "AGENT_NOT_DRAFT" });
  });
});

describe("#660 自助发布：仅某组无法诚实登记 ⇒ 明确拒绝，不退化成全组织", () => {
  it("仅某组 ⇒ AGENT_VISIBILITY_UNSUPPORTED", () => {
    expect(checkToollessSelfPublish(candidate({ visibility: "仅某组" }))).toEqual({
      ok: false,
      reason: "AGENT_VISIBILITY_UNSUPPORTED",
    });
  });
});
