/**
 * F98 — 联系方式遮盖 / 查看留痕 / 导出排除（uc-6-7 R5/R8/R9/AC7）.
 *
 * ## Why this file never opens a database connection
 *
 * Per this worker's standing instruction (issue #74: full-suite Postgres connection
 * exhaustion causes nondeterminism), no test that needs Postgres runs locally here --
 * `F72`'s `phone-encrypted-masked.test.ts` already established the technique this file
 * follows for the SAME class of requirement ("is the sensitive value ever handed back in
 * plaintext"): drive the pure domain + application layer directly, with an in-memory
 * `SubjectRepository` fake (`../support/fake-subject-repository.ts`) wired through the SAME
 * `guard()`/`Guarded<T>` machinery the Postgres repository uses. Nothing here is a shortcut
 * around permission-filter.
 *
 * The Postgres-backed structural assertions (contact_cipher never plaintext on disk, the
 * CHECK constraints accept the new provenance members) are covered by
 * `apps/api/tests/files/provenance-enum-single-source.test.ts` (dynamic, needs no edit) and
 * would be covered by a DB-backed sibling test this worker is not running locally per
 * standing instruction; this file is the part of F98's contract that does not need one.
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_CONTACT_CIPHER } from "../support/interview-db";
import { FakeSubjectRepository } from "../support/fake-subject-repository";
import { toOrgId } from "../../src/domain/org-id";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import type { ProvenanceAppendInput, ProvenanceWriter } from "../../src/application/provenance/ports";
import { revealContact } from "../../src/application/interview/reveal-contact";
import { exportSubjects } from "../../src/application/interview/export-subjects";
import { InMemoryExportFileStore } from "../../src/infrastructure/interview/in-memory-export-file-store";
import { ContactRevealDeniedError } from "../../src/application/interview/errors";
import {
  canRevealContact,
  canReadSubject,
  type ContactRevealViewer,
} from "../../src/domain/interview/subject-visibility";
import { revealSealedContact, sealContact } from "../../src/domain/interview/contact-vault";

const ORG = toOrgId("org-f98-contact");
const GROUP = "grp-f98-1";
const CREATOR = "u-f98-creator";
const FACILITATOR = "u-f98-facilitator";
const GROUP_LEAD = "u-f98-grouplead";
const MEMBER = "u-f98-member";
const OBSERVER = "u-f98-observer";

class FakeProvenanceWriter implements ProvenanceWriter {
  readonly events: ProvenanceAppendInput[] = [];
  async append(input: ProvenanceAppendInput): Promise<string> {
    this.events.push(input);
    return `prov-${this.events.length}`;
  }
  async appendWithin(_session: never, input: ProvenanceAppendInput): Promise<string> {
    this.events.push(input);
    return `prov-${this.events.length}`;
  }
}

function makeRepo() {
  const repo = new FakeSubjectRepository(FIXTURE_CONTACT_CIPHER);
  repo.setGroupContext(ORG, FACILITATOR, GROUP, { orgRole: "consultant", teamId: null, projectRole: "facilitator" });
  repo.setGroupContext(ORG, GROUP_LEAD, GROUP, { orgRole: "consultant", teamId: null, projectRole: "groupLead" });
  repo.setGroupContext(ORG, MEMBER, GROUP, { orgRole: "consultant", teamId: null, projectRole: "member" });
  repo.setGroupContext(ORG, OBSERVER, GROUP, { orgRole: "consultant", teamId: null, projectRole: "observer" });
  repo.setOrgContext(ORG, FACILITATOR, { orgRole: "consultant", teamId: null });
  repo.setOrgContext(ORG, GROUP_LEAD, { orgRole: "consultant", teamId: null });
  repo.setOrgContext(ORG, MEMBER, { orgRole: "consultant", teamId: null });
  repo.setOrgContext(ORG, OBSERVER, { orgRole: "consultant", teamId: null });
  return repo;
}

describe("domain/interview/contact-vault — 加密存储 (O-39)", () => {
  it("sealContact 产出的密文不等于明文，且序列化里也不含明文", () => {
    const sealed = sealContact("13800001111", FIXTURE_CONTACT_CIPHER, "2026-08-01T00:00:00.000Z");
    expect(sealed.ciphertext).not.toBe("13800001111");
    expect(JSON.stringify(sealed)).not.toContain("13800001111");
  });

  it("revealSealedContact 是唯一能把密文变回明文的函数，且往返一致", () => {
    const sealed = sealContact("13800001111", FIXTURE_CONTACT_CIPHER, "2026-08-01T00:00:00.000Z");
    expect(revealSealedContact(sealed, FIXTURE_CONTACT_CIPHER)).toBe("13800001111");
  });

  it("key-id 不匹配时拒绝解密，而不是产出乱码", () => {
    const sealed = sealContact("13800001111", FIXTURE_CONTACT_CIPHER, "2026-08-01T00:00:00.000Z");
    const otherKeyCipher = { ...FIXTURE_CONTACT_CIPHER, keyId: "k-other" };
    expect(() => revealSealedContact(sealed, otherKeyCipher)).toThrow(/cannot be revealed/);
  });

  it("拒绝密封空字符串", () => {
    expect(() => sealContact("", FIXTURE_CONTACT_CIPHER, "2026-08-01T00:00:00.000Z")).toThrow();
  });
});

describe("domain/interview/subject-visibility — canRevealContact 比 canReadSubject 窄 (R5)", () => {
  const facts = { groupId: GROUP, createdBy: CREATOR };

  it("组员能读对象行（含掩码），但不能看联系方式明文", () => {
    expect(canReadSubject(facts, { userId: MEMBER, projectRole: "member" })).toBe(true);
    const viewer: ContactRevealViewer = { userId: MEMBER, projectRole: "member", actorKind: "human" };
    expect(canRevealContact(facts, viewer)).toBe(false);
  });

  it("组长 / 引导师-项目负责人能看联系方式明文", () => {
    const groupLead: ContactRevealViewer = { userId: GROUP_LEAD, projectRole: "groupLead", actorKind: "human" };
    const facilitator: ContactRevealViewer = { userId: FACILITATOR, projectRole: "facilitator", actorKind: "human" };
    expect(canRevealContact(facts, groupLead)).toBe(true);
    expect(canRevealContact(facts, facilitator)).toBe(true);
  });

  it("创建者恒可查看自己创建的对象的联系方式", () => {
    const viewer: ContactRevealViewer = { userId: CREATOR, projectRole: null, actorKind: "human" };
    expect(canRevealContact(facts, viewer)).toBe(true);
  });

  it("agent 主体一律拒绝，且不是权限配置能打开的一档", () => {
    const asFacilitator: ContactRevealViewer = { userId: FACILITATOR, projectRole: "facilitator", actorKind: "agent" };
    expect(canRevealContact(facts, asFacilitator)).toBe(false);
  });

  it("观察者不可读对象表，也不可能看到联系方式", () => {
    expect(canReadSubject(facts, { userId: OBSERVER, projectRole: "observer" })).toBe(false);
    const viewer: ContactRevealViewer = { userId: OBSERVER, projectRole: "observer", actorKind: "human" };
    expect(canRevealContact(facts, viewer)).toBe(false);
  });
});

describe("application/interview/reveal-contact — 先写审计后解密 (R8/AC7/I-21)", () => {
  it("引导师查看联系方式：拿到明文，且写下一条 contact-revealed 审计事件", async () => {
    const repo = makeRepo();
    const created = await repo.create({
      orgId: ORG, displayName: "王芳", roleTitle: "采购总监", orgName: "某物流园区",
      groupId: GROUP, contact: "13800001111", sourceKind: "human", createdBy: CREATOR,
    });
    const provenance = new FakeProvenanceWriter();

    const result = await revealContact(
      { repo, cipher: FIXTURE_CONTACT_CIPHER, provenance },
      {
        orgId: ORG, viewerUserId: FACILITATOR, viewerActorKind: "human",
        input: { subjectId: created.subjectId, purpose: "booking" },
      },
    );

    expect(result.plaintext).toBe("13800001111");
    expect(provenance.events).toHaveLength(1);
    expect(provenance.events[0]!.type).toBe("contact-revealed");
    expect(provenance.events[0]!.target).toEqual({ kind: "subject", id: created.subjectId });
    expect(result.auditEventId).toBe("prov-1");
  });

  it("组员试图查看：被拒，且仍然写审计（unauthorized-attempt）——被拒的尝试也要留痕", async () => {
    const repo = makeRepo();
    const created = await repo.create({
      orgId: ORG, displayName: "韩梅梅", roleTitle: "运营总监", orgName: null,
      groupId: GROUP, contact: "13900002222", sourceKind: "human", createdBy: CREATOR,
    });
    const provenance = new FakeProvenanceWriter();

    await expect(
      revealContact(
        { repo, cipher: FIXTURE_CONTACT_CIPHER, provenance },
        {
          orgId: ORG, viewerUserId: MEMBER, viewerActorKind: "human",
          input: { subjectId: created.subjectId, purpose: "follow-up" },
        },
      ),
    ).rejects.toThrow(ContactRevealDeniedError);

    expect(provenance.events).toHaveLength(1);
    expect(provenance.events[0]!.type).toBe("unauthorized-attempt");
    expect(provenance.events[0]!.target).toEqual({ kind: "subject", id: created.subjectId });
  });

  it("agent 主体试图查看：恒被拒，不看角色配置", async () => {
    const repo = makeRepo();
    const created = await repo.create({
      orgId: ORG, displayName: "赵总", roleTitle: "运营总监", orgName: null,
      groupId: GROUP, contact: "13700003333", sourceKind: "human", createdBy: CREATOR,
    });
    const provenance = new FakeProvenanceWriter();

    await expect(
      revealContact(
        { repo, cipher: FIXTURE_CONTACT_CIPHER, provenance },
        {
          // 即便是引导师账号，一旦 actorKind 是 agent 也必须被拒。
          orgId: ORG, viewerUserId: FACILITATOR, viewerActorKind: "agent",
          input: { subjectId: created.subjectId, purpose: "booking" },
        },
      ),
    ).rejects.toThrow(ContactRevealDeniedError);
  });

  it("对象不存在：与「无权」返回同一个错误码，且仍然写审计（不可区分是安全属性）", async () => {
    const repo = makeRepo();
    const provenance = new FakeProvenanceWriter();

    await expect(
      revealContact(
        { repo, cipher: FIXTURE_CONTACT_CIPHER, provenance },
        {
          orgId: ORG, viewerUserId: FACILITATOR, viewerActorKind: "human",
          input: { subjectId: "subj-does-not-exist", purpose: "booking" },
        },
      ),
    ).rejects.toThrow(ContactRevealDeniedError);
    expect(provenance.events).toHaveLength(1);
    expect(provenance.events[0]!.type).toBe("unauthorized-attempt");
  });

  it("从未录入联系方式的对象：允许查看，返回空字符串而不是抛错", async () => {
    const repo = makeRepo();
    const created = await repo.create({
      orgId: ORG, displayName: "无联系方式对象", roleTitle: "顾问", orgName: null,
      groupId: GROUP, contact: null, sourceKind: "human", createdBy: CREATOR,
    });
    const provenance = new FakeProvenanceWriter();

    const result = await revealContact(
      { repo, cipher: FIXTURE_CONTACT_CIPHER, provenance },
      {
        orgId: ORG, viewerUserId: FACILITATOR, viewerActorKind: "human",
        input: { subjectId: created.subjectId, purpose: "compliance" },
      },
    );
    expect(result.plaintext).toBe("");
    expect(provenance.events).toHaveLength(1); // 仍然写审计——查看这个动作本身发生了。
  });
});

describe("application/interview/export-subjects — 批量导出默认不含联系方式 (R8/R9)", () => {
  it("导出产物的每一行都没有联系方式相关字段，即便某些对象有联系方式", async () => {
    const repo = makeRepo();
    await repo.create({
      orgId: ORG, displayName: "王芳", roleTitle: "采购总监", orgName: "某物流园区",
      groupId: GROUP, contact: "13800001111", sourceKind: "human", createdBy: CREATOR,
    });
    await repo.create({
      orgId: ORG, displayName: "韩梅梅", roleTitle: "运营总监", orgName: null,
      groupId: GROUP, contact: "13900002222", sourceKind: "human", createdBy: CREATOR,
    });
    const files = new InMemoryExportFileStore();
    const decisions = new UuidDecisionIdFactory();

    const result = await exportSubjects(
      { repo, files, decisions },
      {
        orgId: ORG, viewerUserId: FACILITATOR,
        input: { scope: { kind: "project", projectId: "proj-f98-x", researchProjectId: null }, includeContact: false },
      },
    );

    expect(result.fileId).toBeTruthy();
    const rows = files.filesById.get(result.fileId)!;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("contact");
      expect(Object.keys(row)).not.toContain("contactMask");
      expect(JSON.stringify(row)).not.toContain("13800001111");
      expect(JSON.stringify(row)).not.toContain("13900002222");
    }
  });

  it("观察者不可读对象表这条边界，导出时同样生效——一行都拿不到", async () => {
    const repo = makeRepo();
    await repo.create({
      orgId: ORG, displayName: "王芳", roleTitle: "采购总监", orgName: "某物流园区",
      groupId: GROUP, contact: "13800001111", sourceKind: "human", createdBy: CREATOR,
    });
    const files = new InMemoryExportFileStore();
    const decisions = new UuidDecisionIdFactory();

    const result = await exportSubjects(
      { repo, files, decisions },
      {
        orgId: ORG, viewerUserId: OBSERVER,
        input: { scope: { kind: "project", projectId: "proj-f98-x", researchProjectId: null }, includeContact: false },
      },
    );
    const rows = files.filesById.get(result.fileId)!;
    expect(rows).toEqual([]);
  });

  it("research / none 范围：模型里没有对应的对象集合，返回空列表而不是报错", async () => {
    const repo = makeRepo();
    const files = new InMemoryExportFileStore();
    const decisions = new UuidDecisionIdFactory();

    const result = await exportSubjects(
      { repo, files, decisions },
      {
        orgId: ORG, viewerUserId: FACILITATOR,
        input: { scope: { kind: "none", projectId: null, researchProjectId: null }, includeContact: false },
      },
    );
    expect(files.filesById.get(result.fileId)).toEqual([]);
  });
});
