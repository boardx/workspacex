/**
 * issue #2126（A续，真实 devapp 实测：消息操作条布局）—— 「落地为产物」按钮与框架
 * 自带的复制/反馈/评分 toolbar 视觉上不对齐、读成两个不相关的区块。间距那部分已经在
 * #2132/#2133（PR 已合入 main）里收紧过（`gap-1.5` → `gap-1`），当时按钮本身仍是
 * `variant="outline"`（带边框、卡片底色）——issue 原文要求"落地按钮改用 ghost 变体"。
 *
 * 2026-08-27（issue #2132 续，人类对照 Claude Design 原型反馈 bug #7）—— 这条判据被
 * 一次更彻底的修法超集了：入口不再是任何一种 `<Button variant>`，而是与复制/反馈/
 * 评分同排的一个纯图标 `<button>`（`MessageLandingTrigger`，见 `message-landing.tsx`
 * 文件头）。断言的东西不变——"无边框/卡片底色 + 有 muted 文字色"，只是不再经过
 * `Button` 的 variant 系统，直接读组件自己的 className。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageLandingTrigger } from "@/components/chat/message-landing";

describe("MessageLandingTrigger 的「落地为产物（草稿）」入口按钮外观（issue #2126 → #2132）", () => {
  it("无边框/卡片底色，有 muted 文字色（不是 outline 卡片，是行内图标按钮）", () => {
    render(
      <MessageLandingTrigger
        message={{ id: "cm-1", text: "hello" }}
        state={undefined}
        onOpen={() => {}}
      />,
    );
    const button = screen.getByTestId("chat-land-artifact-open-cm-1");
    expect(button.className).not.toMatch(/\bborder-border\b/);
    expect(button.className).not.toMatch(/\bbg-card\b/);
    expect(button.className).toMatch(/\btext-muted-foreground\b/);
  });
});
