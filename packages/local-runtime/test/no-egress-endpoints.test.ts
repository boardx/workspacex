/**
 * 本地版的每一个服务端点都必须是**回环地址**（#3872 维度 3）。
 *
 * ## 为什么要有这道门
 *
 * 「离线」在这个产品里不是一句宣传，是评分卡维度 3 的九分判据：
 * 离线是常态不是错误态。而本仓已经栽过一次：**刻意不设专属变量 ≠ 能力关掉了**，
 * 因为那条路径的判据读的是另一个共享变量。那一类问题没有任何门会变红。
 *
 * 这道门盯的是最容易被悄悄改坏的一层：**本地版自己配出去的端点**。
 * 谁哪天往 `config.ts` 里加一个云端 URL（补个模型、补个检索、补个遥测），
 * 这里立刻红。它证明不了「整个进程一定不出网」——那要在运行时用死端口代理量
 * （见 evidence 里的说明）——但它把最常见、最容易发生的那条退路堵死了。
 *
 * 实测 2026-09-23（SHA 02413d08f）：14 个 URL 类变量，**全部回环**；
 * 10 个凭据全是本机生成的密钥，没有任何云端 key。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as config from "../src/config";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** 把 config.ts 里所有 `*Env(c)` 产出的变量合起来——**新加的 env 函数自动进来**，不用维护名单。 */
function allEnv(): Record<string, string> {
  const c = config.resolveLocalConfig({ repoRoot: REPO_ROOT, dataDir: mkdtempSync(join(tmpdir(), "wsx-egress-")) });
  const out: Record<string, string> = {};
  for (const [name, fn] of Object.entries(config)) {
    if (!/Env$/.test(name) || typeof fn !== "function") continue;
    try { Object.assign(out, (fn as (x: unknown) => Record<string, string>)(c)); } catch { /* 需要额外参数的跳过 */ }
  }
  return out;
}

/** 回环：带 scheme 的 URL，或裸主机名。 */
function isLoopback(v: string): boolean {
  const host = /^[a-z]+:\/\//i.test(v) ? (() => { try { return new URL(v).hostname; } catch { return ""; } })() : v.split(":")[0] ?? "";
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

describe("本地版不往外连", () => {
  it("每一个 URL / HOST / ENDPOINT 变量都是回环地址", () => {
    const env = allEnv();
    const endpoints = Object.entries(env).filter(([k, v]) => /URL|ENDPOINT|HOST/i.test(k) && v !== "");
    expect(endpoints.length, "一个端点都没扫到，判据本身坏了").toBeGreaterThan(8);
    const outside = endpoints.filter(([, v]) => !isLoopback(v));
    expect(outside, `本地版配了非回环端点：${outside.map(([k, v]) => `${k}=${v}`).join("  ")}`).toEqual([]);
  });

  it("不带任何云端凭据——凭据只能是本机生成的", () => {
    const env = allEnv();
    // 云端 key 有辨识度的前缀；本机生成的是随机串。
    const cloudish = Object.entries(env).filter(([k, v]) =>
      /KEY|SECRET|TOKEN/i.test(k) && /^(sk-[a-zA-Z0-9]|AKIA|ghp_|xox[baprs]-)/.test(v) && !v.startsWith("sk-local"));
    expect(cloudish.map(([k]) => k), "本地版 env 里出现了云端形状的凭据").toEqual([]);
  });

  it("判据能看见「存在」——拿一个假的云端端点验一下它会被抓住", () => {
    // ⚠ 没有这条，上面两条在 isLoopback 恒真时也会全绿（本仓栽过：
    //   一个「不存在」的结论，先要证明判据能看见「存在」）。
    expect(isLoopback("https://dashscope.aliyuncs.com/v1")).toBe(false);
    expect(isLoopback("api.openai.com")).toBe(false);
    expect(isLoopback("http://127.0.0.1:3200")).toBe(true);
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("ws://127.0.0.1:3320")).toBe(true);
  });
});
