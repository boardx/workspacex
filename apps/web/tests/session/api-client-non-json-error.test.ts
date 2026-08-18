/**
 * `apiRequest` 对**非 JSON 响应正文**的处理。
 *
 * ## 这条测试为什么存在（实测事故，不是假想）
 *
 * 2026-08-18，真栈 + 真实百炼模型跑 pptx skill 试跑：Next 的 rewrite 代理在 30s
 * 掐断了一次真实的长模型调用（`socket hang up`），代理回了一个**纯文本**
 * `Internal Server Error`。`apiRequest` 里当时是裸的 `JSON.parse(text)`，
 * 于是抛出的是一个原始 `SyntaxError`，一路冒到界面上显示成
 * `Unexpected token 'I', "Internal S"... is not valid JSON`——
 * 真实原因（代理超时）被一句 JSON 解析报错完全盖住。
 *
 * ⚠ 这个症状在本仓被观测过**七次以上**：`next.config.mjs` 里至少七处注释把
 * `Unexpected token '<'`（解析到 `<!DOCTYPE`）当成"rewrite 少配了"的诊断路标。
 * 也就是说它一直被当成"读得懂的线索"来用，却从来没人修解析本身——每一次都要
 * 人肉重新推理一遍。这条测试把"不得再抛裸 SyntaxError"钉死。
 *
 * ⚠ 四格覆盖，不是"报错就算过"：非 JSON 失败 / 非 JSON 成功 / 正常 JSON 失败信封
 * （必须仍然拿到 `reasonCode`）/ 正常 JSON 成功。少了后两格，一个"永远抛
 * ApiError"的实现也会全绿。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "@/lib/api-client";

function respond(body: string, status: number, contentType = "text/plain"): Response {
  return new Response(body, { status, headers: { "Content-Type": contentType } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest：非 JSON 正文不得抛裸 SyntaxError", () => {
  it("① 失败响应 + 纯文本正文 ⇒ ApiError（带真实 status 与原始正文），不是 SyntaxError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond("Internal Server Error", 500)));

    const failure = await apiRequest("/anything").catch((e: unknown) => e);

    expect(failure, "必须是 ApiError；抛 SyntaxError 就是这次事故本身").toBeInstanceOf(ApiError);
    const err = failure as ApiError;
    expect(err.status).toBe(500);
    expect(err.reasonCode).toBeNull();
    // 原始正文要留下来——这是排查网关/代理故障时唯一的线索。
    expect(err.rawBody).toContain("Internal Server Error");
    // ⚠ 反空转：错误信息里**不得**再出现 JSON 解析那句话。
    expect(String(err.message)).not.toContain("is not valid JSON");
  });

  it("② 2xx 但正文是 HTML（rewrite 打到 Next 自己的 404 页）⇒ 同样是 ApiError，不静默成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond("<!DOCTYPE html><html></html>", 200, "text/html")));

    const failure = await apiRequest("/anything").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).rawBody).toContain("<!DOCTYPE");
  });

  it("③ ⭐ 正常 JSON 失败信封仍然解析出 reasonCode（缺这格，『一律抛 ApiError』会全绿）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      respond(JSON.stringify({ error: "nope", reasonCode: "SKILL_NOT_FOUND" }), 404, "application/json")));

    const failure = await apiRequest("/anything").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).reasonCode).toBe("SKILL_NOT_FOUND");
    // 正常信封走 `raw`，`rawBody` 恒为 undefined——两条路径不得混淆。
    expect((failure as ApiError).rawBody).toBeUndefined();
  });

  it("④ ⭐ 正常 JSON 成功响应照常返回解析后的对象（缺这格，『一律抛错』会全绿）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      respond(JSON.stringify({ ok: true, n: 7 }), 200, "application/json")));

    await expect(apiRequest<{ ok: boolean; n: number }>("/anything")).resolves.toEqual({ ok: true, n: 7 });
  });
});
