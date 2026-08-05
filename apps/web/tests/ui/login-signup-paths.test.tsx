import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { LoginForm } from "@/components/entry/login-form";
import { SessionProvider } from "@/components/session/session-provider";

/**
 * #547 —— 登录页必须给出**两条**新用户路径。
 *
 * 断言全部锚在真实渲染出来的节点上（`getByTestId` + 可见文本），不是断言源码里
 * 有某个字符串：把 login-form.tsx 里那段指引删掉，本文件必须变红。
 */
beforeEach(() => {
  window.localStorage.clear();
  push.mockReset();
});

function renderLogin() {
  render(
    <SessionProvider>
      <LoginForm state="default" />
    </SessionProvider>,
  );
}

describe("login page shows both new-user paths (#547)", () => {
  it("keeps the existing create-org entry untouched", () => {
    renderLogin();
    const createOrg = screen.getByTestId("login-create-org");
    expect(createOrg).toBeInTheDocument();
    expect(createOrg).toHaveTextContent("创建组织");
  });

  it("renders a second path for people invited into an existing org", () => {
    renderLogin();
    const hint = screen.getByTestId("login-invited-hint");
    expect(hint).toBeInTheDocument();
    // 它必须真的说清「被邀请的人该去哪」，而不是一句泛泛的招呼。
    expect(hint).toHaveTextContent("被邀请加入已有组织");
    expect(hint).toHaveTextContent("激活链接");
  });

  it("does not invent a self-serve join flow for invited users", () => {
    renderLogin();
    const hint = screen.getByTestId("login-invited-hint");
    // 受邀人的入场点是管理员发出的激活链接；这一格里不能出现可点的「加入」控件，
    // 否则就是在登录页发明一条后端并不存在的自助注册路径。
    expect(hint.querySelectorAll("button, a")).toHaveLength(0);
    expect(hint).toHaveTextContent("无法自行注册加入");
  });

  it("presents the two paths as one labelled choice, not a single default", () => {
    renderLogin();
    const paths = screen.getByTestId("login-signup-paths");
    expect(paths).toHaveTextContent("还没有账号？");
    expect(paths).toHaveTextContent("开一个新组织");
    // 两条路径同处一格：摘掉任意一条，这里都会变红。
    expect(paths).toContainElement(screen.getByTestId("login-create-org"));
    expect(paths).toContainElement(screen.getByTestId("login-invited-hint"));
  });
});
