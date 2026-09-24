import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionReplacementSupersededError, withSessionStorageLock } from "@/lib/session-storage-lock";
import { ApiError, storeSessionToken, clearStoredSessionToken, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const { resolveIdentity, switchCurrentOrganization, revokeWhiteboardSession } = vi.hoisted(() => ({
  resolveIdentity: vi.fn(),
  switchCurrentOrganization: vi.fn(),
  revokeWhiteboardSession: vi.fn(),
}));

vi.mock("@/lib/session-api", () => ({ resolveIdentity, switchCurrentOrganization }));
vi.mock("@/lib/whiteboard-outbox", () => ({ revokeWhiteboardSession }));

import {
  SESSION_COMMIT_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  SessionProvider,
  type SessionContextValue,
  useSession,
} from "@/components/session/session-provider";

const LOGIN = {
  sessionToken: "token-one",
  userId: "user-one",
  orgs: ["org-one", "org-two"],
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const IDENTITY_ONE = {
  org: { id: "org-one", name: "One", kind: "organization", team: "Team One", modelPolicy: "any" },
  orgRole: "lead",
  teamId: "team-one",
  projectRole: null,
  groupId: null,
  displayName: "Ada One",
};

const IDENTITY_TWO = {
  org: { id: "org-two", name: "Two", kind: "organization", team: null, modelPolicy: "self-hosted-only" },
  orgRole: "admin",
  teamId: null,
  projectRole: null,
  groupId: null,
  displayName: "Bea Two",
};

function Probe() {
  const session = useSession();
  return (
    <div>
      <output data-testid="status">{session.status}</output>
      <output data-testid="org">{session.identity?.org.name ?? "none"}</output>
      <output data-testid="display-name">{session.identity?.displayName ?? "none"}</output>
      <button data-testid="sign-in" onClick={() => void session.startSession(LOGIN)}>sign in</button>
      <button data-testid="switch" onClick={() => void session.switchOrganization("org-two").catch(() => undefined)}>switch</button>
      <button data-testid="logout" onClick={session.logout}>logout</button>
      <button data-testid="retry" onClick={() => void session.retry()}>retry</button>
      <button data-testid="rename" onClick={() => session.updateDisplayName("New Name")}>rename</button>
    </div>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function storedSession(login = LOGIN, currentOrgId = "org-one") {
  return JSON.stringify({
    version: 1,
    userId: login.userId,
    orgs: login.orgs,
    currentOrgId,
    expiresAt: login.expiresAt,
  });
}

function dispatchStorage(key: string, oldValue: string | null, newValue: string | null) {
  window.dispatchEvent(new StorageEvent("storage", {
    key,
    oldValue,
    newValue,
    storageArea: window.localStorage,
  }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  resolveIdentity.mockReset();
  switchCurrentOrganization.mockReset();
  revokeWhiteboardSession.mockReset();
  revokeWhiteboardSession.mockResolvedValue([]);
});

describe("SessionProvider", () => {
  it("starts a real identity session, switches with the signed API, and logs out locally", async () => {
    resolveIdentity.mockResolvedValueOnce(IDENTITY_ONE);
    switchCurrentOrganization.mockResolvedValueOnce(IDENTITY_TWO);
    render(<SessionProvider><Probe /></SessionProvider>);

    expect(await screen.findByTestId("status")).toHaveTextContent("anonymous");
    fireEvent.click(screen.getByTestId("sign-in"));
    await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("One"));
    expect(screen.getByTestId("display-name")).toHaveTextContent("Ada One");
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe("token-one");
    const persisted = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "null") as {
      version?: number;
      revision?: string;
    } | null;
    expect(persisted?.version).toBe(2);
    expect(persisted?.revision).toBeTruthy();
    expect(window.localStorage.getItem(SESSION_COMMIT_STORAGE_KEY)).toBe(persisted?.revision);

    fireEvent.click(screen.getByTestId("switch"));
    await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("Two"));
    expect(screen.getByTestId("display-name")).toHaveTextContent("Bea Two");
    expect(switchCurrentOrganization).toHaveBeenCalledWith("org-two", "token-one");
    const switched = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "null") as {
      revision?: string;
    } | null;
    expect(switched?.revision).not.toBe(persisted?.revision);
    expect(window.localStorage.getItem(SESSION_COMMIT_STORAGE_KEY)).toBe(switched?.revision);

    fireEvent.click(screen.getByTestId("logout"));
    await waitFor(()=>expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(revokeWhiteboardSession).toHaveBeenCalledWith("user-one","token-one");
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("updateDisplayName reflects a rename immediately, without waiting on the next resolveIdentity (Addendum A / 反证 B)", async () => {
    resolveIdentity.mockResolvedValueOnce(IDENTITY_ONE).mockResolvedValue(IDENTITY_ONE);
    render(<SessionProvider><Probe /></SessionProvider>);

    fireEvent.click(screen.getByTestId("sign-in"));
    await waitFor(() => expect(screen.getByTestId("display-name")).toHaveTextContent("Ada One"));
    // LOGIN carries two orgs, so #596's "fill in the other org names" effect fires one more
    // resolveIdentity call in the background -- let it settle before taking the baseline, so
    // it is not mistaken for a call the rename itself triggered.
    await waitFor(() => expect(resolveIdentity).toHaveBeenCalledTimes(2));
    const callsBeforeRename = resolveIdentity.mock.calls.length;

    // Simulates ProfileForm calling `session.updateDisplayName()` with the PATCH response's
    // `out.displayName` right after a save -- no additional resolveIdentity call, and status
    // must stay "authenticated" the whole time (no loading flash that would hide the save).
    fireEvent.click(screen.getByTestId("rename"));
    expect(screen.getByTestId("display-name")).toHaveTextContent("New Name");
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(resolveIdentity).toHaveBeenCalledTimes(callsBeforeRename);
  });

  it("still becomes anonymous when durable Board cleanup reports an IndexedDB failure",async()=>{
    resolveIdentity.mockResolvedValueOnce(IDENTITY_ONE);revokeWhiteboardSession.mockRejectedValueOnce(new Error('indexeddb unavailable'));render(<SessionProvider><Probe/></SessionProvider>);
    fireEvent.click(await screen.findByTestId('sign-in'));await waitFor(()=>expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));fireEvent.click(screen.getByTestId('logout'));
    await waitFor(()=>expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("clears an invalid session on 401", async () => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, LOGIN.sessionToken);
    window.localStorage.setItem("wsx.session", JSON.stringify({ ...LOGIN, currentOrgId: "org-one", version: 1 }));
    resolveIdentity.mockRejectedValueOnce(new ApiError(401, null, {}));

    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
    expect(revokeWhiteboardSession).toHaveBeenCalledWith(LOGIN.userId,LOGIN.sessionToken);
  });

  it("preserves the bearer session on dependency failure so retry can recover", async () => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, LOGIN.sessionToken);
    window.localStorage.setItem("wsx.session", JSON.stringify({ ...LOGIN, currentOrgId: "org-one", version: 1 }));
    resolveIdentity
      .mockRejectedValueOnce(new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", {}))
      .mockResolvedValueOnce(IDENTITY_ONE);

    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("dependency-failed"));
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe("token-one");

    fireEvent.click(screen.getByTestId("retry"));
    await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("One"));
  });

  it.each([SESSION_STORAGE_KEY, SESSION_TOKEN_STORAGE_KEY])(
    "fails closed when another tab removes %s",
    async (removedKey) => {
      resolveIdentity.mockResolvedValueOnce(IDENTITY_ONE);
      render(<SessionProvider><Probe /></SessionProvider>);
      await screen.findByText("anonymous");
      fireEvent.click(screen.getByTestId("sign-in"));
      await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("One"));

      const oldValue = window.localStorage.getItem(removedKey);
      window.localStorage.removeItem(removedKey);
      dispatchStorage(removedKey, oldValue, null);

      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
      expect(screen.getByTestId("org")).toHaveTextContent("none");
      expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
    },
  );

  it.each([SESSION_STORAGE_KEY, SESSION_TOKEN_STORAGE_KEY])(
    "external replacement reported through %s invalidates an older in-flight hydrate",
    async (changedKey) => {
      const oldHydrate = deferred<typeof IDENTITY_ONE>();
      resolveIdentity.mockReturnValueOnce(oldHydrate.promise).mockResolvedValueOnce(IDENTITY_TWO);
      window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, LOGIN.sessionToken);
      window.localStorage.setItem(SESSION_STORAGE_KEY, storedSession());
      render(<SessionProvider><Probe /></SessionProvider>);
      await waitFor(() => expect(resolveIdentity).toHaveBeenCalledOnce());

      const replacement = {
        ...LOGIN,
        sessionToken: "token-two",
        userId: "user-two",
        orgs: ["org-two"],
      };
      const oldValue = window.localStorage.getItem(changedKey);
      window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, replacement.sessionToken);
      window.localStorage.setItem(SESSION_STORAGE_KEY, storedSession(replacement, "org-two"));
      dispatchStorage(changedKey, oldValue, window.localStorage.getItem(changedKey));

      await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("Two"));
      expect(resolveIdentity).toHaveBeenLastCalledWith("org-two", "token-two");
      oldHydrate.resolve(IDENTITY_ONE);
      await Promise.resolve();
      expect(screen.getByTestId("org")).toHaveTextContent("Two");
    },
  );

  it("does not destroy a new cross-tab session when metadata arrives before its token", async () => {
    resolveIdentity.mockResolvedValueOnce(IDENTITY_ONE);
    render(<SessionProvider><Probe /></SessionProvider>);
    await screen.findByText("anonymous");

    const metadata = storedSession();
    window.localStorage.setItem(SESSION_STORAGE_KEY, metadata);
    dispatchStorage(SESSION_STORAGE_KEY, null, metadata);

    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(metadata);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loading"));

    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, LOGIN.sessionToken);
    dispatchStorage(SESSION_TOKEN_STORAGE_KEY, null, LOGIN.sessionToken);

    await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("One"));
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(metadata);
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe(LOGIN.sessionToken);
  });

  it("does not destroy a non-empty cross-tab token while its metadata is pending", async () => {
    resolveIdentity.mockResolvedValueOnce(IDENTITY_ONE);
    render(<SessionProvider><Probe /></SessionProvider>);
    await screen.findByText("anonymous");

    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, LOGIN.sessionToken);
    dispatchStorage(SESSION_TOKEN_STORAGE_KEY, null, LOGIN.sessionToken);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loading"));
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe(LOGIN.sessionToken);

    const metadata = storedSession();
    window.localStorage.setItem(SESSION_STORAGE_KEY, metadata);
    dispatchStorage(SESSION_STORAGE_KEY, null, metadata);

    await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("One"));
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(metadata);
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe(LOGIN.sessionToken);
  });

  it("hydrates a versioned cross-tab session only after its ordered commit arrives", async () => {
    resolveIdentity.mockResolvedValueOnce(IDENTITY_ONE);
    render(<SessionProvider><Probe /></SessionProvider>);
    await screen.findByText("anonymous");

    const revision = "revision-one";
    const metadata = JSON.stringify({
      version: 2,
      revision,
      userId: LOGIN.userId,
      orgs: LOGIN.orgs,
      currentOrgId: "org-one",
      expiresAt: LOGIN.expiresAt,
    });
    window.localStorage.setItem(SESSION_STORAGE_KEY, metadata);
    dispatchStorage(SESSION_STORAGE_KEY, null, metadata);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loading"));
    expect(resolveIdentity).not.toHaveBeenCalled();

    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, LOGIN.sessionToken);
    dispatchStorage(SESSION_TOKEN_STORAGE_KEY, null, LOGIN.sessionToken);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loading"));
    expect(resolveIdentity).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(metadata);

    window.localStorage.setItem(SESSION_COMMIT_STORAGE_KEY, revision);
    dispatchStorage(SESSION_COMMIT_STORAGE_KEY, null, revision);
    await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("One"));
    expect(resolveIdentity).toHaveBeenCalledWith("org-one", LOGIN.sessionToken);
  });

  it("a new session invalidates an older in-flight hydrate", async () => {
    const oldHydrate = deferred<typeof IDENTITY_TWO>();
    resolveIdentity.mockReturnValueOnce(oldHydrate.promise).mockResolvedValueOnce(IDENTITY_ONE);
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, LOGIN.sessionToken);
    window.localStorage.setItem(SESSION_STORAGE_KEY, storedSession());
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(resolveIdentity).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByTestId("sign-in"));
    await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("One"));
    oldHydrate.resolve(IDENTITY_TWO);
    await Promise.resolve();

    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("org")).toHaveTextContent("One");
  });

  it("logout invalidates an in-flight organization switch so its late response cannot restore the bearer", async () => {
    const switching = deferred<typeof IDENTITY_TWO>();
    resolveIdentity.mockResolvedValueOnce(IDENTITY_ONE);
    switchCurrentOrganization.mockReturnValueOnce(switching.promise);
    render(<SessionProvider><Probe /></SessionProvider>);
    await screen.findByText("anonymous");
    fireEvent.click(screen.getByTestId("sign-in"));
    await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("One"));

    fireEvent.click(screen.getByTestId("switch"));
    expect(switchCurrentOrganization).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("logout"));
    switching.resolve(IDENTITY_TWO);
    await Promise.resolve();
    await Promise.resolve();

    await waitFor(()=>expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(screen.getByTestId("org")).toHaveTextContent("none");
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("wsx.session")).toBeNull();
  });
});


