// drop-database.test.ts — #487 的反证：**故意不归还一条连接**，断言拆库时
// ① 库确实被拆掉了（拆除动作本身不能因为泄漏而卡住）；
// ② 报出来的错误**指名道姓**（pid / application_name），而不是一条匿名 FATAL 57P01；
// ③ 没有泄漏时安安静静，不误报。
//
// 修复前的行为是 `DROP DATABASE … WITH (FORCE)`：库也会被拆掉，但残留连接收到的
// FATAL 会以运行期错误冒进 vitest —— 表现为「全部测试通过但 job 红」，且错误里
// 没有任何可行动的信息。所以本文件断言的重点不是「能不能拆」，是**拆的时候说了什么**。
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { dropDatabaseAfterDraining } from "./drop-database";

const APP_NAME = "drop-database-leak-probe";
const created: string[] = [];
const openClients: pg.Client[] = [];

function config(database: string, applicationName?: string) {
  return { ...migrationConfig(), database, ...(applicationName ? { application_name: applicationName } : {}) };
}

async function admin(database = "postgres"): Promise<pg.Client> {
  const client = new pg.Client(config(database));
  await client.connect();
  return client;
}

async function makeDatabase(): Promise<string> {
  const name = `wsx_drop_probe_${process.pid}_${created.length}_${Date.now()}`;
  const root = await admin();
  try {
    await root.query(`CREATE DATABASE ${name}`);
  } finally {
    await root.end();
  }
  created.push(name);
  return name;
}

async function exists(name: string): Promise<boolean> {
  const root = await admin();
  try {
    const { rows } = await root.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    return rows.length > 0;
  } finally {
    await root.end();
  }
}

beforeAll(() => {
  // 需要真实 PostgreSQL；缺了就该红，不是"跳过算通过"
  expect(migrationConfig().host, "本套件需要真实 PostgreSQL 连接配置").toBeTruthy();
}, 30_000);

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((c) => c.end().catch(() => undefined)));
});

describe("#487 拆库必须排空连接，并对泄漏指名道姓", () => {
  it("没有残留连接时安静拆掉，不误报", async () => {
    const name = await makeDatabase();
    const root = await admin();
    try {
      const leaked = await dropDatabaseAfterDraining(root, name, { graceMs: 500 });
      expect(leaked).toEqual([]);
    } finally {
      await root.end();
    }
    expect(await exists(name)).toBe(false);
  }, 60_000);

  it("反证：故意留一条活连接 —— 库照样拆掉，但必须报出是谁", async () => {
    const name = await makeDatabase();
    const leaker = new pg.Client(config(name, APP_NAME));
    // 被 pg_terminate_backend 干掉的客户端会 emit 一个 'error'。没有 handler 时
    // 它就是一条**运行期未捕获错误**——正是 #487 原始事故的形态（全部测试通过、
    // job 却红）。这里显式接住它：本用例要证的是「报告指名道姓」，
    // 而不是把同一个坑再踩一遍。
    leaker.on("error", () => undefined);
    await leaker.connect();
    openClients.push(leaker);
    // 让它处于「事务里挂着」这种最难缠的状态，而不是空闲
    await leaker.query("BEGIN");
    await leaker.query("SELECT 1");

    const root = await admin();
    let error: Error | null = null;
    try {
      await dropDatabaseAfterDraining(root, name, { graceMs: 300 });
    } catch (e) {
      error = e as Error;
    } finally {
      await root.end();
    }

    expect(error, "泄漏必须失败，不能被静默吞掉").not.toBeNull();
    // 关键：错误必须可行动 —— 指出 application_name，并说清该改哪里
    expect(error!.message).toContain(APP_NAME);
    expect(error!.message).toMatch(/pid=\d+/);
    expect(error!.message).toContain("afterAll");
    // 反面：不能只是把原始 FATAL 抛出来
    expect(error!.message).not.toContain("57P01");
    // 拆除动作本身必须成功 —— 泄漏不该把库留在那里污染下一次 run
    expect(await exists(name), "库必须已被拆掉").toBe(false);
  }, 60_000);

  it("throwOnLeak: false 时只报告不抛错（供确实需要豁免的调用方显式选择）", async () => {
    const name = await makeDatabase();
    const leaker = new pg.Client(config(name, APP_NAME));
    leaker.on("error", () => undefined);
    await leaker.connect();
    openClients.push(leaker);

    const root = await admin();
    try {
      const leaked = await dropDatabaseAfterDraining(root, name, { graceMs: 300, throwOnLeak: false });
      expect(leaked.length).toBeGreaterThan(0);
      expect(leaked.some((c) => c.applicationName === APP_NAME)).toBe(true);
    } finally {
      await root.end();
    }
    expect(await exists(name)).toBe(false);
  }, 60_000);
});
