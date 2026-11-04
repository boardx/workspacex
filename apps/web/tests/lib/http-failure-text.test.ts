import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { describeArtifactFailure } from "@/lib/chat-workbench/artifact-failure";
import { describeFailure } from "@/lib/design-failure";
import { describeHomeConfigFailure } from "@/lib/home-config-failure";
import { httpFailureText } from "@/lib/http-failure-text";

const forbiddenEn = "You do not have permission to perform this action. Contact your administrator if you need access.";
const forbiddenZh = "你没有权限执行此操作，如需访问请联系管理员";
const authEn = "Your session has expired. Refresh the page and sign in again.";
const authZh = "登录状态过期了，刷新页面重新登录";

describe("httpFailureText", () => {
  it("explains permission denial in both locales and defaults to Chinese", () => {
    expect(httpFailureText(403, "en")).toBe(forbiddenEn);
    expect(httpFailureText(403, "zh-CN")).toBe(forbiddenZh);
    expect(httpFailureText(403)).toBe(forbiddenZh);
  });

  it("keeps session-expiry instructions for 401 in both locales and by default", () => {
    expect(httpFailureText(401, "en")).toBe(authEn);
    expect(httpFailureText(401, "zh-CN")).toBe(authZh);
    expect(httpFailureText(401)).toBe(authZh);
  });

  it.each([
    [404, "The requested item is no longer available.", "要找的东西不在了"],
    [429, "Too many requests. Wait a moment and try again.", "操作太频繁了，等一下再试"],
    [500, "The server encountered an error. Please try again later.", "服务器出错了，稍后再试一次"],
    [503, "The server encountered an error. Please try again later.", "服务器出错了，稍后再试一次"],
    [599, "The server encountered an error. Please try again later.", "服务器出错了，稍后再试一次"],
    [400, "The request failed. Please try again later.", "这次请求没成功，稍后再试一次"],
    [418, "The request failed. Please try again later.", "这次请求没成功，稍后再试一次"],
    [499, "The request failed. Please try again later.", "这次请求没成功，稍后再试一次"],
  ])("preserves the existing fallback for status %i", (status, en, zh) => {
    expect(httpFailureText(status, "en")).toBe(en);
    expect(httpFailureText(status, "zh-CN")).toBe(zh);
    expect(httpFailureText(status)).toBe(zh);
  });
});

describe("permission fallback through callers", () => {
  it.each(["UNKNOWN_PRIVATE_REASON", null])("masks diagnostics without mutating ApiError (%s)", (reason) => {
    const raw = { error: "fake-private-message", reasonCode: reason, traceId: "fake-private-trace", details: { host: "fake-private-host" } };
    const snapshot = structuredClone(raw);
    const rawBody = "fake-private-gateway-body";
    const error = new ApiError(403, reason, raw, rawBody);
    const message = error.message;
    const outputs = [
      describeFailure(error, "en"),
      describeFailure(error, "zh-CN"),
      describeHomeConfigFailure(error, "en"),
      describeHomeConfigFailure(error, "zh-CN"),
      describeArtifactFailure(error),
    ];
    expect(outputs).toEqual([forbiddenEn, forbiddenZh, forbiddenEn, forbiddenZh, forbiddenZh]);
    for (const output of outputs) {
      expect(output).not.toMatch(/UNKNOWN_PRIVATE_REASON|private|http_403|HTTP/);
    }
    expect(error.status).toBe(403);
    expect(error.reasonCode).toBe(reason);
    expect(error.raw).toBe(raw);
    expect(error.raw).toEqual(snapshot);
    expect(error.rawBody).toBe(rawBody);
    expect(error.message).toBe(message);
  });

  it("retains known domain-code precedence over the 403 fallback", () => {
    const design = new ApiError(403, "NOT_PROJECT_OWNER", {});
    expect(describeFailure(design, "en")).toBe("Only the person who created this project can edit it.");
    expect(describeFailure(design, "zh-CN")).toBe("这个项目不是你建的，只有建它的人能改");
    const feedback = new ApiError(403, "PERMISSION_REVOKED", {});
    expect(describeFailure(feedback, "en")).toBe("You no longer have permission to do this. Check with an administrator.");
    expect(describeFailure(feedback, "zh-CN")).toBe("你没有做这件事的权限了，找管理员确认一下");
    const home = new ApiError(403, "FORBIDDEN", {});
    expect(describeHomeConfigFailure(home, "en")).toBe("Only organization administrators can edit the home configuration.");
    expect(describeHomeConfigFailure(home, "zh-CN")).toBe("首页配置仅组织管理员可编辑");
    expect(describeArtifactFailure(new ApiError(403, "NOT_VISIBLE", {})))
      .toBe("这份产物你现在看不到：可能是别人的草稿，也可能已经被删掉");
  });

  it.each([null, "UNKNOWN_PRIVATE_REASON"])("preserves caller 401 fallback (%s)", (reason) => {
    const error = new ApiError(401, reason, {});
    for (const adapter of [describeFailure, describeHomeConfigFailure]) {
      expect(adapter(error, "en")).toBe(authEn);
      expect(adapter(error, "zh-CN")).toBe(authZh);
      expect(adapter(error)).toBe(authZh);
    }
    expect(describeArtifactFailure(error)).toBe(authZh);
  });
});
