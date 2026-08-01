/**
 * F126 —— UC-00.3 R5 两层交叉的第 ④ 格：组织 `lead` 对**自建但未加入**的项目
 * 持管理权、不持内容读取权（Q-4② 裁）。
 *
 * ## 为什么这是「组装」而不是一处新判断
 *
 * 第 ④ 格不是一条新规则，是三条已经各自存在的规则第一次被摆在同一个 actor 身上：
 *
 *   · 管理成员 —— F125 `authorizeManageMembers` 的路径②（本文件只是把它摆进
 *     「这个人没有一行 `project_memberships`」这个具体场景里断言，不重复其内部判据）。
 *   · 管理生命周期（归档/解归档）—— F124 `archiveProject`/`unarchiveProject` 复用
 *     `canCreateProject`，只查组织角色，从未查过项目成员。
 *   · 内容读取被拒 —— phase-00 F03 `readContent`/`decideContentRead`：无项目角色时
 *     一律 `NO_PROJECT_ROLE`，这是**正常状态**（domain I-11），且明确按项目层报告，
 *     不是「你不是这个组织的人」（`NO_ORG_MEMBERSHIP`）。
 *
 * 反证方式：三个断言用**同一个** actor（`u-f126-lead`，组织角色 `lead`，
 * 在 `FakeContentRepository`/`FakeProjectMembershipRepository` 里都没有一行项目成员记录）
 * 分别打三个不同的用例，而不是分别为「能管理」「不能读」造两个不同的人 ——
 * 只有同一个人在三处都被断言到，才证明的是「第 ④ 格」而不是「巧合地都对」。
 */
import { describe, expect, it } from "vitest";
import { authorizeManageMembers } from "../../src/application/project/member-authorization";
import { archiveProject } from "../../src/application/project/archive-project";
import { unarchiveProject } from "../../src/application/project/unarchive-project";
import { readContent, ContentDeniedError } from "../../src/application/identity/read-content";
import type { ArchiveOutcome, ProjectArchiveRepository, UnarchiveOutcome } from "../../src/application/project/ports";
import { FakeRoleViewRepository, FakeDecisionIds, FakeProvenanceWriter } from "../support/role-view-fakes";
import { FakeContentRepository } from "../support/content-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("f126-org");
const PROJECT = "f126-proj-unjoined";
const LEAD = "u-f126-lead"; // 组织角色 lead，创建了 PROJECT，但**没有**这场项目的成员行
const ITEM = "f126-item";

/** 最小 `ProjectArchiveRepository` 假实现——只记录被调用过，不模拟真实议程状态。 */
class FakeProjectArchiveRepository implements ProjectArchiveRepository {
  archiveCalls: string[] = [];
  unarchiveCalls: string[] = [];

  async archive(_orgId: unknown, projectId: string): Promise<ArchiveOutcome> {
    this.archiveCalls.push(projectId);
    return { kind: "archived", projectId };
  }
  async unarchive(_orgId: unknown, projectId: string): Promise<UnarchiveOutcome> {
    this.unarchiveCalls.push(projectId);
    return { kind: "unarchived", projectId };
  }
}

describe("F126 第 ④ 格：lead 对自建未加入的项目——管理权在，内容读取权不在", () => {
  it("① 管理成员：不查项目角色，组织角色 lead 这条路径直接放行（F125 路径②）", async () => {
    const identity = new FakeRoleViewRepository({
      [LEAD]: { orgRole: "lead", projectRole: null },
    });
    await expect(
      authorizeManageMembers(identity, { actorId: LEAD, orgId: ORG, projectId: PROJECT }),
    ).resolves.toBeUndefined();
  });

  it("② 管理生命周期：归档 / 解归档同样只查组织角色，同一个人放行", async () => {
    const identity = new FakeRoleViewRepository({
      [LEAD]: { orgRole: "lead", projectRole: null },
    });
    const repo = new FakeProjectArchiveRepository();

    const archived = await archiveProject({ repo, identity }, { orgId: ORG, actorId: LEAD, projectId: PROJECT });
    expect(archived.status).toBe("archived");

    const unarchived = await unarchiveProject(
      { repo, identity },
      { orgId: ORG, actorId: LEAD, projectId: PROJECT },
    );
    expect(unarchived.status).toBe("active");

    // 两次仓储调用都真的发生了——不是判定提前短路、仓储从未被触达。
    expect(repo.archiveCalls).toEqual([PROJECT]);
    expect(repo.unarchiveCalls).toEqual([PROJECT]);
  });

  it("③ 内容读取：同一个人被拒，且理由说得清是项目层挡的，不是「你不属于这个组织」", async () => {
    const content = new FakeContentRepository();
    content.seed(ITEM, {
      layer: "project",
      status: "published",
      ownerUserId: "u-f126-someone-else",
      body: "workshop notes the lead cannot see through this door",
    });
    const identity = new FakeRoleViewRepository({
      [LEAD]: { orgRole: "lead", projectRole: null },
    });
    const provenance = new FakeProvenanceWriter();
    const ids = new FakeDecisionIds();

    await expect(
      readContent(
        { repo: identity, content, provenance, ids },
        { userId: LEAD, orgId: ORG, projectId: PROJECT, itemId: ITEM, purpose: "work" },
      ),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });

    // 精确检查错误类型与理由码，防止将来有人把 NO_PROJECT_ROLE 和
    // NO_ORG_MEMBERSHIP / ADMIN_NOT_SUPERUSER 混着抛——三者对用户是三个不同的下一步动作。
    try {
      await readContent(
        { repo: identity, content, provenance, ids },
        { userId: LEAD, orgId: ORG, projectId: PROJECT, itemId: ITEM, purpose: "work" },
      );
      expect.unreachable("readContent 本应抛出 ContentDeniedError");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentDeniedError);
      expect((e as ContentDeniedError).reasonCode).toBe("NO_PROJECT_ROLE");
      // 不是「你不是这个组织的人」——lead 明明有组织成员资格，只是没有项目角色。
      expect((e as ContentDeniedError).reasonCode).not.toBe("NO_ORG_MEMBERSHIP");
    }

    // 且这次拒绝没有写审计——它是普通工作读被拒，不是被放行的 audit 豁口。
    expect(provenance.appended).toHaveLength(0);
  });
});
