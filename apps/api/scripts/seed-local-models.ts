/**
 * seed-local-models.ts —— #1381：把本地自托管模型（如 qwen3.5-4B）灌进模型池。
 *
 * 与 `seed-aliyun-bailian-models.ts` 同一套取舍（直接调用用例、凭据显式留空、按
 * `displayName` 判重），不重复抄一遍理由，见该文件文件头。本文件独有的一点：
 *
 * `endpoint` 不是已核实的公开地址，是**部署方式的默认值**（Ollama 的 OpenAI 兼容端口）——
 * 见 `scripts/lib/local-models.ts` 文件头。种下之后，人类几乎一定需要按自己的实际部署
 * 删除重建这一行（`configureModel` 回填端点还没接线，同 aliyun 脚本的已知限制）。
 *
 * ## 用法
 *
 *   MODEL_CREDENTIAL_KEY=<与 API 进程一致的密钥> \
 *   SEED_MODEL_ORG_ID=<目标组织 id> \
 *     pnpm --filter api exec tsx scripts/seed-local-models.ts
 */
import { appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { PgModelPoolRepository } from "../src/infrastructure/model/pg-model-pool-repository";
import { credentialCipherFromEnv } from "../src/infrastructure/model/aes-credential-cipher";
import { OrgComplianceVocabulary } from "../src/infrastructure/model/org-compliance-vocabulary";
import { SystemModelPoolClock } from "../src/infrastructure/model/system-model-pool-clock";
import type { RegisterModelDeps } from "../src/application/model/register-model";
import { seedLocalModels } from "./lib/local-models";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const orgId = required("SEED_MODEL_ORG_ID");

const db = new PgDatabase(appConfig());
const deps: RegisterModelDeps = {
  repository: new PgModelPoolRepository(db),
  cipher: credentialCipherFromEnv(),
  vocabulary: new OrgComplianceVocabulary(),
  clock: new SystemModelPoolClock(),
};

const outcomes = await seedLocalModels(orgId, deps);

let created = 0;
let skipped = 0;
for (const outcome of outcomes) {
  if (outcome.skipped) {
    console.log(`  跳过（已存在）：${outcome.displayName}`);
    skipped += 1;
    continue;
  }
  const result = outcome.result!;
  if (!result.ok) {
    throw new Error(
      `注册失败：${outcome.displayName} → ${result.code}（unknown=${JSON.stringify(result.unknown)}）`,
    );
  }
  console.log(
    `  已接入：${outcome.displayName} → modelId=${result.row.modelId} status=${result.row.status}` +
      `（端点为默认占位值，按需改）`,
  );
  created += 1;
}

console.log(`done：新增 ${created}，跳过 ${skipped}（org=${orgId}）`);
await db.close();
process.exit(0);
