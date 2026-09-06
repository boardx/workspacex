/**
 * 2026-09-06 实测：deploy.sh 在 `4b-ii` 步以
 * `DIAG_DB_PASSWORD: unbound variable` 当场死掉。
 *
 * 根因不在那一步，在 provision.sh：生成 deploy.env 的整块都在 `if [ ! -f "$ENV_FILE" ]`
 * 里。于是**后来**给部署链新增的每一个必需键（`DIAG_DB_PASSWORD` 是 2026-09-02 随
 * app_diag_ro 一起加的），在已经有 deploy.env 的机器上永远补不进去——重跑 provision.sh
 * 也不会，因为那个 if 直接跳过。
 *
 * ⚠ 这个坑之所以到今天才炸，是因为那台机器上跑的 deploy.sh 是 2026-08-21 的旧副本
 *   （#2833 修的那件事）：新脚本的新需求从来没被执行过。一个 bug 藏着另一个。
 *
 * 两条门控，各配反证：
 * ① provision.sh 对**已存在**的 deploy.env 逐键补齐，且**绝不覆盖**已有的值
 *   （覆盖 = 把线上数据库密码换掉，服务连不上自己的库）。
 * ② deploy.sh 用之前先点名，报一句能照着做的话，而不是 `unbound variable`。
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const VM_DIR = resolve(import.meta.dirname);
const PROVISION = readFileSync(join(VM_DIR, "provision.sh"), "utf8");
const DEPLOY = readFileSync(join(VM_DIR, "deploy.sh"), "utf8");
const temps: string[] = [];

afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

/**
 * 把 provision.sh 里那段补齐逻辑单独跑起来。
 *
 * ⚠ 不跑整个 provision.sh：它要 root、装系统包、写 systemd。测的是补齐这一件事，
 *   所以把那段函数原样抽出来在临时目录上跑——抽取靠**锚点字符串**，锚点变了这里会
 *   立刻找不到而红，不会静默测一段过时的副本。
 */
function runBackfill(existingEnv: string): { env: string; stdout: string; status: number } {
  const start = PROVISION.indexOf("ensure_env_key() {");
  const end = PROVISION.indexOf('chown "${APP_USER}:${APP_USER}" "$ENV_FILE"', start);
  expect(start, "provision.sh 里找不到 ensure_env_key —— 锚点漂了").toBeGreaterThan(-1);
  expect(end, "provision.sh 里找不到补齐段的结尾").toBeGreaterThan(start);
  const snippet = PROVISION.slice(start, end);

  const temp = mkdtempSync(join(tmpdir(), "deploy-env-"));
  temps.push(temp);
  const envFile = join(temp, "deploy.env");
  writeFileSync(envFile, existingEnv);
  chmodSync(envFile, 0o600);

  const result = spawnSync("bash", ["-euo", "pipefail", "-c", `ENV_FILE=${JSON.stringify(envFile)}\n${snippet}`], {
    encoding: "utf8",
  });
  return { env: readFileSync(envFile, "utf8"), stdout: result.stdout, status: result.status ?? -1 };
}

describe("deploy.env 的新增必需键要能补进存量文件", () => {
  it("① 缺 DIAG_DB_PASSWORD 的存量文件被补齐", () => {
    const { env, status } = runBackfill("PGHOST=127.0.0.1\nAPP_DB_PASSWORD=already-live\n");
    expect(status).toBe(0);
    expect(env).toMatch(/^DIAG_DB_PASSWORD=.+$/m);
    expect(env).toMatch(/^DIAG_DB_USER=app_diag_ro$/m);
  });

  it("① 反证（最重要的一条）：已有的值一个字符都不许被改写", () => {
    const before = "APP_DB_PASSWORD=live-password-do-not-touch\nDIAG_DB_PASSWORD=live-diag-password\n";
    const { env } = runBackfill(before);
    expect(env).toContain("APP_DB_PASSWORD=live-password-do-not-touch");
    expect(env).toContain("DIAG_DB_PASSWORD=live-diag-password");
    // 也不许追加第二行同名键——`grep '^KEY='` 之后 source 谁生效是不确定的。
    expect(env.match(/^DIAG_DB_PASSWORD=/gm)).toHaveLength(1);
  });

  it("① 幂等：连跑两次结果一致", () => {
    const first = runBackfill("PGHOST=127.0.0.1\n").env;
    const second = runBackfill(first).env;
    expect(second).toBe(first);
  });

  it("② deploy.sh 在用之前先点名，且报错里给出可照做的修法", () => {
    expect(DEPLOY).toMatch(/for required_key in .*DIAG_DB_PASSWORD/);
    const block = DEPLOY.slice(DEPLOY.indexOf("for required_key in"));
    expect(block).toContain("provision.sh");
    expect(block).toContain("exit 1");
  });

  it("② 反证：点名检查必须排在使用之前，否则 unbound variable 先炸", () => {
    expect(DEPLOY.indexOf("for required_key in")).toBeLessThan(
      DEPLOY.indexOf("ALTER ROLE app_diag_ro PASSWORD"),
    );
  });
});
