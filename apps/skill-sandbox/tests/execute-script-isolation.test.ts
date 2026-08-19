/**
 * `verification.md` **V2-a**（contract §4 的 L2 进程层）+ 沙箱执行的基本形态。
 *
 * ⚠⚠ 本文件**不**测网络。网络是 L1 容器层(`network: none`)的事,由
 * `tests/container-network-isolation.test.ts`(V2-b)在真容器里测。
 * 这里反而有一条断言**钉死** L2 挡不住网络这个事实——见 `does NOT block network`。
 * 那条不是"记录一个缺陷",它是防止有人日后误以为进程层已经把网络管住了、
 * 于是把容器的 `network: none` 当成冗余摘掉(那正是 V2-CP 要抓的回归)。
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { executeScript } from "../src/execute-script.js";

const TIMEOUT_MS = 30_000;

describe("V2-a L2 进程层:越界操作必须 ERR_ACCESS_DENIED", () => {
  it("blocks out-of-scope file writes, and the file really is not created", async () => {
    const target = "/tmp/skill-sandbox-v2a-should-not-exist";
    const result = await executeScript({
      script: `
        try { require('fs').writeFileSync(${JSON.stringify(target)}, 'x'); console.log('WROTE'); }
        catch (e) { console.log('DENIED:' + e.code); }
      `,
      timeoutMs: TIMEOUT_MS,
    });

    expect(result.stdout).toContain("DENIED:ERR_ACCESS_DENIED");
    expect(result.stdout).not.toContain("WROTE");
    // 断言副作用真的没发生,而不是只信进程自己打印的字。
    expect(existsSync(target)).toBe(false);
  });

  it("blocks child_process", async () => {
    const result = await executeScript({
      script: `
        try { require('child_process').execSync('id'); console.log('SPAWNED'); }
        catch (e) { console.log('DENIED:' + e.code); }
      `,
      timeoutMs: TIMEOUT_MS,
    });
    expect(result.stdout).toContain("DENIED:ERR_ACCESS_DENIED");
    expect(result.stdout).not.toContain("SPAWNED");
  });

  it("blocks out-of-scope file reads", async () => {
    const result = await executeScript({
      script: `
        try { require('fs').readFileSync('/etc/hosts'); console.log('READ'); }
        catch (e) { console.log('DENIED:' + e.code); }
      `,
      timeoutMs: TIMEOUT_MS,
    });
    expect(result.stdout).toContain("DENIED:ERR_ACCESS_DENIED");
    expect(result.stdout).not.toContain("READ");
  });

  it("blocks writes into the workdir outside the designated out dir", async () => {
    // 只有 outdir 可写。脚本自己所在的目录是**只读**的——否则脚本能改写自己
    // 或往 node_modules 软链里塞东西。
    const result = await executeScript({
      script: `
        const path = require('path');
        const outside = path.join(__dirname, 'sneaky.txt');
        try { require('fs').writeFileSync(outside, 'x'); console.log('WROTE'); }
        catch (e) { console.log('DENIED:' + e.code); }
      `,
      timeoutMs: TIMEOUT_MS,
    });
    expect(result.stdout).toContain("DENIED:ERR_ACCESS_DENIED");
  });
});

describe("L2 的边界:进程层挡不住网络(这正是 L1 存在的理由)", () => {
  /**
   * ⚠ 这条断言的方向是**反直觉**的:它断言网络**通得过**。
   *
   * 它钉的是 contract §4 那个 ⚠⚠:Node 权限模型没有网络维度。#1575 ⑤ 与 #1583 都
   * 实测过。如果哪天 Node 给权限模型加了网络维度而这条变红,那是**好消息**,
   * 但必须由人显式来改这条断言 + 更新 contract §4,而不是让它默默成立——
   * 因为"两层隔离"的必要性论证就建立在这条事实上。
   *
   * ⚠ 本条只在显式开 `SKILL_SANDBOX_ALLOW_EGRESS_PROBE=1` 时跑:它要真的出网,
   *   在 CI/离线环境里会因为"根本没网"而假红,那种红说明不了任何事。
   *   V2-b(容器层)才是常跑的那条,它用回环地址,不需要外网。
   */
  it.runIf(process.env.SKILL_SANDBOX_ALLOW_EGRESS_PROBE === "1")(
    "does NOT block network — network can only be closed at the container layer",
    async () => {
      const result = await executeScript({
        script: `
          fetch('https://example.com')
            .then((r) => console.log('NET_OK:' + r.status))
            .catch((e) => console.log('NET_BLOCKED:' + e.message));
        `,
        timeoutMs: TIMEOUT_MS,
      });
      expect(result.stdout).toContain("NET_OK:");
    },
    TIMEOUT_MS,
  );
});

describe("执行结果的基本形态", () => {
  it("reports a non-zero exit code as a successful execution of a failing script", async () => {
    const result = await executeScript({
      script: `console.error('boom detail'); process.exit(3);`,
      timeoutMs: TIMEOUT_MS,
    });
    expect(result.exitCode).toBe(3);
    // 真实 stderr 原样带回——contract §7 的回喂重试与 SCRIPT_FAILED_AFTER_RETRIES
    // 都依赖这一点(#660 纪律)。
    expect(result.stderr).toContain("boom detail");
    expect(result.timedOut).toBe(false);
  });

  it("collects files written into the out dir", async () => {
    const result = await executeScript({
      script: `
        const fs = require('fs');
        fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/hello.txt', 'hi there');
      `,
      timeoutMs: TIMEOUT_MS,
    });
    expect(result.exitCode).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.name).toBe("hello.txt");
    expect(Buffer.from(result.files[0]!.contentBase64, "base64").toString("utf8")).toBe("hi there");
  });

  it("kills a CPU-spinning script at the wall clock deadline", async () => {
    const startedAt = Date.now();
    const result = await executeScript({
      script: `while (true) {}`,
      timeoutMs: 1_500,
    });
    expect(result.timedOut).toBe(true);
    // SIGKILL 之后没有退出码,只有信号——断言它确实是被杀的,不是自己跑完的。
    expect(result.exitCode).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(TIMEOUT_MS);
  }, TIMEOUT_MS);
});
