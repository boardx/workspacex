/**
 * 迭代 14 —— 设备预设与缩放。**纯函数先测**：`fitScale` 在 jsdom 里量不到布局，
 * 做成纯函数才验得了，也才不用为了测它去 mock ResizeObserver。
 */
import { describe, expect, it } from "vitest";
import {
  DEVICE_PRESETS, DEFAULT_PRESET_ID, presetById, defaultPresetFor, rotated, fitScale,
} from "@/lib/prototype-devices";

describe("设备预设表", () => {
  it("id 唯一、尺寸是真实逻辑分辨率（不是拍脑袋的画板尺寸）", () => {
    expect(new Set(DEVICE_PRESETS.map((p) => p.id)).size).toBe(DEVICE_PRESETS.length);
    // ⭐ 反证：把 iPhone 改回 300×560 这种"看着像手机"的尺寸 ⇒ 这条红。
    //   比例不真，"这行字在真机上有多小"就答不出来，模拟也就没有意义。
    const iphone = presetById("iphone");
    expect([iphone.w, iphone.h]).toEqual([393, 852]);
    for (const p of DEVICE_PRESETS) {
      expect(p.w, p.id).toBeGreaterThan(0);
      expect(p.h, p.id).toBeGreaterThan(0);
      // ⚠ 「高 > 宽」只对**可旋转**的预设成立：手机/平板的自然方向是竖的，
      //   而笔记本/桌面天生是横的（1280×800）。第一版把这条写成对所有预设都成立，
      //   被 laptop 当场判红——是断言错了，不是表错了。
      if (p.rotatable) expect(p.h / p.w, `${p.id} 竖向预设的高应大于宽`).toBeGreaterThan(1);
      else expect(p.w / p.h, `${p.id} 横向预设的宽应大于高`).toBeGreaterThan(1);
    }
  });

  it("presetById 认不得的 id 回落到默认，不抛也不返回 undefined", () => {
    // 前端把 id 存在组件状态里；将来删掉一个预设时，旧状态不该让整个画布崩掉。
    expect(presetById("no-such-device").id).toBe(DEFAULT_PRESET_ID);
    expect(presetById("").id).toBe(DEFAULT_PRESET_ID);
  });

  it("模板决定默认镜头：mobile⇒iPhone / ui⇒笔记本 / wireframe⇒iPad", () => {
    expect(defaultPresetFor("mobile").id).toBe("iphone");
    expect(defaultPresetFor("ui").id).toBe("laptop");
    expect(defaultPresetFor("wireframe").id).toBe("ipad");
  });

  it("旋转交换宽高；不可旋转的预设原样返回", () => {
    const ipad = presetById("ipad");
    expect(rotated(ipad, true)).toEqual({ w: ipad.h, h: ipad.w });
    expect(rotated(ipad, false)).toEqual({ w: ipad.w, h: ipad.h });
    const laptop = presetById("laptop");
    expect(laptop.rotatable).toBe(false);
    // ⭐ 反证：`rotated` 不判 `rotatable` ⇒ 这条红，桌面浏览器会变成 800×1280 的竖条。
    expect(rotated(laptop, true)).toEqual({ w: laptop.w, h: laptop.h });
  });
});

describe("fitScale：只缩不放", () => {
  it("装得下就 1，装不下按更紧的那一维缩", () => {
    expect(fitScale({ w: 1000, h: 1000 }, { w: 393, h: 852 })).toBe(1);
    // 宽够高不够 ⇒ 按高缩
    expect(fitScale({ w: 1000, h: 426 }, { w: 393, h: 852 })).toBeCloseTo(0.5, 5);
    // 高够宽不够 ⇒ 按宽缩
    expect(fitScale({ w: 640, h: 2000 }, { w: 1280, h: 800 })).toBeCloseTo(0.5, 5);
  });

  it("**永远不放大**——哪怕容器比设备大得多", () => {
    // ⭐ 反证：去掉 `Math.min(1, …)` ⇒ 这条红。放大会让字跟着变大、看起来"很清楚"，
    //   而"这行字在真机上有多小"正是模拟要回答的问题，放大等于把答案抹掉。
    expect(fitScale({ w: 4000, h: 4000 }, { w: 393, h: 852 })).toBe(1);
  });

  it("容器还没量到（0 / 负数）⇒ 1，不产生 Infinity 或 NaN", () => {
    for (const c of [{ w: 0, h: 0 }, { w: 0, h: 500 }, { w: 500, h: 0 }, { w: -1, h: -1 }]) {
      const k = fitScale(c, { w: 393, h: 852 });
      expect(Number.isFinite(k), JSON.stringify(c)).toBe(true);
      expect(k).toBe(1);
    }
    // 设备尺寸为 0 是不该发生的，但除数为 0 会得到 Infinity——一并挡掉。
    expect(fitScale({ w: 100, h: 100 }, { w: 0, h: 0 })).toBe(1);
  });
});
