/**
 * 2026-09-22 —— `/admin/local` 的导出三步流程是**演示态**，屏幕上必须说出来。
 *
 * 取证不是推测：`local-export-panel.tsx` 里只有两个 `setStep`，一次网络调用都不发；
 * 列出的成果是写死的 `DEMO_ARTIFACTS`，两个响应是契约生成的 `*Mock`。此前屏幕上
 * 没有任何一句说这件事——用户点完三步会以为东西已经进了正式组织。本仓的验收线把
 * 「实质性假功能」单列为不可豁免项，所以这条说明是必需的。
 */
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CLOUD_SWITCH_NOTES } from "@repo/contracts/deployment";
import { LocalExportPanel } from "@/components/admin/local-export-panel";

it("says on screen that the three steps are a demo and nothing leaves the machine", () => {
  render(<LocalExportPanel />);
  const notice = screen.getByTestId("local-export-demo-notice").textContent ?? "";
  expect(notice).toContain("流程演示");
  expect(notice).toContain("不会真的");
  // 还要给一条现在真的可行的路，不是只说「这是假的」
  expect(notice).toContain("下载");
  expect(screen.getByTestId("local-export-demo-badge").textContent).toBe("演示态");
});

it("the cloud-switch note no longer promises an export path that does not exist", () => {
  const note = CLOUD_SWITCH_NOTES.find((n) => n.id === "data-stays");
  expect(note).toBeDefined();
  // 反证：这句话曾经写成「要带过去，用『导出到正式组织』」——那条通道还没实现
  expect(note!.statement).not.toContain("用「导出到正式组织」");
  expect(note!.statement).toContain("还没实现");
  expect(note!.statement).toContain("下载");
});
