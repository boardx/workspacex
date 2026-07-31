import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { artifact as C } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import {
  makeHarness,
  seedArtifact,
  seedVersionlessArtifact,
  type Harness,
} from "../support/binding-fixture";
import { toOrgId } from "../../src/domain/org-id";
import { bindToProjectStep } from "../../src/application/artifact/bind-to-project-step";
import { listBackflow } from "../../src/application/artifact/list-backflow";
import {
  ArtifactNotFoundError,
  CONTRACT_CODE_BY_ERROR,
  NoProjectRoleError,
  NoVersionToBindError,
  PinnedRequiresVersionError,
  ProjectRoleInsufficientError,
} from "../../src/application/artifact/binding-errors";
import {
  MODE_RANK,
  classifyTransition,
  isProjectSideVisible,
} from "../../src/domain/artifact/binding-modes";

/**
 * F06 -- the three binding modes are three different behaviours (uc-0-1 R3 step 3, I-8/I-12).
 *
 * ## What this file refuses to accept as a pass
 *
 * "A pinned binding does not follow the source" is satisfied by a binding that resolves to
 * nothing at all, and "a draft does not appear on the project side" is satisfied by a system
 * that stored no draft. Both are the failure shape this project has recorded nine times. So
 * every mode is asserted in BOTH directions:
 *
 *   draft   the row exists and names its author  AND  no requester sees it in the list
 *   live    the entry exists                     AND  its version moves when the source does
 *   pinned  the entry exists                     AND  its version does NOT move, in the same
 *                                                     test where a live entry did
 *
 * The live/pinned pair is asserted against ONE source moving once, so "the source moved" is
 * not a separate claim that could itself be false.
 */

const ORG = "org-f06-modes";
const PROJECT = "proj-f06-modes";
const STEP = "step-discovery";
const AUTHOR = "u-f06-author";
const LEAD = "u-f06-lead";
const MEMBER = "u-f06-member";
const ADMIN = "u-f06-admin";
const STRANGER = "u-f06-stranger";

let h: Harness;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  h = await makeHarness("f06m");
});

afterAll(async () => {
  await h?.close();
  if (h?.root) await rm(h.root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  // Roles chosen from the SIGNED matrix, not invented: `facilitator` and `groupLead` hold
  // `group.submitOutput`, `member` and `observer` do not -- which is R5's split between who
  // may bind/pin and who may only look.
  await addOrgMember(ORG, AUTHOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, AUTHOR, "facilitator", null);
  await addOrgMember(ORG, LEAD, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, LEAD, "groupLead", null);
  await addOrgMember(ORG, MEMBER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, MEMBER, "member", null);
  // An org ADMIN with no project role -- I-12 says drafts are invisible to them too.
  await addOrgMember(ORG, ADMIN, "admin", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ADMIN, "facilitator", null);
  await addOrgMember(ORG, STRANGER, "consultant", fx.teams.platform!);
});

const org = () => toOrgId(ORG);
const listAs = (userId: string, stepId?: string) =>
  listBackflow(h.deps, { userId, orgId: org(), projectId: PROJECT, stepId });

/* ─────────────────────────── the vocabulary has one source ─────────────────────────── */

describe("the three modes are the contract's three modes", () => {
  it("artifact_bindings.mode enumerates exactly BindingMode", async () => {
    // The CHECK in 0008 is a copy of a zod enum, and a copy is what this project has drifted
    // from six times. Reconciled mechanically: add a mode to the contract, forget the
    // migration, and this goes red naming the missing value.
    const def = await asOwner(async (c) => {
      const r = await c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
          WHERE t.relname = 'artifact_bindings' AND c.contype = 'c' AND a.attname = 'mode'
            AND pg_get_constraintdef(c.oid) LIKE '%ANY %'`,
      );
      return r.rows[0]?.def ?? "";
    });
    expect(def, "no enum CHECK found on artifact_bindings.mode").not.toBe("");
    const inSql = [...def.matchAll(/'([a-z-]+)'::text/g)].map((m) => m[1]!).sort();
    expect(inSql).toEqual([...C.BindingMode.options].sort());
  });

  it("closedness, not the count: an undeclared mode is refused by BOTH the schema and the table", async () => {
    // Asserting `options.length === 3` would make a properly reviewed fourth mode fail its
    // own test (修订 E-4's lesson). What must hold is that the SET matches and that a value
    // outside it cannot get in.
    expect(new Set(C.BindingMode.options)).toEqual(new Set(Object.keys(MODE_RANK)));
    expect(C.BindingMode.safeParse("archived").success).toBe(false);

    const a = await seedArtifact(h, ORG, PROJECT, ["one\n"]);
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO artifact_bindings
             (id, org_id, artifact_id, project_id, step_id, mode, pinned_version_id, created_by)
           VALUES ('f06m-bad',$1,$2,$3,$4,'archived',NULL,'u')`,
          [ORG, a.artifactId, PROJECT, STEP],
        ),
      ),
    ).rejects.toThrow(/violates check constraint/i);
  });
});

