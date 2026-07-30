/**
 * 组件测试基础设施的**第一条真测试**（不是 smoke test，是一条真断言）。
 *
 * 为什么是这条：`RESERVED_STATE_TESTID` 是七态的单一事实源，它的两个消费者是
 * `state-shell.tsx`（渲染）与 `scripts/verify-ui-states.sh`（SSR 后 grep HTML）。
 * 后者要起 dev server、跑 19 屏 × 6 态，是分钟级的重门控；而「StateShell 处于某态时
 * 是否真的挂上了那个保留名」是**组件级**的事实，本该在毫秒级被验。此前验不了，
 * 原因是 `apps/web/vitest.config.ts` 的 `include` 不含 `.tsx`、environment 是 node、
 * 且 jsdom / @testing-library 全仓未安装 —— 13 个 phase-01 feature 计划写的
 * `tests/ui/*.test.tsx` 一条都收集不到（会红，但红的理由是「找不到文件」而非「行为不对」）。
 *
 * 这条测试同时是那套基础设施的**存在证明**：能 collect `.tsx`、有 DOM、能 render 真组件。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateShell } from "@/components/state/state-shell";
import { RESERVED_STATE_TESTID, UI_STATES, type UiState } from "@/lib/ui-state";

const NON_DEFAULT = UI_STATES.filter((s): s is Exclude<UiState, "default"> => s !== "default");

function renderState(state: UiState) {
  return render(
    <StateShell
      state={state}
      errors={{ email: "邮箱格式不对" }}
      depFailure={{ what: "检索服务不可用" }}
      denial={{ layer: "project", reason: "你在本项目中没有对应的角色" }}
    >
      <p data-testid="real-content">正常内容</p>
    </StateShell>,
  );
}

describe("StateShell —— 保留 testid 是渲染出来的事实，不只是常量表里的字符串", () => {
  it("六个非默认态各自挂上自己的保留名", () => {
    for (const state of NON_DEFAULT) {
      const { unmount } = renderState(state);
      const reserved = RESERVED_STATE_TESTID[state];
      // invalid 的保留名是**前缀**（`err-` + 字段名），故用真实字段拼出来断言，
      // 不把「前缀」这件事再写第二遍。
      const testid = state === "invalid" ? `${reserved}email` : reserved;
      expect(screen.getByTestId(testid)).toBeInTheDocument();
      unmount();
    }
  });

  it("互斥：处于 empty 时不得同时渲染别的态的保留名", () => {
    renderState("empty");
    for (const other of NON_DEFAULT.filter((s) => s !== "empty" && s !== "invalid")) {
      expect(screen.queryByTestId(RESERVED_STATE_TESTID[other])).toBeNull();
    }
  });

  it("default 态渲染的是真实内容，而不是任何保留名", () => {
    renderState("default");
    expect(screen.getByTestId("real-content")).toBeInTheDocument();
    for (const s of NON_DEFAULT.filter((x) => x !== "invalid")) {
      expect(screen.queryByTestId(RESERVED_STATE_TESTID[s])).toBeNull();
    }
  });

  it("断言集合非空 —— 空集会让上面三条平凡为真", () => {
    expect(NON_DEFAULT.length).toBeGreaterThanOrEqual(6);
  });
});
