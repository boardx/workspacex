/**
 * 模型把系统提示复述回来时，不能原样交给用户（B1，2026-09-24 真实模型实测）。
 *
 * 人类要「深度研究中国的教育和人工智能会如何融合，然后生成一个 ppt」，
 * 屏幕上出现的是 **66149 字的技能内部协议**：`run_script` 协议块、
 * 「The sandbox has NO network access」、画布模板的「条数上限〔分区名=N条〕」规则。
 * 肉眼确认见 `apps/web/test-results/real-model-evidence/90-final-screen.png`。
 *
 * 它同时是体验灾难与内部信息外泄；而且很可能就是「没有产物」的成因——
 * 一个在复述协议的模型，自然不会真去写文件。
 *
 * ## 这份测试同时钉住**不许误伤**
 *
 * 判据是「两条以上标记同时命中」。单条命中不动手：用户完全可能在正常回答里
 * 提到「沙箱」或某个变量名。把一条正常回答掐掉，用户立刻就会发现且无从申诉——
 * 这个方向的错比漏掉一次轻微泄漏更糟，所以下面专门有一条反向用例。
 */
import { describe, expect, it } from "vitest";
import { withoutProtocolEcho } from "../../src/application/agent-run/run-skill-script";

/** 实测那一幕的形状：多段系统提示成片出现。 */
const ECHOED = [
  "name: pptx-create description: Create Office files with preinstalled libraries.",
  "You can execute Node.js code in a sandbox to produce real files.",
  "To do so, reply with exactly one fenced block:",
  "// Write every file you want to return into process.env.SKILL_SANDBOX_OUT_DIR.",
  "The sandbox has NO network access. Only the preinstalled modules are available.",
].join("\n");

describe("系统提示复述不进用户可见回复", () => {
  it("成片复述 ⇒ 整段换成一句说明，原文一个字都不外露", () => {
    const out = withoutProtocolEcho(ECHOED);
    expect(out).not.toContain("SKILL_SANDBOX_OUT_DIR");
    expect(out).not.toContain("The sandbox has NO network access");
    expect(out).not.toContain("reply with exactly one fenced block");
    // 不留空白：用户要知道这一轮发生了什么、下一步能做什么。
    expect(out).toContain("复述了内部执行说明");
    expect(out).toContain("重试");
  });

  it("正常回答原样通过——哪怕它恰好提到「沙箱」这个词", () => {
    const normal = "我把研究结论整理成了 12 页幻灯片，其中第 3 页是政策梳理。脚本在沙箱里跑完了。";
    expect(withoutProtocolEcho(normal)).toBe(normal);
  });

  // 单条命中不算复述：这是刻意留的余量，防止把正常回答掐掉。
  it("只命中一条标记时不动手", () => {
    const one = `这一轮我把文件写到了 process.env.SKILL_SANDBOX_OUT_DIR 指定的目录里。`;
    expect(withoutProtocolEcho(one)).toBe(one);
  });

  it("空回复原样返回，不凭空造一句话", () => {
    expect(withoutProtocolEcho("")).toBe("");
  });
});
