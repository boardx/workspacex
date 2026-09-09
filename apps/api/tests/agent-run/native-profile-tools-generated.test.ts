/**
 * 跨语言边界的新鲜度门：改了 `NATIVE_PROFILE_TOOLS` 或风险分级、却没重新生成
 * `native_profile_tools.json`，这里当场红。
 *
 * 没有这一条，Python 侧的准入门控就会拿着一张**过期的**准入表判绿——那正是
 * "静态痕迹 ≠ 动态事实"：生成物写下来就不会自己变，越像权威越骗人。
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NATIVE_PROFILE_TOOLS, nativeInterruptOn } from "../../src/application/agent-run/native-invocation";

describe("准入表的 Python 生成物", () => {
  it("与 TS 源一致（--check 不通过就是忘了重新生成）", () => {
    execFileSync(process.execPath, ["--import", "tsx",
      fileURLToPath(new URL("../../scripts/generate-native-profile-tools.ts", import.meta.url)), "--check"]);
  });

  it("interrupt_on 与准入表同域：每个准入工具都有一条布尔判定，没有多余的名字", () => {
    const interruptOn = nativeInterruptOn();
    expect(Object.keys(interruptOn).sort()).toEqual([...NATIVE_PROFILE_TOOLS].sort());
    // #3159 的落点：durable 子任务派发是有副作用的动作，未登记时的保守默认（L2 审批）
    // 必须在登记之后仍然成立——登记的目的是让它**存在**，不是顺手放行。
    expect(interruptOn["spawn_async_task"]).toBe(true);
  });
});
