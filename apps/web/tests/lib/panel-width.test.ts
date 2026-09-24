/**
 * 2026-09-23 —— 侧栏宽度的判据（纯函数层）。
 *
 * 人类要求「可以拖拽边界」。判据放在纯函数里而不是组件里，理由是 jsdom 模拟真实拖拽不可靠
 * （没有布局、指针捕获是空实现），把「指针位置→宽度」「按键→宽度」「越界夹取」做成纯函数
 * 才判得动——本仓九次「全绿但空转」，很多就出在判据落在测不动的那一层。
 */
import { describe, expect, it } from "vitest";
import {
  PANEL_WIDTH_DEFAULT, PANEL_WIDTH_KEY_STEP, PANEL_WIDTH_KEY_STEP_LARGE,
  PANEL_WIDTH_MAX, PANEL_WIDTH_MIN, clampPanelWidth, panelWidthStorageKey,
  readPanelWidth, widthFromDrag, widthFromKey, writePanelWidth,
} from "@/lib/chat-workbench/panel-width";

describe("clampPanelWidth", () => {
  it("夹到绝对上下限", () => {
    expect(clampPanelWidth(10)).toBe(PANEL_WIDTH_MIN);
    expect(clampPanelWidth(99999)).toBe(PANEL_WIDTH_MAX);
    expect(clampPanelWidth(320)).toBe(320);
  });

  it("视口给了就再夹一层：右栏不许超过半屏", () => {
    // 1000px 视口 ⇒ 上限 500，而不是绝对上限 720
    expect(clampPanelWidth(700, 1000)).toBe(500);
    // 窄视口下相对上限会低于下限，此时下限赢——不能算出一个比 min 还小的"上限"
    expect(clampPanelWidth(700, 400)).toBe(PANEL_WIDTH_MIN);
  });

  it("视口缺席时只用绝对限——不猜一个视口宽度", () => {
    // SSR/jsdom 无布局：猜一个会让服务端与客户端首帧算出不同宽度
    expect(clampPanelWidth(700, undefined)).toBe(700);
    expect(clampPanelWidth(700, Number.NaN)).toBe(700);
  });

  it("非数字回到默认宽度而不是 0", () => {
    expect(clampPanelWidth(Number.NaN)).toBe(PANEL_WIDTH_DEFAULT);
  });
});

describe("widthFromDrag", () => {
  it("右栏的把手在左边界：往左拖变宽，往右拖变窄", () => {
    expect(widthFromDrag("left", 300, 800, 700)).toBe(400);
    expect(widthFromDrag("left", 300, 800, 850)).toBe(250);
  });

  it("左栏方向相反——方向写在函数里，复用时不会把符号搞反", () => {
    expect(widthFromDrag("right", 300, 800, 900)).toBe(400);
    expect(widthFromDrag("right", 300, 800, 750)).toBe(250);
  });

  it("拖出界照旧被夹住", () => {
    expect(widthFromDrag("left", 300, 800, -5000)).toBe(PANEL_WIDTH_MAX);
    expect(widthFromDrag("left", 300, 800, 5000)).toBe(PANEL_WIDTH_MIN);
  });
});

describe("widthFromKey", () => {
  it("方向与拖拽一致：右栏 ArrowLeft 变宽", () => {
    expect(widthFromKey("left", 300, "ArrowLeft", false)).toBe(300 + PANEL_WIDTH_KEY_STEP);
    expect(widthFromKey("left", 300, "ArrowRight", false)).toBe(300 - PANEL_WIDTH_KEY_STEP);
  });

  it("Shift 走大步", () => {
    expect(widthFromKey("left", 300, "ArrowLeft", true)).toBe(300 + PANEL_WIDTH_KEY_STEP_LARGE);
  });

  it("Home/End 到两端，Enter/Space 回默认宽度", () => {
    expect(widthFromKey("left", 300, "Home", false)).toBe(PANEL_WIDTH_MAX);
    expect(widthFromKey("left", 300, "End", false)).toBe(PANEL_WIDTH_MIN);
    expect(widthFromKey("left", 500, "Enter", false)).toBe(PANEL_WIDTH_DEFAULT);
    expect(widthFromKey("left", 500, " ", false)).toBe(PANEL_WIDTH_DEFAULT);
  });

  it("认不出的按键返回 null——调用方据此不拦默认行为（Tab 还要能走出去）", () => {
    expect(widthFromKey("left", 300, "Tab", false)).toBeNull();
    expect(widthFromKey("left", 300, "a", false)).toBeNull();
  });
});

describe("持久化", () => {
  const mem = (initial?: Record<string, string>): Storage => {
    const map = new Map(Object.entries(initial ?? {}));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => { map.clear(); },
      key: () => null,
      get length() { return map.size; },
    } as Storage;
  };

  it("每条侧栏一把 key——右栏与左栏不共用一个宽度", () => {
    expect(panelWidthStorageKey("chat-inspector")).not.toBe(panelWidthStorageKey("shell-left"));
  });

  it("写了能读回来，并且读的时候照样夹", () => {
    const storage = mem();
    writePanelWidth("p", 360, storage);
    expect(readPanelWidth("p", storage)).toBe(360);
    writePanelWidth("p", 9999, storage);   // 写进去的是原值
    expect(readPanelWidth("p", storage)).toBe(PANEL_WIDTH_MAX); // 读的时候夹
  });

  it("读不到 / 不是数字 ⇒ 默认宽度，且**不**写回", () => {
    const storage = mem({ [panelWidthStorageKey("p")]: "abc" });
    expect(readPanelWidth("p", storage)).toBe(PANEL_WIDTH_DEFAULT);
    // 不悄悄「修正」旧值：那会掩盖是谁写坏的
    expect(storage.getItem(panelWidthStorageKey("p"))).toBe("abc");
    expect(readPanelWidth("p", mem())).toBe(PANEL_WIDTH_DEFAULT);
    expect(readPanelWidth("p", null)).toBe(PANEL_WIDTH_DEFAULT);
  });

  it("storage 抛异常（隐私模式/配额满）不炸——宽度不是必须持久的东西", () => {
    const throwing = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    } as unknown as Storage;
    expect(readPanelWidth("p", throwing)).toBe(PANEL_WIDTH_DEFAULT);
    expect(() => { writePanelWidth("p", 300, throwing); }).not.toThrow();
  });
});
