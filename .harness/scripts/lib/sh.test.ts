import { describe, it, expect } from "vitest";
import { sh } from "./sh";

describe("sh() — 双管道大体量并发输出不挂起（2026-08-15 F156 verify:quick 假死复现修复）", () => {
  it("stdout 和 stderr 同时产出远超单条 OS pipe 缓冲区（64KB）的并发数据，不阻塞、不超时", () => {
    // 复现原 bug 的关键条件：两条流都要写，且总量都超过一次 OS pipe 缓冲区（64KB）。
    // 旧实现（各自独立 pipe，spawnSync 轮转读取）在这种双流大体量场景下会挂起；
    // 新实现把 stderr 并入 stdout（shell 级 2>&1），只剩一条管道，不会挂起。
    const cmd = [
      "for i in $(seq 1 4000); do echo \"stdout-line-$i-$(head -c 40 /dev/zero | tr '\\0' 'x')\"; done &",
      "for i in $(seq 1 4000); do echo \"stderr-line-$i-$(head -c 40 /dev/zero | tr '\\0' 'y')\" >&2; done &",
      "wait",
    ].join("\n");

    const start = Date.now();
    const r = sh(cmd);
    const elapsedMs = Date.now() - start;

    expect(r.code).toBe(0);
    // 挂起的旧实现会一直卡到 testTimeout=60_000ms（见 .harness/vitest.config.ts）才失败；
    // 新实现应远快于此完成。阈值原为 15_000ms，但在本仓典型并发 agent 负载下（多个 worktree
    // 同时跑 verify）实测多次落在 16_000-19_000ms（2026-08-16 F156 verify:release 两次复现，
    // 见 issue，均非挂起——r.code===0 且内容完整，只是墙钟变慢），15s 阈值把「跑得慢」误判成
    // 「疑似挂起」。放宽到 45s：仍比 60s 的 testTimeout 留出安全边际，且远快于旧 bug 的
    // 「直到 testTimeout 才失败」特征，不会漏检真的挂起。
    expect(elapsedMs).toBeLessThan(45_000);
    expect(r.stdout).toContain("stdout-line-1-");
    expect(r.stdout).toContain("stdout-line-4000-");
    // stderr 已被合并进 stdout（shell 级 2>&1），单独的 stderr 字段应为空。
    expect(r.stdout).toContain("stderr-line-1-");
    expect(r.stderr).toBe("");
  });

  it("超过旧的 1MB 默认 maxBuffer 的输出不再被 SIGTERM 杀掉（原复现里看到的 exit 143）", () => {
    // 单条 echo 循环产出 ~2MB，超过 Node 默认 maxBuffer=1MB。
    const cmd = "for i in $(seq 1 40000); do echo \"line-$i-0123456789012345678901234567890123456789\"; done";
    const r = sh(cmd);
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(1024 * 1024);
    expect(r.stdout).toContain("line-40000-");
  });
});
