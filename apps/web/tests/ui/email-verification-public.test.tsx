import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiRequest };
});

import { EmailVerification } from "@/components/entry/email-verification";

beforeEach(() => {
  apiRequest.mockReset();
});

describe("public verification landing", () => {
  it("removes the bearer from history before the confirm request and renders completion", async () => {
    window.history.replaceState({}, "", "/auth/verify-email?token=secret-bearer&campaign=mail");
    apiRequest.mockImplementationOnce(async (_path: string, options: { body: { token: string } }) => {
      expect(window.location.href).not.toContain("secret-bearer");
      expect(window.location.search).toBe("?campaign=mail");
      expect(options.body.token).toBe("secret-bearer");
      return { status: "completed" };
    });
    render(<EmailVerification />);
    await waitFor(() => expect(screen.getByTestId("email-verification-status")).toHaveTextContent("现在可以返回"));
    expect(screen.getByTestId("email-verification-success")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith("/auth/email-verifications/confirm", expect.objectContaining({ sessionToken: null }));
  });

  it("shows the same safe invalid state for an absent or rejected token", async () => {
    window.history.replaceState({}, "", "/auth/verify-email?token=expired");
    apiRequest.mockRejectedValueOnce(new ApiError(400, "VERIFICATION_LINK_INVALID", {}));
    render(<EmailVerification />);
    await waitFor(() => expect(screen.getByTestId("email-verification-status")).toHaveTextContent("重新申请"));
    expect(screen.getByTestId("email-verification-invalid")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});
