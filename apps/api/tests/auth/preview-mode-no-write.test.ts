/**
 * F04 — 视角切换器 `PreviewAsRole`：预览态不写入、留痕（UC-1.4 R4-A1，I-30）。
 *
 * I-30 两条：
 *   ① 预览不得让引导师获得任何超出真实角色的读权（这里真实角色本就是四个里最高的，
 *      条款的实际内容是「预览到的读权是被预览角色的，不是引导师自己的」）；
 *   ② 预览态下**全部写端点**返回 `PROJECT_ROLE_INSUFFICIENT`——不是「按被预览角色的
 *      写权判断」，是**无论谁、无论真实角色多高，处于预览态就一律拒绝写**（见
 *      `authorize-project-write.ts` 头部对这条为什么必须是「categorical」而不是
 *      「按预览角色封顶」的推导）。
 *
 * 本文件同样不导入 `tests/support/db`：`previewAsRole` 只做 `authorize()` + 矩阵查表的
 * 只读投影 + 一次审计写入，用内存 repo/provenance fake 完整可测。
 */
import { describe, expect, it } from "vitest";
import { previewAsRole } from "../../src/application/project/preview-as-role";
import { authorizeProjectWrite } from "../../src/application/identity/authorize-project-write";
import { authorize } from "../../src/application/identity/authorize";
import { ProjectError } from "../../src/application/project/errors";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeProvenanceWriter, FakeRoleViewRepository } from "../support/role-view-fakes";

const ORG = toOrgId("org-f04-preview");
const PROJECT = "proj-f04-preview";
const SCREEN = "project-workbench";

const FACILITATOR = "u-f04pv-facilitator";
const GROUP_LEAD = "u-f04pv-grouplead";

function repo() {
  return new FakeRoleViewRepository({
    [FACILITATOR]: { orgRole: "consultant", projectRole: "facilitator", isHost: true },
    [GROUP_LEAD]: { orgRole: "consultant", projectRole: "groupLead", groupId: "g2" },
  });
}

describe("只有真实 projectRole = facilitator 才能打开切换器", () => {
  it("facilitator 打开切换器成功，返回 previewing:true 与 exitTo", async () => {
    const provenance = new FakeProvenanceWriter();
    const out = await previewAsRole(
      { repo: repo(), ids: new FakeDecisionIds(), provenance },
      { userId: FACILITATOR, orgId: ORG, projectId: PROJECT, screen: SCREEN, asRole: "observer" },
    );
    expect(out.previewing).toBe(true);
    expect(out.exitTo).toContain(PROJECT);
    expect(out.auditEventId).toBeTruthy();
  });

  it("groupLead（非 facilitator）打开切换器被拒 PROJECT_ROLE_INSUFFICIENT", async () => {
    const provenance = new FakeProvenanceWriter();
    await expect(
      previewAsRole(
        { repo: repo(), ids: new FakeDecisionIds(), provenance },
        { userId: GROUP_LEAD, orgId: ORG, projectId: PROJECT, screen: SCREEN, asRole: "observer" },
      ),
    ).rejects.toBeInstanceOf(ProjectError);
    // 被拒时不应该留下一条「预览发生过」的审计——本来就没有预览发生。
    expect(provenance.appended).toEqual([]);
  });
});

describe("① 预览到的读权是被预览角色的，不是引导师自己的", () => {
  it("facilitator 预览 observer：visibleBlocks 与直接以 observer 身份查询到的一致，且远窄于 facilitator 本人的读权", async () => {
    const provenance = new FakeProvenanceWriter();
    const preview = await previewAsRole(
      { repo: repo(), ids: new FakeDecisionIds(), provenance },
      { userId: FACILITATOR, orgId: ORG, projectId: PROJECT, screen: SCREEN, asRole: "observer" },
    );
    expect(preview.visibleBlocks).toEqual(["read.published"]);
    expect(preview.visibleBlocks).not.toContain("read.rawTranscript");
    expect(preview.visibleBlocks).not.toContain("read.privateChat");
  });

  it("预览态下 actionEndpoints 可以非空（被预览角色看得见按钮）——预览 groupLead 时能看到 group.submitOutput", async () => {
    const provenance = new FakeProvenanceWriter();
    const preview = await previewAsRole(
      { repo: repo(), ids: new FakeDecisionIds(), provenance },
      { userId: FACILITATOR, orgId: ORG, projectId: PROJECT, screen: SCREEN, asRole: "groupLead" },
    );
    expect(preview.actionEndpoints).toContain("group.submitOutput");
  });
});

