/**
 * In-memory ports for the export use case (F17).
 *
 * ## Why fakes here, when this project's rule is "real PostgreSQL, not a fake"
 *
 * The rule holds for what the database decides -- RLS, triggers, the one-transaction atom --
 * and `local-export-copy-not-move` / `-provenance-both-sides` / `local-import-rejected` all
 * use the real thing for exactly that reason.
 *
 * This file exists for the ONE claim a database cannot make: what happens at
 * `net.Socket.prototype.connect` while an export is in flight. Asserting that needs a
 * transport that really opens a socket, and a real transport does not. So the guard is the
 * real `ProcessEgressGuard` and the storage is fake -- the opposite split from the other
 * files, and deliberate.
 */
import type {
  ConsumedPreview,
  ExportCommitResult,
  ExportPlanItem,
  ExportVisibilitySubject,
  ExportableArtifact,
  LocalExportRepository,
} from "../../src/application/identity/local-export-ports";
import type { EgressGuard } from "../../src/application/identity/local-org-ports";
import { guard, type Guarded } from "../../src/application/security/permission-filter";
import type { ExportDeps } from "../../src/application/identity/export-to-organization";
import type {
  AclObjectRef,
  BindingRow,
  IdentityRepository,
  OrgMembershipRow,
  OrganizationRow,
  ProjectMembershipRow,
} from "../../src/application/identity/ports";
import type { OrgId } from "../../src/domain/org-id";

export const LOCAL_ORG = "org-f17-fake-local";
export const REAL_ORG = "org-f17-fake-real";
/** In the confirmed preview. */
export const SELECTED = "f17-art-selected";
/** In the local organization, deliberately NOT confirmed. */
export const UNSELECTED = "f17-art-unselected";

const ORGS: Record<string, OrganizationRow> = {
  [LOCAL_ORG]: { id: LOCAL_ORG, name: "local", kind: "personal-local", team: null, avatarUrl: null },
  [REAL_ORG]: { id: REAL_ORG, name: "real", kind: "organization", team: null, avatarUrl: null },
};

class FakeIdentityRepository implements IdentityRepository {
  async findOrganization(orgId: OrgId): Promise<OrganizationRow | null> {
    return ORGS[orgId] ?? null;
  }
  async findOrgMembership(_userId: string, orgId: OrgId): Promise<OrgMembershipRow | null> {
    return ORGS[orgId] ? { orgRole: "admin", teamId: null } : null;
  }
  async findProjectMembership(): Promise<ProjectMembershipRow | null> {
    return null;
  }
  async findBindings(_o: OrgId, _x: readonly AclObjectRef[]): Promise<Map<string, BindingRow>> {
    return new Map();
  }
  async listMemberships(): Promise<readonly { orgId: string; orgRole: "admin" }[]> {
    return [{ orgId: LOCAL_ORG, orgRole: "admin" }, { orgId: REAL_ORG, orgRole: "admin" }];
  }
  async ensurePersonalLocalOrg(): Promise<OrganizationRow> {
    return ORGS[LOCAL_ORG]!;
  }
  async findPersonalLocalOrg(): Promise<OrganizationRow | null> {
    return ORGS[LOCAL_ORG]!;
  }
  async countOrgMembers(): Promise<number> {
    return 1;
  }
}

const artifact = (id: string): ExportableArtifact => ({
  artifactId: id,
  title: `artifact ${id}`,
  source: "upload",
  synthesized: false,
  versions: [{
    versionId: `${id}-v1`,
    versionNumber: 1,
    objectStorageKey: `local/${LOCAL_ORG}/artifacts/${id}/v1`,
    contentHash: "0".repeat(64),
    mime: "application/octet-stream",
    sizeBytes: 8,
  }],
});

/** One pre-consumed-able token, single-use, exactly like the real table's conditional UPDATE. */
class FakeExportRepository implements LocalExportRepository {
  readonly commits: ExportPlanItem[][] = [];
  private spent = false;

  constructor(readonly token: string, private readonly approved: readonly string[]) {}

  async findExportable(_o: OrgId, ids: readonly string[]): Promise<readonly Guarded<ExportableArtifact>[]> {
    return ids
      .filter((id) => id === SELECTED || id === UNSELECTED)
      .map((id) => guard<ExportableArtifact>({ kind: "artifact", id }, artifact(id)));
  }
  async previewVisibility(): Promise<readonly ExportVisibilitySubject[]> {
    return [{ kind: "user", id: "u-f17-other", name: "u-f17-other（consultant）" }];
  }
  async createPreview(): Promise<{ token: string; issuedAtMs: number }> {
    return { token: this.token, issuedAtMs: Date.now() };
  }
  async consumePreview(_o: OrgId, token: string): Promise<ConsumedPreview | null> {
    if (token !== this.token || this.spent) return null;
    this.spent = true;
    return { toOrgId: REAL_ORG, artifactIds: this.approved, issuedAtMs: Date.now() };
  }
  async commitExport(input: { items: readonly ExportPlanItem[] }): Promise<ExportCommitResult> {
    this.commits.push([...input.items]);
    return { localProvenanceEventId: "ev-local", targetProvenanceEventId: "ev-target" };
  }
}

export function fakeExportDeps(opts: {
  guard: EgressGuard;
  /** Called once per version pushed. Make it open a socket to observe the aperture. */
  transport: () => Promise<unknown>;
  approved?: readonly string[];
}): { deps: ExportDeps; token: string; repo: FakeExportRepository } {
  const token = `xprv-fake-${Math.random().toString(36).slice(2)}`;
  const repo = new FakeExportRepository(token, opts.approved ?? [SELECTED]);
  return {
    token,
    repo,
    deps: {
      repo: new FakeIdentityRepository(),
      // The guarded read path mints one decision id per item; deterministic here so a
      // failure message names the item rather than a fresh uuid.
      ids: { next: () => "decision-fake" },
      exports: repo,
      egress: opts.guard,
      transport: { push: async () => void (await opts.transport()) },
      now: () => Date.now(),
    },
  };
}
