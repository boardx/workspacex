/** Consumer-only browser fixture. Native model/file production is covered separately.
 * Real tenant rows, production version registration and real object-store bytes. */
import { randomUUID } from "node:crypto";
import { addChatMessage, addChatThread } from "../tests/support/chat-db";
import { asApp } from "../tests/support/db";
import { createObjectStore } from "../src/infrastructure/storage/create-object-store";
import { registerRunArtifacts } from "../src/infrastructure/artifacts-steering/register-run-artifacts";
import { toOrgId } from "../src/domain/org-id";

export async function seedChatArtifactConsumer(input: {
  orgId: string; userId: string; agentId: string; agentVersionId: string;
  modelProvider: string; modelId: string; threadId: string;
}): Promise<void> {
  const { orgId, userId, agentId, threadId } = input;
  await addChatThread({ orgId, id: threadId, projectId: null, createdBy: userId,
    visibilityScope: "plenary", title: "产物读取验收", lastActivityAt: new Date("2020-01-01") });
  const store = await createObjectStore();
  const artifactId = `agent-artifact-${threadId}-attachment-1`;
  for (const version of [1, 2]) {
    const runId = `${threadId}-run-${version}`;
    const outputId = `${threadId}-output-${version}`;
    const content = `consumer version ${version}: ${version === 1 ? "original" : "revised"}\n`;
    const bytes = Buffer.from(content);
    const key = `chat-read-consumer/${randomUUID()}/report.txt`;
    await store.putOnce(key, bytes, "text/plain");
    await addChatMessage({ orgId, id: `${runId}-input`, threadId, body: `生成版本 ${version}`, authorId: userId });
    await addChatMessage({ orgId, id: outputId, threadId, body: content, authorId: agentId, agentId, authorKind: "agent" });
    await asApp(orgId, async c => {
      await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status)
        VALUES($1,$2,$3,$4,$5,$6,'[]',$7,$8,'succeeded')`,
      [runId, orgId, threadId, `${runId}-input`, agentId, input.agentVersionId, input.modelProvider, input.modelId]);
      await c.query(`INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at)
        VALUES($1,$2,$3,1,'accepted','succeeded',now(),now())`, [`${runId}-step`, orgId, runId]);
      await c.query(`INSERT INTO chat_message_attachments(id,org_id,thread_id,message_id,storage_ref,filename,mime,bytes)
        VALUES($1,$2,$3,$4,$5,'report.txt','text/plain',$6)`, [`${threadId}-attachment-${version}`, orgId, threadId, outputId, key, bytes.length]);
      if (version === 2) await c.query(`INSERT INTO agent_run_artifact_context(org_id,run_id,artifact_id,based_on_version)
        VALUES($1,$2,$3,1)`, [orgId, runId, artifactId]);
      await registerRunArtifacts({ query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }) },
        { orgId: toOrgId(orgId), runId, threadId, messageId: outputId,
          files: [{ name: "report.txt", mime: "text/plain", sizeBytes: bytes.length, objectKey: key }] });
    });
  }
}