/* ──────────────────────────── I-8's structural half ────────────────────────────────── */

describe("I-8: pinned means frozen to a version, and only pinned does", () => {
  it("the IFF is enforced by the table in both directions", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["one\n"]);

    // pinned with no version -- the mode claims a freeze that has no referent.
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO artifact_bindings
             (id, org_id, artifact_id, project_id, step_id, mode, pinned_version_id, created_by)
           VALUES ('f06m-iff-1',$1,$2,$3,'s1','pinned',NULL,'u')`,
          [ORG, a.artifactId, PROJECT],
        ),
      ),
    ).rejects.toThrow(/artifact_bindings_pinned_iff_version/);

    // ...and the other direction, which an implication (`pinned => version`) would allow:
    // a live row carrying a version id that nothing reads. A column written but never read
    // is a column that eventually gets read.
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO artifact_bindings
             (id, org_id, artifact_id, project_id, step_id, mode, pinned_version_id, created_by)
           VALUES ('f06m-iff-2',$1,$2,$3,'s2','live',$4,'u')`,
          [ORG, a.artifactId, PROJECT, a.versionIds[0]],
        ),
      ),
    ).rejects.toThrow(/artifact_bindings_pinned_iff_version/);

    // Counter-proof that the constraint is not simply rejecting every insert: the two legal
    // shapes go in.
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO artifact_bindings
           (id, org_id, artifact_id, project_id, step_id, mode, pinned_version_id, created_by)
         VALUES ('f06m-iff-ok1',$1,$2,$3,'s3','live',NULL,'u'),
                ('f06m-iff-ok2',$1,$2,$3,'s4','pinned',$4,'u')`,
        [ORG, a.artifactId, PROJECT, a.versionIds[0]],
      ),
    );
  });

  it("a binding cannot pin another artifact's version", async () => {
    // The FK says `pinned_version_id` is SOME version. It cannot say it is a version OF this
    // artifact -- and a binding that pins someone else's version renders on the project side
    // as `已定版 v1` while citing a different document.
    const mine = await seedArtifact(h, ORG, PROJECT, ["mine\n"]);
    const theirs = await seedArtifact(h, ORG, PROJECT, ["theirs\n"]);

    await expect(
      bindToProjectStep(h.deps, {
        userId: AUTHOR, orgId: org(), artifactId: mine.artifactId,
        projectId: PROJECT, stepId: STEP, mode: "pinned",
        sourceVersionId: theirs.versionIds[0]!,
      }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);

    // ...and the database refuses it too, so the rule survives a writer that skips the use
    // case. Without this the application check is the only thing holding, and the trigger
    // could be deleted with every test still green.
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO artifact_bindings
             (id, org_id, artifact_id, project_id, step_id, mode, pinned_version_id, created_by)
           VALUES ('f06m-cross',$1,$2,$3,'s9','pinned',$4,'u')`,
          [ORG, mine.artifactId, PROJECT, theirs.versionIds[0]],
        ),
      ),
    ).rejects.toThrow(/is not a version of artifact/);

    // Counter-proof: its OWN version is accepted through the same path.
    const ok = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: mine.artifactId,
      projectId: PROJECT, stepId: STEP, mode: "pinned",
      sourceVersionId: mine.versionIds[0]!,
    });
    expect(ok.pinnedVersionId).toBe(mine.versionIds[0]);
  });
});

