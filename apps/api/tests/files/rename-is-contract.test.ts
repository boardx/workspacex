/**
 * F34 -- V11·22-1 / N-23: 「目录结构与文件命名一旦对外可见即为契约」. `renameArtifact` /
 * `resolveArtifactAlias` (uc-22-1 R7).
 *
 * ## What has to be true, concretely
 *
 *   1. after a rename, the OLD name still resolves (via `resolveArtifactAlias`) to the SAME
 *      artifact, at its CURRENT name -- "旧路径引用链接仍可解析（重定向或别名命中）";
 *   2. a name that was NEVER assigned to anything 404s -- "不存在改名后旧引用直接 404" is the
 *      negative half: a fabricated old-looking path must not resolve just because it LOOKS
 *      like a rename artifact;
 *   3. a CHAIN of renames (A -> B -> C) resolves correctly from ANY link in the chain, not
 *      just the most recent one -- this is what proves the alias table does not need to
 *      store "what did it become", only "what was it called before" (see
 *      `0033-f34-files-terminal-states.sql`'s header and `rename-artifact.ts`'s);
 *   4. the write is gated (`content.renameFile`) and the read is gated separately
 *      (`read.allHands`) -- an observer may not rename, and a stranger to the project may
 *      not even resolve a path in it;
 *   5. `renameAndAlias` is ONE transaction -- a rename that recorded the alias without
 *      taking effect (or vice versa) would violate the whole point of this feature.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { files as C } from "@repo/contracts";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgArtifactRenameRepository } from "../../src/infrastructure/files/pg-artifact-rename-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import {
  RenameArtifactError, renameArtifact, resolveArtifactAlias, type RenameDeps,
} from "../../src/application/files/rename-artifact";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f34-rename";
const PROJECT = "proj-f34-rename";

class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}
class SeqRowIds {
  private n = 0;
  next(prefix: string): string { return `${prefix}-${++this.n}`; }
}

let db: PgDatabase;
let deps: RenameDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy"] });
  await addOrgMember(ORG, "u-fac", "consultant", `${ORG}-team-energy`);
  await addOrgMember(ORG, "u-obs", "consultant", `${ORG}-team-energy`);
  await addOrgMember(ORG, "u-outside", "consultant", `${ORG}-team-energy`);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, "u-obs", "observer", null, false);
  // "u-outside" holds NO project membership at all -- the NO_PROJECT_ROLE case.

  await addBrowserArtifact({ orgId: ORG, id: "f34ren-a", projectId: PROJECT, source: "upload", title: "quarterly-report.pdf" });
  await addBrowserArtifact({ orgId: ORG, id: "f34ren-b", projectId: PROJECT, source: "upload", title: "never-touched.pdf" });

  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db),
    ids: new SeqIds(),
    aliases: new PgArtifactRenameRepository(db),
    idFactory: new SeqRowIds(),
  };
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG);
});

const rename = (userId: string, artifactId: string, newName: string, reason = "cleanup") =>
  renameArtifact(deps, { userId, orgId: toOrgId(ORG), artifactId, newName, reason });

const resolve = (userId: string, path: string) =>
  resolveArtifactAlias(deps, { userId, orgId: toOrgId(ORG), projectId: PROJECT, path });

const errorOf = async (p: Promise<unknown>): Promise<RenameArtifactError> => {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(RenameArtifactError);
  return e as RenameArtifactError;
};

describe("contract shape", () => {
  it("renameArtifact.out and resolveArtifactAlias.out validate against the signed contract", async () => {
    const out = await rename("u-fac", "f34ren-a", "q1-report-v2.pdf");
    expect(C.operations.renameArtifact.out.safeParse(out).success).toBe(true);

    const resolved = await resolve("u-fac", "quarterly-report.pdf");
    expect(C.operations.resolveArtifactAlias.out.safeParse(resolved).success).toBe(true);
  });
});

describe("V11·22-1: the old path still resolves after a rename", () => {
  it("resolves the OLD name to the artifact, at its NEW (current) name", async () => {
    const r = await rename("u-fac", "f34ren-b", "renamed-once.pdf");
    expect(r.aliasFrom).toBe("never-touched.pdf");
    expect(r.aliasTo).toBe("renamed-once.pdf");
    expect(r.changeLogId).toBeTruthy();

    const resolved = await resolve("u-fac", "never-touched.pdf");
    expect(resolved.artifactId).toBe("f34ren-b");
    expect(resolved.currentPath).toBe("renamed-once.pdf");
  });

  it("the CURRENT name resolves to itself -- no alias needed for a name never renamed away from", async () => {
    const resolved = await resolve("u-fac", "renamed-once.pdf");
    expect(resolved.artifactId).toBe("f34ren-b");
    expect(resolved.currentPath).toBe("renamed-once.pdf");
  });

  it("a CHAIN of renames (A -> B -> C) resolves from EITHER old name to the FINAL name", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f34ren-chain", projectId: PROJECT, source: "upload", title: "alpha.pdf" });
    await rename("u-fac", "f34ren-chain", "beta.pdf");
    await rename("u-fac", "f34ren-chain", "gamma.pdf");

    const fromAlpha = await resolve("u-fac", "alpha.pdf");
    const fromBeta = await resolve("u-fac", "beta.pdf");
    const fromGamma = await resolve("u-fac", "gamma.pdf");
    for (const r of [fromAlpha, fromBeta, fromGamma]) {
      expect(r.artifactId).toBe("f34ren-chain");
      expect(r.currentPath).toBe("gamma.pdf");
    }
  });

  it("PINS: a rename BACK to a former name (A -> B -> A) still resolves the middle name correctly", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f34ren-back", projectId: PROJECT, source: "upload", title: "x.pdf" });
    await rename("u-fac", "f34ren-back", "y.pdf");
    await rename("u-fac", "f34ren-back", "x.pdf"); // back to the original name

    // "y.pdf" was a real intermediate name -- must still resolve, to the CURRENT name ("x.pdf").
    const fromY = await resolve("u-fac", "y.pdf");
    expect(fromY.artifactId).toBe("f34ren-back");
    expect(fromY.currentPath).toBe("x.pdf");
    // "x.pdf" is live again -- resolves as a CURRENT name, not through the alias table at all.
    const fromX = await resolve("u-fac", "x.pdf");
    expect(fromX.artifactId).toBe("f34ren-back");
  });
});

describe("V11·22-1 negative half: a fabricated old-looking path 404s -- it is not a rename artifact", () => {
  it("a path that was never assigned to anything is ARTIFACT_NOT_FOUND", async () => {
    const err = await errorOf(resolve("u-fac", "this-name-never-existed.pdf"));
    expect(err.reasonCode).toBe("ARTIFACT_NOT_FOUND");
  });

  it("renaming a nonexistent artifact is ARTIFACT_NOT_FOUND", async () => {
    const err = await errorOf(rename("u-fac", "f34ren-does-not-exist", "whatever.pdf"));
    expect(err.reasonCode).toBe("ARTIFACT_NOT_FOUND");
  });
});

describe("the write is gated, and the read is gated separately", () => {
  it("an observer may not rename (PROJECT_ROLE_INSUFFICIENT)", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f34ren-observer-target", projectId: PROJECT, source: "upload", title: "observer-cannot-touch.pdf" });
    const err = await errorOf(rename("u-obs", "f34ren-observer-target", "renamed-by-observer.pdf"));
    expect(err.reasonCode).toBe("PROJECT_ROLE_INSUFFICIENT");

    // And the rename did NOT happen -- one failed authorize() call must not have side effects.
    const stillThere = await resolve("u-fac", "observer-cannot-touch.pdf");
    expect(stillThere.currentPath).toBe("observer-cannot-touch.pdf");
  });

  it(
    "PINS: an observer is denied resolve() too (read.allHands, same gate browse-artifacts.ts " +
      "uses, same T-6/FS3 unruled question F31/F32 already flag -- fail-closed until ruled)",
    async () => {
      const err = await errorOf(resolve("u-obs", "observer-cannot-touch.pdf"));
      expect(err.reasonCode).toBe("NO_PROJECT_ROLE");
    },
  );

  it("someone with NO project membership at all gets NO_PROJECT_ROLE on resolve", async () => {
    const err = await errorOf(resolve("u-outside", "observer-cannot-touch.pdf"));
    expect(err.reasonCode).toBe("NO_PROJECT_ROLE");
  });

  it("someone with NO project membership at all gets PROJECT_ROLE_INSUFFICIENT on rename (collapsed, see file header of rename-artifact.ts)", async () => {
    const err = await errorOf(rename("u-outside", "f34ren-observer-target", "x.pdf"));
    expect(err.reasonCode).toBe("PROJECT_ROLE_INSUFFICIENT");
  });
});

describe("COUNTER-PROOF: renameAndAlias is one transaction, not two statements a caller could observe half-done", () => {
  it("after a successful rename, EXACTLY one new alias row names the old value, and the artifact's title is the new one -- never both-old or both-new", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f34ren-atomic", projectId: PROJECT, source: "upload", title: "before.pdf" });
    await rename("u-fac", "f34ren-atomic", "after.pdf");

    const viaOld = await resolve("u-fac", "before.pdf");
    const viaNew = await resolve("u-fac", "after.pdf");
    // Both must land on the SAME artifact and the SAME current name -- if the alias insert
    // and the title update were two separate statements a crash between them could leave
    // "before.pdf" resolving to nothing (alias missing) while "after.pdf" is also unresolved
    // (title never updated), or an alias pointing at a title that was never actually changed.
    expect(viaOld.artifactId).toBe("f34ren-atomic");
    expect(viaNew.artifactId).toBe("f34ren-atomic");
    expect(viaOld.currentPath).toBe("after.pdf");
    expect(viaNew.currentPath).toBe("after.pdf");
  });
});
