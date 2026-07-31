/**
 * F78 AC1 / AC4 —— 到期时间**固化**、到期**先逻辑失效再物理删除**、删除证明**可检索**。
 *
 * 四组断言，每组都有一个「如果只写正向就会漏掉」的反向面：
 *
 *   1. **固化（I-30 / I-31）** —— 正向：落库即有 `expiresAt`。
 *      **反向**：固化之后把项目参数改掉（甚至改成另一级来源），重读存储，
 *      `expiresAt` / `resolvedDays` / `resolvedFrom` 三者一个都不许动。
 *      这是本 feature 最容易做成「看着对」的一条：只要查询端顺手读一次参数，它就破了。
 *   2. **顺序（uc-5-4 R3-4）** —— 先逻辑失效，过宽限期才物理删除。
 *      **反向**：宽限期未满的那一轮，材料必须**已经不可读**而**文件仍在**。
 *      「到期即删」和「到期什么都没发生」都会被这条抓住。
 *   3. **删除证明（I-34 / E7 / V7）** —— 正向：删成功 ⇒ 有证明，且能按材料 / 按证明 id 查回。
 *      **反向**：物理删除失败 ⇒ 材料**保持不可读**、**没有证明**、整轮**判失败**。
 *   4. **禁止用于训练（I-37）** —— 在四个生命周期时点上逐点断言恒 true，
 *      并静态确认本束里不存在把它写成 false 的代码。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findDeletionCertificate,
  freezeMaterialExpiry,
  getMaterialRetention,
  resolveRetention,
  runExpiryDeletion,
} from "../../src/application/recording/retention-lifecycle";
import { retentionHarness, type RetentionHarness } from "../support/retention-fakes";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
const ORG = { orgId: "org-1", projectId: "prj-1" };

const STORED_AT = "2026-01-01T00:00:00.000Z";
/** 保留期 10 天 ⇒ 到期 1/11；宽限期 5 天 ⇒ 1/16 才真删。全部由测试供给。 */
const RETENTION_DAYS = 10;
const GRACE_DAYS = 5;
const EXPIRES_AT = "2026-01-11T00:00:00.000Z";

const BEFORE_EXPIRY = "2026-01-05T00:00:00.000Z";
const AT_EXPIRY = "2026-01-11T00:00:00.000Z";
const IN_GRACE = "2026-01-14T00:00:00.000Z";
const AFTER_GRACE = "2026-01-20T00:00:00.000Z";

/** 起一份已固化的材料。返回 harness 供后续逐轮推进。 */
async function frozenMaterial(
  materialId = "mat-1",
  opts: { snapshotReferenced?: boolean } = {},
): Promise<RetentionHarness> {
  const deps = retentionHarness({
    projectOverrideDays: RETENTION_DAYS,
    orgDefaultDays: 999,
    deletionGraceDays: GRACE_DAYS,
  });
  const resolved = await resolveRetention(deps, { ...ORG, resolvedAt: STORED_AT });
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) throw new Error("unreachable");

  const frozen = await freezeMaterialExpiry(deps, {
    materialId,
    storedAt: STORED_AT,
    retentionResolution: resolved.retention,
    snapshotReferenced: opts.snapshotReferenced ?? false,
  });
  expect(frozen.ok).toBe(true);
  return deps;
}

/* ─────────────────────────── 1. 固化 ─────────────────────────── */

