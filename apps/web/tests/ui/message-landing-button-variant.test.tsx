/**
 * issue #2126（A续，真实 devapp 实测：消息操作条布局）—— 「落地为产物」按钮与框架
 * 自带的复制/反馈/评分 toolbar 视觉上不对齐、读成两个不相关的区块。间距那部分已经在
 * #2132/#2133（PR 已合入 main）里收紧过（`gap-1.5` → `gap-1`），但按钮本身当时仍是
 * `variant="outline"`（带边框、卡片底色）——issue 原文明确要求"落地按钮改用 ghost
 * 变体"，这一条尚未落地。
 *
 * 这个测试直接钉住"按钮是不是 ghost 变体"这件事本身：`outline` 变体的类名签名是
 * `border border-border bg-card`（见 `components/ui/button.tsx` 的 `buttonVariants`），
 * `ghost` 变体没有 `border-border`/`bg-card`，只有 `text-muted-foreground`。断言按钮
 * 类名不含 `border-border`（outline 独有的边框颜色 token，⚠ 不能只查 `\bborder\b`——
 * 全部 variant 共用的 disabled 态基类里就有 `disabled:border-transparent`，会把这条
 * 判据误判成"总是命中"），且含 `text-muted-foreground`（ghost 的文字色）——不是断言
 * 字符串字面量 "ghost"（那只是 prop 值，不保证真的渲染出 ghost 的视觉）。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageLandingControls } from "@/components/chat/message-landing";

describe("MessageLandingControls 的「落地为产物（草稿）」入口按钮变体（issue #2126）", () => {
  it("是 ghost 变体，不是 outline（无边框/卡片底色，有 ghost 的文字色）", () => {
    render(
      <MessageLandingControls
        message={{ id: "cm-1", text: "hello" }}
        state={undefined}
        onOpen={() => {}}
        onTitleChange={() => {}}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
    const button = screen.getByTestId("chat-land-artifact-open-cm-1");
    expect(button.className).not.toMatch(/\bborder-border\b/);
    expect(button.className).not.toMatch(/\bbg-card\b/);
    expect(button.className).toMatch(/\btext-muted-foreground\b/);
  });
});