describe("② 预览态下全部写端点返回 PROJECT_ROLE_INSUFFICIENT —— 不看被预览角色，也不看真实角色", () => {
  it("反证前提：facilitator 在非预览态下，写动作本来是被允许的", async () => {
    const d = await authorize(
      { repo: repo(), ids: new FakeDecisionIds() },
      {
        userId: FACILITATOR,
        orgId: ORG,
        projectId: PROJECT,
        object: { kind: "project", id: PROJECT },
        action: "agendaSegment.advance",
      },
    );
    expect(d.allowed).toBe(true);
  });

  it("同一个 facilitator、同一个写动作，`previewing:true` 时被拒——即使真实角色的权限本来足够", async () => {
    const d = await authorizeProjectWrite(
      { repo: repo(), ids: new FakeDecisionIds() },
      {
        userId: FACILITATOR,
        orgId: ORG,
        projectId: PROJECT,
        object: { kind: "project", id: PROJECT },
        action: "agendaSegment.advance",
        previewing: true,
      },
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("PROJECT_ROLE_INSUFFICIENT");
  });

  it("预览态下即使动作是被预览角色自己够格的（groupLead 预览着自己能做的 group.submitOutput），照样被拒", async () => {
    // 这条专门排除「预览态是按被预览角色的写权封顶」的读法：即便挑一个被预览角色本来
    // 就有资格做的写动作，预览态下仍然一律拒绝——见本文件头部与
    // `authorize-project-write.ts` 对「categorical」这个取舍的推导。
    const d = await authorizeProjectWrite(
      { repo: repo(), ids: new FakeDecisionIds() },
      {
        userId: FACILITATOR,
        orgId: ORG,
        projectId: PROJECT,
        object: { kind: "project", id: PROJECT },
        action: "group.submitOutput",
        previewing: true,
      },
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("PROJECT_ROLE_INSUFFICIENT");
  });

  it("`previewing:false` 落回普通 authorize()：不是「一个永远拒绝的桩」", async () => {
    const d = await authorizeProjectWrite(
      { repo: repo(), ids: new FakeDecisionIds() },
      {
        userId: FACILITATOR,
        orgId: ORG,
        projectId: PROJECT,
        object: { kind: "project", id: PROJECT },
        action: "agendaSegment.advance",
        previewing: false,
      },
    );
    expect(d.allowed).toBe(true);
  });

  it("预览态拒绝在调用鉴权仓储之前发生：仓储抛错也不影响这条拒绝（categorical，不依赖判定服务）", async () => {
    const broken = new Proxy(repo(), {
      get(target, prop, recv) {
        if (prop === "findOrgMembership" || prop === "findProjectMembership") {
          return () => Promise.reject(new Error("auth store down"));
        }
        return Reflect.get(target, prop, recv) as unknown;
      },
    });
    const d = await authorizeProjectWrite(
      { repo: broken, ids: new FakeDecisionIds() },
      {
        userId: FACILITATOR,
        orgId: ORG,
        projectId: PROJECT,
        object: { kind: "project", id: PROJECT },
        action: "agendaSegment.advance",
        previewing: true,
      },
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("PROJECT_ROLE_INSUFFICIENT");
  });
});

describe("预览动作本身留痕", () => {
  it("成功预览恰好写入一条审计事件，target 指向本项目", async () => {
    const provenance = new FakeProvenanceWriter();
    await previewAsRole(
      { repo: repo(), ids: new FakeDecisionIds(), provenance },
      { userId: FACILITATOR, orgId: ORG, projectId: PROJECT, screen: SCREEN, asRole: "member" },
    );
    expect(provenance.appended.length).toBe(1);
    expect(provenance.appended[0]!.target).toEqual({ kind: "project", id: PROJECT });
    expect(provenance.appended[0]!.actorId).toBe(FACILITATOR);
  });
});