/* ──────────────────────────────── draft (I-12) ─────────────────────────────────────── */

describe("draft: private to its author, on nobody's project side", () => {
  it("the row exists and names its author, and NO requester sees it in the list", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["notes\n"], AUTHOR);
    const binding = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
      projectId: PROJECT, stepId: STEP, mode: "draft",
    });

    // ── direction 1: something was actually stored ──────────────────────────────────────
    // Without this, everything below is satisfied by an implementation that discards drafts,
    // and `bindToProjectStep` would be returning a Binding id that names nothing.
    const row = await asOwner(async (c) => {
      const r = await c.query<{ mode: string; created_by: string; pinned_version_id: string | null }>(
        `SELECT mode, created_by, pinned_version_id FROM artifact_bindings WHERE id = $1`,
        [binding.id],
      );
      return r.rows[0] ?? null;
    });
    expect(row).toEqual({ mode: "draft", created_by: AUTHOR, pinned_version_id: null });
    expect(binding.mode).toBe("draft");

    // ── direction 2: it is on nobody's project side ─────────────────────────────────────
    // Including the author's: 「已回流的产出与版本」 is the PROJECT side, and a draft is by
    // definition not on it. Including an org ADMIN's -- I-12 names administrators explicitly.
    for (const who of [AUTHOR, LEAD, ADMIN]) {
      expect(await listAs(who), `${who} saw a draft`).toEqual([]);
    }
    await expect(listAs(STRANGER)).rejects.toBeInstanceOf(NoProjectRoleError);
  });

  it("counter-proof: the SAME binding appears the moment it stops being a draft", async () => {
    // This is what separates "drafts are filtered" from "the list is broken". Without it,
    // deleting the whole `listForProject` query body would leave the test above green.
    const a = await seedArtifact(h, ORG, PROJECT, ["notes\n"], AUTHOR);
    const draft = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
      projectId: PROJECT, stepId: STEP, mode: "draft",
    });
    expect(await listAs(AUTHOR)).toEqual([]);

    const published = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
      projectId: PROJECT, stepId: STEP, mode: "live",
    });
    // The same row, raised -- not a second binding. Two rows for one step is how a project
    // side shows one artifact twice at two versions.
    expect(published.id).toBe(draft.id);

    const listed = await listAs(AUTHOR);
    expect(listed.map((e) => e.bindingId)).toEqual([draft.id]);
    expect(listed[0]!.mode).toBe("live");
  });

  it("the exclusion rule is a predicate, and it is the one the list uses", () => {
    // The filter is in the application (`isProjectSideVisible`) rather than in the WHERE
    // clause precisely so it can be asserted directly. A SQL-side filter makes "no drafts
    // came back" and "no rows came back" the same observation.
    expect(isProjectSideVisible("draft")).toBe(false);
    expect(isProjectSideVisible("live")).toBe(true);
    expect(isProjectSideVisible("pinned")).toBe(true);
  });
});

/* ─────────────────────────── live vs pinned, one source, one move ───────────────────── */

