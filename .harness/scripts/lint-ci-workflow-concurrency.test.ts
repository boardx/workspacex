import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * lint-ci-workflow-concurrency.test.ts —— CI workflow 的 `concurrency.group` 必须用
 * PR 唯一标识，不能用分支短名。
 *
 * 背景（2026-09-03，#2572/#2573）：harness-verify.yml 一直没有 `concurrency:` 块，
 * 导致同一个 PR 连续推送时旧的 run 不会被顶掉，PR 页面堆着好几轮过期 run，是发布
 * 拥堵的直接成因。修复的第一版用了 `github.head_ref`——independent feature review
 * 当场拦下：`head_ref` 只是来源分支的短名，不含 fork owner、不含 PR number，两个
 * 不相关的 PR（尤其不同 fork）完全可能用同一个分支短名开 PR，会落进同一个
 * concurrency group，互相顶掉——从"同 PR 连续推送互顶"变成"跨 PR 互顶"，是另一种
 * 拥堵/拒绝服务。
 *
 * 这条测试是纯静态断言（读 workflow 源文本，不跑 workflow 本身），管两件事：
 *   ① harness-verify.yml 与 backend-gates.yml 的 concurrency.group 都必须引用
 *      `github.ref`（pull_request 事件下就是该 PR 唯一的 refs/pull/<n>/merge），
 *      不得引用 `github.head_ref` 或裸的 branch 名。
 *   ② cancel-in-progress 只在 pull_request 事件上为 true——main/tag/schedule/
 *      workflow_dispatch 上必须是 false，否则会把一次已经发生的、必须留痕的事件
 *      的验证结果顶掉。
 * 防止以后又在"看起来更精确"的重构里退回 head_ref 这类分支短名。
 */
const ROOT = join(import.meta.dirname, "..", "..");

const WORKFLOWS_WITH_CONCURRENCY = [
  ".github/workflows/harness-verify.yml",
  ".github/workflows/backend-gates.yml",
];

describe("CI workflow concurrency group 必须用 PR 唯一标识", () => {
  for (const rel of WORKFLOWS_WITH_CONCURRENCY) {
    it(`${rel}: concurrency.group 引用 github.ref，不引用 github.head_ref`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      const m = /^concurrency:\n(?:.*\n)*?\s*group:\s*(.+)$/m.exec(src);
      expect(m, `${rel} 里没找到 concurrency.group`).not.toBeNull();
      const groupLine = m![1];

      expect(groupLine).toContain("github.ref");
      expect(groupLine).not.toContain("head_ref");
      // 也不能是裸分支名插值（例如误写成 github.ref_name），那同样只是短名，
      // 在不同 fork/不同仓库下不唯一。
      expect(groupLine).not.toContain("ref_name");
    });

    it(`${rel}: 非 pull_request 事件的 group 必须含 github.run_id（每个 run 自成一组）`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      const m = /^concurrency:\n(?:.*\n)*?\s*group:\s*(.+)$/m.exec(src);
      expect(m, `${rel} 里没找到 concurrency.group`).not.toBeNull();
      const groupLine = m![1];

      // #3038：GitHub 对同一 group 只保留**一个 pending**，与 cancel-in-progress 无关。
      // push/tag/schedule/dispatch 共用 `refs/heads/main` 这类固定 ref 时，跑道一满，
      // 新 run 入队就把旧的 pending 顶掉——main 自己的门一次都跑不完，main 上的红因此隐身
      // （#3177：一个半小时内十余次，第一次真正跑完就暴露出一条无人看见的存量红）。
      // 修法是让非 PR 事件的每个 run 各自成组（run_id 唯一）；#3177 的判决实验已实测确认
      // `github.run_id` 在顶层 concurrency 上下文里确实插值、该修法确实生效。
      // 这条断言钉住那个不变量：删掉 run_id 就是退回 #3038。
      expect(groupLine).toContain("github.run_id");
      // 且 run_id 必须挂在**非** pull_request 的那一支上：PR 分支要的就是同 ref 互相顶掉，
      // 给 PR 也加 run_id 会让 cancel-in-progress 永远命不中，退回 #2572 的堆积。
      const prBranch = /pull_request'\s*&&\s*([^|]+)\|\|/.exec(groupLine);
      expect(prBranch, `${rel} 的 group 不是 pull_request 三元表达式`).not.toBeNull();
      expect(prBranch![1]).not.toContain("run_id");
    });

    it(`${rel}: cancel-in-progress 只在 pull_request 事件上为 true`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      // 排除注释行——本文件与两个 workflow 自己都在注释里提到过
      // "cancel-in-progress: true"这个词组，只认不以 `#` 开头（去掉前导空白后）的那行。
      const m = /^\s*cancel-in-progress:\s*(.+)$/m.exec(
        src
          .split("\n")
          .filter((line) => !/^\s*#/.test(line))
          .join("\n"),
      );
      expect(m, `${rel} 里没找到非注释的 cancel-in-progress`).not.toBeNull();
      const cond = m![1];

      expect(cond).toContain("github.event_name == 'pull_request'");
      // 恒 true（不带任何条件）会在 main/tag/schedule/dispatch 上把已发生事件的
      // 验证结果顶掉，是另一种假绿——写死 true/false 都不行，必须是条件表达式。
      expect(cond.trim()).not.toBe("true");
      expect(cond.trim()).not.toBe("false");
    });
  }
});
