/**
 * #1172 —— 「我的本地」屏接 F16/F15 真端点之后的四条主张。
 *
 * ## 这个文件断的三件事，性质各不相同
 *
 *   ① **行为**：模型行的本机/云端判定走契约函数，云端行禁用且**给出原因**；
 *      运行时不可用时给的是启动指引，**不是**「稍后重试」，也不给切云端的入口。
 *   ② **缺席**：读失败时**不退回示例数据**。这条只断言缺席，所以配了阳性对照
 *      （成功态里那两行确实渲染得出来），否则把整段列表删掉它也会绿。
 *   ③ **反证（源码扫描）**：删掉的 `DEMO_MODELS` 不许被写回来。
 *      ①② 是渲染断言——有人在组件里加一份写死清单当兜底时，它们**照样全绿**
 *      （真端点返回什么就渲染什么，兜底只在读失败时才露头，而那条路径的断言
 *      只说「不出现示例数据的那两个名字」，换两个名字就绕过去了）。
 *      所以扫源码不是补充，它是「不许有内置清单」（F15 V1）这句话本身。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const getLocalOrg = vi.fn();
const getLocalRuntimeStatus = vi.fn();
const listCapabilities = vi.fn();

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ identity: { displayName: "林可" } }),
}));
vi.mock("@/lib/live-identity", () => ({
  getLocalOrg: (...a: unknown[]) => getLocalOrg(...a),
  getLocalRuntimeStatus: (...a: unknown[]) => getLocalRuntimeStatus(...a),
}));
vi.mock("@/lib/live-capabilities", () => ({
  listCapabilities: (...a: unknown[]) => listCapabilities(...a),
}));

import { LocalOrgLive } from "@/components/admin/local-org-live";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ORG = { org: { id: "org-local-1" }, memberCount: 1 };

function model(id: string, name: string, endpoint: string | null) {
  return { id, orgId: "org-local-1", kind: "model", name, scope: "org", enabled: true, endpoint };
}

function arrange(opts: {
  models?: unknown[];
  runtime?: { available: boolean; endpoint: string };
  orgFails?: boolean;
}) {
  if (opts.orgFails) getLocalOrg.mockRejectedValue(new Error("boom"));
  else getLocalOrg.mockResolvedValue(ORG);
  listCapabilities.mockResolvedValue(opts.models ?? []);
  getLocalRuntimeStatus.mockResolvedValue({
    ...(opts.runtime ?? { available: true, endpoint: "http://127.0.0.1:11434" }),
    failure: null,
  });
}

describe("#1172 「我的本地」真栈", () => {
  it("成员数来自 getLocalOrg，运行时状态按本地组织自己的 id 查——不是会话的当前组织", async () => {
    arrange({});
    render(<LocalOrgLive />);
    await waitFor(() => expect(screen.getByTestId("local-org-member-count")).toBeTruthy());

    expect(screen.getByTestId("local-org-member-count").textContent).toContain("1");
    // ⚠ `getLocalOrg` 无参数是契约的一部分（接受 org id 的端点就是可以被指向别人
    //    本地组织的端点）。传了参数就说明有人给它加了「以备将来」的形参。
    expect(getLocalOrg).toHaveBeenCalledWith();
    expect(getLocalRuntimeStatus).toHaveBeenCalledWith("org-local-1");
    expect(listCapabilities).toHaveBeenCalledWith("org-local-1", "model");
  });

  it("云端端点整行禁用并注明原因；本机端点不禁用（判定走契约函数，界面不自己认）", async () => {
    arrange({
      models: [
        model("m-local", "本机模型", "http://127.0.0.1:11434"),
        model("m-cloud", "云端模型", "https://api.vendor.example/v1"),
        // 局域网**不算**本机：承诺的字面是「不出本机」，不是「不出内网」。
        model("m-lan", "内网模型", "http://192.168.1.50:11434"),
      ],
    });
    render(<LocalOrgLive />);
    await waitFor(() => expect(screen.getByTestId("local-org-model-m-cloud")).toBeTruthy());

    expect(screen.getByTestId("local-org-model-m-local").getAttribute("data-disabled")).toBeNull();
    expect(screen.getByTestId("local-org-model-m-cloud").getAttribute("data-disabled")).toBe("true");
    expect(screen.getByTestId("local-org-model-m-lan").getAttribute("data-disabled")).toBe("true");
    // 禁用**且说明为什么**——「禁用但不说原因」和藏起来一样让人读作「产品做不到」。
    expect(screen.getByTestId("local-org-model-reason-m-cloud").textContent).toBeTruthy();
    expect(screen.queryByTestId("local-org-model-reason-m-local")).toBeNull();
  });

  it("组织没配模型 ⇒ 空态，不显示任何内置默认清单（F15 V1）", async () => {
    arrange({ models: [] });
    render(<LocalOrgLive />);
    await waitFor(() => expect(screen.getByTestId("local-org-models-empty")).toBeTruthy());
    expect(screen.queryByTestId(/^local-org-model-m/)).toBeNull();
  });

  it("运行时未就绪 ⇒ 启动指引，且**不出现**「稍后重试」或任何切换云端的说法", async () => {
    arrange({ runtime: { available: false, endpoint: "http://127.0.0.1:11434" } });
    render(<LocalOrgLive />);
    await waitFor(() => expect(screen.getByTestId("local-org-runtime-hint")).toBeTruthy());

    const runtime = screen.getByTestId("local-org-runtime");
    expect(runtime.textContent).toContain("未就绪");

    // ⚠ 断言的是「这句话**就是**契约常量」，不是「这句话里没有某些字眼」。
    //   第一版写的是 `not.toMatch(/改用云端/)`，当场被契约常量自己打红——那句常量
    //   逐字写着「系统不会替你改用云端模型」。按字眼查会逼人把**否定句**也删掉，
    //   而否定句正是这里要说的话。等值断言既钉住单一事实源，也顺带钉住
    //   「界面没有另外加一句自己的安慰话」。
    const C = await import("@repo/contracts/identity");
    expect(screen.getByTestId("local-org-runtime-hint").textContent)
      .toBe(C.LOCAL_RUNTIME_STARTUP_HINT);

    // 「绝不偷偷改用云端」在界面上的形态：这一块里**没有任何可点的东西**。
    // 有指引没有按钮 = 用户只能去启动运行时；给个按钮就等于给了一条绕过承诺的路。
    expect(runtime.querySelectorAll("button, a")).toHaveLength(0);
  });

  it("【缺席 + 阳性对照】读失败不退回示例数据", async () => {
    // 阳性对照：同样的渲染路径，成功时确实画得出模型行——否则下面那条缺席断言
    // 只是在为「这块根本不渲染任何东西」背书。
    arrange({ models: [model("m-local", "本机模型", "http://127.0.0.1:11434")] });
    const ok = render(<LocalOrgLive />);
    await waitFor(() => expect(screen.getByTestId("local-org-model-m-local")).toBeTruthy());
    ok.unmount();

    arrange({ orgFails: true });
    render(<LocalOrgLive />);
    await waitFor(() => expect(screen.getByTestId("local-org-load-failed")).toBeTruthy());
    expect(screen.queryByTestId(/^local-org-model-/)).toBeNull();
    expect(screen.queryByTestId("local-org-member-count")).toBeNull();
  });

  it("【反证】组件源码里不存在写死的模型清单——渲染断言抓不到「加一份兜底清单」", () => {
    for (const rel of ["../../components/admin/local-org-live.tsx", "../../components/admin/local-org-screen.tsx"]) {
      const body = readFileSync(new URL(rel, import.meta.url), "utf8");
      const code = body.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(l)).join("\n");
      // 写死清单的形状：数组字面量里出现带 endpoint 的对象。
      expect(code, `${rel} 里出现了写死的能力清单`).not.toMatch(/\{[^}]*\bendpoint\s*:\s*["'`]/);
      // 以及 mock 读点——#1172 之前这一屏从这两处取数。
      expect(code, `${rel} 仍在读 identity.mock`).not.toMatch(/generated\/identity\.mock/);
      expect(code, `${rel} 仍在读 mockIdentity()`).not.toMatch(/\bmockIdentity\s*\(/);
    }
  });
});
