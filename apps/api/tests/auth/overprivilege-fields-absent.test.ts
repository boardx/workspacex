/**
 * F04 — 越权数据不出现在接口返回体中（UC-1.4 AC2，I-27）。
 *
 * ⚠ 断言方式与 F07 的 `team-visibility-filter.test.ts` 同一条纪律：对
 * **序列化后的原始文本**做 `not.toContain`，而不是对解析后的数组做 `not.toEqual` ——
 * 一个在浏览器里做过滤的实现在「解析后的数组」这一层看起来完全正确，而受限字段其实已经
 * 在网络上传输过。`expect(JSON.stringify(body)).not.toContain(x)` 才真正说明「键不存在」，
 * 而不是「键存在但恰好被过滤掉了」。
 *
 * `visibleBlocks` / `actionEndpoints` 本身就是白名单数组（不是带 `visible:boolean` 的全集
 * 对象），所以「越权字段不存在」在这里等价于「越权 block/action 的字符串不出现在数组里」，
 * 这正是下面每条测试直接断言的东西。
 */
import { describe, expect, it } from "vitest";
import { renderRoleView } from "../../src/application/project/render-role-view";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeRoleViewRepository } from "../support/role-view-fakes";

const ORG = toOrgId("org-f04-overpriv");
const PROJECT = "proj-f04-overpriv";
const SCREEN = "project-workbench";

/** 越权字段：别组内容、组员私聊、原始转写 —— 逐字取自 issue 的 user_visible_behavior。 */
const RESTRICTED_BLOCKS = ["read.privateChat", "read.rawTranscript"] as const;

const USERS = {
  facilitator: "u-f04op-facilitator",
  groupLead: "u-f04op-grouplead",
  member: "u-f04op-member",
  observer: "u-f04op-observer",
} as const;

const STRANGER = "u-f04op-stranger";

function repo() {
  return new FakeRoleViewRepository({
    [USERS.facilitator]: { orgRole: "consultant", projectRole: "facilitator", isHost: true },
    [USERS.groupLead]: { orgRole: "consultant", projectRole: "groupLead", groupId: "g2" },
    [USERS.member]: { orgRole: "consultant", projectRole: "member", groupId: "g2" },
    [USERS.observer]: { orgRole: "consultant", projectRole: "observer" },
    // In the organization, but never given a project role -- the case V10/NO_PROJECT_ROLE
    // is actually about. A user absent from the org entirely would fail one layer earlier
    // (NO_ORG_MEMBERSHIP), which is a different code and would not exercise this path.
    [STRANGER]: { orgRole: "consultant", projectRole: null },
  });
}

async function bodyFor(role: keyof typeof USERS) {
  const deps = { repo: repo(), ids: new FakeDecisionIds() };
  return renderRoleView(deps, { userId: USERS[role], orgId: ORG, projectId: PROJECT, screen: SCREEN });
}

describe("组长/组员/观察者：越权字段在响应体的原始文本里不存在", () => {
  it.each(["groupLead", "member", "observer"] as const)(
    "%s 的响应文本不包含 read.rawTranscript / read.privateChat",
    async (role) => {
      const text = JSON.stringify(await bodyFor(role));
      for (const restricted of RESTRICTED_BLOCKS) {
        expect(text, `${role} response must not contain "${restricted}"`).not.toContain(restricted);
      }
    },
  );

  it("观察者的 visibleBlocks 恰好是 [read.published]，不多不少", async () => {
    const body = await bodyFor("observer");
    expect(body.visibleBlocks).toEqual(["read.published"]);
  });

  it("组员看不到 read.rawTranscript / read.privateChat，但看得到 read.ownGroup（不是整块被关掉）", async () => {
    const body = await bodyFor("member");
    expect(body.visibleBlocks).toContain("read.ownGroup");
    expect(body.visibleBlocks).not.toContain("read.rawTranscript");
    expect(body.visibleBlocks).not.toContain("read.privateChat");
  });
});

describe("反证：引导师的响应文本**确实**包含这两个字段", () => {
  // 没有这一条，上面四条对「谁都拒绝返回内容」的实现同样全绿——那样测的是
  // 「响应体是不是空的」，不是「越权字段被有针对性地过滤」。
  it("引导师的响应文本包含 read.rawTranscript 与 read.privateChat", async () => {
    const text = JSON.stringify(await bodyFor("facilitator"));
    for (const restricted of RESTRICTED_BLOCKS) {
      expect(text).toContain(restricted);
    }
  });
});

describe("无项目角色：无权限态而非越权数据（V10）", () => {
  it("不在项目里的用户，visibleBlocks / actionEndpoints 均为空，且 reasonCode 是 NO_PROJECT_ROLE", async () => {
    const deps = { repo: repo(), ids: new FakeDecisionIds() };
    const body = await renderRoleView(deps, {
      userId: STRANGER,
      orgId: ORG,
      projectId: PROJECT,
      screen: SCREEN,
    });
    expect(body.visibleBlocks).toEqual([]);
    expect(body.actionEndpoints).toEqual([]);
    expect(body.decision.allowed).toBe(false);
    expect(body.decision.reasonCode).toBe("NO_PROJECT_ROLE");
    // 无权限态：不是「假装是空列表」的越权判断——decision.projectLayer 记录了「有上下文、
    // 无角色」这一事实，而不是把它和「不是项目页」混为一谈（domain I-11）。
    expect(body.decision.projectLayer).not.toBeNull();
    expect(body.decision.projectLayer?.role).toBeNull();
  });
});
