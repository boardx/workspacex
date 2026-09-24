/**
 * F08 召回测试的共享夹具：一个 org、两条会话，会话里的知识由 F06 抽取流水线真实产生，
 * 再投影到 AGE（图路读的就是真图）。
 */
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { projectPendingGraph } from "../../src/application/knowledge-graph/project-pending-graph";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { PgGraphProjection } from "../../src/infrastructure/knowledge-graph/pg-graph-projection";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel, silentLogger } from "./kg-extraction-fixtures";

export const LAUNCH = JSON.stringify({
  entities: [
    { name: "张三", kind: "person", aliases: ["老张"] },
    { name: "v2", kind: "product", aliases: [] },
    { name: "测试环境", kind: "concept", aliases: [] },
  ],
  claims: [
    { statement: "张三决定下周一上线 v2", kind: "decision", confidence: 0.9, about: ["v2"], decidedBy: "张三", quote: "张三决定下周一上线 v2" },
    { statement: "测试环境不稳定会拖慢 v2", kind: "risk", confidence: 0.7, about: ["测试环境", "v2"], decidedBy: null, quote: "测试环境不稳定" },
    { statement: "季度预算已经批下来了", kind: "fact", confidence: 0.8, about: [], decidedBy: null, quote: "季度预算已经批下来了" },
  ],
});

/**
 * `projectThreads`：这些会话挂在项目下（不是本人的个人对话）。F15 起本人的**其他个人对话**也在召回范围里
 * （个人空间 = 同一用户全部个人线程），要验「别的会话不会漏进来」，那个别的会话就得真的不在这个人的个人空间里。
 */
export async function seedRecallOrg(
  db: DatabasePort, org: string, threads: readonly string[], owner = "u-owner", opts: { projectThreads?: readonly string[] } = {},
): Promise<void> {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(org);
  await seedOrg({ orgId: org, projectId: `${org}-p` });
  await enableExtraction();
  for (const t of threads) {
    const inProject = opts.projectThreads?.includes(t) === true;
    await addChatThread({ orgId: org, id: t, projectId: inProject ? `${org}-p` : null, visibilityScope: inProject ? "plenary" : "private", createdBy: owner });
    await addChatMessage({ orgId: org, id: `m-${t}-seed`, threadId: t, body: "张三决定下周一上线 v2。测试环境不稳定。季度预算已经批下来了。", authorId: owner });
  }
  await runExtractionTick(extractionDeps(db, loopbackModel([["张三决定", LAUNCH]]).model, org));
  await projectPendingGraph(new PgGraphProjection(db), silentLogger);
}
