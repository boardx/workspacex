import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DigitalInterviewCreate } from "@/components/itv/digital-interview-create";

describe("F04 新建批量访谈第一步", () => {
  beforeEach(() => {
    push.mockReset();
    localStorage.clear();
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-f04");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("名称、标签、主题完整后创建本地 Mock 草稿并进入 setup", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<DigitalInterviewCreate />);
    expect(screen.getByTestId("itv-create-page")).toBeInTheDocument();
    expect(screen.getByTestId("itv-step-active")).toHaveTextContent("01主题");
    expect(screen.getByTestId("itv-step-active")).toHaveClass("bg-primary", "text-primary-foreground");
    expect(screen.getByTestId("itv-create-submit")).toBeDisabled();

    fireEvent.change(screen.getByTestId("itv-create-name"), { target: { value: "德国采购决策链" } });
    fireEvent.change(screen.getByTestId("itv-create-tags"), { target: { value: "采购决策，德国市场" } });
    fireEvent.change(screen.getByTestId("itv-create-topic"), { target: { value: "德国储能采购由谁否决？" } });
    expect(screen.getByTestId("itv-create-submit")).toBeEnabled();
    expect(screen.getByTestId("itv-create-submit")).toHaveClass("bg-primary", "text-primary-foreground");
    fireEvent.click(screen.getByTestId("itv-create-submit"));

    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/itv\/mock-batch-.+\/setup$/)));
    expect(fetchMock).not.toHaveBeenCalled();
    const saved = JSON.parse(localStorage.getItem("wsx.mockDigitalInterviewDrafts.v1") ?? "{}");
    expect(Object.values(saved)[0]).toMatchObject({
      name: "德国采购决策链", tags: ["采购决策", "德国市场"],
      topic: "德国储能采购由谁否决？", status: "draft", selectedExpertIds: [],
    });
  });
});