describe("F78 · 到期时间在落库时固化（I-30 / I-31）", () => {
  it("固化即写入：expiresAt = 落库时间 + 生效保留期，且解析依据一起落盘", async () => {
    const deps = await frozenMaterial();
    const view = await getMaterialRetention(deps, "mat-1");

    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.retention.expiresAt).toBe(EXPIRES_AT);
    expect(view.retention.resolvedDays).toBe(RETENTION_DAYS);
    // uc-5-4 R3-2：「记录用了哪一级、当时的数值是多少」——两件事都要。
    expect(view.retention.resolvedFrom).toBe("project");
    expect(view.retention.deletionCertificateId).toBeNull();
  });

  it("⚠ 反向断言 · 事后改参数，已固化的到期时间**不跟着变**", async () => {
    const deps = await frozenMaterial();
    const before = deps.materials.peek("mat-1")!;

    // 三种改法一起上：改覆盖值、清掉覆盖值让它「换一级来源」、再改组织默认值。
    deps.params.set({ projectOverrideDays: 1 });
    deps.params.set({ projectOverrideDays: null });
    deps.params.set({ orgDefaultDays: 3650 });

    // 重新解析确实**变了** —— 证明参数真的被改动了，不是断言在空转。
    const reResolved = await resolveRetention(deps, { ...ORG, resolvedAt: "2026-03-01T00:00:00.000Z" });
    expect(reResolved.ok && reResolved.retention.resolvedDays).toBe(3650);
    expect(reResolved.ok && reResolved.retention.resolvedFrom).toBe("org");

    // 而已固化的那份一个字段都没动。
    const after = deps.materials.peek("mat-1")!;
    expect(after.expiresAt).toBe(before.expiresAt);
    expect(after.resolvedDays).toBe(before.resolvedDays);
    expect(after.resolvedFrom).toBe(before.resolvedFrom);

    // 查询端也不许「顺手用当前参数重算一遍」。
    const view = await getMaterialRetention(deps, "mat-1");
    expect(view.ok && view.retention.expiresAt).toBe(EXPIRES_AT);
    expect(view.ok && view.retention.resolvedDays).toBe(RETENTION_DAYS);
    expect(view.ok && view.retention.resolvedFrom).toBe("project");
  });

  it("二次固化被拒（EXPIRY_ALREADY_FROZEN）—— 那是追溯改写的入口", async () => {
    const deps = await frozenMaterial();
    const again = await freezeMaterialExpiry(deps, {
      materialId: "mat-1",
      storedAt: "2026-06-01T00:00:00.000Z",
      retentionResolution: { resolvedDays: 1, resolvedFrom: "org", resolvedAt: STORED_AT },
    });
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.reason).toBe("EXPIRY_ALREADY_FROZEN");
    expect(deps.materials.peek("mat-1")!.expiresAt).toBe(EXPIRES_AT);
  });

  it("不存在的材料 ⇒ MATERIAL_NOT_FOUND，不是编一份空的出来", async () => {
    const deps = await frozenMaterial();
    const view = await getMaterialRetention(deps, "mat-nope");
    expect(view.ok === false && view.reason).toBe("MATERIAL_NOT_FOUND");
  });
});

/* ──────────────────── 2. 顺序：先逻辑失效再物理删除 ──────────────────── */

