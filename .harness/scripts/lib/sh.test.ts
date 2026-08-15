import { describe, it, expect } from "vitest";
import { sh } from "./sh";

describe("sh() — 双管道大体量并发输出不挂起（2026-08-15 F156 verify:quick 假死复现修复）", () => {
  it(
    "stdout 和 stderr 同时产出远超单条 OS pipe 缓冲区（64KB）的并发数据，不阻塞、不超时",
    () => {
      // 复现原 bug 的关键条件：两条流都要写，且总量都超过一次 OS pipe 缓冲区（64KB）。
      // 旧实现（各自独立 pipe，spawnSync 轮转读取）在这种双流大体量场景下会挂起；
      // 新实现把 stderr 并入 stdout（shell 级 2>&1），只剩一条管道，不会挂起。
      const cmd = [
        "for i in $(seq 1 4000); do echo \"stdout-line-$i-$(head -c 40 /dev/zero | tr '\\0' 'x')\"; done &",
        "for i in $(seq 1 4000); do echo \"stderr-line-$i-$(head -c 40 /dev/zero | tr '\\0' 'y')\" >&2; done &",
        "wait",
      ].join("\n");

      const r = sh(cmd);

      // 真正要防的回归是「永久挂起」，不是「跑得比某个绝对秒数快」——机器负载会让
      // 绝对耗时在几秒到几十秒间浮动（本用例曾在高负载下实测跑到 34s，被一个写死的
      // 15s 阈值误判为失败），拿墙钟时间当断言在共享机器上必然会变成间歇性假红。
      // 真正的挂起检测交给下面 it() 的显式 timeout：旧实现会一直卡到那个上限触发
      // vitest 自己的超时失败，新实现无论负载多高都会在有限时间内真正返回。
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("stdout-line-1-");
      expect(r.stdout).toContain("stdout-line-4000-");
      // stderr 已被合并进 stdout（shell 级 2>&1），单独的 stderr 字段应为空。
      expect(r.stdout).toContain("stderr-line-1-");
      expect(r.stderr).toBe("");
    },
    { timeout: 60_000 },
  );

  it("超过旧的 1MB 默认 maxBuffer 的输出不再被 SIGTERM 杀掉（原复现里看到的 exit 143）", () => {
    // 单条 echo 循环产出 ~2MB，超过 Node 默认 maxBuffer=1MB。
    const cmd = "for i in $(seq 1 40000); do echo \"line-$i-0123456789012345678901234567890123456789\"; done";
    const r = sh(cmd);
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(1024 * 1024);
    expect(r.stdout).toContain("line-40000-");
  });
});
