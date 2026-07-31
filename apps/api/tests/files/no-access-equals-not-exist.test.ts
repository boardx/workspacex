/**
 * F34 -- V6·22-1: 「请求无权访问的 artifact_id 返回与『不存在』完全相同的状态码/响应体/响应头」.
 *
 * ## What "same" is asserted at each of two layers, and why both
 *
 * `deliver-artifact.ts`'s `resolveVisible` already collapses "not visible" and "not there"
 * into ONE throw (`FilesDeliveryError("ARTIFACT_NOT_FOUND")`, no distinguishing data) -- that
 * was F32's design, stated in its own header. What F31/F32 never had a test for is the
 * ASSERTION that the two INPUT SHAPES that reach that throw (a real version another
 * requester cannot see, and a version id that never existed) actually produce it -- as
 * opposed to, say, a different error path for one of them that happens to render similarly.
 *
 *   1. APPLICATION layer: both inputs must raise the identical `FilesDeliveryError` --
 *      same class, same `reasonCode`, same `message` -- for BOTH `previewArtifactVersion`
 *      and `issueDownloadUrl`.
 *   2. CONTROLLER layer: `files-delivery.controller.ts`'s `mapErrors` turns
 *      `ARTIFACT_NOT_FOUND` into a BARE `NotFoundException()` with no body. Constructing the
 *      controller directly (a Nest controller is a plain class; the parameter decorators are
 *      request-binding metadata that a direct call does not need) and calling its route
 *      methods proves the HTTP-facing status and body are equal too, not just the internal
 *      error object.
 *
 * ⚠ NOT asserted here, and said so rather than implied: response TIMING. The contract's own
 * note (quoted in the controller's header) already says "那一条契约表达不了，只能在验收里测"
 * and no infrastructure exists in this repository to measure it from a unit test. Reporting
 * the gap here rather than a comment that reads as if it were covered.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { addBinding, addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDownloadGrantRepository } from "../../src/infrastructure/files/pg-download-grant-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { IsolatedDownloadUrlBuilder } from "../../src/infrastructure/files/isolated-download-url-builder";
import { ObjectStoreIntegrityChecker } from "../../src/infrastructure/files/object-store-integrity-checker";
import {
  FilesDeliveryError, issueDownloadUrl, previewArtifactVersion, type DeliveryDeps,
} from "../../src/application/files/deliver-artifact";
import { FilesDeliveryController } from "../../src/interface/controllers/files-delivery.controller";
import { toOrgId } from "../../src/domain/org-id";
import type { Principal } from "../../src/domain/principal";

const ORG = "org-f34-noaccess";
const OTHER_ORG = "org-f34-noaccess-other";
const PROJECT = "proj-f34-noaccess";
const OTHER_PROJECT = "proj-f34-noaccess-other";

class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}
class SeqRowIds {
  private n = 0;
  next(prefix: string): string { return `${prefix}-${++this.n}`; }
}
const STORE_UP = { available: async () => true };
const INTEGRITY_OK = { verify: async () => "ok" as const };

const v = (artifactId: string): string => `${artifactId}-v1`;

let db: PgDatabase;
let deps: DeliveryDeps;
let controller: FilesDeliveryController;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG, OTHER_ORG);

  await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy"] });
  await seedOrg({ orgId: OTHER_ORG, projectId: OTHER_PROJECT, teamNames: ["water"] });
  await addOrgMember(ORG, "u-in", "consultant", `${ORG}-team-energy`);
  await addProjectMember(ORG, PROJECT, "u-in", "facilitator", null, true);
  // "u-in" belongs to ORG only -- has no membership at all in OTHER_ORG, which is the
  // simplest real shape of "cannot see this": not merely a different team, an org this
  // requester was never seated in.

  // A REAL artifact -- in the OTHER org, where "u-in" holds no membership whatsoever.
  await addBrowserArtifact({
    orgId: OTHER_ORG, id: "f34na-real", projectId: OTHER_PROJECT, source: "upload", title: "real file",
  });

  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db),
    ids: new SeqIds(),
    grants: new PgDownloadGrantRepository(db),
    objectStore: STORE_UP,
    integrity: INTEGRITY_OK,
    urls: new IsolatedDownloadUrlBuilder(),
    provenance: new PgProvenanceRepository(db),
    idFactory: new SeqRowIds(),
    now: () => new Date(),
  };

  controller = new FilesDeliveryController(
    new PgDownloadGrantRepository(db),
    new IsolatedDownloadUrlBuilder(),
    STORE_UP,
    INTEGRITY_OK,
    new PgIdentityRepository(db),
    new SeqIds(),
    new SeqRowIds(),
    new PgProvenanceRepository(db),
  );
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG, OTHER_ORG);
});

/** A version id that was never inserted anywhere, in any org. */
const NEVER_EXISTED = "v-never-existed-f34na";

