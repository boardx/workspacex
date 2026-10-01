/**
 * 2026-09-27 用户实测：「我在创建设计的时候，输入了一系列的问题，应该要带入到 chat 的界面。」
 * 新建时的问答由服务端汇总进 `problem`（`foldIntakeIntoProblem`：一句话 + 空行 + `- 问题：回答`）；
 * 对话最上面的「你的需求」卡片把它摆出来。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
import * as React from "react";
import { DetailChatLog, parseBrief } from "@/components/design-loop/detail-chat-log";

afterEach(cleanup);

// 与服务端 `foldIntakeIntoProblem` 产出的形状一致：一句话 + 空行 + 逐条「- 问题：回答」。
const FOLDED = "做一个团队白板，大家能一起贴便签、连线整理想法\n\n- 谁会用这个东西？：产品和设计团队，每周头脑风暴\n- 最想省掉哪一步？：会后整理便签要手抄一遍";

describe("parseBrief", () => {
  it("拆出一句话与逐条问答", () => {
    expect(parseBrief(FOLDED)).toEqual({
      brief: "做一个团队白板，大家能一起贴便签、连线整理想法",
      qa: [
        { q: "谁会用这个东西？", a: "产品和设计团队，每周头脑风暴" },
        { q: "最想省掉哪一步？", a: "会后整理便签要手抄一遍" },
      ],
    });
  });
  it("手写的背景（没有问答）⇒ 整段原样，不猜", () => {
    expect(parseBrief("一段手写的背景\n第二行")).toEqual({ brief: "一段手写的背景\n第二行", qa: [] });
  });
});

describe("对话最上面的「你的需求」卡片", () => {
  const log = (problem: string, chat: unknown[] = []) => render(
    <DetailChatLog
      project={{ problem, chat, prototype: [], frames: [] } as never}
      suggestions={[]} sending={false} fallbackReason={null} lastUserText={null} lastApplied={[]} onSend={() => undefined}
    />,
  );

  it("⭐ 反证锚点：新建时答过的题在对话里看得见（问题与回答都在）", () => {
    log(FOLDED, [{ role: "user", text: "按我写的背景和验收标准，画第一版原型。", at: "2026-09-27T07:50:00.000Z" }]);
    const card = screen.getByTestId("design-detail-brief");
    expect(card).toHaveTextContent("做一个团队白板");
    const qa = within(screen.getByTestId("design-detail-brief-qa"));
    expect(qa.getByText("谁会用这个东西？")).toBeTruthy();
    expect(qa.getByText("会后整理便签要手抄一遍")).toBeTruthy();
  });

  it("卡片在所有对话之上", () => {
    log(FOLDED, [{ role: "user", text: "第一句", at: "2026-09-27T07:50:00.000Z" }]);
    const chat = screen.getByTestId("design-detail-chat");
    expect(chat.firstElementChild?.getAttribute("data-testid")).toBe("design-detail-brief");
  });

  it("没写背景 ⇒ 不出这张卡", () => {
    log("   ");
    expect(screen.queryByTestId("design-detail-brief")).toBeNull();
  });
});
