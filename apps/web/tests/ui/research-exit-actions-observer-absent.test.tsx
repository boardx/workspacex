/**
 * F147 / R5 / E4 · **观察者视角下结论区三个出口动作不存在于 DOM**
 * (`uc-24-4` E4 / R5 · N-10 · R12.1 / R12.8)
 *
 * ## 这是一条安全断言，不是样式断言（同 F144 `research-entry-observer-absent`）
 * `uc-24-4` E4 逐字：「动作按钮**不渲染**（原型 `roleNow === "obs"` 时 `actions`
 * 返回空数组 `[原型 @16,943,050B]`）——这是原型自己的实现，不是设计推断。」
 * R12.1 同时要求：阻断断言必须打在**行为**上，不是按钮的 `disabled` 属性上——
 * 对观察者而言，"行为"层面的第一件事就是**节点根本不在 DOM 里**，
 * 灰按钮在无障碍与 API 层都挡不住任何请求。
 *
 * ⇒ 因此本文件断的是**三个出口按钮根本不在 DOM 里**，判据用三层：
 *   L1 `queryByTestId` 为 null；
 *   L2 `container.innerHTML` **不含 testid 字符串**（`display:none` 过不了这条）；
 *   L3 `container.innerHTML` **不含动作文案**（换个 testid 藏起来也过不了这条）。
 *
 * ## ⚠ 这是界面投影，不是权限实现
 * 真实门控在服务端：契约 `promoteConclusionToInsight.err` 的三码
 * （`NO_EXTERNAL_SOURCE` / `EVIDENCE_IS_DISPUTED` / `CONFLICT_PENDING_HUMAN`）
 * 与角色码 `NO_PROJECT_ROLE` / `PROJECT_ROLE_INSUFFICIENT`。本测试保证的是
 * 观察者不会看到三个他点不动的按钮，不是保证他调不到接口。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RsDetailScreen } from "@/components/research-studio/rs-screens";
import { RS_CONCLUSION_ACTIONS } from "@/lib/mock/research-studio";

/** 结论区三个出口动作对应的 testid（组件里写死，本文件不各写一份，直接读组件产出）。 */
const EXIT_ACTION_TESTIDS = ["rs-act-promote", "rs-act-supplement", "rs-act-pin"] as const;

describe("F147 · 反空转：结论区确实有三个出口动作，且与契约 R2 逐字一致", () => {
  it("RS_CONCLUSION_ACTIONS 恰好三项，且 testid 恰好三个、互不相同", () => {
    expect(RS_CONCLUSION_ACTIONS).toHaveLength(3);
    expect(new Set(EXIT_ACTION_TESTIDS).size).toBe(3);
  });

  it("能写的角色下（owner / collaborator，default 态）三个动作按钮都渲染出来", () => {
    for (const view of ["owner", "collaborator"] as const) {
      const { container, unmount } = render(<RsDetailScreen state="default" view={view} />);
      for (let i = 0; i < EXIT_ACTION_TESTIDS.length; i++) {
        const el = container.querySelector(`[data-testid="${EXIT_ACTION_TESTIDS[i]}"]`);
        expect(el, `${view} 视角下看不到「${RS_CONCLUSION_ACTIONS[i]}」——它本该能看到`).not.toBeNull();
        expect(el!.textContent).toContain(RS_CONCLUSION_ACTIONS[i]);
      }
      unmount();
    }
  });
});

describe("F147 · E4 · 观察者视角（denied 态）：三个出口按钮不存在于 DOM（不是灰掉）", () => {
  it("L1 · queryByTestId 拿不到任何一个出口动作节点", () => {
    const { container, unmount } = render(<RsDetailScreen state="denied" view="owner" />);
    for (const testid of EXIT_ACTION_TESTIDS) {
      expect(
        container.querySelector(`[data-testid="${testid}"]`),
        `观察者仍能查到出口动作节点 ${testid}`,
      ).toBeNull();
    }
    unmount();
  });

  it("L2 · 整段 HTML 里连 testid 字符串都不出现（display:none 过不了这条）", () => {
    const { container, unmount } = render(<RsDetailScreen state="denied" view="owner" />);
    for (const testid of EXIT_ACTION_TESTIDS) {
      expect(
        container.innerHTML,
        `观察者的 DOM 里还留着出口动作节点 ${testid}（被藏起来了，不是没渲染）`,
      ).not.toContain(testid);
    }
    unmount();
  });

  it("L3 · 三个出口动作的文案一个字都不在 DOM 里（换 testid 藏起来也过不了）", () => {
    const { container, unmount } = render(<RsDetailScreen state="denied" view="owner" />);
    for (const label of RS_CONCLUSION_ACTIONS) {
      expect(container.innerHTML, `观察者仍能看到「${label}」`).not.toContain(label);
    }
    unmount();
  });

  it("denied 态本身可见（不是整屏空白，是明确的权限拒绝态）", () => {
    render(<RsDetailScreen state="denied" view="owner" />);
    expect(screen.getByTestId("denied")).toBeInTheDocument();
  });
});

describe("F147 · 反 disabled：能发起的角色下出口按钮没有 disabled/hidden 属性", () => {
  it("owner 视角下三个出口按钮都不是 disabled、不是 hidden —— 否则本条断言测的是灰按钮", () => {
    const { container, unmount } = render(<RsDetailScreen state="default" view="owner" />);
    for (const testid of EXIT_ACTION_TESTIDS) {
      const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement;
      expect(el).not.toBeNull();
      expect(el.disabled).toBe(false);
      expect(el.hasAttribute("hidden")).toBe(false);
    }
    unmount();
  });
});