describe("F78 · 到期后先逻辑失效再物理删除（uc-5-4 R3-4 / AC4）", () => {
  it("未到期 ⇒ 什么都不发生", async () => {
    const deps = await frozenMaterial();
    const run = await runExpiryDeletion(deps, { asOf: BEFORE_EXPIRY, ...ORG });

    expect(run.ok).toBe(true);
    expect(run.logicallyDisabled).toEqual([]);
    expect(run.physicallyDeleted).toEqual([]);
    expect(deps.materials.peek("mat-1")!.logicallyDisabledAt).toBeNull();
    expect(deps.objects.stillReadable("mat-1")).toBe(true);
  });

  it("⚠ 到期当轮只逻辑失效，文件仍在 —— 「到期即删」会被这条抓住", async () => {
    const deps = await frozenMaterial();
    const run = await runExpiryDeletion(deps, { asOf: AT_EXPIRY, ...ORG });

    expect(run.ok).toBe(true);
    expect(run.logicallyDisabled).toEqual(["mat-1"]);
    expect(run.physicallyDeleted).toEqual([]);
    expect(run.certificates).toEqual([]);
    expect(deps.materials.peek("mat-1")!.logicallyDisabledAt).toBe(AT_EXPIRY);
    expect(deps.objects.stillReadable("mat-1")).toBe(true);
  });

  it("⚠ 宽限期内 ⇒ 保持不可读、仍不删 —— 「到期什么都没发生」也会被这条抓住", async () => {
    const deps = await frozenMaterial();
    await runExpiryDeletion(deps, { asOf: AT_EXPIRY, ...ORG });
    const run = await runExpiryDeletion(deps, { asOf: IN_GRACE, ...ORG });

    expect(run.ok).toBe(true);
    expect(run.physicallyDeleted).toEqual([]);
    // 逻辑失效**没有被退回**：它是在第一轮打上的，第二轮不许把它抹掉。
    expect(deps.materials.peek("mat-1")!.logicallyDisabledAt).toBe(AT_EXPIRY);
    expect(deps.objects.stillReadable("mat-1")).toBe(true);
  });

  it("宽限期满 ⇒ 物理删除到文件层（I-35 点名的四类对象都不见了）", async () => {
    const deps = await frozenMaterial();
    await runExpiryDeletion(deps, { asOf: AT_EXPIRY, ...ORG });
    const run = await runExpiryDeletion(deps, { asOf: AFTER_GRACE, ...ORG });

    expect(run.ok).toBe(true);
    expect(run.physicallyDeleted).toEqual(["mat-1"]);
    expect(deps.objects.stillReadable("mat-1")).toBe(false);

    const keys = deps.objects.purged.get("mat-1")!;
    // 「只删数据库行而文件仍可下载 = 缺陷」（uc-5-4 R10）。
    expect(keys.some((k) => k.endsWith("transcript.jsonl"))).toBe(true);
    expect(keys.some((k) => k.endsWith("notes.md"))).toBe(true);
    expect(keys.some((k) => k.endsWith(".opus"))).toBe(true);
    expect(keys.some((k) => /whiteboard/.test(k))).toBe(true);
  });

  it("已删的材料不会被下一轮再处理一次", async () => {
    const deps = await frozenMaterial();
    await runExpiryDeletion(deps, { asOf: AT_EXPIRY, ...ORG });
    await runExpiryDeletion(deps, { asOf: AFTER_GRACE, ...ORG });
    const third = await runExpiryDeletion(deps, { asOf: "2026-03-01T00:00:00.000Z", ...ORG });

    expect(third.ok).toBe(true);
    expect(third.physicallyDeleted).toEqual([]);
    expect(deps.certificates.count).toBe(1);
  });

  it("宽限期参数缺失 ⇒ 整轮拒绝，不落到某个隐含天数", async () => {
    const deps = await frozenMaterial();
    deps.params.set({ deletionGraceDays: null });
    const run = await runExpiryDeletion(deps, { asOf: AFTER_GRACE, ...ORG });

    expect(run.ok).toBe(false);
    expect(run.ok === false && run.reason).toBe("RETENTION_POLICY_MISSING");
    expect(deps.objects.stillReadable("mat-1")).toBe(true);
  });

  it("⚠ C_REC_2 未裁：被不可变快照引用的材料**既不删也不当没事**，单独列出来等裁决", async () => {
    const deps = await frozenMaterial("mat-snap", { snapshotReferenced: true });
    await runExpiryDeletion(deps, { asOf: AT_EXPIRY, ...ORG });
    const run = await runExpiryDeletion(deps, { asOf: AFTER_GRACE, ...ORG });

    expect(run.ok).toBe(true);
    // 不是「删了」（那是裁法 ②），也不是从报告里消失（那是裁法 ①）。
    expect(run.physicallyDeleted).toEqual([]);
    expect(run.deferredPendingRuling).toEqual(["mat-snap"]);
    expect(run.certificates).toEqual([]);
    // 但它**已经**逻辑失效了 —— 这一步在两种裁法下都成立。
    expect(deps.materials.peek("mat-snap")!.logicallyDisabledAt).toBe(AT_EXPIRY);
    expect(deps.objects.stillReadable("mat-snap")).toBe(true);
  });
});

/* ─────────────────────────── 3. 删除证明 ─────────────────────────── */

