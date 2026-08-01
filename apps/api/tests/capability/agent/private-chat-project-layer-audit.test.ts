/**
 * F59 / 已裁决 O-24 / V13 / V15 / V16 -- 私聊正文归项目层可审计；组员开关逐场不继承；
 * 发起私聊不改变线程编制。
 *
 * `user_visible_behavior`: 「私聊正文归项目层，组织管理员可读但每次访问写审计且对项目负责人
 * 可见……组员默认无私聊入口，由引导师逐场开关（不跨场继承）；发起私聊前后线程 agent 在场
 * 名单与计数不变」。
 */
import { describe, expect, it } from "vitest";
import {
  recordAdminPrivateChatRead,
  startPrivateChatSession,
  assertRosterUnchanged,
  defaultMemberToggleForNewSession,
  setMemberToggleForThread,
  type AgentPresenceT,
} from "../../../src/domain/agent/private-chat";

describe("F59 V13 / O-04 -- 管理员读私聊正文成功且每次访问写审计，对项目负责人可见", () => {
  it("管理员读取成功并产生一条 admin-project-access 审计事件（不是被拒绝或静默不留痕）", () => {
    const audit = recordAdminPrivateChatRead({
      adminId: "admin-1",
      sessionId: "pc-session-1",
      projectId: "prj-9",
      projectOwnerId: "owner-7",
      at: "2026-08-02T09:00:00Z",
      adminHoldsProjectRole: false,
    });
    expect(audit.type).toBe("admin-project-access");
    expect(audit.actorId).toBe("admin-1");
    expect(audit.target).toEqual({ kind: "thread", id: "pc-session-1" });
    expect(audit.detail.visibleToProjectOwner).toBe("owner-7");
  });

  it("反向断言：管理员是否持有该项目角色不影响审计结果（O-04 逐字「不区分」）", () => {
    const withRole = recordAdminPrivateChatRead({
      adminId: "admin-1",
      sessionId: "pc-session-1",
      projectId: "prj-9",
      projectOwnerId: "owner-7",
      at: "2026-08-02T09:00:00Z",
      adminHoldsProjectRole: true,
    });
    const withoutRole = recordAdminPrivateChatRead({
      adminId: "admin-1",
      sessionId: "pc-session-1",
      projectId: "prj-9",
      projectOwnerId: "owner-7",
      at: "2026-08-02T09:00:00Z",
      adminHoldsProjectRole: false,
    });
    expect(withRole).toEqual(withoutRole);
  });

  it("每一次独立访问都各自产生一条事件，不去重成一条（「每次访问写审计」是字面意思）", () => {
    const firstRead = recordAdminPrivateChatRead({
      adminId: "admin-1",
      sessionId: "pc-session-1",
      projectId: "prj-9",
      projectOwnerId: "owner-7",
      at: "2026-08-02T09:00:00Z",
      adminHoldsProjectRole: false,
    });
    const secondRead = recordAdminPrivateChatRead({
      adminId: "admin-1",
      sessionId: "pc-session-1",
      projectId: "prj-9",
      projectOwnerId: "owner-7",
      at: "2026-08-02T09:05:00Z",
      adminHoldsProjectRole: false,
    });
    expect(firstRead.at).not.toBe(secondRead.at);
    expect(firstRead).not.toBe(secondRead);
  });
});

describe("F59 V15 / O-24 -- 组员私聊开关逐场生效，不跨场继承", () => {
  it("新场景恒从「关」开始 -- 函数不接受上一场的值作为输入", () => {
    expect(defaultMemberToggleForNewSession()).toBe(false);
  });

  it("反向断言：即使上一个线程把开关设为 true，一个全新线程在被显式打开前仍然是默认关闭", () => {
    const previousThread = setMemberToggleForThread({
      threadId: "thread-old",
      enabled: true,
      setBy: "facilitator-1",
      setAt: "2026-08-01T00:00:00Z",
    });
    expect(previousThread.enabled).toBe(true);

    // 新场景与旧场景是不同的 threadId；default 函数完全不引用 previousThread。
    const newSessionDefault = defaultMemberToggleForNewSession();
    expect(newSessionDefault).toBe(false);
  });

  it("引导师在本场显式打开后，本场（且仅本场）的开关状态才是 true", () => {
    const thisThread = setMemberToggleForThread({
      threadId: "thread-new",
      enabled: true,
      setBy: "facilitator-2",
      setAt: "2026-08-02T08:00:00Z",
    });
    expect(thisThread.enabled).toBe(true);
    expect(thisThread.threadId).toBe("thread-new");
  });
});

describe("F59 V16 -- 发起私聊前后，线程的 agent 在场名单与计数不变", () => {
  const rosterBefore: readonly AgentPresenceT[] = [
    { agentId: "agt-ava", name: "Ava", presence: "在场", agentVersionId: "agt-ava-v3" },
    { agentId: "agt-scout", name: "Scout", presence: "跑批中", agentVersionId: "agt-scout-v1" },
  ];

  it("startPrivateChatSession 的返回值里没有 roster 字段 -- 结构上就摸不到编制", () => {
    const session = startPrivateChatSession({
      sessionId: "pc-session-1",
      threadId: "thread-1",
      projectId: "prj-9",
      agentId: "agt-ava",
      agentVersionId: "agt-ava-v3",
      initiatorId: "user-1",
      initiatorRole: "facilitator",
      createdAt: "2026-08-02T08:00:00Z",
    });
    expect(session).not.toHaveProperty("roster");
    expect(Object.keys(session).sort()).toEqual(
      [
        "agentId",
        "agentVersionId",
        "createdAt",
        "initiatorId",
        "initiatorRole",
        "projectId",
        "sessionId",
        "threadId",
      ].sort(),
    );
  });

  it("同一份 roster 快照在发起私聊前后逐项相同 ⇒ 断言通过", () => {
    const rosterAfter = rosterBefore.map((r) => ({ ...r }));
    expect(assertRosterUnchanged(rosterBefore, rosterAfter)).toBe(true);
  });

  it("反向断言：数量不变但内容变了（presence 被悄悄改掉）⇒ 断言必须失败", () => {
    const rosterAfter: AgentPresenceT[] = [
      { agentId: "agt-ava", name: "Ava", presence: "静音", agentVersionId: "agt-ava-v3" },
      rosterBefore[1]!,
    ];
    expect(assertRosterUnchanged(rosterBefore, rosterAfter)).toBe(false);
  });

  it("反向断言：多出一个条目（编制数被悄悄改变）⇒ 断言必须失败", () => {
    const rosterAfter: AgentPresenceT[] = [
      ...rosterBefore,
      { agentId: "agt-echo", name: "Echo", presence: "在场", agentVersionId: "agt-echo-v1" },
    ];
    expect(assertRosterUnchanged(rosterBefore, rosterAfter)).toBe(false);
  });
});
