/**
 * 启动失败必须**说得出话**（#548 的账单，不是理论顾虑）。
 *
 * ## 这个文件是为哪次事故立的
 *
 * #548 往 `kernel.module` 里加了一个 provider 工厂：缺 `MODEL_CREDENTIAL_KEY` 就抛错
 * （那是 `aes-credential-cipher.ts` 文件头写死的取舍——加密密钥不许有开发态兜底）。
 * 语义是对的，形态是灾难：`NestFactory.create` 的默认值是 `abortOnError: true`，
 * 而那个 abort 是字面意义的 `process.abort()`（`@nestjs/core/nest-factory.js:118`），
 * **进程原地消失，一个字都不打印**。
 *
 * 于是 CI 上的全部证据是：`@repo/api#test` 跑满 5 分钟后 exited (1)，
 * `Test Files 385 passed (449)`、`Errors 64 errors`，
 * 64 条一模一样的 `Error: Worker exited unexpectedly`（tinypool 的 onUnexpectedExit），
 * **0 个断言失败**。既不说是哪个 provider，也不说缺哪个变量。
 * 上一位实现方据此判成「本机环境问题，与本改动无关」并 `push --no-verify`——
 * 在那个形态下，这个判断几乎是必然的。
 *
 * ## 断的是什么
 *
 * ① 缺 key ⇒ `createApp()` **reject**，且异常消息里指名 `MODEL_CREDENTIAL_KEY`。
 *   —— 断的是**失败形态**（rejects vs abort），不是「启动会不会失败」。
 *      启动仍然必须失败：本文件不放宽那条要求，见 ③。
 * ② 反证：`process.abort` 在整段期间被替换成一个会让断言红掉的哨兵。
 *   若哪天有人把 `abortOnError` 改回去（或删掉它，让默认值回来），
 *   本文件不是「测不到」，而是**红**。
 * ③ 有 key ⇒ 正常起得来。这条是 ① 的对照：否则「总是 reject」也能骗过 ①。
 *
 * ⚠ 不打数据库。`PgDatabase` 的构造只建连接池不连；这里只走 Nest 的实例化阶段。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MODEL_CREDENTIAL_KEY_ENV } from "../../../src/infrastructure/model/aes-credential-cipher";

process.env.KERNEL_QUIET = "1";

/** vitest.config.ts 的 `env` 下发的那一份，测完要原样放回去。 */
const ORIGINAL_KEY = process.env[MODEL_CREDENTIAL_KEY_ENV];
const ORIGINAL_ABORT = process.abort;

/** 每个用例都新 import 一次也没必要：`createApp` 无状态，工厂在调用时才求值。 */
const createApp = async () => (await import("../../../src/main")).createApp();

describe("kernel boot failures are legible", () => {
  beforeEach(() => {
    /**
     * ⚠ 反证 ②：把 `process.abort` 换掉。
     *
     * 真的 abort 会让 worker 消失，本文件连同它的断言一起蒸发——「测试没红」会被
     * 误读成「测试通过」，正是 #548 踩的那个坑。换成抛异常之后，一旦 `abortOnError`
     * 回到 true，① 拿到的就是这条哨兵消息而不是 cipher 的消息，断言红。
     */
    Object.defineProperty(process, "abort", {
      configurable: true,
      value: () => {
        throw new Error("SENTINEL: process.abort() was called — NestFactory abortOnError is back on");
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "abort", { configurable: true, value: ORIGINAL_ABORT });
    if (ORIGINAL_KEY === undefined) delete process.env[MODEL_CREDENTIAL_KEY_ENV];
    else process.env[MODEL_CREDENTIAL_KEY_ENV] = ORIGINAL_KEY;
  });

  it("① 缺 MODEL_CREDENTIAL_KEY：启动失败，且异常指名是哪个变量", async () => {
    delete process.env[MODEL_CREDENTIAL_KEY_ENV];

    // 启动**仍然**失败——本文件不放宽这条，只要求它失败得说得出话。
    await expect(createApp()).rejects.toThrow(MODEL_CREDENTIAL_KEY_ENV);
  });

  it("② 失败走的是 rejects，不是 process.abort（哨兵没被触发）", async () => {
    delete process.env[MODEL_CREDENTIAL_KEY_ENV];

    const error = await createApp().then(
      () => new Error("createApp resolved without a credential key — the startup gate is gone"),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
    );

    expect(error.message).not.toContain("SENTINEL");
    expect(error.message).toContain(MODEL_CREDENTIAL_KEY_ENV);
  });

  it("③ 对照：有 key 时正常起得起来（否则 ① 会被「总是 reject」骗过）", async () => {
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "kernel-boot-test-key-not-a-production-secret";

    const app = await createApp();
    expect(app).toBeDefined();
    await app.close();
  });
});
