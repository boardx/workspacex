/**
 * 画布模板后台管理刷新掉回根目录一案的反证：`SessionAppShell` 检测到匿名态时，
 * 此前 `router.replace("/login")` 会把当前深链彻底丢掉。现在要带上
 * `?next=` 编码后的当前路径 + 查询串，见 `components/shell/app-shell.tsx`
 * 与 `lib/return-to.ts`。
 */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const sessionStatus = vi.hoisted(() => ({ current: "anonymous" as string }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ status: sessionStatus.current }),
}));

import { AppShell } from "@/components/shell/app-shell";

function setUrl(pathname: string, search = "") {
  window.history.replaceState({}, "", `${pathname}${search}`);
}

describe("SessionAppShell 匿名跳转带 next", () => {
  beforeEach(() => {
    replace.mockReset();
    sessionStatus.current = "anonymous";
  });

  it("刷新 /canvas/template-admin 时，跳转带上原路径的 ?next=", async () => {
    setUrl("/canvas/template-admin");
    render(
      <AppShell previewRole={null}>
        <div>content</div>
      </AppShell>,
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/canvas/template-admin")}`,
      ),
    );
  });

  it("在 /projects 上匿名时跳 /login，不附带多余的 next", async () => {
    setUrl("/projects");
    render(
      <AppShell previewRole={null}>
        <div>content</div>
      </AppShell>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});
