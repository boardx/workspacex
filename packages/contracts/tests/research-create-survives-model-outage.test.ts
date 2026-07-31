/**
 * 反证套件 —— **E1：Scout 不可用不得让「新建深度研究」失败**（`uc-24-1` E1 / F144）
 *
 * ## 为什么这个文件存在
 * `research.ts` 的 `createResearch` 注释逐字写着：
 *   「`MODEL_UNAVAILABLE` **不在本操作的 `err` 里**……
 *     反过来说：**谁把 `MODEL_UNAVAILABLE` 加进这里，E1 就当场破了**。」
 * 而 2026-07-31 起草 F144 时实测：**全仓没有任何测试断这件事**
 * （`grep -rn MODEL_UNAVAILABLE packages/contracts --include=*.test.ts` → 零命中）。
 *
 * ⇒ 这正是 `AGENTS.md` 自己那一条：**没有脚本的规范条目视为未落地**。
 *   注释拦不住任何人，它只是在事后解释为什么会错。本文件把它变成会红的东西。
 *
 * ## 断的是「契约里没有那个东西」
 * 这一类断言（缺席即正确）最容易写成空转——集合取错名字、操作被改名，
 * 断言都会静默变绿。因此每条都配了反向锚：先证明**参照物存在**，再证明**目标缺席**。
 */
import { describe, it, expect } from "vitest";
import { operations, ResearchError } from "../src/research";

const createErr = operations.createResearch.err as readonly string[];
const runErr = operations.runResearch.err as readonly string[];

describe("uc-24-1 E1 · 模型不可用时研究仍然创建成功", () => {
  it("① createResearch 的失败枚举里**没有** MODEL_UNAVAILABLE", () => {
    expect(
      createErr,
      "MODEL_UNAVAILABLE 被加进 createResearch.err —— E1 当场破：Scout 跑不动就会丢掉用户填的七项配置",
    ).not.toContain("MODEL_UNAVAILABLE");
  });

  it("② 反空转：MODEL_UNAVAILABLE 确实是本束存在的码，且它属于 runResearch", () => {
    // 缺这条时，把该码整个删掉 / 改名，①  会静默变绿。
    expect(ResearchError.options).toContain("MODEL_UNAVAILABLE");
    expect(runErr, "MODEL_UNAVAILABLE 不在 runResearch.err —— 它被搬走了，①  的缺席就没有意义了").toContain("MODEL_UNAVAILABLE");
  });

  it("③ 反空转：createResearch.err 不是空数组（空集合会让 ① 平凡为真）", () => {
    expect(createErr.length).toBeGreaterThan(0);
    // 它现在只该有两条角色码——多出别的码需要有人解释一句
    expect([...createErr].sort()).toEqual(["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT"]);
  });

  it("④ 同族：跑研究才可能失败的三个码，一个都不许出现在创建里", () => {
    for (const code of ["MODEL_UNAVAILABLE", "AGENT_RUN_FAILED", "SOURCE_PREF_VIOLATION"]) {
      expect(ResearchError.options, `${code} 不在 ResearchError 里 —— 下一行的断言会平凡为真`).toContain(code);
      expect(createErr, `${code} 出现在 createResearch.err —— 创建被外部依赖绑架了`).not.toContain(code);
    }
  });

  it("⑤ 契约面刻意没有 VALIDATION_FAILED：question 的非空由 schema 表达，不是域错误码", () => {
    expect(createErr).not.toContain("VALIDATION_FAILED");
    expect(ResearchError.options).not.toContain("VALIDATION_FAILED");
  });
});
