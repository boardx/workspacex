import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-wave2-ui" }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: `Wave 2 组织 ${sessionState.currentOrgId}` },
      orgRole: "admin",
    },
  }),
}));

/**
 * 2026-08-30：「编辑」链接带 `?from=<当前 URL>`（见 `capability-catalog-screen.tsx`
 * 的 `editHrefFor`），需要 `usePathname`/`useSearchParams` 有确定返回值。
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/skill",
  useSearchParams: () => new URLSearchParams(),
}));

import { SkillScreen } from "@/components/admin/skill-screen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const importedCapability = {
  id: "skill-imported-1",
  orgId: "org-wave2-ui",
  kind: "skill",
  name: "Explicitly imported Skill",
  scope: "org-wide",
  enabled: true,
  endpoint: null,
  disabledReason: null,
};

describe("#412 explicit Skill starter-pack import", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-wave2-ui";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-wave2-ui");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the empty state honest and sends nothing until the admin explicitly confirms", async () => {
    let listCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") {
        listCount += 1;
        return jsonResponse(listCount === 1 ? [] : [importedCapability]);
      }
      expect(url.pathname).toBe("/admin/skills/starter-pack-imports");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-wave2-ui");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.packId).toBe("facilitation-core");
      expect(body.packVersion).toBe("1.0.0");
      expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      return jsonResponse({
        importId: "skill-import-1",
        packId: body.packId,
        packVersion: body.packVersion,
        packDigest: "a".repeat(64),
        status: "succeeded",
        skillIds: ["skill-imported-1"],
        versionIds: ["skill-version-1"],
        importedAt: "2026-08-04T03:30:00.000Z",
      }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillScreen state="default" />);
    expect(await screen.findByTestId("admin-skill-empty")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("skill-starter-import"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Pack ID"), { target: { value: "facilitation-core" } });
    fireEvent.change(screen.getByLabelText("Pack version"), { target: { value: "1.0.0" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("skill-starter-import-confirm"));
    expect(await screen.findByTestId("skill-starter-import-result")).toHaveTextContent("导入完成");
    expect(await screen.findByText("Explicitly imported Skill")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows a conflict as a failure and never fabricates rows", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      return url.pathname === "/capabilities"
        ? jsonResponse([])
        : jsonResponse({ reasonCode: "SKILL_STARTER_PACK_CONFLICT" }, 409);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillScreen state="default" />);
    await screen.findByTestId("admin-skill-empty");
    fireEvent.click(screen.getByTestId("skill-starter-import"));
    fireEvent.change(screen.getByLabelText("Pack ID"), { target: { value: "conflicting-pack" } });
    fireEvent.change(screen.getByLabelText("Pack version"), { target: { value: "1.0.0" } });
    fireEvent.click(screen.getByTestId("skill-starter-import-confirm"));

    expect(await screen.findByTestId("skill-starter-import-result")).toHaveTextContent(
      "SKILL_STARTER_PACK_CONFLICT",
    );
    expect(screen.getByTestId("admin-skill-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-skill-list")).not.toBeInTheDocument();
  });

  it("reuses the same idempotency key when an observable failure is explicitly retried", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let postAttempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") return jsonResponse([]);
      postAttempt += 1;
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return postAttempt === 1
        ? jsonResponse({ reasonCode: "DEPENDENCY_UNAVAILABLE" }, 503)
        : jsonResponse({
            importId: "skill-import-retry",
            packId: "facilitation-core",
            packVersion: "1.0.0",
            packDigest: "b".repeat(64),
            status: "succeeded",
            skillIds: ["skill-retry"],
            versionIds: ["skill-version-retry"],
            importedAt: "2026-08-04T03:31:00.000Z",
          }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillScreen state="default" />);
    await screen.findByTestId("admin-skill-empty");
    fireEvent.click(screen.getByTestId("skill-starter-import"));
    fireEvent.change(screen.getByLabelText("Pack ID"), { target: { value: "facilitation-core" } });
    fireEvent.change(screen.getByLabelText("Pack version"), { target: { value: "1.0.0" } });
    fireEvent.click(screen.getByTestId("skill-starter-import-confirm"));
    expect(await screen.findByTestId("skill-starter-import-result")).toHaveTextContent("DEPENDENCY_UNAVAILABLE");

    fireEvent.click(screen.getByTestId("skill-starter-import-confirm"));
    await waitFor(() => expect(requestBodies).toHaveLength(2));
    expect(requestBodies[1]?.idempotencyKey).toBe(requestBodies[0]?.idempotencyKey);
  });

  it("reports import success honestly when only the follow-up directory refresh fails", async () => {
    let listAttempt = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") {
        listAttempt += 1;
        return listAttempt === 1 ? jsonResponse([]) : jsonResponse({ reasonCode: "DEPENDENCY_UNAVAILABLE" }, 503);
      }
      return jsonResponse({
        importId: "skill-import-refresh-failed",
        packId: "facilitation-core",
        packVersion: "1.0.0",
        packDigest: "c".repeat(64),
        status: "succeeded",
        skillIds: ["skill-imported"],
        versionIds: ["skill-version-imported"],
        importedAt: "2026-08-04T03:32:00.000Z",
      }, 201);
    }));

    render(<SkillScreen state="default" />);
    await screen.findByTestId("admin-skill-empty");
    fireEvent.click(screen.getByTestId("skill-starter-import"));
    fireEvent.change(screen.getByLabelText("Pack ID"), { target: { value: "facilitation-core" } });
    fireEvent.change(screen.getByLabelText("Pack version"), { target: { value: "1.0.0" } });
    fireEvent.click(screen.getByTestId("skill-starter-import-confirm"));

    expect(await screen.findByTestId("skill-starter-import-result")).toHaveTextContent("导入完成");
    expect(screen.getByTestId("skill-starter-import-result")).toHaveTextContent("目录刷新失败");
    expect(screen.getByTestId("skill-starter-import-result")).not.toHaveTextContent("导入失败");
  });

  it("discards an old organization's pending import continuation after switching organizations", async () => {
    let resolveImport!: (response: Response) => void;
    const pendingImport = new Promise<Response>((resolve) => { resolveImport = resolve; });
    const listOrgs: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") {
        listOrgs.push(url.searchParams.get("orgId") ?? "");
        return jsonResponse([]);
      }
      return pendingImport;
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<SkillScreen state="default" />);
    await screen.findByTestId("admin-skill-empty");
    fireEvent.click(screen.getByTestId("skill-starter-import"));
    fireEvent.change(screen.getByLabelText("Pack ID"), { target: { value: "facilitation-core" } });
    fireEvent.change(screen.getByLabelText("Pack version"), { target: { value: "1.0.0" } });
    fireEvent.click(screen.getByTestId("skill-starter-import-confirm"));

    sessionState.currentOrgId = "org-wave2-next";
    view.rerender(<SkillScreen state="default" />);
    expect(await screen.findByTestId("admin-skill-empty")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pack ID")).not.toBeInTheDocument();

    resolveImport(jsonResponse({
      importId: "skill-import-old-org",
      packId: "facilitation-core",
      packVersion: "1.0.0",
      packDigest: "d".repeat(64),
      status: "succeeded",
      skillIds: ["old-org-skill"],
      versionIds: ["old-org-version"],
      importedAt: "2026-08-04T03:33:00.000Z",
    }, 201));
    await waitFor(() => expect(listOrgs).toEqual(["org-wave2-ui", "org-wave2-next"]));
    expect(screen.getByTestId("admin-skill-empty")).toBeInTheDocument();
    expect(screen.queryByText("old-org-skill")).not.toBeInTheDocument();
  });
});
