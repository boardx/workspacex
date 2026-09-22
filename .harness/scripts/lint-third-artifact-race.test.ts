/**
 * #1021 的第二半反证：`readdir(<phase>/contracts)` 自己抛 ENOENT。
 *
 * 实测报的那条就是它：全量 .harness 套件并行时，本扫描器在 `existsSync` 与
 * `readdir` 之间撞上 design-signoff.test.ts 的 afterEach
 * （`rm -rf phases/phase-zz-signoff-test-fixture`），scandir ENOENT 抛穿，
 * 「真实仓库状态必须绿」那条用例红在一个跟它毫无关系的目录上。
 *
 * 这条窗口**没法用真实文件系统确定性地摆出来**（要在同步的两行之间插进一次 rm），
 * 所以这里只 mock `readdirSync` 在某一条路径上的那一次抛，其余全部走真盘：
 * 断言的是「扫描器撞上 ENOENT 之后是什么行为」，不是 mock 自己。
 *
 * 单独一个文件，是为了不让这次 node:fs mock 影响 lint-third-artifact.test.ts
 * 里那些走真实文件系统的用例（以及最后那条跑真仓库的反向反证）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** readdir 撞到这条路径时抛 `code`；每个用例自己设。 */
let failing: { path: string; code: string } | null = null;

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readdirSync = ((p: unknown, ...rest: unknown[]) => {
    if (failing !== null && String(p) === failing.path) {
      const err = new Error(
        `${failing.code}: simulated, scandir '${failing.path}'`,
      ) as NodeJS.ErrnoException;
      err.code = failing.code;
      throw err;
    }
    return (actual.readdirSync as (...a: unknown[]) => unknown)(p, ...rest);
  }) as typeof actual.readdirSync;
  return { ...actual, default: { ...actual, readdirSync }, readdirSync };
});

// @ts-expect-error —— .mjs 无类型声明，故意直接引
import { lintThirdArtifact } from "./lint-third-artifact.mjs";

type LintResult = { errors: string[]; rows: { label: string; form: string | null }[] };

let root: string;
const PHASE = "phase-test";
const BUNDLE = "demo";

function write(rel: string, body: string) {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
}

/** 一份合规的束：跑完应当零错误。 */
function goodBundle() {
  write(
    `phases/${PHASE}/contracts/${BUNDLE}/coverage.md`,
    [
      `# 契约束 \`${BUNDLE}\` — UC 覆盖证明`,
      "",
      "| V | 一句话 | API 操作 | 前端消费点 | 状态 |",
      "|---|---|---|---|---|",
      "| V1 | 线索 1 | `UC-1 createThing` | `thing-list` | ✅ |",
    ].join("\n"),
  );
  write(`phases/${PHASE}/contracts/${BUNDLE}/domain.md`, "# 契约束 — ① 领域模型\n\n## 一、值对象\n\n略。");
  write(`packages/contracts/src/${BUNDLE}.ts`, "export const Thing = z.object({});");
}

function run(): LintResult {
  return lintThirdArtifact({
    root,
    phasesRoot: join(root, "phases"),
    contractsSrc: join(root, "packages", "contracts", "src"),
    schemaMapFile: join(root, ".harness", "scripts", "third-artifact-map.json"),
  }) as LintResult;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "third-artifact-race-"));
  failing = null;
});
afterEach(() => {
  failing = null;
  rmSync(root, { recursive: true, force: true });
});

describe("扫描途中目录被删（#1021 的实测形状）", () => {
  it("某阶段的 contracts/ 在 readdir 那一刻 ENOENT ⇒ 跳过它，别的阶段照常判定", () => {
    goodBundle();
    // 另一个阶段：stat 时还在，readdir 时已经被并行的测试 rm 掉了。
    mkdirSync(join(root, "phases", "phase-zz-gone", "contracts", "b"), { recursive: true });
    failing = { path: join(root, "phases", "phase-zz-gone", "contracts"), code: "ENOENT" };

    let out: LintResult | undefined;
    expect(() => { out = run(); }).not.toThrow();
    expect(out!.errors).toEqual([]);
    expect(out!.rows.map((r) => r.label)).toEqual([`${PHASE}/${BUNDLE}`]);
  });

  it("phases/ 自己 ENOENT ⇒ 空集防线照样红，不是「扫不到所以全绿」", () => {
    goodBundle();
    failing = { path: join(root, "phases"), code: "ENOENT" };
    expect(run().errors.join("\n")).toContain("门控无对象可查");
  });

  it("不是 ENOENT 的错误必须抛穿 —— 权限/IO 故障不许被吞成「没看见」", () => {
    goodBundle();
    failing = { path: join(root, "phases", PHASE, "contracts"), code: "EACCES" };
    expect(() => run()).toThrow(/EACCES/);
  });
});
