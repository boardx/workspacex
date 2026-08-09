"use client";

import * as React from "react";
import type { LoginOut } from "@/lib/auth";
import {
  ApiError,
  clearStoredSessionToken,
  getStoredSessionToken,
  SESSION_TOKEN_STORAGE_KEY,
  storeSessionToken,
} from "@/lib/api-client";
import type { Identity } from "@/lib/identity";
import type { OrganizationSummary } from "@/lib/org-display";
import {
  resolveIdentity,
  switchCurrentOrganization,
  type ResolvedIdentity,
} from "@/lib/session-api";

export const SESSION_STORAGE_KEY = "wsx.session";
export const SESSION_COMMIT_STORAGE_KEY = "wsx.sessionCommit";

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
  /**
   * 本会话所属的**全部**组织及其真实名称（#596）。
   *
   * ## 为什么名字要在这里补，而不是从 login 拿
   * `login` 契约的 out 只有 `orgs: string[]`（一串 id，见 `contracts/auth.ts`），
   * `resolveIdentity` 一次只回**一个**组织。于是前端手上只有 id，
   * 切换器过去就直接把 id 画出来了。
   *
   * 这里的做法是**逐个调用已签核的 `GET /identity/me?orgId=`**——不新增契约操作
   * （新增要走 ADR-023 人类签核）。代价是 N 次请求（N = 所属组织数，通常 1~2），
   * 收益是切换器上再也不会出现裸 ID。
   */
  readonly organizations: readonly OrganizationSummary[];
  readonly error: ApiError | Error | null;
  startSession(login: LoginOut): Promise<void>;
  switchOrganization(orgId: string): Promise<void>;
  retry(): Promise<void>;
  logout(): void;
  /**
   * Addendum A（#638 迭代 1 复核修复）：`updateOwnProfile` 保存成功后，用它 PATCH 响应里
   * 如实回传的 `displayName`（`update-own-profile.ts` 读的是 `UPDATE ... RETURNING` 之后的
   * 那一行，不是拍脑袋的回显）本地立刻刷新 identity——不等下一次 `resolveIdentity`。
   * 不用 `retry()`：那条路径会把 `identity` 先置 null 再重新拉，会让改名成功的界面在
   * 保存成功的同一刻先闪一下 loading 骨架，反而看起来像刚保存的东西又丢了。
   * reload / 重新登录时会走 `resolveIdentity` 的真实读路径，跟这条本地更新互相印证。
   */
  updateDisplayName(displayName: string): void;
  /**
   * 组织资料页保存成功后，用响应里如实回传的 `name` 本地立刻刷新——同
   * `updateDisplayName` 的道理：不等下一次 `resolveIdentity`/`retry()`，否则顶栏
   * 切换器和当前组织标题会在保存成功的那一刻仍然显示旧名，要刷新整页才同步
   * （同一个事实两处显示不一致）。同时更新 `organizations` 字典（切换器用它）
   * 和 `identity.org.name`（页面标题类展示用它），两处都是这份名字的读点。
   */
  updateOrgName(orgId: string, name: string): void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

function toIdentity(_userId: string, resolved: ResolvedIdentity): Identity {
  return {
    // Addendum A (#638 迭代 1 复核修复): `resolveIdentity.out.displayName` now carries the
    // real `credentials.display_name`. Before this, the contract had no display-name field
    // at all and this fell back to the raw userId -- so a rename would "save" but every
    // place reading the display name (rail avatar initial, etc.) kept showing the old value.
    displayName: resolved.displayName,
    org: resolved.org,
    orgRole: resolved.orgRole,
    projectRole: resolved.projectRole,
    projectName: null,
    groupName: null,
  };
}

function createSessionRevision(): string {
  return window.crypto.randomUUID();
}

function persistSession(session: SessionInfo): void {
  const revision = createSessionRevision();
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    version: 2,
    revision,
    userId: session.userId,
    orgs: session.orgIds,
    currentOrgId: session.currentOrgId,
    expiresAt: session.expiresAt,
  }));
  storeSessionToken(session.sessionToken);
  // Commit last so another tab never hydrates metadata against a bearer from a
  // different write. Storage events for the preceding writes remain fail-closed.
  window.localStorage.setItem(SESSION_COMMIT_STORAGE_KEY, revision);
}

function clearSession(): void {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  clearStoredSessionToken();
  window.localStorage.removeItem(SESSION_COMMIT_STORAGE_KEY);
}

type SessionRead =
  | { readonly kind: "ready"; readonly session: SessionInfo }
  | { readonly kind: "absent" | "invalid" | "pending" };

