/**
 * issue #385 —— `init.sh` 的启动文案必须指向**本仓真实存在的应用层**，
 * 不许再留模板期的「模板无应用层 / 去建 phase-01」措辞。
 *
 * 为什么这需要机械门控：过期文案是**读起来完全正常**的那一类错误。它不会让任何
 * 命令退出码变红，只会让第一次进来的人按它做一遍，然后发现自己在一个早就有
 * Web/API/网关三个应用的仓库里被指去「接入你的 app」。这正是本仓
 * `static-trace-vs-live-fact.md` 记过的形状：痕迹写得越具体，读起来越像权威。
 *
 * 判据只看**会被打印出来的东西**（`echo` 行）与 `START_CMD` 的实际取值，不看
 * 整份文件的注释——脚本里讲历史的注释（例如 pre-push 收窄那几段）本来就该提到
 * 模板期的往事，把它们一起判红会逼人去删有用的出处。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const INIT_SH = readFileSync(resolve(ROOT, "init.sh"), "utf8");

/** `init.sh` 里所有会真的打印到终端的文案（`echo ...` 行，含 heredoc 外的缩进行）。 */
const echoedOutput = INIT_SH.split("\n")
  .filter((line) => /^\s*echo\s/.test(line))
  .join("\n");

/** `START_CMD="..."` 的赋值。脚本只赋值一次；拿不到就是脚本结构变了，该红。 */
const startCmd = ((): string => {
  const match = INIT_SH.match(/^START_CMD="([^"]*)"/m);
  if (match?.[1] === undefined) {
    throw new Error('init.sh 里找不到 START_CMD="..." 赋值');
  }
  return match[1];
})();

describe("init.sh 的启动文案（issue #385）", () => {
  it("没有任何一句声称本仓没有应用层", () => {
    // 注释也算：`START_CMD` 旁边那句「模板无应用层」正是 #385 的原始缺陷。
    expect(INIT_SH).not.toContain("模板无应用层");
    for (const stale of ["无应用层", "接入你的 app", "改成真实启动命令"]) {
      expect(INIT_SH).not.toContain(stale);
    }
  });

  it("打印的内容里没有模板期的「先去建 phase-01」引导", () => {
    for (const stale of [
      "十分钟接入",
      "new-phase --id 01",
      "phases/phase-01-*/requirements/",
      "填 .harness/instructions/project/PROJECT.md",
    ]) {
      expect(echoedOutput).not.toContain(stale);
    }
  });

  it("START_CMD 是真实启动命令，不是空占位", () => {
    expect(startCmd.trim()).not.toBe("");
    // 真实启动命令必须点到本仓真实存在的应用包名，不能是泛泛的 `pnpm dev`。
    expect(startCmd).toMatch(/(web|@repo\/api)/);
  });

  it("打印的内容点名 Web / API / 网关三个真实入口", () => {
    for (const entry of ["apps/web", "apps/api", "coord-gateway"]) {
      expect(echoedOutput).toContain(entry);
    }
  });
});
