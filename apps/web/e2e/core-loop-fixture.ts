/**
 * #492 核心闭环的共享装置：**空库标签**，以及从 e2e 侧读/改库态的唯一入口。
 *
 * 库操作只是 `apps/api/scripts/core-loop-db.ts` 的薄壳。⚠ 刻意**不**在 `apps/web/e2e/**`
 * 里直连 PostgreSQL：库的 schema、角色划分（`app_rw` 无权 DELETE `auth_bootstrap_state`）、
 * RLS 策略全都住在 `apps/api`；在 web 侧另起一个 pg 客户端等于把这些事实抄第二份，
 * 而抄本会漂 —— 本仓已五次因「同一事实声明在两处」出事故。
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * 需要**零用户库**的用例的标签，唯一事实源。
 *
 * `core-loop.spec.ts` 拿它拼测试标题，`playwright.fullstack-smoke.config.ts` 拿它做
 * `grep` / `grepInvert` 把那一条分流到清库之后的 project。两边各写一份字面量的下场很具体：
 * 改了标题而没改 config，那条用例会**静悄悄地落回吃种子的 project 并从此恒红**，
 * 或者更糟——落进两个 project 里跑两遍，其中一遍恒绿。
 */
export const EMPTY_DB_TAG = "@empty-db";
/** 同一事实的正则形态，给 Playwright 的 project 分流用。 */
export const EMPTY_DB_TAG_RE = new RegExp(EMPTY_DB_TAG);

/**
 * ⚠ `__dirname`，不是 `import.meta.url`。Playwright 把 config 与 spec 转译成 **CJS** 再加载，
 * 那里 `import.meta` 是语法错误 —— 实测：整个 config 加载失败，一个用例都跑不起来。
 */
const ROOT = resolve(__dirname, "../../..");
/** 脚本用它给 JSON 打头，好从 pnpm 的噪声输出里抠出来，而不是假设 stdout 只有 JSON。 */
const MARKER = "__CORE_LOOP_DB__";

export interface CoreLoopDbStat {
  readonly credentials: number;
  readonly bootstrapConsumed: boolean;
  readonly orgRoles: readonly string[];
  readonly orgNames: readonly string[];
}

function run(command: "reset" | "stat", email: string): CoreLoopDbStat {
  let stdout: string;
  try {
    stdout = execFileSync(
      "pnpm",
      ["--filter", "@repo/api", "exec", "tsx", "scripts/core-loop-db.ts", command, email],
      { cwd: ROOT, encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`core-loop-db ${command} 失败:\n${err.stdout ?? ""}\n${err.stderr ?? ""}`);
  }
  const payload = new RegExp(`${MARKER}(.*)`).exec(stdout)?.[1];
  if (payload === undefined) throw new Error(`core-loop-db ${command} 没有产出可解析的库态:\n${stdout}`);
  return JSON.parse(payload) as CoreLoopDbStat;
}

/** 把库清成零用户，并把一次性 bootstrap 门重新打开。 */
export const resetToEmptyDatabase = (): CoreLoopDbStat => run("reset", "");

/** 读当前库态。`email` 用来查该账号在正式组织里的角色。 */
export const readDatabaseStat = (email: string): CoreLoopDbStat => run("stat", email);
