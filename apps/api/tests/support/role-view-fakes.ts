/**
 * Fakes for F04's `RenderRoleView` / `PreviewAsRole` unit tests.
 *
 * These deliberately do NOT touch `tests/support/db` / PostgreSQL: `renderRoleView` and
 * `previewAsRole` are pure projections over `authorize()`'s decision plus the (already
 * pure) role matrix, so the whole claim is testable against an in-memory `IdentityRepository`
 * -- see F07's `team-visibility-filter.test.ts` header for the same reasoning applied to a
 * different feature. Nothing here is wired into the composition root.
 */
import type {
  AclObjectRef,
  BindingRow,
  IdentityRepository,
  OrgMembershipRow,
  OrganizationRow,
  ProjectMembershipRow,
} from "../../src/application/identity/ports";
import type { OrgRole, ProjectRole } from "../../src/domain/identity/roles";
import type { ProvenanceAppendInput, ProvenanceWriter } from "../../src/application/provenance/ports";
import type { OrgId } from "../../src/domain/org-id";

export interface FakeMembership {
  readonly orgRole: OrgRole | null;
  readonly teamId?: string | null;
  readonly projectRole: ProjectRole | null;
  readonly groupId?: string | null;
  readonly isHost?: boolean;
}

/** Keyed by userId. A user absent from the map is treated as "not a member of anything". */
export class FakeRoleViewRepository implements IdentityRepository {
  constructor(private readonly members: Record<string, FakeMembership>) {}

  async findOrganization(): Promise<OrganizationRow | null> {
    return null;
  }
  async findOrgMembership(userId: string): Promise<OrgMembershipRow | null> {
    const m = this.members[userId];
    if (!m || m.orgRole === null) return null;
    return { orgRole: m.orgRole, teamId: m.teamId ?? null };
  }
  async findProjectMembership(userId: string): Promise<ProjectMembershipRow | null> {
    const m = this.members[userId];
    if (!m || m.projectRole === null) return null;
    return { projectRole: m.projectRole, groupId: m.groupId ?? null, isHost: m.isHost ?? false };
  }
  async findBindings(_o: OrgId, _objects: readonly AclObjectRef[]): Promise<Map<string, BindingRow>> {
    // No team-only bindings in these fixtures -- every object defaults to org-wide, which is
    // the correct default per `authorize.ts` (an object with no row is unrestricted, not the
    // dimension F04 is testing).
    return new Map();
  }
  async listMemberships(): Promise<readonly { orgId: string; orgRole: OrgRole }[]> {
    return [];
  }
  async ensurePersonalLocalOrg(): Promise<OrganizationRow> {
    throw new Error("not used by F04 fixtures");
  }
  async findPersonalLocalOrg(): Promise<OrganizationRow | null> {
    return null;
  }
  async countOrgMembers(): Promise<number> {
    return 0;
  }
}

/** Deterministic ids -- a failure message names the call, not a fresh uuid. */
export class FakeDecisionIds {
  private n = 0;
  next(): string {
    this.n += 1;
    return `d-${this.n}`;
  }
}

/** Records every append call so a test can assert the audit trail was actually written. */
export class FakeProvenanceWriter implements ProvenanceWriter {
  readonly appended: ProvenanceAppendInput[] = [];

  async append(input: ProvenanceAppendInput): Promise<string> {
    this.appended.push(input);
    return `ev-${this.appended.length}`;
  }
  async appendWithin(_session: unknown, input: ProvenanceAppendInput): Promise<string> {
    this.appended.push(input);
    return `ev-${this.appended.length}`;
  }
}
