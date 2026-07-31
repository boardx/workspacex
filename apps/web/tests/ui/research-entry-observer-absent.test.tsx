/**
 * F144 / V1 · **观察者视角下三处入口不存在于 DOM**（`uc-24-1` E5 / R5 · N-10 · R12.8）
 *
 * ## 这是一条安全断言，不是样式断言
 * `uc-24-1` E5 逐字：「观察者角色下**入口按钮不渲染**（不是渲染后禁用）」。
 * 原型的负向印证：小组能力面 `actions` 在 `roleNow === "obs"` 时**返回空数组**
 * `[原型 @16,943,050B]`；「观察者只读：不能发言、**不能触发 agent**」`[原型 @15,415,445B]`。
 *
 * ⇒ 因此本文件断的是**节点根本不在 DOM 里**，而不是：
 *   · `display:none` / `visibility:hidden` / `hidden` 属性（都还在 DOM 里，`innerHTML` 拿得到）
 *   · `disabled`（DOM 里还在，且 `disabled` 只挡鼠标，挡不住任何请求）
 * 判据用了**三层**，任何一层单独都能被绕过：
 *   L1 `queryByTestId` 为 null；
 *   L2 `container.innerHTML` **不含 testid 字符串**（`display:none` 过不了这条）；
 *   L3 `container.innerHTML` **不含入口文案**（换个 testid 藏起来也过不了这条）。
 *
 * ## ⚠ 这是界面投影，不是权限实现
 * 真实权限在服务端：契约 `createResearch.err` 的 `NO_PROJECT_ROLE` /
 * `PROJECT_ROLE_INSUFFICIENT`。UC-0.3 R5 明确禁止「前端隐藏即安全」。
 * 本测试保证的是**观察者不会看到一个他点不动的按钮**，不是保证他调不到接口。
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NewResearchEntry } from "@/components/research-studio/new-research";
import {
  RESEARCH_ENTRY_POINTS, researchEntryTestId, canStartResearch,
} from "@/lib/research-new";
import { PROJECT_ROLES, type ProjectRole } from "@/lib/identity";

/** 能发起的三种角色（`uc-24-1` R5：引导师 / 组长 / 组员）。 */
const CAN: ProjectRole[] = ["facilitator", "groupLead", "member"];
/** 不能发起的角色。 */
const CANNOT: ProjectRole[] = ["observer"];

describe("F144 · 观察者视角下，三处入口不存在于 DOM（不是灰掉）", () => {
  it("三处入口在**能发起**的角色下都渲染出来（反空转：没有这条，下面全是平凡真）", () => {
    for (const role of CAN) {
      for (const p of RESEARCH_ENTRY_POINTS) {
        const { container, unmount } = render(<NewResearchEntry role={role} at={p.at} />);
        const el = container.querySelector(`[data-testid="${researchEntryTestId(p.at)}"]`);
        expect(el, `${role} 在「${p.where}」看不到入口——它本该能发起`).not.toBeNull();
        expect(el!.textContent).toContain(p.label);
        unmount();
      }
    }
  });

  it("L1 · 观察者：queryByTestId 拿不到入口节点", () => {
    for (const role of CANNOT) {
      for (const p of RESEARCH_ENTRY_POINTS) {
        const { container, unmount } = render(<NewResearchEntry role={role} at={p.at} />);
        expect(
          container.querySelector(`[data-testid="${researchEntryTestId(p.at)}"]`),
          `${role} 在「${p.where}」仍能查到入口节点`,
        ).toBeNull();
        unmount();
      }
    }
  });

  it("L2 · 观察者：整段 HTML 里连 testid 字符串都不出现（display:none 过不了这条）", () => {
    for (const role of CANNOT) {
      for (const p of RESEARCH_ENTRY_POINTS) {
        const { container, unmount } = render(<NewResearchEntry role={role} at={p.at} />);
        expect(
          container.innerHTML,
          `${role} 的 DOM 里还留着「${p.where}」的入口节点（被藏起来了，不是没渲染）`,
        ).not.toContain(researchEntryTestId(p.at));
        unmount();
      }
    }
  });

  it("L3 · 观察者：入口文案一个字都不在 DOM 里（换 testid 藏起来也过不了）", () => {
    for (const role of CANNOT) {
      for (const p of RESEARCH_ENTRY_POINTS) {
        const { container, unmount } = render(<NewResearchEntry role={role} at={p.at} />);
        expect(container.innerHTML, `${role} 仍能看到「${p.label}」`).not.toContain(p.label);
        // 渲染结果必须是**空**，不是「一个空壳容器里藏着东西」
        expect(container.innerHTML.trim()).toBe("");
        unmount();
      }
    }
  });

  it("反 disabled：能发起的角色下入口**没有** disabled —— 否则本条断言测的是灰按钮", () => {
    for (const p of RESEARCH_ENTRY_POINTS) {
      const { container, unmount } = render(<NewResearchEntry role="facilitator" at={p.at} />);
      const el = container.querySelector(`[data-testid="${researchEntryTestId(p.at)}"]`) as HTMLButtonElement;
      expect(el.disabled).toBe(false);
      expect(el.hasAttribute("hidden")).toBe(false);
      unmount();
    }
  });

  it("判定函数本身：四种项目角色恰好三种能发起，观察者不能", () => {
    for (const role of CAN) expect(canStartResearch(role), `${role} 应能发起`).toBe(true);
    for (const role of CANNOT) expect(canStartResearch(role), `${role} 不应能发起`).toBe(false);
    // 角色全集不许悄悄变大：新增角色必须显式归类，不能默默落进「能发起」
    expect(new Set(PROJECT_ROLES)).toEqual(new Set([...CAN, ...CANNOT]));
  });

  it("反空转：三处入口确实是三处，且 testid 互不相同", () => {
    expect(RESEARCH_ENTRY_POINTS.length).toBe(3);
    const ids = RESEARCH_ENTRY_POINTS.map((p) => researchEntryTestId(p.at));
    expect(new Set(ids).size).toBe(3);
    const labels = RESEARCH_ENTRY_POINTS.map((p) => p.label);
    expect(new Set(labels).size).toBe(3);
  });
});
