"use client";

import * as React from "react";
import type { LoginOut } from "@/lib/auth";
import {
  ApiError,
  clearStoredSessionToken,
  getStoredSessionToken,
  storeSessionToken,
} from "@/lib/api-client";
import type { Identity } from "@/lib/identity";
import {
  resolveIdentity,
  switchCurrentOrganization,
  type ResolvedIdentity,
} from "@/lib/session-api";

export const SESSION_STORAGE_KEY = "wsx.session";

export type SessionStatus = "loading" | "anonymous" | "authenticated" | "dependency-failed";

export interface SessionInfo {
  readonly sessionToken: string;
  readonly userId: string;
  readonly orgIds: readonly string[];
  readonly currentOrgId: string;
  readonly expiresAt: string;
}

export interface SessionContextValue {
  readonly status: SessionStatus;
  readonly session: SessionInfo | null;
  readonly identity: Identity | null;
  readonly error: ApiError | Error | null;
  startSession(login: LoginOut): Promise<void>;
  switchOrganization(orgId: string): Promise<void>;
  retry(): Promise<void>;
  logout(): void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

function toIdentity(userId: string, resolved: ResolvedIdentity): Identity {
  return {
    // The signed contracts do not expose a display-name field. Use the real user id as the
    // account label instead of inventing profile data.
    displayName: userId,
    org: resolved.org,
    orgRole: resolved.orgRole,
    projectRole: resolved.projectRole,
    projectName: null,
    groupName: null,
  };
}

function persistSession(session: SessionInfo): void {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    version: 1,
    userId: session.userId,
    orgs: session.orgIds,
    currentOrgId: session.currentOrgId,
    expiresAt: session.expiresAt,
  }));
  storeSessionToken(session.sessionToken);
}

function clearSession(): void {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  clearStoredSessionToken();
}

function readSession(): SessionInfo | null {
  const sessionToken = getStoredSessionToken();
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionToken || !raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const userId = value.userId;
    const orgIds = value.orgs;
    const currentOrgId = value.currentOrgId;
    const expiresAt = value.expiresAt;
    if (
      value.version !== 1 || typeof userId !== "string" ||
      !Array.isArray(orgIds) || !orgIds.every((id) => typeof id === "string") ||
      typeof currentOrgId !== "string" || !orgIds.includes(currentOrgId) ||
      typeof expiresAt !== "string" || Date.parse(expiresAt) <= Date.now()
    ) return null;
    return { sessionToken, userId, orgIds, currentOrgId, expiresAt };
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<SessionStatus>("loading");
  const [session, setSession] = React.useState<SessionInfo | null>(null);
  const [identity, setIdentity] = React.useState<Identity | null>(null);
  const [error, setError] = React.useState<ApiError | Error | null>(null);

  const logout = React.useCallback(() => {
    clearSession();
    setSession(null);
    setIdentity(null);
    setError(null);
    setStatus("anonymous");
  }, []);

  const handleFailure = React.useCallback((failure: unknown) => {
    const normalized = failure instanceof Error ? failure : new Error("session_dependency_failed");
    if (normalized instanceof ApiError && normalized.status === 401) {
      logout();
      return;
    }
    setIdentity(null);
    setError(normalized);
    setStatus("dependency-failed");
  }, [logout]);

  const hydrate = React.useCallback(async (next: SessionInfo) => {
    setSession(next);
    setError(null);
    try {
      const resolved = await resolveIdentity(next.currentOrgId, next.sessionToken);
      setIdentity(toIdentity(next.userId, resolved));
      setStatus("authenticated");
    } catch (failure) {
      handleFailure(failure);
      throw failure;
    }
  }, [handleFailure]);

  React.useEffect(() => {
    const stored = readSession();
    if (!stored) {
      clearSession();
      setStatus("anonymous");
      return;
    }
    void hydrate(stored).catch(() => undefined);
  }, [hydrate]);

  const startSession = React.useCallback(async (login: LoginOut) => {
    const currentOrgId = login.orgs[0];
    if (!currentOrgId) {
      const failure = new Error("session_has_no_organization");
      setError(failure);
      setStatus("dependency-failed");
      throw failure;
    }
    const next: SessionInfo = {
      sessionToken: login.sessionToken,
      userId: login.userId,
      orgIds: login.orgs,
      currentOrgId,
      expiresAt: login.expiresAt,
    };
    persistSession(next);
    await hydrate(next);
  }, [hydrate]);

  const switchOrganization = React.useCallback(async (orgId: string) => {
    if (!session || !session.orgIds.includes(orgId) || orgId === session.currentOrgId) return;
    setError(null);
    try {
      const resolved = await switchCurrentOrganization(orgId, session.sessionToken);
      const next = { ...session, currentOrgId: orgId };
      persistSession(next);
      setSession(next);
      setIdentity(toIdentity(next.userId, resolved));
      setStatus("authenticated");
    } catch (failure) {
      handleFailure(failure);
      throw failure;
    }
  }, [handleFailure, session]);

  const retry = React.useCallback(async () => {
    if (!session) return;
    await hydrate(session);
  }, [hydrate, session]);

  const value = React.useMemo<SessionContextValue>(() => ({
    status, session, identity, error, startSession, switchOrganization, retry, logout,
  }), [error, identity, logout, retry, session, startSession, status, switchOrganization]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useOptionalSession(): SessionContextValue | null {
  return React.useContext(SessionContext);
}

export function useSession(): SessionContextValue {
  const value = useOptionalSession();
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