describe("atomic invitation session replacement", () => {
  function installLocks() {
    let queue: Promise<unknown> = Promise.resolve();
    const request = vi.fn((_name: string, action: () => unknown) => {
      const result = queue.then(action);
      queue = result.catch(() => undefined);
      return result;
    });
    vi.stubGlobal("navigator", { locks: { request } });
    return request;
  }

  async function mountSession() {
    let current!: SessionContextValue;
    function Capture() { current = useSession(); return <output data-testid="atomic-status">{current.status}</output>; }
    resolveIdentity.mockResolvedValue(IDENTITY_ONE);
    render(<SessionProvider><Capture /></SessionProvider>);
    await screen.findByText("anonymous");
    return () => current;
  }

  it("rechecks under the shared lock when another login commits after the caller's check", async () => {
    const lock = installLocks();
    const current = await mountSession();
    const expectedToken = window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    const blocker = deferred<void>();
    const held = withSessionStorageLock(() => blocker.promise);
    const other = { ...LOGIN, sessionToken: "other-tab-token", userId: "other-user" };
    let otherLogin!: Promise<void>;
    let invitation!: Promise<void>;
    await act(async () => {
      otherLogin = current().startSession(other);
      invitation = current().startSession(LOGIN, { expectedToken });
      const outcomes = Promise.allSettled([otherLogin, invitation]);
      blocker.resolve();
      await held;
      const [otherResult, invitationResult] = await outcomes;
      expect(invitationResult.status).toBe("rejected");
      if (invitationResult.status === "rejected") {
        expect(invitationResult.reason).toBeInstanceOf(SessionReplacementSupersededError);
      }
      expect(otherResult.status).toBe("fulfilled");
    });
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe(other.sessionToken);
    expect(JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY)!).userId).toBe(other.userId);
    expect(resolveIdentity).not.toHaveBeenCalledWith("org-one", LOGIN.sessionToken);
    expect(lock).toHaveBeenCalled();
  });

  it("raw-token live writers and clears participate in the same lock", async () => {
    installLocks();
    const current = await mountSession();
    const blocker = deferred<void>();
    const held = withSessionStorageLock(() => blocker.promise);
    const liveLogin = storeSessionToken("live-token");
    const invitation = current().startSession(LOGIN, { expectedToken: null });
    const rejected = expect(invitation).rejects.toBeInstanceOf(SessionReplacementSupersededError);
    blocker.resolve();
    await held;
    await liveLogin;
    await rejected;
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe("live-token");
    await clearStoredSessionToken();
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("an old deletion event cannot clear a newer committed login", async () => {
    installLocks();
    const current = await mountSession();
    await act(async () => { await current().startSession(LOGIN); });
    dispatchStorage(SESSION_TOKEN_STORAGE_KEY, "previous-account-token", null);
    await waitFor(() => expect(screen.getByTestId("atomic-status")).toHaveTextContent("authenticated"));
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe(LOGIN.sessionToken);
  });

  it("automatic replacement fails closed without Web Locks while explicit login remains available", async () => {
    const current = await mountSession();
    await expect(current().startSession(LOGIN, { expectedToken: null })).rejects.toThrow("cross_tab_session_lock_unavailable");
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
    await act(async () => { await current().startSession(LOGIN); });
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe(LOGIN.sessionToken);
  });
});
