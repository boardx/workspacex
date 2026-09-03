/**
 * `summarizeErrorLog`（2026-09-02，系统异常 AI 摘要）——纯 fake，不碰 DB/真实模型。
 *
 *   ① 成功：模型输出严格 JSON ⇒ 原样返回 {title,summary}。
 *   ② 宽松解析：JSON 前后带解释性文字/代码块标记也能提出来。
 *   ③ 模型调用失败（超时/`ModelCallError`）⇒ 返回 null，不抛——调用方是 fire-and-forget
 *      的后台任务，`PgErrorLogWriter` 不该因为一次模型故障而多一条未处理异常。
 *   ④ 输出不是 JSON / 缺 title 或 summary ⇒ 同样返回 null，不编一个占位摘要。
 *   ⑤ 超长的 title/summary 被截断到契约允许的长度。
 *   ⑥ 独立评审 finding #4（2026-09-03）：无论模型赢还是超时赢，`setTimeout` 句柄都被清掉，
 *      不悬挂到 30 秒后才触发——用 vi 的假计时器直接断言 `clearTimeout` 被调用过。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  summarizeErrorLog,
  type SummarizeErrorLogDeps,
} from "../../src/application/system/summarize-error-log";
import { ModelCallError } from "../../src/application/agent-run/ports";

function deps(over: Partial<SummarizeErrorLogDeps> = {}): SummarizeErrorLogDeps {
  return {
    model: { complete: vi.fn(async () => ({ text: '{"title":"数据库连接超时","summary":"疑似连接池耗尽，建议先查慢查询与连接数上限。"}' })) },
    summaryModel: { provider: "test-provider", modelId: "test-model" },
    log: vi.fn(),
    ...over,
  } as SummarizeErrorLogDeps;
}

const input = { redactedMsg: "unhandled exception", redactedDetail: { name: "Error", message: "connect ETIMEDOUT" } };

describe("summarizeErrorLog", () => {
  it("① 成功：严格 JSON 输出原样返回", async () => {
    const d = deps();
    const out = await summarizeErrorLog(d, input);
    expect(out).toEqual({ title: "数据库连接超时", summary: "疑似连接池耗尽，建议先查慢查询与连接数上限。" });
    expect(d.model.complete).toHaveBeenCalledWith(expect.objectContaining({
      modelProvider: "test-provider", modelId: "test-model",
      user: JSON.stringify({ msg: input.redactedMsg, detail: input.redactedDetail }),
    }));
  });

  it("② 宽松解析：JSON 前后带解释性文字/代码块标记也能提出来", async () => {
    const d = deps({
      model: { complete: vi.fn(async () => ({
        text: '这是我的分析：\n```json\n{"title":"空指针","summary":"某个可选字段没判空就直接取属性。"}\n```\n供参考。',
      })) },
    });
    const out = await summarizeErrorLog(d, input);
    expect(out).toEqual({ title: "空指针", summary: "某个可选字段没判空就直接取属性。" });
  });

  it("③ 模型调用失败（ModelCallError）⇒ null，不抛，记一条日志", async () => {
    const d = deps({
      model: { complete: vi.fn(async () => { throw new ModelCallError("MODEL_CALL_FAILED", "upstream 503"); }) },
    });
    await expect(summarizeErrorLog(d, input)).resolves.toBeNull();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("model call failed"), expect.objectContaining({ code: "MODEL_CALL_FAILED" }));
  });

  it("③b 超时同样返回 null（Promise.race 的另一支）", async () => {
    const d = deps({
      model: { complete: vi.fn(() => new Promise<never>(() => {})) }, // 永不 resolve
    });
    const out = await summarizeErrorLog(d, input);
    expect(out).toBeNull();
  }, 40_000);

  it("④a 输出不是 JSON ⇒ null，不编占位摘要", async () => {
    const d = deps({ model: { complete: vi.fn(async () => ({ text: "抱歉，我不知道怎么分析这个。" })) } });
    await expect(summarizeErrorLog(d, input)).resolves.toBeNull();
  });

  it("④b 输出是 JSON 但缺 title/summary ⇒ null", async () => {
    const d = deps({ model: { complete: vi.fn(async () => ({ text: '{"title":"只有标题"}' })) } });
    await expect(summarizeErrorLog(d, input)).resolves.toBeNull();
  });

  it("⑤ 超长 title/summary 被截断", async () => {
    const d = deps({
      model: { complete: vi.fn(async () => ({
        text: JSON.stringify({ title: "t".repeat(300), summary: "s".repeat(3000) }),
      })) },
    });
    const out = await summarizeErrorLog(d, input);
    expect(out?.title.length).toBe(200);
    expect(out?.summary.length).toBe(2000);
  });

  describe("⑥ 定时器句柄不悬挂（独立评审 finding #4）", () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it("模型先赢：句柄被 clearTimeout 清掉，不留到超时", async () => {
      const clearSpy = vi.spyOn(globalThis, "clearTimeout");
      const d = deps();
      await summarizeErrorLog(d, input);
      expect(clearSpy).toHaveBeenCalled();
    });

    it("超时先赢：句柄已触发，clearTimeout 仍然被调用一次（安全 no-op，不是分支遗漏）", async () => {
      const clearSpy = vi.spyOn(globalThis, "clearTimeout");
      const d = deps({ model: { complete: vi.fn(() => new Promise<never>(() => {})) } });
      await summarizeErrorLog(d, input);
      expect(clearSpy).toHaveBeenCalled();
    }, 40_000);
  });
});
