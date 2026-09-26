/**
 * F06 抽取测试的共享夹具：一个 org + 会话线程，一个按消息内容回固定 JSON 的回环模型，
 * 以及真实的队列 / 数据源 / 执行器实现拼出来的抽取依赖。
 */
import type { ModelCallInput, ModelCallPort } from "../../src/application/agent-run/ports";
import type { ExtractionDeps } from "../../src/application/knowledge-graph/extract-message-knowledge";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { ModelKnowledgeExtractor } from "../../src/infrastructure/knowledge-graph/model-knowledge-extractor";
import { PgKgConflict } from "../../src/infrastructure/knowledge-graph/pg-kg-conflict";
import { PgKgExtraction } from "../../src/infrastructure/knowledge-graph/pg-kg-extraction";
import { PgOntologyStore } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { addChatThread } from "../support/chat-db";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

/**
 * 两道闸门都要过才排队（迁移 20260924210000 + 20260925110000 + 20260926100000）；测试库里打开它。
 * 第一道（数据库级单行开关，部署开关）总是打开，重复调用无害。
 * 第二道（issue #4178，`kg_org_extraction_settings`，组织开关）在产品里默认开，但测试组织由
 * `seedOrg` 显式关掉（理由见 `tests/support/db.ts` 里那条 INSERT 的注释）——
 * 传入的每个 orgId 在这里显式打开，不传就只开部署那一道（`kg-e2e-fixtures.ts` 的 `startApp()` 在
 * 任何组织存在之前就调用它，调用方随后自己对每个测试组织再调一次这个函数）。
 */
export async function enableExtraction(...orgIds: readonly string[]): Promise<void> {
  await asOwner((c) => c.query("SELECT kg_extraction_enable()"));
  for (const orgId of orgIds) {
    await asOwner((c) => c.query(
      `INSERT INTO kg_org_extraction_settings (org_id, enabled, updated_by)
       VALUES ($1, true, 'test-fixture')
       ON CONFLICT (org_id) DO UPDATE SET enabled = true, updated_by = 'test-fixture'`,
      [orgId],
    ));
  }
}

export async function seedThread(orgId: string, threadIds: readonly string[]): Promise<void> {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(orgId);
  await seedOrg({ orgId, projectId: `${orgId}-p` });
  // `kg_org_extraction_settings.org_id` 外键指着 organizations，必须等 seedOrg 把这一行建出来才能开。
  await enableExtraction(orgId);
  for (const id of threadIds) {
    await addChatThread({ orgId, id, projectId: `${orgId}-p`, visibilityScope: "private", createdBy: "u-owner" });
  }
}

/** 回环模型：按「本条消息」里出现的关键词回对应的 JSON；记下每次调用。 */
export function loopbackModel(replies: ReadonlyArray<readonly [string, string | Error]>) {
  const calls: ModelCallInput[] = [];
  const model: ModelCallPort = {
    complete: async (input) => {
      calls.push(input);
      const hit = replies.find(([k]) => input.user.includes(k));
      if (hit === undefined) return { text: '{"entities":[],"claims":[]}' };
      if (hit[1] instanceof Error) throw hit[1];
      return { text: hit[1] };
    },
  };
  return { model, calls };
}

export const silentLogger = { info: () => undefined, error: () => undefined };

/**
 * 队列只暴露本测试自己的 org：同一个测试库里别的测试文件（并行执行）也会往队列里排消息，
 * 一轮 tick 若把它们一起处理掉，就会用错误的回环模型消费别人的任务。
 */
export function extractionDeps(db: DatabasePort, model: ModelCallPort, onlyOrg: string): ExtractionDeps {
  const pg = new PgKgExtraction(db);
  const queue: ExtractionDeps["queue"] = {
    enable: () => pg.enable(),
    pendingOrgs: async () => (await pg.pendingOrgs()).filter((o) => o === onlyOrg),
    claim: (o, n) => pg.claim(o, n),
    complete: (o, m) => pg.complete(o, m),
    fail: (o, m, e) => pg.fail(o, m, e),
  };
  return {
    queue, source: pg, store: new PgOntologyStore(db), conflicts: new PgKgConflict(db), logger: silentLogger, newId: newKgId,
    extractor: new ModelKnowledgeExtractor(model, { enabled: true, provider: "loopback", modelId: "m" }, silentLogger),
  };
}

export const ZHANG_DECIDES = JSON.stringify({
  entities: [
    { name: "张三", kind: "person", aliases: ["老张"] },
    { name: "v2", kind: "product", aliases: [] },
  ],
  claims: [{
    statement: "张三决定下周一上线 v2", kind: "decision", confidence: 0.9,
    about: ["v2"], decidedBy: "张三", quote: "张三决定下周一上线 v2",
  }],
});
