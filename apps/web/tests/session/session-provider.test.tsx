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
};

const IDENTITY_TWO = {
  org: { id: "org-two", name: "Two", kind: "organization", team: null, modelPolicy: "self-hosted-only" },
  orgRole: "admin",
  teamId: null,
  projectRole: null,
  groupId: null,
};

function Probe() {
  const session = useSession();
  return (
    <div>
      <output data-testid="status">{session.status}</output>
      <output data-testid="org">{session.identity?.org.name ?? "none"}</output>
      <button data-testid="sign-in" onClick={() => void session.startSession(LOGIN)}>sign in</button>
      <button data-testid="switch" onClick={() => void session.switchOrganization("org-two").catch(() => undefined)}>switch</button>
      <button data-testid="logout" onClick={session.logout}>logout</button>
      <button data-testid="retry" onClick={() => void session.retry()}>retry</button>
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
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe("token-one");

    fireEvent.click(screen.getByTestId("switch"));
    await waitFor(() => expect(screen.getByTestId("org")).toHaveTextContent("Two"));
    expect(switchCurrentOrganization).toHaveBeenCalledWith("org-two", "token-one");

    fireEvent.click(screen.getByTestId("logout"));
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
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
