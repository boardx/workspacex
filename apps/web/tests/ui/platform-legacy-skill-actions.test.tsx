import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
const api = vi.hoisted(() => ({
  scan: vi.fn(),
  submit: vi.fn(),
  review: vi.fn(),
}));
vi.mock("@/lib/ai-catalog-admin", () => ({
  scanPlatformLegacySkill: api.scan,
  submitPlatformLegacySkill: api.submit,
  reviewPlatformLegacySkill: api.review,
}));
import { PlatformLegacySkillActions } from "@/components/admin/platform-legacy-skill-actions";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("submits the actual version state under the explicit target organization", async () => {
  api.submit.mockResolvedValue({ status: "待审核", versionState: "待审核" });
  const changed = vi.fn();
  render(
    <PlatformLegacySkillActions
      orgId="org-target"
      versionId="v-contract"
      versionState="草稿"
      onChanged={changed}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
  await waitFor(() =>
    expect(api.submit).toHaveBeenCalledWith("org-target", "v-contract", "草稿"),
  );
  expect(changed).toHaveBeenCalledOnce();
});
it("requires a review reason and sends only explicitly acknowledged risks", async () => {
  api.scan.mockResolvedValue({
    verdict: "risk-pending-confirm",
    findings: [
      {
        riskItemId: "risk-1",
        kind: "prompt-injection",
        detail: "Review this risk",
      },
    ],
  });
  api.review.mockResolvedValue({
    skillStatus: "已启用",
    versionState: "已启用",
    reviewRecordId: "r",
  });
  render(
    <React.StrictMode>
      <PlatformLegacySkillActions
        orgId="org-target"
        versionId="v-contract"
        versionState="待审核"
        onChanged={() => {}}
      />
    </React.StrictMode>,
  );
  expect(
    (screen.getByRole("button", { name: "审核通过" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "安全扫描" }));
  fireEvent.click(await screen.findByLabelText("Review this risk"));
  fireEvent.change(screen.getByLabelText("审核理由（必填）"), {
    target: { value: "Checked the source" },
  });
  fireEvent.click(screen.getByRole("button", { name: "审核通过" }));
  await waitFor(() =>
    expect(api.review).toHaveBeenCalledWith("org-target", {
      versionId: "v-contract",
      decision: "approve",
      reason: "Checked the source",
      riskAcks: ["risk-1"],
    }),
  );
});
it("shows real reviewer-function denial without reporting success", async () => {
  api.review.mockRejectedValue(
    new ApiError(403, "REVIEWER_FUNCTION_MISMATCH", {}),
  );
  const changed = vi.fn();
  render(
    <PlatformLegacySkillActions
      orgId="org-target"
      versionId="v-contract"
      versionState="待审核"
      onChanged={changed}
    />,
  );
  fireEvent.change(screen.getByLabelText("审核理由（必填）"), {
    target: { value: "Reason" },
  });
  fireEvent.click(screen.getByRole("button", { name: "审核通过" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "平台管理权限不能替代审核职能",
  );
  expect(changed).not.toHaveBeenCalled();
});
