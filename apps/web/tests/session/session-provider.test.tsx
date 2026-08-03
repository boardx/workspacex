import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const { resolveIdentity, switchCurrentOrganization } = vi.hoisted(() => ({
  resolveIdentity: vi.fn(),
  switchCurrentOrganization: vi.fn(),
}));

vi.mock("@/lib/session-api", () => ({ resolveIdentity, switchCurrentOrganization }));

import { SessionProvider, useSession } from "@/components/session/session-provider";

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
      <button data-testid="switch" onClick={() => void session.switchOrganization("org-two")}>switch</button>
      <button data-testid="logout" onClick={session.logout}>logout</button>
      <button data-testid="retry" onClick={() => void session.retry()}>retry</button>
    </div>
  );
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
});
