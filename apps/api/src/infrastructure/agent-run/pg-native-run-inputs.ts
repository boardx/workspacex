import { createHash } from 'node:crypto';
import { NativeInputManifest } from '@repo/contracts/native-session-binding';
import { limits } from '@repo/contracts/sandbox-session';
import type { DatabasePort } from '../../application/ports/database.port';
import type { ObjectStore } from '../../application/artifact/ports';
import type { NativeRunInputs } from '../../application/agent-run/native-run-inputs';
import type { ExecutionAuthorityContext } from '../../application/agent-run/tool-execution-authority';
import { resolveVisibility, type ResolveVisibilityDeps } from '../../application/chat/resolve-visibility';
import { selectRunScopedAttachments } from '../../domain/chat/attachment-mentions';
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Attachment = { id: string; filename: string; mime: string; bytes: string | number; storage_ref: string; message_id: string | null; created_at: string | Date };

/**
 * Same scope as PgRunImageInput; run identity chooses that scope server-side:
 * the triggering message's own attachments, plus (issue #3727) attachments of the SAME
 * author's earlier human messages in the SAME thread that the triggering message names
 * as `@<filename>`. The SQL fences the candidate rows (thread ∧ author ∧ human message);
 * `selectRunScopedAttachments` (domain, pure) does the textual match and de-duplication.
 */
export class PgNativeRunInputs implements NativeRunInputs {
  constructor(private db: DatabasePort, private objects: ObjectStore, private visibility: ResolveVisibilityDeps) {}
  async read(context: ExecutionAuthorityContext) {
    const rows = await this.db.withTenant(context.orgId, async s => {
      // #2931: a durable subtask provisions a native session too, but it owns no
      // `agent_runs` row -- the parent-scope read below would throw and kill every
      // file-producing subtask. It gets an EMPTY input set: a subtask must not
      // inherit the parent run's attachment scope. Discloses nothing but "is this
      // id a subtask"; shape pinned by workbench-repository-boundary.
      const subtask=await s.query('SELECT id FROM subtask_runs WHERE org_id=$1 AND id=$2',[context.orgId,context.parentRunId]);
      if(subtask.rows.length)return [];
      const run = (await s.query<{ thread_id: string; input_message_id: string; author_id: string; body: string }>(
        `SELECT r.thread_id,r.input_message_id,m.author_id,m.body FROM agent_runs r
         JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id AND m.thread_id=r.thread_id
         WHERE r.org_id=$1 AND r.id=$2 AND m.author_kind='human'`, [context.orgId, context.parentRunId])).rows[0];
      if (!run) throw new Error('native_input_scope_unavailable');
      const facts = await this.visibility.chat.findThreadFacts(context.orgId, run.thread_id);
      if (!facts) throw new Error('native_input_scope_unavailable');
      const decision = await resolveVisibility(this.visibility, {orgId:context.orgId,userId:run.author_id,threadId:run.thread_id,projectId:facts.projectId});
      if (decision.kind !== 'allow') throw new Error('native_input_scope_denied');
      // 候选 = 触发消息自己的附件 ∪ 正文以 `@<filename>` 点名的历史附件（同线程、同作者、
      // 人类消息）。`position()` 只是 SQL 侧的粗筛，让没被点名的历史附件根本不出库；精确的
      // 词边界与"同名取最新"由 domain 纯函数决定。maxFiles 上限在纯函数收敛之后再判。
      const candidates = (await s.query<Attachment>(`SELECT a.id,a.filename,a.mime,a.bytes,a.storage_ref,a.message_id,a.created_at
        FROM chat_message_attachments a JOIN chat_messages m ON m.org_id=a.org_id AND m.id=a.message_id
        WHERE a.org_id=$1 AND a.thread_id=$2 AND m.author_id=$4 AND m.author_kind='human'
          AND (a.message_id=$3 OR position('@' || a.filename IN $5) > 0)
        ORDER BY a.created_at, a.id`, [context.orgId,run.thread_id,run.input_message_id,run.author_id,run.body])).rows;
      return selectRunScopedAttachments(candidates, run.input_message_id, run.body);
    });
    if (rows.length > limits.maxFiles) throw new Error('native_input_limit');
    const files: {path:string;contentBase64:string}[] = [];
    const manifest = [];
    let total = 0;
    for (const row of rows) {
      const size = Number(row.bytes);
      if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxFileBytes || (total += size) > limits.maxRequestBytes) throw new Error('native_input_limit');
      const actual = await this.objects.head(row.storage_ref);
      if (!actual || actual.sizeBytes !== size) throw new Error('native_input_bytes_unavailable_or_changed');
      const bytes = await this.objects.get(row.storage_ref);
      if (bytes === null || bytes.byteLength !== size) throw new Error('native_input_bytes_unavailable_or_changed');
      // Filename is display metadata only. Attachment hash separates collisions; normalized basename retains extensions.
      const filename = row.filename.replace(/[^A-Za-z0-9_.-]/g,'_').replace(/^[.-]+/,'_').slice(0,200) || 'attachment';
      const path = `/inputs/${hash(row.id)}/${filename}`;
      manifest.push({attachmentId:row.id,filename:row.filename,path,mediaType:row.mime,sizeBytes:size,digest:hash(bytes)});
      files.push({path,contentBase64:Buffer.from(bytes).toString('base64')});
      if (Buffer.byteLength(JSON.stringify({inputs:files})) > limits.maxRequestBytes) throw new Error('native_input_limit');
    }
    return {manifest:NativeInputManifest.parse(manifest),files};
  }
}
