import { defineConfig } from "vitest/config";

/**
 * 研判工作流的**纯领域**车道：状态机与门的判定不碰数据库、不碰时钟。
 *
 * 单独成一条车道的理由不是图快，是让"门到底拦不拦得住"这件事可以在任何机器上
 * 被立刻反证——包括没有 Docker 的环境。门控的可信度取决于它的测试有多容易被跑，
 * 一条必须先起 PG 容器才能验证的规则，实际上没人会去验证。
 */
export default defineConfig({ test: {
  include: ["tests/research-workflow/state-machine.test.ts", "tests/research-workflow/phase-enum-parity.test.ts", "tests/research-workflow/pass-gate.test.ts", "tests/research-workflow/guarded-operations.test.ts", "tests/research-workflow/verification.test.ts", "tests/research-workflow/agent-instructions-parity.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
