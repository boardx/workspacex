/**
 * #595 —— **TLS fixture 生成不了的时候，必须红，⛔ 不许 skip。**
 *
 * ## 这条门挡的是「修 CI 红」时最顺手的那个错误答案
 *
 * 证书改成当场生成之后，最省事的写法是：
 *   `if (!hasOpenssl()) it.skip(...)`
 * ⚠ 那样 **CI 会变绿**，而 `import-fetch-wiring.test.ts` 里
 *   **重定向逐跳过门**与**响应体上限**两条就此**无人验证**——
 *   它们恰恰是「完成真实 TLS 握手之后才验得到」的那两条。
 *
 * ⇒ **绿了，但覆盖面悄悄没了。** 本项目今晚反复测量到的就是这个形状，
 *   所以这条反证做成**常驻用例**，而不是一次手工实验。
 *
 * ⚠ 注意本文件断言的是**两个方向**，少一个都会空转：
 *   ① 缺 openssl ⇒ **抛错**（而不是返回、跳过、或给一份空材料）；
 *   ② 有 openssl ⇒ **真的生成得出来**。
 *   只有 ① 会被一个「永远抛错」的实现满足；只有 ② 会被一个「永远不抛」的实现满足。
 */
import { describe, expect, it } from "vitest";
import { generateTestTlsMaterial, testTlsMaterial } from "../support/tls";

/** 一个几乎不可能存在的命令名；⛔ 不要换成真实存在的东西。 */
const MISSING_BINARY = "workspacex-definitely-not-openssl-9f3a1c";

describe("TLS fixture 生成失败必须 FAIL", () => {
  it("openssl 不存在 ⇒ 抛错，⛔ 不是 skip、不是静默返回", () => {
    expect(() => generateTestTlsMaterial(MISSING_BINARY)).toThrow();
  });

  /**
   * 错误信息必须**可行动**。⚠ 一句光秃秃的 ENOENT 会让下一个人
   * 去查「是不是我的代码坏了」，而真相是「这台机器没装 openssl」。
   */
  it("错误信息说清了缺什么、怎么装、以及为什么不 skip", () => {
    let message = "";
    try {
      generateTestTlsMaterial(MISSING_BINARY);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(MISSING_BINARY);
    expect(message).toContain("openssl");
    // 明确写出「为什么是 FAIL 而不是 skip」——这条理由本身就是防回归的一部分。
    expect(message).toContain("skip");
    expect(message).toMatch(/apt-get install|macOS/);
  });

  /**
   * 装置自检（方向②）：真实路径**确实生成得出来**。
   *
   * ⚠ 没有这一条，上面两条会被一个「无论如何都抛错」的实现满足，
   *   而那种实现会让所有 TLS 用例永久红——同样是坏的，只是坏在另一边。
   * ⚠ 这一条也顺带成为「**本机/CI 到底有没有 openssl**」的实测：
   *   没有的话它会红，且红在这里，而不是红成一堆看不懂的握手错误。
   */
  it("装置自检：有 openssl 时真的生成得出证书与私钥", () => {
    const material = testTlsMaterial();
    expect(material.cert.length).toBeGreaterThan(0);
    expect(material.key.length).toBeGreaterThan(0);
    expect(material.cert.toString()).toContain("BEGIN CERTIFICATE");
    expect(material.key.toString()).toContain("PRIVATE KEY");
  });

  /** 同一次运行内复用同一份材料（避免每个文件都 fork 一次 openssl）。 */
  it("进程内缓存：两次调用拿到同一份材料", () => {
    expect(testTlsMaterial()).toBe(testTlsMaterial());
  });
});
