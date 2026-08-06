/**
 * seed-aliyun-bailian-models.ts —— #548 第二步：把阿里云百炼（DashScope）的真实模型清单
 * 灌进模型池，走刚接好的真实 `registerModel` 用例（不是重新发明一条写路径）。
 *
 * ## 为什么直接调用用例而不是打 HTTP
 *
 * `ModelController.register` 与本脚本调用的是**同一个** `apps/api/src/application/model/
 * register-model.ts::registerModel`，用的是**同一套**生产基础设施实现
 * （`PgModelPoolRepository` / `AesCredentialCipher` / `OrgComplianceVocabulary` /
 * `SystemModelPoolClock`，`appConfig()` 连的也是运行时用的 `app_rw` 角色，会经过 RLS）。
 * 唯一少的一层是 HTTP 与「组织管理员」鉴权——那属于*谁能触发这次导入*，不属于
 * *导入本身走不走真实路径*；本仓其它种子脚本（`seed-dev-account.ts`）也是同样的取舍：
 * 绕开 HTTP，但不绕开真实表结构与真实用例/服务实现。
 *
 * ## 凭据：显式留空，不编造假值
 *
 * `credential` 全部传 `null`（见 `scripts/lib/aliyun-bailian-models.ts`）。DashScope 的
 * 真实 API key 是敏感信息，本脚本没有也不该有；一个显式的 `null` 会诚实地让
 * `model_secrets` 里没有 `credential` 那一行（`credentialConfigured` 读出来是
 * `false`），而不是塞一个看起来像密钥、实际上是假的字符串进去骗过后续检查。
 * ⚠ 目前 `configureModel`（凭据回填/轮换）还没有接线（见 `ModelController` 文件头），
 * 所以人类要真正配置这些模型的凭据，眼下只能删除重建这一行、用真实 key 重新调用
 * `registerModel`——这是已知限制，不是本脚本要解决的范围。
 *
 * `endpoint` 用 DashScope 公开的兼容模式端点（公开信息，不是密钥），能配的都配了。
 *
 * ## 数据来源与局限
 *
 * 模型清单是 2026-08-06 现场取值（人类提供），阿里云百炼命名迭代快，未来可能已经改名/
 * 下线；`contextWindow` / `unitPrice` 没有对应的现场取值，本脚本给的是保守占位值，不是
 * 真实规格，人类需要之后自行核实更新（见 `lib/aliyun-bailian-models.ts` 每行行内注释）。
 *
 * ## 幂等
 *
 * 按 `displayName` 判重：已存在同名模型的组织，这次运行会跳过它，不会重复插入。
 *
 * ## 用法
 *
 *   MODEL_CREDENTIAL_KEY=<与 API 进程一致的密钥> \
 *   SEED_MODEL_ORG_ID=<目标组织 id> \
 *     pnpm --filter api exec tsx scripts/seed-aliyun-bailian-models.ts
 */
import { appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { PgModelPoolRepository } from "../src/infrastructure/model/pg-model-pool-repository";
import { credentialCipherFromEnv } from "../src/infrastructure/model/aes-credential-cipher";
import { OrgComplianceVocabulary } from "../src/infrastructure/model/org-compliance-vocabulary";
import { SystemModelPoolClock } from "../src/infrastructure/model/system-model-pool-clock";
import type { RegisterModelDeps } from "../src/application/model/register-model";
import { seedAliyunBailianModels } from "./lib/aliyun-bailian-models";

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

const outcomes = await seedAliyunBailianModels(orgId, deps);

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
    `  已接入：${outcome.displayName} → modelId=${result.row.modelId} status=${result.row.status}`,
  );
  created += 1;
}

console.log(`done：新增 ${created}，跳过 ${skipped}（org=${orgId}）`);
await db.close();
process.exit(0);
