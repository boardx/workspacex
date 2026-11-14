/** AIDT-only page state. It never grants access or persists a shared result. */
export type AidtStateIdentity = {
  currentOrgId?: string | null;
  userId?: string | null;
  sessionToken?: string | null;
};

/** Token refresh preserves the same student's local drafts. Actor changes do not. */
export function aidtDraftScope(identity: AidtStateIdentity | null | undefined, projectId: string): string {
  return JSON.stringify(["aidt", identity?.currentOrgId ?? null, identity?.userId ?? null, projectId]);
}

/** A previous actor's resource association must never unlock a native editor. */
export function aidtResourceScope(identity: AidtStateIdentity | null | undefined, projectId: string, tool: string, resourceId: string | null, canWrite: boolean): string {
  return JSON.stringify([aidtDraftScope(identity, projectId), identity?.sessionToken ?? null, tool, resourceId, canWrite]);
}

export function hasAidtIdentity(identity: AidtStateIdentity | null | undefined): boolean {
  return Boolean(identity?.currentOrgId && identity.userId && identity.sessionToken);
}
