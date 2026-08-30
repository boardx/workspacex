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

  it("server-renders the login form while hydration is pending so no-JS users are not stranded", () => {
    render(<LoginSessionGate><div>login form</div></LoginSessionGate>);

    expect(screen.getByText("login form")).toBeInTheDocument();
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

  // 画布模板后台管理刷新掉回根目录一案：带 `?next=` 深链进 /login 时，
  // 已登录浏览器要回到深链而不是一律落到 /projects。
  it("sends an already authenticated browser back to a valid `next` deep link", async () => {
    status = "authenticated";
    render(
      <LoginSessionGate next="/canvas?screen=template-admin">
        <div>login form</div>
      </LoginSessionGate>,
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/canvas?screen=template-admin"),
    );
  });

  it("falls back to /projects when `next` is unsafe (protocol-relative injection)", async () => {
    status = "authenticated";
    render(
      <LoginSessionGate next="//evil.com">
        <div>login form</div>
      </LoginSessionGate>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/projects"));
  });
});
