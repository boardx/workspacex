/**
 * 产物取源失败 → 人话（单源判据）。
 *
 * ## 为什么这份测试必须存在
 *
 * 界面那一层只断言了「两种码说不同的话、且不含内部码」。做**反证**时发现那条判据
 * 太弱：把码→人话的查表整段删掉，两种码退回 HTTP 兜底（404 / 503）——仍然是两句
 * 不同的、不含内部码的话，测试照样绿。也就是说界面那条证明不了码表在被使用。
 *
 * 逐字钉住的地方在这里：删掉查表，下面第一组就红。
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { describeArtifactFailure } from "@/lib/chat-workbench/artifact-failure";

describe("describeArtifactFailure", () => {
  it("契约错误码各有自己的一句人话（逐字）", () => {
    expect(describeArtifactFailure(new ApiError(404, "NOT_VISIBLE", {})))
      .toBe("这份产物你现在看不到：可能是别人的草稿，也可能已经被删掉");
    expect(describeArtifactFailure(new ApiError(503, "STORAGE_UNAVAILABLE", {})))
      .toBe("产物内容暂时读不出来（存储服务不可用），稍后再试一次");
  });

  it("屏上不出现内部码，也不出现 HTTP 字样", () => {
    for (const err of [
      new ApiError(404, "NOT_VISIBLE", {}),
      new ApiError(503, "STORAGE_UNAVAILABLE", {}),
      new ApiError(500, null, {}),
    ]) {
      const text = describeArtifactFailure(err);
      expect(text).not.toMatch(/[A-Z]{3,}_[A-Z]/);
      expect(text).not.toContain("HTTP");
    }
  });

  it("不认识的码退回 HTTP 兜底（共享单源），不退回那个码本身", () => {
    expect(describeArtifactFailure(new ApiError(429, "SOMETHING_NEW", {})))
      .toBe("操作太频繁了，等一下再试");
  });

  it("不是 ApiError 也给一句能照着做的话，不端出 String(err)", () => {
    expect(describeArtifactFailure(new TypeError("fetch failed")))
      .toBe("连不上服务器，检查一下网络再试");
    expect(describeArtifactFailure({ weird: true })).toBe("这份产物没能打开，稍后再试一次");
  });
});