function readSession(): SessionRead {
  const sessionToken = getStoredSessionToken();
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionToken && !raw) return { kind: "absent" };
  if (!sessionToken || !raw) return { kind: "pending" };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const userId = value.userId;
    const orgIds = value.orgs;
    const currentOrgId = value.currentOrgId;
    const expiresAt = value.expiresAt;
    if (
      (value.version !== 1 && value.version !== 2) || typeof userId !== "string" ||
      !Array.isArray(orgIds) || !orgIds.every((id) => typeof id === "string") ||
      typeof currentOrgId !== "string" || !orgIds.includes(currentOrgId) ||
      typeof expiresAt !== "string" || Date.parse(expiresAt) <= Date.now()
    ) return { kind: "invalid" };
    if (value.version === 2) {
      const revision = value.revision;
      if (typeof revision !== "string" || revision.length === 0) return { kind: "invalid" };
      if (window.localStorage.getItem(SESSION_COMMIT_STORAGE_KEY) !== revision) {
        return { kind: "pending" };
      }
    }
    return {
      kind: "ready",
      session: { sessionToken, userId, orgIds, currentOrgId, expiresAt },
    };
  } catch {
    return { kind: "invalid" };
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const generationRef = React.useRef(0);
  const [status, setStatus] = React.useState<SessionStatus>("loading");
  const [session, setSession] = React.useState<SessionInfo | null>(null);
  const [identity, setIdentity] = React.useState<Identity | null>(null);
  const [error, setError] = React.useState<ApiError | Error | null>(null);
  /**
   * 已解析的组织名字典（#596）。`string` = 真名；`null` = 解析失败；缺键 = 还没查。
   *
   * ⚠ 同时留一份 `ref`：解析副作用要读「哪些还没查」，把 state 放进 effect 依赖会自激成
   * 死循环。ref 是那次读取的唯一入口，`setOrgNames` 与 ref 永远同批更新。
   */
  const orgNamesRef = React.useRef<Record<string, string | null>>({});
  const [orgNames, setOrgNames] = React.useState<Record<string, string | null>>({});

  const mergeOrgNames = React.useCallback((entries: ReadonlyArray<readonly [string, string | null]>) => {
    const next = { ...orgNamesRef.current };
    let changed = false;
    for (const [id, name] of entries) {
      if (id in next && next[id] === name) continue;
      next[id] = name;
      changed = true;
    }
    if (!changed) return;
    orgNamesRef.current = next;
    setOrgNames(next);
  }, []);

  const becomeAnonymous = React.useCallback((clearStorage: boolean) => {
    generationRef.current += 1;
    if (clearStorage) clearSession();
    setSession(null);
    setIdentity(null);
    setError(null);
    // 换人登录不得继承上一位用户看到过的组织名。
    orgNamesRef.current = {};
    setOrgNames({});
    setStatus("anonymous");
  }, []);

  const logout = React.useCallback(() => {
    becomeAnonymous(true);
  }, [becomeAnonymous]);

  const handleFailure = React.useCallback((failure: unknown, generation: number) => {
    if (generation !== generationRef.current) return;
    const normalized = failure instanceof Error ? failure : new Error("session_dependency_failed");
    if (normalized instanceof ApiError && normalized.status === 401) {
      becomeAnonymous(true);
      return;
    }
    setIdentity(null);
    setError(normalized);
    setStatus("dependency-failed");
  }, [becomeAnonymous]);

  const hydrateAtGeneration = React.useCallback(async (next: SessionInfo, generation: number) => {
    if (generation !== generationRef.current) return false;
    setSession(next);
    setError(null);
    try {
      const resolved = await resolveIdentity(next.currentOrgId, next.sessionToken);
      if (generation !== generationRef.current) return false;
      setIdentity(toIdentity(next.userId, resolved));
      setStatus("authenticated");
      return true;
    } catch (failure) {
      if (generation !== generationRef.current) return false;
      handleFailure(failure, generation);
      throw failure;
    }
  }, [handleFailure]);

  React.useEffect(() => {
    const reconcileStorage = (allowPending: boolean) => {
      const generation = ++generationRef.current;
      const result = readSession();
      setIdentity(null);
      setError(null);
      if (result.kind === "pending" && allowPending) {
        setSession(null);
        setStatus("loading");
        return;
      }
      if (result.kind !== "ready") {
        clearSession();
        setSession(null);
        setStatus("anonymous");
        return;
      }
      // Fail closed while the replacement bearer is validated against /identity/me.
      setSession(result.session);
      setStatus("loading");
      void hydrateAtGeneration(result.session, generation).catch(() => undefined);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== null && event.storageArea !== window.localStorage) return;
      if (
        event.key !== null &&
        event.key !== SESSION_STORAGE_KEY &&
        event.key !== SESSION_TOKEN_STORAGE_KEY &&
        event.key !== SESSION_COMMIT_STORAGE_KEY
      ) return;
      if (event.newValue === null) {
        becomeAnonymous(true);
        return;
      }
      reconcileStorage(true);
    };

    reconcileStorage(false);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      generationRef.current += 1;
    };
  }, [becomeAnonymous, hydrateAtGeneration]);

  /**
   * #596 ①：当前组织的名字已经在 `identity` 里了，直接收进字典 —— 不为它再发一次请求。
   *
   * ⚠ 这个 effect 必须**声明在下面那个补齐 effect 之前**：同一次提交里 React 按声明顺序
   * 跑 effect，于是补齐那一步看到的字典里已经有当前组织，不会重复 GET。
   */
  React.useEffect(() => {
    if (!identity) return;
    mergeOrgNames([[identity.org.id, identity.org.name]]);
  }, [identity, mergeOrgNames]);

  /**
   * #596 ②：把**其余**组织的名字补齐。
   *
   * 只在 `authenticated` 之后跑：此时 bearer 已经被 `/identity/me` 验过一次，
   * 不会在会话本身还没确定时先打出 N 个注定 401 的请求。
   *
   * 单个组织查失败**不**升级成整个会话的失败态（记成 `null` → 界面显示「暂不可用」）：
   * 「切换器里有一个组织读不到名字」不该把用户从一个能用的应用里踢出去。
   */
  React.useEffect(() => {
    if (status !== "authenticated" || !session) return;
    const pending = session.orgIds.filter((id) => !(id in orgNamesRef.current));
    if (pending.length === 0) return;
    const token = session.sessionToken;
    let cancelled = false;
    void Promise.all(pending.map(async (id): Promise<readonly [string, string | null]> => {
      try {
        const resolved = await resolveIdentity(id, token);
        return [id, resolved.org.name];
      } catch {
        return [id, null];
      }
    })).then((entries) => {
      if (cancelled) return;
      mergeOrgNames(entries);
    });
    return () => { cancelled = true; };
  }, [mergeOrgNames, session, status]);

  const startSession = React.useCallback(async (login: LoginOut) => {
    const generation = ++generationRef.current;
    const currentOrgId = login.orgs[0];
    if (!currentOrgId) {
      const failure = new Error("session_has_no_organization");
      clearSession();
      setSession(null);
      setIdentity(null);
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
    setIdentity(null);
    setStatus("loading");
    const applied = await hydrateAtGeneration(next, generation);
    if (!applied) throw new Error("session_operation_superseded");
  }, [hydrateAtGeneration]);

  const switchOrganization = React.useCallback(async (orgId: string) => {
    if (!session || !session.orgIds.includes(orgId) || orgId === session.currentOrgId) return;
    const generation = ++generationRef.current;
    setError(null);
    try {
      const resolved = await switchCurrentOrganization(orgId, session.sessionToken);
      if (generation !== generationRef.current) throw new Error("session_operation_superseded");
      const next = { ...session, currentOrgId: orgId };
      persistSession(next);
      setSession(next);
      setIdentity(toIdentity(next.userId, resolved));
      setStatus("authenticated");
    } catch (failure) {
      if (generation !== generationRef.current) throw failure;
      handleFailure(failure, generation);
      throw failure;
    }
  }, [handleFailure, session]);

  const retry = React.useCallback(async () => {
    if (!session) return;
    const generation = ++generationRef.current;
    setIdentity(null);
    setStatus("loading");
    const applied = await hydrateAtGeneration(session, generation);
    if (!applied) throw new Error("session_operation_superseded");
  }, [hydrateAtGeneration, session]);

  const updateDisplayName = React.useCallback((displayName: string) => {
    setIdentity((prev) => (prev ? { ...prev, displayName } : prev));
  }, []);

  const updateOrgName = React.useCallback((orgId: string, name: string) => {
    mergeOrgNames([[orgId, name]]);
    setIdentity((prev) => (prev && prev.org.id === orgId ? { ...prev, org: { ...prev.org, name } } : prev));
  }, [mergeOrgNames]);

  const organizations = React.useMemo<readonly OrganizationSummary[]>(() => {
    if (!session) return [];
    return session.orgIds.map((id) => {
      const name = orgNames[id];
      if (typeof name === "string") return { id, name, nameStatus: "ready" as const };
      // 键存在但为 null = 查过且失败；键不存在 = 还没查回来。两者的界面文案不同。
      return { id, name: null, nameStatus: id in orgNames ? ("unavailable" as const) : ("loading" as const) };
    });
  }, [orgNames, session]);

  const value = React.useMemo<SessionContextValue>(() => ({
    status, session, identity, organizations, error,
    startSession, switchOrganization, retry, logout, updateDisplayName, updateOrgName,
  }), [
    error, identity, logout, organizations, retry, session, startSession, status,
    switchOrganization, updateDisplayName, updateOrgName,
  ]);

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
