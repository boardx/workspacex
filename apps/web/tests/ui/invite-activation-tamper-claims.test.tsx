import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * issue #592 残余缺口的反证：**篡改审计的链条在前端这一端是断的**。
 *
 * `POST /org-invites/activate` 从**查询串**收 `?org=&role=&team=` 三个「声明值」，
 * 唯一去处是 `org_invite_tamper_attempts`（`org-invite.controller.ts` 逐字写着
 * 「不收就没得审计：那样『篡改无效』只能证明到『我们没读』，证明不到『有人试过』」）。
 * 服务端那一半是真的，还有 `activation-link-tamper-server-authoritative.test.ts` 钉着。
 *
 * 但**生产里唯一的调用方是激活落地页**，而它此前把自己 URL 上的这三个参数整个丢掉，
 * 于是 `detectTamper` 永远只看到三个 null，审计表永远收不到一行——
 * 「篡改尝试写安全审计」（usecases.md / AC5）在生产里结构性地不可达。
 * 这正是 #592 本身那句「每一层都能通过自己的验收，链条却是断的」的最后一段。
 *
 * ⚠ 本文件断言的是**服务端最终看到的 URL**（用真实的 `apiUrl` 拼），不是
 * `apiRequest` 参数长什么形状——后者换一种等价写法就会假红/假绿。
 */
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: null, startSession: vi.fn() }),
}));

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiRequest };
});

import { apiUrl } from "@/lib/api-client";
import ActivatePage from "@/app/(entry)/auth/activate/page";

const TOKEN = "P_qpx-invite-token";

/** 受邀人打开链接后真正发给服务端的那个 URL。 */
function activationRequestUrl(): URL {
  expect(apiRequest).toHaveBeenCalledTimes(1);
  const [path, opts] = apiRequest.mock.calls[0]!;
  return new URL(apiUrl(path as string, (opts as { query?: Record<string, string | undefined> }).query));
}

function submitAsNewUser() {
  fireEvent.change(screen.getByTestId("activate-name"), { target: { value: "受邀人" } });
  fireEvent.change(screen.getByTestId("activate-pwd"), { target: { value: "long-enough-pass-1" } });
  fireEvent.submit(screen.getByTestId("activate-form"));
}

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockResolvedValue({ userId: "u1", orgId: "org-real", orgRole: "consultant", teamId: "", sessionId: "s1" });
  window.localStorage.clear();
});

describe("激活链接被改写 ⇒ 声明值必须原样送到服务端（否则审计表收不到任何一行）", () => {
  it("反证 A：`?t=&org=&role=&team=` 三个声明值逐字出现在激活请求的查询串上", async () => {
    render(<ActivatePage searchParams={{ t: TOKEN, org: "org-evil", role: "admin", team: "team-9" }} />);
    submitAsNewUser();

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const url = activationRequestUrl();
    expect(url.searchParams.get("org")).toBe("org-evil");
    expect(url.searchParams.get("role")).toBe("admin");
    expect(url.searchParams.get("team")).toBe("team-9");
  });

  it("声明值只进查询串，**不进请求体**——契约 `activateOrgMember.in` 是 `.strict()` 的，塞进去会被 400", async () => {
    render(<ActivatePage searchParams={{ t: TOKEN, org: "org-evil", role: "admin", team: "team-9" }} />);
    submitAsNewUser();

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, opts] = apiRequest.mock.calls[0]!;
    expect((opts as { body: unknown }).body).toEqual({
      token: TOKEN,
      mode: "new-account",
      profile: { name: "受邀人", password: "long-enough-pass-1" },
      sessionId: null,
    });
  });

  it("声明值不改变界面：落地页不回显链接里写的组织/角色（授予恒以服务端记录为准，AC5）", () => {
    render(<ActivatePage searchParams={{ t: TOKEN, org: "org-evil", role: "admin", team: "team-9" }} />);
    expect(document.body.textContent).not.toContain("org-evil");
    expect(document.body.textContent).not.toContain("team-9");
  });
});

describe("没被改写的链接 ⇒ 查询串上一个声明值都不许有", () => {
  it("`?t=` 单参数：org / role / team 三个键都不出现（「没说」不能被写成空字符串）", async () => {
    render(<ActivatePage searchParams={{ t: TOKEN }} />);
    submitAsNewUser();

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const url = activationRequestUrl();
    // 空串声明会让 `claimOf` 判 null 之外的分支变噪音，也会让审计表被正常激活灌满。
    expect(url.searchParams.has("org")).toBe(false);
    expect(url.searchParams.has("role")).toBe(false);
    expect(url.searchParams.has("team")).toBe(false);
  });

  it("重复参数（`?org=a&org=b`）与服务端 `claimOf` 同一判定：非字符串 = 「没说」，不转发", async () => {
    render(<ActivatePage searchParams={{ t: TOKEN, org: ["a", "b"], role: "admin" }} />);
    submitAsNewUser();

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const url = activationRequestUrl();
    expect(url.searchParams.has("org")).toBe(false);
    // 同一条链接上合法的那一个仍然要转发——不是「有一个怪的就整批丢掉」。
    expect(url.searchParams.get("role")).toBe("admin");
  });
});
