/**
 * doctor 的 issue 清单**被截断时必须降级，而不是拿残缺清单去判「这个 feature 没有 issue」**。
 *
 * ## 这条测试来自一次真实的、连红四次的误判
 *
 * `loadIssues` 原本写死 `gh issue list --limit 300`。`gh` 按编号**从新到旧**返回，
 * 所以上限一到，**最老的那几个被悄悄丢掉** —— 而 phase-00 的 feature 恰恰对应
 * 最早那批 issue（F14 是 `#1`）。
 *
 * 2026-08-05 仓库长到 302 个 issue，`#1` 掉出窗口 ⇒ doctor 报
 * 「F14 已领入 sprint 01 但 GitHub 上没有对应 issue」⇒ 判审计链断裂。
 * **同一份代码 05:25 还绿、05:28 就红，中间没有任何相关改动。**
 *
 * ⇒ 要守的不变量不是「上限要够大」（任何固定上限都会再次触顶，而且下一次
 *   同样没人看得出来），而是：**触顶时宁可不判，也不要用不完整的数据做否定性判断。**
 *
 * ## 为什么用假 `gh` 而不是查源码里有没有某个字符串
 *
 * `expect(source).toContain("ISSUE_PAGE_LIMIT")` 这种断言防不住「有人把阈值判断
 * 删掉但常量还留着」—— 今天已经栽过一次同型的（`toContain("assertProjectMember")`
 * 命中的是私有方法定义本身，把调用点注释掉照样绿）。所以这里断**行为**。
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

let dir: string | null = null;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

/** 让假 `gh issue list` 返回 n 条**内容为空**的 issue —— 空 body ⇒ 匹配不到任何 feature 标记。 */
function runDoctorWithFakeGh(rows: number): { out: string; code: number } {
  dir = mkdtempSync(join(tmpdir(), "doctor-gh-"));
  const gh = join(dir, "gh");
  writeFileSync(gh, `#!/usr/bin/env bash
case "$*" in
  *"issue list"*) node -e 'process.stdout.write(JSON.stringify(Array.from({length:${rows}},(_,i)=>({number:i+1,state:"OPEN",body:""}))))' ;;
  *) echo '[]' ;;
esac
`);
  chmodSync(gh, 0o755);
  try {
    const out = execFileSync("pnpm", ["harness", "doctor", "--phase", "00"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
  }
}

describe("doctor：issue 清单截断", () => {
  it("触顶（可能被截断）时降级跳过，**不**报「没有对应 issue」", () => {
    // 5000 = ISSUE_PAGE_LIMIT。返回正好这么多 ⇒ 无法排除被截断。
    const { out } = runDoctorWithFakeGh(5000);
    expect(out).toContain("可能被截断");
    // 关键：不得因为一份**可能残缺**的清单而做否定性判断。
    expect(out).not.toContain("但 GitHub 上没有对应 issue");
  });

  it("反空转正样本：清单**没有**触顶时，那条否定性判断照旧会报", () => {
    // 只回 3 条空 body 的 issue ⇒ 清单完整、但确实匹配不到 F14 ⇒ 这时就该报。
    const { out } = runDoctorWithFakeGh(3);
    expect(out).not.toContain("可能被截断");
    expect(out).toContain("但 GitHub 上没有对应 issue");
  });
});
