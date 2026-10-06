import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateOrganizationDialog } from "@/components/shell/create-organization-dialog";
afterEach(cleanup);
function setup(create = vi.fn().mockResolvedValue({ orgId: "org-new", orgName: "新组织" })) {
  const close = vi.fn(); const select = vi.fn();
  render(<CreateOrganizationDialog open onOpenChange={close} create={create} onSelect={select} />);
  return { create, close, select };
}
describe("authenticated organization creation dialog", () => {
  it("rejects whitespace, creates once under double submit and only switches on choice", async () => {
    let finish!: (value: { orgId: string; orgName: string }) => void;
    const create = vi.fn(() => new Promise<{ orgId: string; orgName: string }>(resolve => { finish = resolve; }));
    const { select, close } = setup(create);
    fireEvent.change(screen.getByLabelText("组织名称"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("create-organization-submit"));
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("组织名称"), { target: { value: " 新组织 " } });
    fireEvent.submit(screen.getByTestId("create-organization-submit").closest("form")!);
    fireEvent.submit(screen.getByTestId("create-organization-submit").closest("form")!);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]).toEqual(["新组织", expect.any(String)]);
    expect(screen.getByText("取消")).toBeDisabled();
    finish({ orgId: "org-new", orgName: "新组织" });
    await screen.findByText("组织已创建");
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("切换到新组织"));
    expect(select).toHaveBeenCalledWith("org-new"); expect(close).toHaveBeenCalledWith(false);
  });
  it("retries uncertain failures with the identical name and key", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue({ orgId: "org-new", orgName: "新组织" });
    setup(create);
    fireEvent.change(screen.getByLabelText("组织名称"), { target: { value: "新组织" } });
    fireEvent.click(screen.getByTestId("create-organization-submit"));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("组织名称")).toBeDisabled();
    fireEvent.click(screen.getByText("重试"));
    await screen.findByText("组织已创建");
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  });
  it("cancel never calls creation or switching", () => {
    const { close, create, select } = setup();
    fireEvent.change(screen.getByLabelText("组织名称"), { target: { value: "放弃" } });
    fireEvent.click(screen.getByText("取消"));
    expect(close).toHaveBeenCalledWith(false);
    expect(create).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
  });
});