/** Real, but in an org "u-in" has no membership in at all -- the RLS-tenant-boundary case. */
const REAL_BUT_FOREIGN = v("f34na-real");

describe("APPLICATION layer: the SAME error for 'real but unreachable' and 'never existed'", () => {
  const errorOf = async (p: Promise<unknown>): Promise<FilesDeliveryError> => {
    const e = await p.then(() => null).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FilesDeliveryError);
    return e as FilesDeliveryError;
  };

  it("previewArtifactVersion: identical reasonCode and message for both inputs", async () => {
    const foreign = await errorOf(
      previewArtifactVersion(deps, { userId: "u-in", orgId: toOrgId(ORG), versionId: REAL_BUT_FOREIGN }),
    );
    const missing = await errorOf(
      previewArtifactVersion(deps, { userId: "u-in", orgId: toOrgId(ORG), versionId: NEVER_EXISTED }),
    );
    expect(foreign.reasonCode).toBe("ARTIFACT_NOT_FOUND");
    expect(missing.reasonCode).toBe("ARTIFACT_NOT_FOUND");
    expect(foreign.message).toBe(missing.message);
    expect(foreign.constructor).toBe(missing.constructor);
  });

  it("issueDownloadUrl: identical reasonCode and message for both inputs", async () => {
    const foreign = await errorOf(
      issueDownloadUrl(deps, { userId: "u-in", orgId: toOrgId(ORG), versionId: REAL_BUT_FOREIGN, purpose: "download" }),
    );
    const missing = await errorOf(
      issueDownloadUrl(deps, { userId: "u-in", orgId: toOrgId(ORG), versionId: NEVER_EXISTED, purpose: "download" }),
    );
    expect(foreign.reasonCode).toBe("ARTIFACT_NOT_FOUND");
    expect(missing.reasonCode).toBe("ARTIFACT_NOT_FOUND");
    expect(foreign.message).toBe(missing.message);
    expect(foreign.constructor).toBe(missing.constructor);
  });
});

describe("CONTROLLER layer: byte-identical HTTP shape -- bare 404, no body, for both inputs", () => {
  const principal: Principal = { userId: "u-in", orgId: toOrgId(ORG) };

  const httpErrorOf = async (p: Promise<unknown>): Promise<{ status: number; body: unknown }> => {
    try {
      await p;
      throw new Error("expected a thrown HttpException, got success");
    } catch (e) {
      const anyE = e as { getStatus: () => number; getResponse: () => unknown };
      return { status: anyE.getStatus(), body: anyE.getResponse() };
    }
  };

  it("GET preview: same status, same body for 'real but unreachable' and 'never existed'", async () => {
    const foreign = await httpErrorOf(controller.preview(principal, REAL_BUT_FOREIGN));
    const missing = await httpErrorOf(controller.preview(principal, NEVER_EXISTED));
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    // Bare: no `reasonCode`, no artifact reference of any kind in the body.
    expect(JSON.stringify(foreign.body)).not.toMatch(/f34na-real|reasonCode/);
  });

  it("POST download-url: same status, same body for 'real but unreachable' and 'never existed'", async () => {
    const foreign = await httpErrorOf(controller.issue(principal, REAL_BUT_FOREIGN, "download"));
    const missing = await httpErrorOf(controller.issue(principal, NEVER_EXISTED, "download"));
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(JSON.stringify(foreign.body)).not.toMatch(/f34na-real|reasonCode/);
  });
});
