/**
 * `seedLocalModels`（#1381）—— 同 `seed-aliyun-bailian-models.test.ts` 的分工与纪律，
 * 只是清单换成本地自托管模型（qwen3.5-4B）。见该文件文件头，不重复抄一遍理由。
 */
import { describe, expect, it } from "vitest";
import { PgDatabase } from "../../../src/infrastructure/db/pg-database";
import { appConfig } from "../../../src/infrastructure/db/pg-config";
import { PgModelPoolRepository } from "../../../src/infrastructure/model/pg-model-pool-repository";
import { credentialCipherFromEnv } from "../../../src/infrastructure/model/aes-credential-cipher";
import { OrgComplianceVocabulary } from "../../../src/infrastructure/model/org-compliance-vocabulary";
import { SystemModelPoolClock } from "../../../src/infrastructure/model/system-model-pool-clock";
import type { RegisterModelDeps } from "../../../src/application/model/register-model";
import { LOCAL_MODELS, seedLocalModels } from "../../../scripts/lib/local-models";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../../support/db";

const ORG = "org-1381-local-seed";

async function makeDeps(): Promise<{ deps: RegisterModelDeps; db: PgDatabase }> {
  const db = new PgDatabase(appConfig());
  const deps: RegisterModelDeps = {
    repository: new PgModelPoolRepository(db),
    cipher: credentialCipherFromEnv(),
    vocabulary: new OrgComplianceVocabulary(),
    clock: new SystemModelPoolClock(),
  };
  return { deps, db };
}

describe("seedLocalModels：真实基础设施，真实落库", () => {
  it("清单本身非空，且都是 self-hosted（本地模型不是托管 API）", () => {
    expect(LOCAL_MODELS.length).toBeGreaterThan(0);
    expect(LOCAL_MODELS.every((m) => m.kind === "self-hosted")).toBe(true);
    expect(LOCAL_MODELS.map((m) => m.displayName)).toContain("qwen3.5-4b");
  });

  it("首次运行：每条都真实注册，credential 显式为空，状态为待测试", async () => {
    await ensureDatabase();
    await migrateOnce();
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-1381-local-seed" });
    const { deps, db } = await makeDeps();
    try {
      const outcomes = await seedLocalModels(ORG, deps);
      expect(outcomes.length).toBe(LOCAL_MODELS.length);
      expect(outcomes.every((o) => !o.skipped)).toBe(true);
      for (const outcome of outcomes) {
        expect(outcome.result?.ok, `${outcome.displayName} 注册失败`).toBe(true);
      }

      const stored = await deps.repository.listForOrg(ORG);
      expect(stored.length).toBe(LOCAL_MODELS.length);
      expect(stored.every((s) => s.credentialConfigured === false)).toBe(true);
      expect(stored.every((s) => s.row.status === "待测试")).toBe(true);
      expect(stored.every((s) => s.row.kind === "self-hosted")).toBe(true);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("反证：第二次运行对已存在的组织全部跳过，不产生重复行", async () => {
    const { deps, db } = await makeDeps();
    try {
      const before = await deps.repository.listForOrg(ORG);
      expect(before.length).toBe(LOCAL_MODELS.length); // 上一条测试已经种下

      const outcomes = await seedLocalModels(ORG, deps);
      expect(outcomes.every((o) => o.skipped)).toBe(true);

      const after = await deps.repository.listForOrg(ORG);
      expect(after.length).toBe(LOCAL_MODELS.length); // 没有变多
    } finally {
      await db.close();
    }
  }, 60_000);
});
