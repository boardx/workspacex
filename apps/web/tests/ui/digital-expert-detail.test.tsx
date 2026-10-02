import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MOCK_DIGITAL_EXPERTS } from "@/lib/mock/digital-expert-personas";
import { DigitalExpertDetail } from "@/components/itv/digital-expert-detail";
const api = vi.hoisted(() => ({ loadDigitalExperts: vi.fn() }));
vi.mock("@/lib/interview-api", () => api);
vi.mock("@/components/itv/expert-avatar", () => ({ ExpertAvatarEditor: () => <span>Avatar</span> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("opens an accessible published expert with its actual profile and quick link", async () => {
  api.loadDigitalExperts.mockResolvedValue({ items: [{ ...MOCK_DIGITAL_EXPERTS[0], expertId: "published-support", displayName: "Published support", bio: "Published profile background" }] });
  render(<DigitalExpertDetail expertId="published-support" />);
  expect(await screen.findByRole("heading", { name: "Published support" })).toBeVisible();
  expect(screen.getByText("Published profile background")).toBeVisible();
  expect(screen.getByText("组织已发布专家")).toBeVisible();
  expect(screen.getByRole("link", { name: "快捷访谈" })).toHaveAttribute("href", "/itv/quick/new?expertId=published-support");
});
it("keeps directory recovery when an expert is unavailable", async () => {
  api.loadDigitalExperts.mockResolvedValue({ items: [] });
  render(<DigitalExpertDetail expertId="unavailable" />);
  expect(await screen.findByText("该专家不可用或无访问权限。" )).toBeVisible();
  expect(screen.getByRole("link", { name: "返回专家列表" })).toHaveAttribute("href", "/itv?tab=experts");
  expect(screen.queryByRole("link", { name: "快捷访谈" })).not.toBeInTheDocument();
});
