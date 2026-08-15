import { beforeEach, describe, expect, it, vi } from "vitest";
import { setConsentDecision } from "@/lib/live-consent";

const request = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({ apiRequest: request }));

/**
 * issue #854 —— 这条单测钉住 `consent-form.tsx` → `live-consent.ts` → 真实 HTTP 之间
 * 唯一的接口面：请求方法/路径/body 形状与 `setConsentDecision` 契约（#652）逐字一致，
 * 且 bearer token 被真的传下去（不是本地假装成功）。
 */
describe("live-consent.setConsentDecision", () => {
  beforeEach(() => request.mockReset());

  it("posts exactly one contract-shaped body per call, with the bearer token forwarded", async () => {
    request.mockResolvedValue({
      participantId: "person-1",
      item: "attribution",
      state: "granted",
      updatedAt: "2026-08-15T00:00:00.000Z",
    });

    await expect(
      setConsentDecision(
        {
          projectId: "proj-1",
          sourceRefId: "thread-1",
          participantId: "person-1",
          item: "attribution",
          state: "granted",
        },
        "sess-token",
      ),
    ).resolves.toMatchObject({ participantId: "person-1", item: "attribution", state: "granted" });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/recording/consent/decisions", {
      method: "POST",
      body: {
        projectId: "proj-1",
        sourceRefId: "thread-1",
        participantId: "person-1",
        item: "attribution",
        state: "granted",
      },
      sessionToken: "sess-token",
    });
  });
});