describe("live follows the source, pinned does not -- asserted against the same move", () => {
  it("after a new version is pinned, the live entry moved to v2 and the pinned entry is still v1", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["as it stood\n"], AUTHOR);

    const live = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
      projectId: PROJECT, stepId: "step-live", mode: "live",
    });
    const pinned = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
      projectId: PROJECT, stepId: "step-pinned", mode: "pinned",
      sourceVersionId: a.versionIds[0]!,
    });

    const before = await listAs(AUTHOR);
    expect(before.find((e) => e.bindingId === live.id)!.version).toBe(1);
    expect(before.find((e) => e.bindingId === pinned.id)!.version).toBe(1);

    // ── the source moves, once, through the ordinary pin path ───────────────────────────
    const moved = await seedArtifactSecondVersion(a.artifactId);
    expect(moved).toBe(2);

    const after = await listAs(AUTHOR);
    const liveAfter = after.find((e) => e.bindingId === live.id)!;
    const pinnedAfter = after.find((e) => e.bindingId === pinned.id)!;

    // live: it moved. Without this half, "pinned did not move" is also true of a list that
    // returns a constant.
    expect(liveAfter.version).toBe(2);
    expect(liveAfter.badge).toBe("live");

    // pinned: it did not (I-8 / AC2).
    expect(pinnedAfter.version).toBe(1);
    expect(pinnedAfter.badge).toBe("pinned");

    // ...and the binding still names the exact version row it was frozen to, not merely a
    // number that happens to be 1.
    const stored = await asOwner(async (c) => {
      const r = await c.query<{ pinned_version_id: string }>(
        `SELECT pinned_version_id FROM artifact_bindings WHERE id = $1`,
        [pinned.id],
      );
      return r.rows[0]!.pinned_version_id;
    });
    expect(stored).toBe(a.versionIds[0]);
  });

  async function seedArtifactSecondVersion(artifactId: string): Promise<number> {
    const { pinVersion } = await import("../../src/application/artifact/pin-version");
    const r = await pinVersion(
      { store: h.store, repo: h.deps.artifacts, ids: h.ids, provenance: h.provenance },
      {
        orgId: org(), artifactId, expectedHeadVersion: 1,
        source: "conversation", title: "a chat", actorId: AUTHOR,
        parts: { "messages.jsonl": new TextEncoder().encode("rewritten\n") },
      },
    );
    return r.versionNumber;
  }
});

/* ───────────────────────────────── who may bind ─────────────────────────────────────── */

describe("binding is a write, and the role matrix decides it (R5)", () => {
  it("a groupLead may bind; a plain member may not; a non-member is told nothing", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["x\n"], AUTHOR);

    const ok = await bindToProjectStep(h.deps, {
      userId: LEAD, orgId: org(), artifactId: a.artifactId,
      projectId: PROJECT, stepId: "step-lead", mode: "live",
    });
    expect(ok.mode).toBe("live");

    await expect(
      bindToProjectStep(h.deps, {
        userId: MEMBER, orgId: org(), artifactId: a.artifactId,
        projectId: PROJECT, stepId: "step-member", mode: "live",
      }),
    ).rejects.toBeInstanceOf(ProjectRoleInsufficientError);

    await expect(
      bindToProjectStep(h.deps, {
        userId: STRANGER, orgId: org(), artifactId: a.artifactId,
        projectId: PROJECT, stepId: "step-stranger", mode: "live",
      }),
    ).rejects.toBeInstanceOf(NoProjectRoleError);
  });

  it("the refusal comes BEFORE existence, so it cannot be used to probe for artifact ids", async () => {
    // Both calls must fail the same way. If existence were checked first, the pair
    // (not-found vs forbidden) tells an outsider which ids are real.
    const real = await seedArtifact(h, ORG, PROJECT, ["x\n"], AUTHOR);

    // ⚠ `allSettled` 而不是「先建两个 promise，再逐个 await」。
    //
    // 那个写法在这里是一枚定时炸弹，而且已经炸过：两个调用都会 reject，
    // 但只有第一个立刻被 await —— 第二个在 `await expect(withReal)` 那段窗口里
    // **没有任何 handler**，于是 Node 报 unhandled rejection。
    // 症状极具欺骗性：`Test Files 83 passed | Tests 1163 passed`，
    // 却带一行 `Errors 1 error`，vitest 退出码 1，pre-push 全仓中止。
    // 单跑这个文件永远是绿的（窗口太窄），只有整套并行、机器有负载时才现形。
    // `allSettled` 在**创建的同一刻**就给两个 promise 挂上了 handler，
    // 而两者仍然是并发发起的 —— 本用例要的「两条路径同样失败」一点没变。
    const [withReal, withFake] = await Promise.allSettled([
      bindToProjectStep(h.deps, {
        userId: STRANGER, orgId: org(), artifactId: real.artifactId,
        projectId: PROJECT, stepId: STEP, mode: "live",
      }),
      bindToProjectStep(h.deps, {
        userId: STRANGER, orgId: org(), artifactId: "no-such-artifact", projectId: PROJECT,
        stepId: STEP, mode: "live",
      }),
    ]);

    expect(withReal.status).toBe("rejected");
    expect(withFake.status).toBe("rejected");
    expect((withReal as PromiseRejectedResult).reason).toBeInstanceOf(NoProjectRoleError);
    expect((withFake as PromiseRejectedResult).reason).toBeInstanceOf(NoProjectRoleError);
  });
});

