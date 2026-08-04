import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginSessionGate } from "@/components/entry/login-session-gate";

const replace = vi.fn();
let status: "loading" | "anonymous" | "authenticated" | "dependency-failed" = "loading";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status }),
}));

describe("LoginSessionGate", () => {
  beforeEach(() => {
    replace.mockReset();
    status = "loading";
  });

  it("does not expose the login form while the stored session is still hydrating", () => {
    render(<LoginSessionGate><div>login form</div></LoginSessionGate>);

    expect(screen.queryByText("login form")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("renders login only after the provider proves the browser is anonymous", () => {
    status = "anonymous";
    render(<LoginSessionGate><div>login form</div></LoginSessionGate>);

    expect(screen.getByText("login form")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends an already authenticated browser to projects", async () => {
    status = "authenticated";
    render(<LoginSessionGate><div>login form</div></LoginSessionGate>);

    expect(screen.queryByText("login form")).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/projects"));
  });
});