describe("F78 · 删除证明（I-34 / E7 / V7）", () => {
  it("删除成功 ⇒ 证明可按材料查回、可按证明 id 查回，且内容对得上", async () => {
    const deps = await frozenMaterial();
    await runExpiryDeletion(deps, { asOf: AT_EXPIRY, ...ORG });
    const run = await runExpiryDeletion(deps, { asOf: AFTER_GRACE, ...ORG });
    expect(run.ok).toBe(true);

    const certificate = await findDeletionCertificate(deps, "mat-1");
    expect(certificate).toBeDefined();
    expect(certificate!.materialId).toBe("mat-1");
    expect(certificate!.deletedAt).toBe(AFTER_GRACE);
    // 「删了哪些东西」必须在证明里可核对，而不是一个布尔。
    expect(certificate!.deletedObjectKeys.length).toBeGreaterThan(0);
    expect(certificate!.deletedObjectKeys).toEqual(deps.objects.purged.get("mat-1"));
    // 「为什么这时候删」也要可核对：当时生效的保留期与到期时间。
    expect(certificate!.resolvedDays).toBe(RETENTION_DAYS);
    expect(certificate!.resolvedFrom).toBe("project");
    expect(certificate!.expiresAt).toBe(EXPIRES_AT);

    const byId = await deps.certificates.byCertificateId(certificate!.certificateId);
    expect(byId).toEqual(certificate);

    // 材料上也指回证明 —— AC1 的「删除时间」在界面上就是从这里来的。
    const view = await getMaterialRetention(deps, "mat-1");
    expect(view.ok && view.retention.deletionCertificateId).toBe(certificate!.certificateId);
    expect(view.ok && view.retention.physicallyDeletedAt).toBe(AFTER_GRACE);
  });

  it("⚠ 反向断言 · 物理删除失败 ⇒ 保持不可读、**不发证明**、整轮判失败（E7 / I-11）", async () => {
    const deps = await frozenMaterial();
    await runExpiryDeletion(deps, { asOf: AT_EXPIRY, ...ORG });
    deps.objects.failFor("mat-1");

    const run = await runExpiryDeletion(deps, { asOf: AFTER_GRACE, ...ORG });

    expect(run.ok).toBe(false);
    expect(run.ok === false && run.reason).toBe("DELETION_TASK_FAILED");
    expect(run.failed?.map((f) => f.materialId)).toEqual(["mat-1"]);
    // 没有证明 —— 「在未真正删除时发出删除证明」是 E7 逐字禁止的。
    expect(await findDeletionCertificate(deps, "mat-1")).toBeUndefined();
    expect(deps.certificates.count).toBe(0);
    // 材料保持不可读：逻辑失效标记还在，且没有被标成已删。
    const row = deps.materials.peek("mat-1")!;
    expect(row.logicallyDisabledAt).toBe(AT_EXPIRY);
    expect(row.physicallyDeletedAt).toBeNull();
    expect(row.deletionCertificateId).toBeNull();
  });

  it("失败后可重试，重试成功才发证明", async () => {
    const deps = await frozenMaterial();
    await runExpiryDeletion(deps, { asOf: AT_EXPIRY, ...ORG });
    deps.objects.failFor("mat-1");
    expect((await runExpiryDeletion(deps, { asOf: AFTER_GRACE, ...ORG })).ok).toBe(false);

    // 对象存储恢复（换一个 harness 的 objects 不算恢复，这里直接换掉失败标记）。
    const healthy = retentionHarness({
      projectOverrideDays: RETENTION_DAYS,
      orgDefaultDays: 999,
      deletionGraceDays: GRACE_DAYS,
    });
    const retryDeps = { ...deps, objects: healthy.objects };
    const retry = await runExpiryDeletion(retryDeps, { asOf: AFTER_GRACE, ...ORG });

    expect(retry.ok).toBe(true);
    expect(retry.physicallyDeleted).toEqual(["mat-1"]);
    expect(await findDeletionCertificate(retryDeps, "mat-1")).toBeDefined();
  });

  it("一份失败不让另一份的成功被报成整轮成功（I-11），但成功的那份确实删掉了", async () => {
    const deps = await frozenMaterial("mat-ok");
    const resolved = await resolveRetention(deps, { ...ORG, resolvedAt: STORED_AT });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    await freezeMaterialExpiry(deps, {
      materialId: "mat-bad",
      storedAt: STORED_AT,
      retentionResolution: resolved.retention,
    });

    await runExpiryDeletion(deps, { asOf: AT_EXPIRY, ...ORG });
    deps.objects.failFor("mat-bad");
    const run = await runExpiryDeletion(deps, { asOf: AFTER_GRACE, ...ORG });

    expect(run.ok).toBe(false);
    expect(run.physicallyDeleted).toEqual(["mat-ok"]);
    expect(run.failed?.map((f) => f.materialId)).toEqual(["mat-bad"]);
    expect(await findDeletionCertificate(deps, "mat-ok")).toBeDefined();
    expect(await findDeletionCertificate(deps, "mat-bad")).toBeUndefined();
  });
});

