/**
 * UIUX 第 17 轮 —— 「导出的这个文件叫什么名字」是一处规则，而且必须是浏览器真的会留下的名字。
 *
 * 背景（2026-09-23 本机 Chromium 实测 `<a download>` + blob URL）：
 *   "plain-name.md" => "plain-name.md"
 *   "对话助手.md"    => "download"     ← 名字连同扩展名一起被丢掉
 * 所以文件名里出现**任何**非 ASCII，用户拿到的就是一个叫 `download` 的无扩展名文件。
 * 这一组就是把那条实测钉成会红的断言。
 */
import { describe, expect, it } from "vitest";
import { exportFileStem } from "@/lib/export-file-name";
import { prototypeExportHtmlFileName } from "@/lib/prototype-export-html";

/** 浏览器留不住的名字：只要含非 ASCII 就整条作废。 */
const survivesDownload = (name: string) => /^[\x20-\x7e]+$/.test(name);

describe("UIUX 17：导出文件名（单源）", () => {
  it("中文名收成 ASCII 兜底，而不是原样塞进 download 属性", () => {
    expect(exportFileStem("对话助手", "design")).toBe("design");
    expect(exportFileStem("UI 设计稿", "design")).toBe("UI");
    expect(exportFileStem("member-flow", "design")).toBe("member-flow");
  });

  it("路径分隔符、冒号这类字符不留在名字里", () => {
    // 整名都是中文加一个斜杠 ⇒ 什么都不剩，退兜底（而不是留一个光杆 `-`）。
    expect(exportFileStem("会员/下单", "design")).toBe("design");
    expect(exportFileStem("member/flow", "design")).toBe("member-flow");
    expect(exportFileStem("a:b*c?", "design")).toBe("a-b-c");
  });

  it("超长名字截断（文件系统上限是 255 字节，后面还要接日期和扩展名）", () => {
    const stem = exportFileStem("x".repeat(400), "design");
    expect(stem.length).toBeLessThanOrEqual(80);
    // ⭐ 反证锚点：去掉 `.slice(0, 80)` ⇒ 这条红。
    expect(stem).toBe("x".repeat(80));
  });

  it("Windows 保留设备名不当文件名用", () => {
    // ⭐ 反证锚点：去掉 RESERVED 那一行 ⇒ 这两条红（Windows 上 `CON.md` 建不出来）。
    expect(exportFileStem("CON", "design")).toBe("CON-file");
    expect(exportFileStem("lpt1", "design")).toBe("lpt1-file");
  });

  it("可点击原型的文件名浏览器留得住——它以前每一次都退成 `download`", () => {
    const name = prototypeExportHtmlFileName("会员下单", new Date("2026-09-23T10:00:00"));
    // ⭐ 反证锚点：把名字改回 `${name}-可点击原型-…` ⇒ 这两条红。
    expect(survivesDownload(name)).toBe(true);
    expect(name).toBe("design-prototype-2026-09-23.html");
    expect(survivesDownload(prototypeExportHtmlFileName("member-flow", new Date("2026-09-23T10:00:00")))).toBe(true);
  });
});
