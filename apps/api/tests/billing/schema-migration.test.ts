/**
 * F01（Phase 21 billing-payment）：计费六表迁移的结构 / 约束 / 授权面；
 * 并钉住「本域不设 RLS」是**有意决定**（表按 (owner_type, owner_id) 归属，没有 org_id 列）。
 *
 * 真实 PostgreSQL：约束由 DB 执行、授权面以 app_rw 实测；库内门见
 * `apps/api/migrations/20261001090000_billing_credits_core.sql` 头注（I-2/I-4/I-5/I-7/I-8/I-11）。
 */

// @global-scope-fixture table:billing_orders: 计费域表无 org_id 列（按 (owner_type, owner_id) 归属，理由见迁移头注）；
//   本文件以 app 角色种订单正例与显式非法值；收敛者=本文件 cleanup()（owner_id / order_no 前缀）。
// @global-scope-fixture table:billing_webhook_events: 同上无 org_id；种微信/Stripe 回调幂等键（含 order_no 为 NULL 的 Stripe 行）；
//   收敛者=本文件 cleanup()（provider_event_id LIKE 'f01-evt-%' 兜住 order_no IS NULL 的行）。
// @global-scope-fixture table:credit_packages: 同上无 org_id；只种一条预期被 CHECK 拒绝的反证行（test-f01- 前缀）；
//   收敛者=本文件 cleanup()（package_id LIKE 'test-f01-%'，兜住「万一落行」）。
// @global-scope-fixture table:credit_transactions: 同上无 org_id；种账本去重/发放留痕的正反例；
//   收敛者=本文件 cleanup()（按 wallet 归属 test-f01-% 删除）。
// @global-scope-fixture table:credit_wallets: 同上无 org_id；种钱包唯一性正反例；收敛者=本文件 cleanup()（owner_id LIKE 'test-f01-%'）。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce } from "../support/db";

const USER = "test-f01-user";
const TEAM = "test-f01-team";
const ORDER_A = "bg20261001090000TST001";
const ORDER_B = "bg20261001090000TST002";