/* ─────────────────── 4. 禁止用于训练：全生命周期恒成立 ─────────────────── */

describe("F78 · 「禁止用于训练」是与保留期并列的独立开关（I-37）", () => {
  it("四个时点逐点断言恒 true", async () => {
    const deps = await frozenMaterial();
    const at = async () => (await getMaterialRetention(deps, "mat-1"));

    // ① 刚固化
    expect((await at()).ok && deps.materials.peek("mat-1")!.trainingProhibited).toBe(true);
    // ② 未到期
    await runExpiryDeletion(deps, { asOf: BEFORE_EXPIRY, ...ORG });
    expect(deps.materials.peek("mat-1")!.trainingProhibited).toBe(true);
    // ③ 已逻辑失效、宽限期内
    await runExpiryDeletion(deps, { asOf: AT_EXPIRY, ...ORG });
    await runExpiryDeletion(deps, { asOf: IN_GRACE, ...ORG });
    expect(deps.materials.peek("mat-1")!.trainingProhibited).toBe(true);
    // ④ 已物理删除（元数据仍在，开关仍成立）
    await runExpiryDeletion(deps, { asOf: AFTER_GRACE, ...ORG });
    expect(deps.materials.peek("mat-1")!.trainingProhibited).toBe(true);
  });

  it("保留期未到**不是**放宽它的理由：任何保留期取值下都恒 true", async () => {
    for (const days of [1, 45, 3650]) {
      const deps = retentionHarness({
        projectOverrideDays: days, orgDefaultDays: null, deletionGraceDays: 1,
      });
      const resolved = await resolveRetention(deps, { ...ORG, resolvedAt: STORED_AT });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) continue;
      const frozen = await freezeMaterialExpiry(deps, {
        materialId: `m-${days}`, storedAt: STORED_AT, retentionResolution: resolved.retention,
      });
      expect(frozen.ok && frozen.trainingProhibited).toBe(true);
    }
  });

  it("静态：本束里不存在把 trainingProhibited 写成 false 的代码", () => {
    // 类型上它是字面量 `true`，所以这行代码写出来 tsc 就会红。静态检查是第二道：
    // 万一有人把类型放宽成 boolean，`tsc` 不再拦，这一条还在。
    const dirs = [
      join(API_DIR, "src/domain/recording"),
      join(API_DIR, "src/application/recording"),
    ];
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) && files.push(p);
      }
    };
    dirs.forEach(walk);
    expect(files.length).toBeGreaterThan(0);

    // 注释行放行：文档里写「`trainingProhibited: false` 写不出来」正是门控要的东西
    // （第一版没排除注释，本文件自己的 doc comment 就把它判红了 —— 门控确实在看）。
    const RE = /trainingProhibited\s*[:=]\s*false/;
    const COMMENT = /^\s*(\*|\/\/|\/\*)/;
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (COMMENT.test(line)) return;
        if (RE.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);

    // 反证：判据不是空正则，且注释豁免没有把整条判据关掉。
    expect(RE.test("trainingProhibited: false")).toBe(true);
    expect(RE.test("trainingProhibited: true")).toBe(false);
    expect(COMMENT.test("  trainingProhibited: false,")).toBe(false);
  });
});
