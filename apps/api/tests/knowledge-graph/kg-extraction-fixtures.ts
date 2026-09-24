/**
 * F06 抽取测试的共享夹具：一个 org + 会话线程，一个按消息内容回固定 JSON 的回环模型，
 * 以及真实的队列 / 数据源 / 执行器实现拼出来的抽取依赖。
 */
import type { ModelCallInput, ModelCallPort } from "../../src/application/agent-run/ports";
import type { ExtractionDeps } from "../../src/application/knowledge-graph/extract-message-knowledge";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { ModelKnowledgeExtractor } from "../../src/infrastructure/knowledge-graph/model-knowledge-extractor";
import { PgKgExtraction } from "../../src/infrastructure/knowledge-graph/pg-kg-extraction";
import { PgOntologyStore } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { addChatThread } from "../support/chat-db";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

/** 抽取默认关（关着时触发器不排队）；测试库里打开它。数据库级的单行开关，重复调用无害。 */
export async function enableExtraction(): Promise<void> {
  await asOwner((c) => c.query("SELECT kg_extraction_enable()"));
}

export async function seedThread(orgId: string, threadIds: readonly string[]): Promise<void> {
  ensureDatabase();
  await migrateOnce();
  await enableExtraction();
  await resetOrgs(orgId);
  await seedOrg({ orgId, projectId: `${orgId}-p` });
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
    queue, source: pg, store: new PgOntologyStore(db), logger: silentLogger, newId: newKgId,
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
