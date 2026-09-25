/**
 * 原生链路的步数熔断到点时，用户看到的是库自己拼的裸英文
 * `Model call limits exceeded: run limit (25/25)`（2026-09-25 devapp 实测截图，
 * 人类原话「model call limit how it comes?」）。
 *
 * `harness.py` 挂 `ModelCallLimitMiddleware(run_limit=25, exit_behavior="end")`
 * 时的注释原话是"用户看到的是「预算耗尽的明确通告」"——但
 * `langchain.agents.middleware.model_call_limit._build_limit_exceeded_message`
 * （逐字核对过 `.venv` 里锁定的源码，不是猜的）拼的就是这句固定格式的裸英文，
 * 库不提供自定义文案的钩子，这条承诺从没被兑现过。
 */
import { describe, expect, it } from "vitest";
import { describeModelCallLimit } from "../../src/infrastructure/agent-run/deep-agent-model-provider";

describe("describeModelCallLimit", () => {
  it("库拼的裸英文限额文案 ⇒ 换成读得懂的中文说明", () => {
    const translated = describeModelCallLimit("Model call limits exceeded: run limit (25/25)");
    expect(translated).not.toContain("Model call limits exceeded");
    expect(translated).not.toContain("25/25");
    expect(translated).toContain("上限");
  });

  it("thread 与 run 两个限额同时超出时的逗号列表形状同样识别", () => {
    const translated = describeModelCallLimit(
      "Model call limits exceeded: thread limit (50/50), run limit (25/25)",
    );
    expect(translated).not.toContain("Model call limits exceeded");
  });

  /*
   * 反证的另一半：不认识的英文句子原样返回——这里只翻译**认得出来**的那一种
   * 库文案，不是看见英文就替换、更不是猜着翻译任何句子。
   */
  it("不是这条库文案的普通英文回复 ⇒ 原样返回，不误伤", () => {
    const normal = "Here is a plain English answer that happens to start with Model, unrelated.";
    expect(describeModelCallLimit(normal)).toBe(normal);
  });

  it("中文正常回复 ⇒ 原样返回", () => {
    const normal = "已经完成生成，请查看附件。";
    expect(describeModelCallLimit(normal)).toBe(normal);
  });
});
