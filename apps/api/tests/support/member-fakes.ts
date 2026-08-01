/**
 * Fakes for F125's unit tests (`addProjectMember` / `changeProjectRole` /
 * `removeProjectMember`). No PostgreSQL -- these three application functions are pure
 * orchestration over `IdentityRepository` (already faked by `FakeRoleViewRepository`, F04's
 * fixture), `ProjectMembershipRepository` and `MemberSubjectResolver`, so the shared-code-path
 * and no-caching claims are testable in memory. Same reasoning `role-view-fakes.ts` gives.
 */
import type {
  AddMemberCommand,
  AddMemberOutcome,
  ChangeRoleCommand,
  ChangeRoleOutcome,
  MemberSubjectResolver,
  ProjectMembershipRepository,
  ProjectMembershipSnapshot,
  RemoveMemberCommand,
  RemoveMemberOutcome,
  ResolvedInviteGrant,
} from "../../src/application/project/member-ports";
import type { OrgId } from "../../src/domain/org-id";

/** In-memory `project_memberships`, keyed the same way the real PK is: `(projectId, userId)`. */
export class FakeProjectMembershipRepository implements ProjectMembershipRepository {
  readonly addCalls: AddMemberCommand[] = [];
  readonly changeCalls: ChangeRoleCommand[] = [];
  readonly removeCalls: RemoveMemberCommand[] = [];
  private readonly rows = new Map<string, ProjectMembershipSnapshot>();
  private readonly archived = new Set<string>();

  private key(projectId: string, userId: string): string {
    return `${projectId}:${userId}`;
  }

  /** Seed an existing membership row, as if a prior request had already written it. */
  seed(row: ProjectMembershipSnapshot): void {
    this.rows.set(this.key(row.projectId, row.userId), row);
  }

  markArchived(projectId: string): void {
    this.archived.add(projectId);
  }

  /** What a caller reading "the current state" would see -- used by the no-cache test. */
  read(projectId: string, userId: string): ProjectMembershipSnapshot | null {
    return this.rows.get(this.key(projectId, userId)) ?? null;
  }

  async addMember(cmd: AddMemberCommand): Promise<AddMemberOutcome> {
    this.addCalls.push(cmd);
    if (this.archived.has(cmd.projectId)) return { kind: "archived" };
    const k = this.key(cmd.projectId, cmd.userId);
    if (this.rows.has(k)) return { kind: "already-member" };
    const row: ProjectMembershipSnapshot = {
      projectId: cmd.projectId,
      userId: cmd.userId,
      projectRole: cmd.projectRole,
      isHost: cmd.isHost,
      groupId: cmd.groupId,
    };
    this.rows.set(k, row);
    return { kind: "added", row };
  }

  async changeRole(cmd: ChangeRoleCommand): Promise<ChangeRoleOutcome> {
    this.changeCalls.push(cmd);
    if (this.archived.has(cmd.projectId)) return { kind: "archived" };
    const k = this.key(cmd.projectId, cmd.userId);
    const existing = this.rows.get(k);
    if (existing === undefined) return { kind: "not-found" };
    const row: ProjectMembershipSnapshot = { ...existing, projectRole: cmd.projectRole, isHost: cmd.isHost };
    this.rows.set(k, row);
    return { kind: "changed", row };
  }

  async removeMember(cmd: RemoveMemberCommand): Promise<RemoveMemberOutcome> {
    this.removeCalls.push(cmd);
    if (this.archived.has(cmd.projectId)) return { kind: "archived" };
    const k = this.key(cmd.projectId, cmd.userId);
    if (!this.rows.has(k)) return { kind: "not-found" };
    this.rows.delete(k);
    return { kind: "removed" };
  }
}

/** Keyed by token. A token absent from the map resolves to `null` (not found / not consumed). */
export class FakeMemberSubjectResolver implements MemberSubjectResolver {
  constructor(private readonly grants: Readonly<Record<string, ResolvedInviteGrant>>) {}

  async resolveInviteToken(_orgId: OrgId, token: string): Promise<ResolvedInviteGrant | null> {
    return this.grants[token] ?? null;
  }
}