/* ───────────────────── the two states the contract cannot name ──────────────────────── */

describe("failures the contract has no code for -- stated, not papered over", () => {
  it("pinned without a version, and live on a version-less artifact, are both refused", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["x\n"], AUTHOR);
    await expect(
      bindToProjectStep(h.deps, {
        userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
        projectId: PROJECT, stepId: STEP, mode: "pinned",
      }),
    ).rejects.toBeInstanceOf(PinnedRequiresVersionError);

    const bare = await seedVersionlessArtifact(h, ORG, "f06m-bare-1", AUTHOR);
    await expect(
      bindToProjectStep(h.deps, {
        userId: AUTHOR, orgId: org(), artifactId: bare,
        projectId: PROJECT, stepId: "step-bare", mode: "live",
      }),
    ).rejects.toBeInstanceOf(NoVersionToBindError);

    // A version-less artifact CAN still hold a draft -- 0007 calls it "a draft buffer with
    // nothing pinned", so it is a normal state and the refusal above must not generalise.
    const draft = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: bare,
      projectId: PROJECT, stepId: "step-bare", mode: "draft",
    });
    expect(draft.mode).toBe("draft");
  });

  it("`bindToProjectStep.in` accepts `mode: pinned` with no sourceVersionId -- the schema does not carry the rule", () => {
    // usecases.md states it as a precondition in prose; the zod schema types
    // `sourceVersionId` as `.optional()` with no refinement, so the single source of truth
    // does NOT express it. Asserted so that adding a `.superRefine` turns this red and the
    // application-level check can be reconsidered rather than duplicated forever.
    const parsed = C.operations.bindToProjectStep.in.safeParse({
      artifactId: "a", projectId: "p", stepId: "s", mode: "pinned",
    });
    expect(parsed.success, "the contract now expresses it -- move the check").toBe(true);
  });

  it("exactly two failures have no code in ArtifactError, and they are the two named here", () => {
    const unmapped = [...CONTRACT_CODE_BY_ERROR.entries()]
      .filter(([, code]) => code === null)
      .map(([ctor]) => ctor.name)
      .sort();
    expect(unmapped).toEqual(["NoVersionToBindError", "PinnedRequiresVersionError"]);

    // ...and the mapped ones really are members of the closed enum, so the table cannot
    // drift into naming a code the contract does not have.
    for (const [, code] of CONTRACT_CODE_BY_ERROR) {
      if (code === null) continue;
      expect(C.ArtifactError.safeParse(code).success, `${code} is not an ArtifactError`).toBe(true);
    }
  });
});

/* ─────────────────────────── the transition classifier ─────────────────────────────── */

describe("classifyTransition sees the case a rank comparison cannot", () => {
  it("re-pointing a pinned binding is not `same`", () => {
    // Mode unchanged, rank unchanged, and the citation moved. An implementation comparing
    // only ranks refuses every downgrade, passes every downgrade test, and permits this.
    expect(
      classifyTransition({ from: "pinned", to: "pinned", fromVersionId: "v1", toVersionId: "v2" }),
    ).toBe("repoint");
    expect(
      classifyTransition({ from: "pinned", to: "pinned", fromVersionId: "v1", toVersionId: "v1" }),
    ).toBe("same");
    expect(
      classifyTransition({ from: "live", to: "pinned", fromVersionId: null, toVersionId: "v1" }),
    ).toBe("upgrade");
    expect(
      classifyTransition({ from: "pinned", to: "live", fromVersionId: "v1", toVersionId: null }),
    ).toBe("downgrade");
  });
});
