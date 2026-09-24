/**
 * backlog E2 —— 把 `ensureSampleProject` 的依赖一次装配好，供两个调用方共用：
 *   · `AuthRegistrationController`（组织创建那一刻，经 `SAMPLE_PROJECT_SEEDER` 注入）；
 *   · `scripts/backfill-sample-projects.ts`（存量组织补种）。
 * 两处用同一个工厂 ⇒ 补种与新建走的是逐字相同的写路径，不会漂移。
 *
 * 全部是本地依赖：PostgreSQL + 已配置的对象存储。不含嵌入/模型客户端——索引由 ingestion
 * worker 在之后异步做，种子阶段零外部调用。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { ObjectStore } from "../../application/artifact/ports";
import {
  ensureSampleProject,
  type SampleProjectSeeder,
} from "../../application/project/sample-project/ensure-sample-project";
import { PgIdentityRepository } from "../identity/pg-identity-repository";
import { PgArtifactRepository } from "../artifact/pg-artifact-repository";
import { UuidIdFactory } from "../artifact/uuid-id-factory";
import { PgProvenanceRepository } from "../provenance/pg-provenance-repository";
import { PgQuarantineRepository } from "../files/pg-quarantine-repository";
import { LogSecurityAlert } from "../files/log-security-alert";
import { PgProjectRepository } from "./pg-project-repository";
import { PgProjectTagsRepository } from "./pg-project-tags-repository";

export function createSampleProjectSeeder(db: DatabasePort, store: ObjectStore): SampleProjectSeeder {
  const ids = new UuidIdFactory();
  const tags = new PgProjectTagsRepository(db);
  const deps = {
    project: { repo: new PgProjectRepository(db, ids), identity: new PgIdentityRepository(db) },
    upload: {
      store,
      repo: new PgArtifactRepository(db),
      ids,
      quarantine: new PgQuarantineRepository(db),
      alerts: new LogSecurityAlert(),
      provenance: new PgProvenanceRepository(db),
    },
    tags,
    lookup: tags,
  };
  return (input) => ensureSampleProject(deps, input);
}
