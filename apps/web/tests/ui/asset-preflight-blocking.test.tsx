/**
 * F136 —— 发布前检查清单是派生视图：每一条都能追回来源，且至少一条 `blocking: true`
 * 的红项要能真的挡住发布（`uc-23-4` R3 第四项 / domain I-22）。
 *
 * 这份测试证明的是**渲染层的真实行为**（不是 API 判定，那部分见
 * `apps/api/tests/asset/preflight-items-have-source-ref.test.ts`）：
 *
 *   §1 默认样例数据（`AG_PUBLISH_CHECKLIST`）里，至少一条是 `blocking && !passed`——
 *      别继承原型的缺陷（原型这一屏四条全 PASS，没有一条失败态）。
 *   §2 每一条渲染出来的检查项都能追回 `sourceRef`（非空，且是当前清单条目自己的值，
 *      不是界面写死的占位字符串）。
 *   §3 反证：只要还有一条 `blocking && !passed`，「发布」按钮必须禁用；把清单换成
 *      全部通过（同样的组件、只换输入），按钮必须变回可用——证明禁用态是从清单**派生**的，
 *      不是组件内部另一份写死的布尔。
 */
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AgGovernance } from "@/components/asset-governance/ag-screens";
import { AG_PUBLISH_CHECKLIST, type AssetPreflightItemView } from "@/lib/mock/asset-governance";

describe("§1 默认清单：至少一条 blocking:true 的红项（不继承原型的全绿缺陷）", () => {
  it("AG_PUBLISH_CHECKLIST 里存在 blocking && !passed 的条目", () => {
    const redBlocking = AG_PUBLISH_CHECKLIST.filter((c) => c.blocking && !c.passed);
    expect(redBlocking.length).toBeGreaterThan(0);
  });
});

describe("§2 每一条检查项都能追回来源", () => {
  it("渲染出的每一行都带非空 sourceRef，且与该条目自身的 sourceRef 一致", () => {
    render(<AgGovernance state="default" view="maintainer" />);
    const rows = screen.getAllByTestId("ag-gov-check-item");
    expect(rows.length).toBe(AG_PUBLISH_CHECKLIST.length);
    rows.forEach((row, i) => {
      const ref = row.getAttribute("data-source-ref");
      expect(ref, `第 ${i} 行缺少 sourceRef`).toBeTruthy();
      expect(ref).toBe(AG_PUBLISH_CHECKLIST[i]!.sourceRef);
    });
    cleanup();
  });

  it("不同条目的 sourceRef 各不相同——不是界面对每一行写死同一个占位串", () => {
    render(<AgGovernance state="default" view="maintainer" />);
    const refs = screen.getAllByTestId("ag-gov-check-item").map((r) => r.getAttribute("data-source-ref"));
    expect(new Set(refs).size).toBe(refs.length);
    cleanup();
  });
});

describe("§3 反证：禁用态从清单派生，不是组件内部写死", () => {
  const ALL_PASS: readonly AssetPreflightItemView[] = AG_PUBLISH_CHECKLIST.map((c) => ({ ...c, passed: true }));

  it("默认清单（含一条未清空的阻断项）—— 发布按钮必须禁用", () => {
    render(<AgGovernance state="default" view="maintainer" />);
    expect(screen.getByTestId("ag-gov-publish")).toBeDisabled();
    cleanup();
  });

  it("把同一个组件的输入换成全部 passed —— 发布按钮必须变回可用（同一份代码，两种输入，两种结果）", () => {
    render(<AgGovernance state="default" view="maintainer" checklist={ALL_PASS} />);
    expect(screen.getByTestId("ag-gov-publish")).not.toBeDisabled();
    // 全部通过时，红色徽标本身也不应出现。
    expect(screen.queryByText(/项未完成/)).toBeNull();
    cleanup();
  });

  it("只留一条 blocking:false 但 passed:false 的条目（不阻断的失败项）—— 不应禁用发布", () => {
    const nonBlockingFailure: readonly AssetPreflightItemView[] = AG_PUBLISH_CHECKLIST.map((c, i) =>
      i === 0 ? { ...c, passed: false, blocking: false } : { ...c, passed: true },
    );
    render(<AgGovernance state="default" view="maintainer" checklist={nonBlockingFailure} />);
    // 反证核心：非阻断的失败项存在，但发布依然可点——证明判据是「blocking && !passed」的
    // 交集，不是「存在任意一条 passed:false」这种更粗的判法。
    expect(screen.getByTestId("ag-gov-publish")).not.toBeDisabled();
    cleanup();
  });
});
