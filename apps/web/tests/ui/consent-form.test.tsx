import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * issue #854 —— `consent-form.tsx` 从纯 mock 换成真实调 `setConsentDecision` 之后的
 * 接线验证：不测 UI 措辞细节，测的是「三条件门 + 真实写 + 失败不静默」这三件事。
 *
 * ## 为什么不直接用真实 fetch 打后端
 *
 * 这个文件是前端单测（vitest + jsdom），没有 PostgreSQL、没有跑起来的 API 进程。
 * 打真实 HTTP 落库的证据在 `apps/api/tests/rec/consent-and-retention-writers-http.test.ts`
 * （issue #652 已建、本次未改）；这里钉的是**浏览器这一侧是否真的调用了那条写路径**，
 * 与「那条写路径本身是否落库」是两件事、两处证据。
 */
const { push, setConsentDecision, sessionState } = vi.hoisted(() => ({
  push: vi.fn(),
  setConsentDecision: vi.fn(),
  sessionState: {
    sessionToken: "provider-bearer",
    currentOrgId: "org-current",
    userId: "user-current",
    orgIds: ["org-current"],
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
}));

let sessionValue: { session: typeof sessionState | null } = { session: sessionState };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status: "authenticated", ...sessionValue, identity: null, error: null }),
}));
vi.mock("@/lib/live-consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-consent")>()),
  setConsentDecision,
}));

import { ConsentForm } from "@/components/entry/consent-form";
import { ApiError } from "@/lib/api-client";

describe("ConsentForm — issue #854 接线", () => {
  beforeEach(() => {
    push.mockReset();
    setConsentDecision.mockReset();
    sessionValue = { session: sessionState };
  });

  it("链接缺参数时拒绝提交，不静默导航", async () => {
    render(<ConsentForm state="default" projectId={null} sourceRefId="thread-1" participantId="p-1" />);
    fireEvent.click(screen.getByTestId("consent-confirm"));

    await waitFor(() => expect(screen.getByTestId("consent-submit-error")).toBeInTheDocument());
    expect(setConsentDecision).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("未登录时拒绝提交，不静默导航", async () => {
    sessionValue = { session: null };
    render(<ConsentForm state="default" projectId="proj-1" sourceRefId="thread-1" participantId="p-1" />);
    fireEvent.click(screen.getByTestId("consent-confirm"));

    await waitFor(() => expect(screen.getByTestId("consent-submit-error")).toHaveTextContent("请先登录"));
    expect(setConsentDecision).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("三项齐全 + 已登录 ⇒ 逐项真实写入，全部成功后才导航到 /session", async () => {
    setConsentDecision.mockResolvedValue({
      participantId: "p-1", item: "record", state: "granted", updatedAt: "2026-08-15T00:00:00.000Z",
    });
    render(<ConsentForm state="default" projectId="proj-1" sourceRefId="thread-1" participantId="p-1" />);
    fireEvent.click(screen.getByTestId("consent-confirm"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/session"));

    // 三个 mock 条目（record/transcript/realname）各发一次，realname 映射到契约的 attribution。
    expect(setConsentDecision).toHaveBeenCalledTimes(3);
    const items = setConsentDecision.mock.calls.map(([input]) => input.item).sort();
    expect(items).toEqual(["attribution", "record", "transcript"]);
    for (const [input, token] of setConsentDecision.mock.calls) {
      expect(input.projectId).toBe("proj-1");
      expect(input.sourceRefId).toBe("thread-1");
      expect(input.participantId).toBe("p-1");
      expect(token).toBe("provider-bearer");
    }
  });

  it("服务端拒绝（NO_PROJECT_ROLE）时如实报错，不假装成功导航", async () => {
    setConsentDecision.mockRejectedValue(new ApiError(403, "NO_PROJECT_ROLE", {}));
    render(<ConsentForm state="default" projectId="proj-1" sourceRefId="thread-1" participantId="p-1" />);
    fireEvent.click(screen.getByTestId("consent-confirm"));

    await waitFor(() => expect(screen.getByTestId("consent-submit-error")).toHaveTextContent("没有角色"));
    expect(push).not.toHaveBeenCalled();
  });
});
