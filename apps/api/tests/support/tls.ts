/**
 * #595 —— test-only 自签证书，**每次运行当场生成**。
 *
 * ## 为什么不是入库的 fixture（这是一次 CI 红换来的）
 *
 * 最初的写法是「openssl 一次性生成并入库」。**它从来没有入过库**：
 * 仓库 `.gitignore:74` 有一条 `*.pem`，⇒ `git add` 静默跳过了那两个文件，
 * 只有 `openssl.cnf` 进了库。
 *
 * ⚠ **本地全绿，CI 全红。** 本地绿是因为生成出来的文件还躺在开发者磁盘上；
 *   CI 是干净 checkout，`readFileSync` 直接 ENOENT。
 *   实测红因（PR #600，run 31038098460）：
 *     `ENOENT: … /apps/api/tests/support/tls/test-only.cert.pem`
 *     `Test Files 1 failed | 455 passed`
 *
 * ⇒ 这正是「**绿来自机器状态，不是来自仓库内容**」。⛔ 裁定（coord-main）：
 *   **不把证书提交进库，也不给 `.gitignore` 开逐条例外**——不开这个口子。
 *   改成每次测试运行当场生成，**CI 与本地行为一致，不依赖仓库状态**。
 *
 * ## 🔴 生成失败必须 FAIL，⛔ 绝不 skip
 *
 * ⚠ 一个「找不到 openssl 就跳过 TLS 用例」的实现**会让 CI 变绿**，而
 *   **重定向逐跳过门**与**响应体上限**两条就此无人验证。
 *   那是本项目反复测量到的形状：**绿了，但覆盖面悄悄没了。**
 *
 * ⇒ 本文件在任何失败路径上都 `throw`，⛔ 没有任何 `skip` / 降级 / 静默兜底。
 *   常驻反证见 `tests/skill/tls-fixture-fails-loudly.test.ts`：
 *   把 openssl 换成不存在的命令，**必须有断言变红**。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface TestTlsMaterial {
  readonly cert: Buffer;
  readonly key: Buffer;
}

/**
 * SAN 列表住在 `tls/openssl.cnf`（**已入库**，它不是 `*.pem` 所以没被忽略）。
 * ⚠ 测试里的主机名（`allowed.example` / `redirect.example` / `big.example` …）
 *   必须与那份 cnf 的 `subjectAltName` 对得上，否则握手会以
 *   `Hostname/IP does not match certificate's altnames` 失败——
 *   ⚠ 那个报错看起来像「门坏了」，其实是 fixture 与用例不同步。
 */
const CONFIG_PATH = fileURLToPath(new URL("./tls/openssl.cnf", import.meta.url));

/**
 * 生成一对 test-only 证书/私钥，写进**临时目录**（不是仓库目录）。
 *
 * @param opensslBin 可注入，**只为常驻反证服务**：传一个不存在的命令必须抛错。
 *        ⛔ 生产/正常测试路径一律用默认值。
 */
export function generateTestTlsMaterial(opensslBin = "openssl"): TestTlsMaterial {
  const dir = mkdtempSync(join(tmpdir(), "workspacex-test-tls-"));
  const certPath = join(dir, "test-only.cert.pem");
  const keyPath = join(dir, "test-only.key.pem");

  try {
    execFileSync(
      opensslBin,
      [
        "req", "-x509",
        "-newkey", "rsa:2048",
        "-nodes",
        "-keyout", keyPath,
        "-out", certPath,
        // 一天足够：它随进程生成、随临时目录消失，不存在「过期没人续」的问题。
        "-days", "1",
        "-config", CONFIG_PATH,
      ],
      { stdio: "pipe" },
    );
  } catch (cause) {
    /**
     * ⚠ 抛错，**不是 skip**。错误信息必须说清缺什么、怎么装——
     *   否则下一个人看到的是一句无从下手的 ENOENT。
     */
    throw new Error(
      `无法生成 test-only TLS 证书：调用 \`${opensslBin}\` 失败。\n` +
        `这些用例（重定向逐跳过门 / 响应体上限）**必须**完成真实 TLS 握手才验得到，\n` +
        `⛔ 因此这里选择 FAIL 而不是 skip —— 跳过会让 CI 变绿而覆盖面悄悄消失。\n` +
        `修法：安装 openssl（Debian/Ubuntu: \`apt-get install -y openssl\`；macOS 自带）。\n` +
        `使用的 config：${CONFIG_PATH}`,
      { cause },
    );
  }

  return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}

let cached: TestTlsMaterial | null = null;

/** 进程内缓存一份：同一次 vitest 运行里多个文件共用，不必反复调 openssl。 */
export function testTlsMaterial(): TestTlsMaterial {
  cached ??= generateTestTlsMaterial();
  return cached;
}
