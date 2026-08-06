/**
 * `seedAliyunBailianModels`（#548 第二步）—— 打真实 PostgreSQL，用真实生产基础设施实现
 * （不是假仓储），证明种子清单能通过真实 `registerModel` 落地，且脚本的判重逻辑真的挡住
 * 了重复导入。
 *
 * 与 `register-model-e2e.test.ts` 的分工：那个文件断的是「controller 这条 HTTP 路径可达」；
 * 这个文件断的是「种子清单本身、以及脚本的判重逻辑，用真实基础设施跑得通」——两者用的是
 * 同一个 `registerModel`，但入口不同（HTTP vs 直接调用），值得分开断言。
 */
import { describe, expect, it } from "vitest";
import { PgDatabase } from "../../../src/infrastructure/db/pg-database";
import { appConfig } from "../../../src/infrastructure/db/pg-config";
import { PgModelPoolRepository } from "../../../src/infrastructure/model/pg-model-pool-repository";
import { credentialCipherFromEnv } from "../../../src/infrastructure/model/aes-credential-cipher";
import { OrgComplianceVocabulary } from "../../../src/infrastructure/model/org-compliance-vocabulary";
import { SystemModelPoolClock } from "../../../src/infrastructure/model/system-model-pool-clock";
import type { RegisterModelDeps } from "../../../src/application/model/register-model";
import { SEED_MODELS, seedAliyunBailianModels } from "../../../scripts/lib/aliyun-bailian-models";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../../support/db";

const ORG = "org-548-aliyun-seed";

async function makeDeps(): Promise<{ deps: RegisterModelDeps; db: PgDatabase }> {
  const db = new PgDatabase(appConfig());
  const deps: RegisterModelDeps = {
    repository: new PgModelPoolRepository(db),
    cipher: credentialCipherFromEnv(), // reads vitest.config.ts's MODEL_CREDENTIAL_KEY
    vocabulary: new OrgComplianceVocabulary(),
    clock: new SystemModelPoolClock(),
  };
  return { deps, db };
}

describe("seedAliyunBailianModels：真实基础设施，真实落库", () => {
  it("清单本身非空，且都是 closed-api（阿里云百炼是托管 API，不是自托管权重）", () => {
    expect(SEED_MODELS.length).toBeGreaterThan(5);
    expect(SEED_MODELS.every((m) => m.kind === "closed-api")).toBe(true);
    expect(SEED_MODELS.map((m) => m.displayName)).toContain("qwen3.8-max");
  });

  it("首次运行：每条都真实注册，credential 显式为空（未回填），状态为待测试", async () => {
    await ensureDatabase();
    await migrateOnce();
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-548-seed" });
    const { deps, db } = await makeDeps();
    try {
      const outcomes = await seedAliyunBailianModels(ORG, deps);
      expect(outcomes.length).toBe(SEED_MODELS.length);
      expect(outcomes.every((o) => !o.skipped)).toBe(true);
      for (const outcome of outcomes) {
        expect(outcome.result?.ok, `${outcome.displayName} 注册失败`).toBe(true);
      }

      const stored = await deps.repository.listForOrg(ORG);
      expect(stored.length).toBe(SEED_MODELS.length);
      // 凭据没有被编造：一行都没有配置 credential。
      expect(stored.every((s) => s.credentialConfigured === false)).toBe(true);
      expect(stored.every((s) => s.row.status === "待测试")).toBe(true);
      expect(new Set(stored.map((s) => s.row.displayName)).size).toBe(SEED_MODELS.length);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("反证：第二次运行对已存在的组织全部跳过，不产生重复行（models_uniq 与脚本判重都成立）", async () => {
    const { deps, db } = await makeDeps();
    try {
      const before = await deps.repository.listForOrg(ORG);
      expect(before.length).toBe(SEED_MODELS.length); // 上一条测试已经种下

      const outcomes = await seedAliyunBailianModels(ORG, deps);
      expect(outcomes.every((o) => o.skipped)).toBe(true);

      const after = await deps.repository.listForOrg(ORG);
      expect(after.length).toBe(SEED_MODELS.length); // 没有变多
    } finally {
      await db.close();
    }
  }, 60_000);
});
