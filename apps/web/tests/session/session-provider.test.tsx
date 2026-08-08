import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const { resolveIdentity, switchCurrentOrganization } = vi.hoisted(() => ({
  resolveIdentity: vi.fn(),
  switchCurrentOrganization: vi.fn(),
}));

vi.mock("@/lib/session-api", () => ({ resolveIdentity, switchCurrentOrganization }));

import {
  SESSION_COMMIT_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  SessionProvider,
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
  window.localStorage.clear();
  resolveIdentity.mockReset();
  switchCurrentOrganization.mockReset();
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
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
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

  it("clears an invalid session on 401", async () => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, LOGIN.sessionToken);
    window.localStorage.setItem("wsx.session", JSON.stringify({ ...LOGIN, currentOrgId: "org-one", version: 1 }));
    resolveIdentity.mockRejectedValueOnce(new ApiError(401, null, {}));

    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
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

    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("org")).toHaveTextContent("none");
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("wsx.session")).toBeNull();
  });
});
