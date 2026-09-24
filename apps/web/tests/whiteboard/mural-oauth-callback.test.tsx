import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MuralOAuthCallbackPage from "@/app/studio/board/mural/callback/page";
import { completeMuralOAuth } from "@/lib/live-whiteboard";

const replace = vi.fn();
let query = new URLSearchParams("state=one-time&code=authorization-code");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => query,
}));
vi.mock("@/lib/live-whiteboard", () => ({ completeMuralOAuth: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  query = new URLSearchParams("state=one-time&code=authorization-code");
});
afterEach(cleanup);

describe("Mural OAuth browser callback", () => {
  it("exchanges the URL code through the authenticated API client then returns to the validated Board path", async () => {
    vi.mocked(completeMuralOAuth).mockResolvedValue({
      returnTo: "/studio/board/57d83843-21e2-40ae-8c1c-571d0ad63c80",
    });
    render(<MuralOAuthCallbackPage />);
    await waitFor(() =>
      expect(completeMuralOAuth).toHaveBeenCalledWith({
        state: "one-time",
        code: "authorization-code",
      }),
    );
    expect(replace).toHaveBeenCalledWith(
      "/studio/board/57d83843-21e2-40ae-8c1c-571d0ad63c80?mural=connected",
    );
  });
  it("shows a safe recovery message for missing or rejected callback parameters", async () => {
    query = new URLSearchParams("state=one-time");
    render(<MuralOAuthCallbackPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "返回白板并重新连接",
    );
    expect(completeMuralOAuth).not.toHaveBeenCalled();
  });
});