async function columns(table: string): Promise<string[]> {
  return asOwner(async (c) => (await c.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`, [table])).rows.map((r) => r.column_name));
}

async function grants(table: string): Promise<string[]> {
  return asOwner(async (c) => (await c.query<{ privilege_type: string }>(
    `SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = $1 AND grantee = 'app_rw' ORDER BY privilege_type`, [table])).rows.map((r) => r.privilege_type));
}

const insertWallet = (ownerType: string, ownerId: string) =>
  asApp(null, async (c) => (await c.query<{ wallet_id: string }>(
    "INSERT INTO credit_wallets (owner_type, owner_id) VALUES ($1, $2) RETURNING wallet_id",
    [ownerType, ownerId])).rows[0]!.wallet_id);

const insertOrder = (orderNo: string, extra: {
  ownerId?: string; status?: string; qr?: string; packageId?: string;
} = {}) =>
  asApp(null, (c) => c.query(
    `INSERT INTO billing_orders
       (order_no, owner_type, owner_id, created_by, package_id, amount_fen, base_credits, bonus_credits, currency, qr_code_url, status, expired_at)
     VALUES ($1, 'user', $2, 'test-f01', $3, 9900, 1200, 120, 'CNY', $4, $5, now() + interval '15 minutes')`,
    [orderNo, extra.ownerId ?? USER, extra.packageId ?? "pkg-plus",
      extra.qr ?? "weixin://wxpay/bizpayurl?pr=test", extra.status ?? "PENDING"]));

const cleanup = () => asOwner(async (c) => {
  await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id LIKE 'test-f01-%')");
  // Stripe 事件行 order_no 为 NULL，order_no LIKE 匹配不到 → 必须按 provider_event_id 前缀兜底
  await c.query("DELETE FROM billing_webhook_events WHERE order_no LIKE 'bg2026100109%' OR provider_event_id LIKE 'f01-evt-%'");
  await c.query("DELETE FROM billing_orders WHERE owner_id LIKE 'test-f01-%'");
  await c.query("DELETE FROM credit_wallets WHERE owner_id LIKE 'test-f01-%'");
  await c.query("DELETE FROM credit_packages WHERE package_id LIKE 'test-f01-%'");
  await c.query("DELETE FROM org_billing_settings WHERE org_id LIKE 'test-f01-%'");
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});

beforeEach(cleanup);
afterAll(cleanup);

describe("计费六表结构", () => {
  it("列的集合被逐表钉住", async () => {
    expect(await columns("credit_packages")).toEqual([
      "amount_fen", "base_credits", "bonus_credits", "bonus_rate", "currency", "enabled",
      "owner_type", "package_id", "region", "sort_order", "total_credits",
    ]);
    expect(await columns("billing_orders")).toEqual([
      "amount_fen", "base_credits", "bonus_credits", "channel_order_no", "closed_at", "created_at",
      "created_by", "currency", "expired_at", "last_error_code", "last_error_message", "notify_at",
      "order_no", "owner_id", "owner_type", "package_id", "paid_at", "provider", "qr_code_url", "status",
    ]);
    expect(await columns("credit_wallets")).toEqual([
      "balance", "owner_id", "owner_type", "total_granted", "total_purchased", "updated_at", "wallet_id",
    ]);
    expect(await columns("credit_transactions")).toEqual([
      "balance_after", "created_at", "credits", "direction", "operator_id", "reason",
      "source_id", "source_type", "txn_id", "type", "wallet_id",
    ]);
    expect(await columns("org_billing_settings")).toEqual([
      "credit_enabled", "org_id", "updated_at", "updated_by",
    ]);
    expect(await columns("billing_webhook_events")).toEqual([
      "event_id", "order_no", "processed_at", "provider", "provider_event_id", "result", "signature_verified",
    ]);
  });

  it("本域不设 RLS（有意决定：按 owner 归属、无 org_id；归属校验在应用层 I-9）", async () => {
    for (const t of [
      "credit_packages", "billing_orders", "credit_wallets", "credit_transactions",
      "org_billing_settings", "billing_webhook_events",
    ]) {
      const row = await asOwner(async (c) => (await c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace",
        [t])).rows[0]);
      expect(row, t).toEqual({ relrowsecurity: false, relforcerowsecurity: false });
    }
  });

  it("授权面按最小化钉住：账本只增不改", async () => {
    expect(await grants("credit_packages")).toEqual(["SELECT"]);
    expect(await grants("billing_orders")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(await grants("credit_wallets")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(await grants("credit_transactions")).toEqual(["INSERT", "SELECT"]);
    expect(await grants("org_billing_settings")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(await grants("billing_webhook_events")).toEqual(["INSERT", "SELECT"]);
  });

  it("账本对 app_rw 禁改（UPDATE 被权限拒绝）", async () => {
    const walletId = await insertWallet("user", USER);
    await asApp(null, (c) => c.query(
      `INSERT INTO credit_transactions (wallet_id, type, credits, balance_after, source_type, source_id)
       VALUES ($1, 'purchase', 500, 500, 'payment_order', $2)`, [walletId, ORDER_A]));
    await expect(asApp(null, (c) => c.query("UPDATE credit_transactions SET credits = 1")))
      .rejects.toThrow(/permission denied/);
  });
});

describe("套餐种子与迁移幂等", () => {
  it("三个种子套餐存在且金额/额度一致（base + bonus = total）", async () => {
    const rows = await asApp(null, async (c) => (await c.query<{
      package_id: string; amount_fen: number; base_credits: number; bonus_credits: number;
      total_credits: number; owner_type: string; enabled: boolean;
    }>(
      `SELECT package_id, amount_fen, base_credits, bonus_credits, total_credits, owner_type, enabled
         FROM credit_packages WHERE package_id IN ('pkg-basic', 'pkg-plus', 'pkg-pro') ORDER BY sort_order`)).rows);
    expect(rows).toEqual([
      { package_id: "pkg-basic", amount_fen: 4900, base_credits: 500, bonus_credits: 0, total_credits: 500, owner_type: "both", enabled: true },
      { package_id: "pkg-plus", amount_fen: 9900, base_credits: 1200, bonus_credits: 120, total_credits: 1320, owner_type: "both", enabled: true },
      { package_id: "pkg-pro", amount_fen: 39900, base_credits: 5000, bonus_credits: 1000, total_credits: 6000, owner_type: "both", enabled: true },
    ]);
  });

  it("迁移可重复执行：再跑一次不报错、种子不重复", async () => {
    await migrateOnce();
    const n = await asOwner(async (c) => (await c.query<{ n: string }>("SELECT count(*) AS n FROM credit_packages")).rows[0]!);
    expect(Number(n.n)).toBe(3);
  });

  it("total ≠ base + bonus 的行被 CHECK 拒绝", async () => {
    await expect(asOwner((c) => c.query(
      `INSERT INTO credit_packages (package_id, region, currency, amount_fen, base_credits, bonus_credits, total_credits)
       VALUES ('test-f01-bad', 'cn', 'CNY', 100, 10, 0, 999)`))).rejects.toThrow(/check constraint/);
  });
});

describe("约束与幂等键", () => {
  it("钱包 (owner_type, owner_id) 唯一（I-4）", async () => {
    await insertWallet("user", USER);
    await expect(insertWallet("user", USER)).rejects.toThrow(/duplicate key/);
    await insertWallet("team", TEAM); // 另一主体可建
  });

  it("订单：格式 / 枚举 / 二维码 / FK 门，且合法 PENDING 单可落（app_rw 可写）", async () => {
    await insertOrder(ORDER_A);
    const row = await asApp(null, async (c) => (await c.query<{ status: string; provider: string }>(
      "SELECT status, provider FROM billing_orders WHERE order_no = $1", [ORDER_A])).rows[0]);
    expect(row).toEqual({ status: "PENDING", provider: "wechat" });

    await expect(insertOrder("BAD-NO")).rejects.toThrow(/check constraint/);            // I-13/订单号格式
    await expect(insertOrder(ORDER_B, { status: "CANCELLED" })).rejects.toThrow(/check constraint/);
    await expect(insertOrder(ORDER_B, { qr: "" })).rejects.toThrow(/check constraint/);  // I-13：无假二维码
    await expect(insertOrder(ORDER_B, { packageId: "pkg-nope" })).rejects.toThrow(/foreign key/);
    await expect(insertOrder(ORDER_A)).rejects.toThrow(/duplicate key/);
  });

  it("订单快照列不可变（I-5）：状态可推进、金额改不动", async () => {
    await insertOrder(ORDER_A);
    await asApp(null, (c) => c.query("UPDATE billing_orders SET status = 'PROCESSING' WHERE order_no = $1", [ORDER_A]));
    await expect(asApp(null, (c) => c.query(
      "UPDATE billing_orders SET amount_fen = 1 WHERE order_no = $1", [ORDER_A]))).rejects.toThrow(/immutable/);
  });

  it("流水去重键（I-2）与发放留痕（I-8）", async () => {
    const walletId = await insertWallet("user", USER);
    await asApp(null, (c) => c.query(
      `INSERT INTO credit_transactions (wallet_id, type, credits, balance_after, source_type, source_id)
       VALUES ($1, 'purchase', 1200, 1200, 'payment_order', $2)`, [walletId, ORDER_A]));
    await expect(asApp(null, (c) => c.query(
      `INSERT INTO credit_transactions (wallet_id, type, credits, balance_after, source_type, source_id)
       VALUES ($1, 'purchase', 1200, 2400, 'payment_order', $2)`, [walletId, ORDER_A])))
      .rejects.toThrow(/duplicate key/);
    // 同订单的 bonus 是另一条（type 参与去重键）→ 允许
    await asApp(null, (c) => c.query(
      `INSERT INTO credit_transactions (wallet_id, type, credits, balance_after, source_type, source_id)
       VALUES ($1, 'bonus', 120, 1320, 'payment_order', $2)`, [walletId, ORDER_A]));
    // grant 缺 operator/reason 被拒；补齐后允许（I-8）
    await expect(asApp(null, (c) => c.query(
      `INSERT INTO credit_transactions (wallet_id, type, credits, balance_after, source_type, source_id)
       VALUES ($1, 'grant', 10, 1330, 'admin_grant', 'grant-1')`, [walletId]))).rejects.toThrow(/check constraint/);
    await asApp(null, (c) => c.query(
      `INSERT INTO credit_transactions (wallet_id, type, credits, balance_after, source_type, source_id, operator_id, reason)
       VALUES ($1, 'grant', 10, 1330, 'admin_grant', 'grant-1', 'admin-x', '回调延迟补偿')`, [walletId]));
  });

  it("回调事件 (provider, provider_event_id) 唯一（I-7）；Stripe 行 order_no 可空", async () => {
    await asApp(null, (c) => c.query(
      `INSERT INTO billing_webhook_events (provider, provider_event_id, order_no, signature_verified, result)
       VALUES ('wechat', 'f01-evt-1', $1, true, 'ok')`, [ORDER_A]));
    await expect(asApp(null, (c) => c.query(
      `INSERT INTO billing_webhook_events (provider, provider_event_id, signature_verified, result)
       VALUES ('wechat', 'f01-evt-1', true, 'ok')`))).rejects.toThrow(/duplicate key/);
    await asApp(null, (c) => c.query(
      `INSERT INTO billing_webhook_events (provider, provider_event_id, signature_verified, result)
       VALUES ('stripe', 'f01-evt-1', true, 'ignored')`)); // 不同 provider 不互相撞
    await expect(asApp(null, (c) => c.query(
      `INSERT INTO billing_webhook_events (provider, provider_event_id, signature_verified, result)
       VALUES ('wechat', 'f01-evt-2', true, 'weird')`))).rejects.toThrow(/check constraint/);
  });
});
