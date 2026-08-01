/**
 * Fakes for F126's fourth-cell / audit-purpose tests.
 *
 * `readContent` (phase-00 F03) is pure orchestration over `IdentityRepository` +
 * `ContentRepository` + `ProvenanceWriter` -- same reasoning `role-view-fakes.ts` gives for
 * `renderRoleView`. The one thing `FakeRoleViewRepository` cannot express is a team-only
 * binding (it always returns an empty `findBindings` map, i.e. "org-wide"), and F126's V5
 * ("audit does not lift a team-only restriction") needs exactly that -- so this file adds a
 * membership fake whose bindings are configurable, plus a minimal in-memory content store.
 */
import type {
  AclObjectRef,
  BindingRow,
  IdentityRepository,
  OrganizationRow,
  OrgMembershipRow,
  ProjectMembershipRow,
} from "../../src/application/identity/ports";
import type { OrgRole, ProjectRole } from "../../src/domain/identity/roles";
import type { OrgId } from "../../src/domain/org-id";
import type { ContentItemFacts } from "../../src/domain/identity/admin-boundary";
import type { ContentRepository } from "../../src/application/identity/content-ports";
import { guard, type Guarded } from "../../src/application/security/permission-filter";

export interface FakeContentMembership {
  readonly orgRole: OrgRole | null;
  readonly teamId?: string | null;
  readonly projectRole: ProjectRole | null;
  readonly groupId?: string | null;
  readonly isHost?: boolean;
}

/**
 * Same shape as `FakeRoleViewRepository`, plus a settable team-only binding per object --
 * the one axis that fake does not vary.
 */
export class FakeBoundaryRepository implements IdentityRepository {
  private readonly bindings = new Map<string, BindingRow>();

  constructor(private readonly members: Record<string, FakeContentMembership>) {}

  /** `objectKind:objectId -> { scope: "team-only", ownerTeamId }`. */
  bindTeamOnly(object: AclObjectRef, ownerTeamId: string): void {
    this.bindings.set(`${object.kind}:${object.id}`, { scope: "team-only", ownerTeamId });
  }

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
  async findBindings(_o: OrgId, objects: readonly AclObjectRef[]): Promise<Map<string, BindingRow>> {
    const out = new Map<string, BindingRow>();
    for (const object of objects) {
      const key = `${object.kind}:${object.id}`;
      const row = this.bindings.get(key);
      if (row) out.set(key, row);
    }
    return out;
  }
  async listMemberships(): Promise<readonly { orgId: string; orgRole: OrgRole }[]> {
    return [];
  }
  async ensurePersonalLocalOrg(): Promise<OrganizationRow> {
    throw new Error("not used by F126 fixtures");
  }
  async findPersonalLocalOrg(): Promise<OrganizationRow | null> {
    return null;
  }
  async countOrgMembers(): Promise<number> {
    return 0;
  }
}

/** Deterministic ids -- same reasoning as `role-view-fakes.ts`'s `FakeDecisionIds`. */
export class FakeDecisionIds2 {
  private n = 0;
  next(): string {
    this.n += 1;
    return `d2-${this.n}`;
  }
}

interface StoredItem extends ContentItemFacts {
  readonly body: string;
}

/** In-memory `content_items` -- just enough for `readContent`'s two-port split. */
export class FakeContentRepository implements ContentRepository {
  private readonly items = new Map<string, StoredItem>();

  seed(itemId: string, item: StoredItem): void {
    this.items.set(itemId, item);
  }

  async findItemFacts(_orgId: OrgId, itemId: string): Promise<ContentItemFacts | null> {
    const item = this.items.get(itemId);
    if (!item) return null;
    return { layer: item.layer, status: item.status, ownerUserId: item.ownerUserId };
  }

  async findItemBody(_orgId: OrgId, itemId: string): Promise<Guarded<string> | null> {
    const item = this.items.get(itemId);
    if (!item) return null;
    return guard({ kind: "artifact", id: itemId }, item.body);
  }

  async countPersonalItems(): Promise<number> {
    return 0;
  }
}
