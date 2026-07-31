/**
 * F15 身份四选（I-17 / O-03）：**组员 / 组长 / 观察者 / 协同引导师**。
 *
 * ## 这个文件守的两件事，第二件才是重点
 *
 * ① 四选各自落到对的 `project_role`。
 * ② **「协同引导师」落库为 `facilitator`，`project_role` 的取值集合恒为四值**——
 *    也就是说四选**不产生第五种取值**。一个把 `coFacilitator` 原样存进库的实现
 *    会让 ① 全绿（每一档都「落到了对的值」），而 `ProjectRole` 悄悄变成五值，
 *    整套两层交集鉴权的测试矩阵从 4×3 变成 5×3，而没有任何东西会红。
 *
 * ## 断言写法：集合一致 + 未声明值不能通过，**不写 `toHaveLength(4)`**
 *
 * `contract-design.md` 硬规则 7：成员数不是要守的性质。写成 `toHaveLength(4)`
 * 会让一次经 ADR 评审的正当新增被自己的测试拦下，而真正要守的
 * 「未声明的值不能通过」反倒没被测。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { identity as I, orgAdmin as C } from "@repo/contracts";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import { consumeInviteLink } from "../../src/application/auth/consume-invite-link";
import { listInviteLinks } from "../../src/application/auth/list-invite-links";
import { upsertParticipantRoster } from "../../src/application/auth/upsert-participant-roster";
import {
  IDENTITY_CHOICE_TO_PROJECT_ROLE,
  identityChoiceOf,
  projectRoleOf,
  type ParticipantIdentityChoice,
} from "../../src/domain/auth/invite-link";
import { PROJECT_ROLES } from "../../src/domain/identity/roles";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { facilitator, fixedIds, newDb, readerCtx, repos, toOrgId } from "../support/invite-link";

const ORG = "org-f15-identity";
const PROJECT = `${ORG}-p`;
const HOST = "u-f15i-host";
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: ReturnType<typeof repos>["links"];
let roster: ReturnType<typeof repos>["roster"];

const orgId = toOrgId(ORG);
const ids = fixedIds("dec-f15-identity");

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = newDb();
  repo = repos(db).links;
  roster = repos(db).roster;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
}, HOOK_TIMEOUT_MS);

const CHOICES = C.ParticipantIdentityChoice.options as readonly ParticipantIdentityChoice[];

describe("四选 → 落库角色（纯函数层）", () => {
  it("契约的四选**每一个**都有落点，且映射与 O-03 一致", () => {
    expect(new Set(Object.keys(IDENTITY_CHOICE_TO_PROJECT_ROLE))).toEqual(new Set(CHOICES));
    expect(projectRoleOf("member")).toBe("member");
    expect(projectRoleOf("groupLead")).toBe("groupLead");
    expect(projectRoleOf("observer")).toBe("observer");
    // ⚠ 这一行是 I-17 的全部：协同引导师 = 展示别名。
    expect(projectRoleOf("coFacilitator")).toBe("facilitator");
  });

  it("落库角色的取值集合恒**等于**契约的 ProjectRole；未声明的值不能通过", () => {
    const landed = new Set(CHOICES.map(projectRoleOf));
    expect(landed).toEqual(new Set(PROJECT_ROLES));
    // 「第五种取值」的两个最可能形态。⚠ 断言的是集合与封闭性，不是成员数。
    expect(I.ProjectRole.safeParse("coFacilitator").success).toBe(false);
    expect(I.ProjectRole.safeParse("coHost").success).toBe(false);
    expect(C.ParticipantIdentityChoice.safeParse("facilitator").success).toBe(false);
  });

  it("映射是单射，反推是它的逆（库里只存一列的前提）", () => {
    for (const c of CHOICES) expect(identityChoiceOf(projectRoleOf(c))).toBe(c);
  });
});

describe("四选 → 落库角色（真实库 + 真实核销）", () => {
  it.each(CHOICES)("身份 %s 的链接：落库值、授予值、管理面读回的值三处一致", async (choice) => {
    const link = await issueInviteLink(
      { repo },
      {
        orgId,
        projectId: PROJECT,
        kind: "main",
        groupId: null,
        identity: choice,
        validity: "7d",
        ...facilitator(HOST),
      },
    );

    const expected = projectRoleOf(choice);

    // ① 库里那一列。绕过应用层直接看，否则「三处一致」只是同一处读了三遍。
    const dbRows = await asApp(ORG, (c) =>
      c.query<{ project_role: string }>("SELECT project_role FROM invite_links WHERE id = $1", [
        link.linkId,
      ]),
    );
    expect(dbRows.rows[0]?.project_role).toBe(expected);

    // ② 核销拿到的**服务端记录值**。
    const grant = await consumeInviteLink({ repo }, { token: link.token, principalId: "p-1" });
    expect(grant.projectRole).toBe(expected);

    // ③ 管理面读回的值。
    const rows = await listInviteLinks(
      { repo, ids },
      readerCtx({ orgId: ORG, projectId: PROJECT, actorId: HOST }),
    );
    expect(rows.find((r) => r.linkId === link.linkId)?.projectRole).toBe(expected);
  });

  it("⚠ 反向：`?r=` 被篡改后，授予的角色**不变**", async () => {
    const link = await issueInviteLink(
      { repo },
      {
        orgId,
        projectId: PROJECT,
        kind: "main",
        groupId: null,
        identity: "observer",
        validity: "7d",
        ...facilitator(HOST),
      },
    );
    expect(link.url).toContain("?r=observer");

    // 把 URL 里的 `?r=` 改成 facilitator，只把**令牌**交给核销路径——
    // 这正是攻击者能做的全部动作：他改得了查询串，改不了服务端那一行。
    const tampered = link.url.replace("?r=observer", "?r=coFacilitator");
    const token = new URL(tampered).searchParams.get("t");
    expect(token).toBe(link.token);

    const grant = await consumeInviteLink({ repo }, { token, principalId: "p-2" });
    // 权威在服务端的 linkId → project_role 映射（usecases.md 逐字）。
    expect(grant.projectRole).toBe("observer");
  });

  it("协同引导师签发的链接，落库值与引导师**逐字相同**（O-03：不是第五种角色）", async () => {
    const co = await issueInviteLink(
      { repo },
      {
        orgId,
        projectId: PROJECT,
        kind: "main",
        groupId: null,
        identity: "coFacilitator",
        validity: "24h",
        ...facilitator(HOST),
      },
    );
    const grant = await consumeInviteLink({ repo }, { token: co.token, principalId: "p-3" });
    expect(grant.projectRole).toBe("facilitator");

    // 库层也钉着：project_role 的 CHECK 只认四值，写 coFacilitator 直接被拒。
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO invite_links
             (id, org_id, project_id, kind, group_id, project_role, validity, token, created_by)
           VALUES ('il-bogus', $1, $2, 'main', NULL, 'coFacilitator', 'once', 'tok-bogus', $3)`,
          [ORG, PROJECT, HOST],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("名单：身份四选同样只落一列，且 identity 由角色反推", () => {
  it("批量邀请落名单，created 里的 identity 与 projectRole 自洽", async () => {
    const out = await upsertParticipantRoster(
      { roster },
      {
        orgId,
        projectId: PROJECT,
        recipients: ["Zhang@Example.com", "13800002049", "not-an-address", "Zhang@example.com"],
        identity: "coFacilitator",
        ...facilitator(HOST),
      },
    );

    expect(out.created).toHaveLength(2);
    for (const c of out.created) {
      expect(c.projectRole).toBe("facilitator");
      expect(c.identity).toBe("coFacilitator");
      expect(C.ParticipantRef.safeParse(c).success).toBe(true);
    }
    // 部分成功是一等返回形态：非法的一条被逐条标出，没有整批失败。
    expect(out.invalid.map((i) => i.value)).toEqual(["not-an-address"]);
    // 大小写不同的同一邮箱按 A2 去重，且回报的是**用户输入的原值**。
    expect(out.deduped).toEqual(["Zhang@example.com"]);
  });

  it("⚠ 反向：ParticipantRef 会拒绝 identity 为第五种取值的条目", () => {
    const good = {
      participantId: "pp-1",
      masked: "138 •••• 2049",
      identity: "coFacilitator",
      projectRole: "facilitator",
      groupId: null,
    };
    expect(C.ParticipantRef.safeParse(good).success).toBe(true);
    expect(C.ParticipantRef.safeParse({ ...good, identity: "coHost" }).success).toBe(false);
    expect(C.ParticipantRef.safeParse({ ...good, projectRole: "coFacilitator" }).success).toBe(false);
    expect(C.ParticipantRef.safeParse({ ...good, extra: 1 }).success).toBe(false);
  });
});
