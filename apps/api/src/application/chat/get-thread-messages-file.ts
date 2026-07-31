/**
 * `getThreadMessagesFile` —— 线程的 `messages.jsonl`（F109 · uc-8-1 UC-6 · I-16 / I-12）。
 *
 * ## file-first 的实现是「不实现」
 *
 * 这个模块**没有**自己的物化逻辑。它调 phase-00 F04 的 `materializeArtifact`，
 * `source: "conversation"` —— 那份物化计划里逐字写着 `messages.jsonl`
 * （`domain/artifact/materialization.ts`）。于是：
 *
 *   · 文件名不是在这里定的（改文件名要改那张表，改了那张表 F04 的断言会说话）；
 *   · 字节 → 对象存储 → 回读校验 → 写 `artifact_versions` 这条顺序不在这里重写；
 *   · 22-files（F31 的 `wsx_visible_artifacts`）列的就是 `artifacts` 表，
 *     所以「在文件浏览器里可见」是**自动成立的**，不是这里再登记一次。
 *
 * 另建一张对话文件表会立刻产生两个证据平面——`coverage.md` 缺口 10 / `design-signoff.md`
 * X-5 讲的就是这条。`chat_thread_files`（迁移 0029）**只存指针**：线程 → 那个 artifact 版本。
 *
 * ## 「恰好一个」是主键，不是一个 if
 *
 * I-16 要求每个线程恰好一个 `messages.jsonl`（**会话为文件粒度**，不是每条消息一个文件）。
 * 这里的形式是 `chat_thread_files.thread_id` 为主键 + 已登记则直接返回。
 * 写成「先查有没有，没有就建」而不带主键，两个并发请求会建出两个版本，
 * 而两个版本各自都「看起来对」。
 *
 * ⚠ 因此本端口是**幂等**的：重复调用返回同一个 `objectKey` / `sha256`。
 *   它**不会**因为线程又多了几条消息就重新物化——版本不可变（phase-00 I-2/I-3），
 *   「什么时候产生新版本」是 F04/F05 的 pin 语义，不由列表端口顺手决定。
 *   ⇒ **已知限制**：文件内容是首次取用时的快照。原样上报，不擅自定义刷新策略。
 *
 * ## 判权与线程同源（I-12）
 *
 * 前置是 `resolveVisibility`——与 `getThread` / `listThreads` 逐字同一个函数。
 * 「文件浏览器不是权限旁路」这句话在代码里的形式就是这一行 import，
 * 而不是本文件里另写一套 ACL。
 */
import type { OrgId } from "../../domain/org-id";
import { observerMayReadMessage } from "../../domain/chat/thread-visibility";
import { messageBadges } from "../../domain/chat/thread-badges";
import { computeContentHash } from "../../domain/artifact/content-hash";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import {
  materializeArtifact,
  MaterializationFailedError,
  type MaterializeDeps,
} from "../artifact/materialize-artifact";
import type { ChatMessageRow, ChatRepository, ThreadFileRecord } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";

/** 物化不出来 —— 契约的 `FILE_NOT_MATERIALIZED`。 */
export class FileNotMaterializedError extends Error {
  constructor() {
    super("file_not_materialized");
  }
}

/**
 * ⚠ `materialize` 是**嵌套的**一组依赖，不是摊平进来的。
 *
 * `ResolveVisibilityDeps` 与 `MaterializeDeps` 都有 `repo` 与 `ids`，而它们指的是
 * **完全不同的东西**（identity 仓储 / artifact 仓储；判定 id / artifact id）。
 * 摊平会让两个同名字段互相顶替，而顶替之后代码照样编译、照样跑，
 * 只是审计里的 decisionId 变成了 artifact id。所以这里保持两组分开。
 */
export interface GetThreadMessagesFileDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  readonly materialize: MaterializeDeps;
}

export interface GetThreadMessagesFileInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly threadId: string;
}

export interface ThreadMessagesFileResult {
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly downloadUrl: string;
}

/**
 * 一条消息在 `.jsonl` 里的一行。
 *
 * `id` 就是 **Segment 的 anchor**（I-16 后半：anchor 为 `messageId`）。
 * 所以定位一条消息 = 在这一个文件里按 `id` 找一行，而不是去找「那条消息的文件」。
 */
interface MessagesJsonlLine {
  readonly id: string;
  readonly authorKind: "human" | "agent";
  readonly agentId: string | null;
  readonly badges: readonly string[];
  readonly body: string;
  readonly createdAt: string;
}

/**
 * 会话 → JSONL 字节。**一行一条消息，一个会话一个文件。**
 *
 * 导出的 `badges` 走 `messageBadges()`——与线程卡、消息头同一个函数（I-13）。
 * 在这里另写一遍 `m.reviewPending ? [...] : []` 会让下载下来的证据文件与界面不一致，
 * 而证据文件不一致这件事没有人会在界面上发现。
 */
export function messagesToJsonl(rows: readonly ChatMessageRow[]): Uint8Array {
  const lines = rows.map((m) => {
    const line: MessagesJsonlLine = {
      id: m.id,
      authorKind: m.authorKind,
      agentId: m.agentId,
      badges: messageBadges(m),
      body: m.body,
      createdAt: m.createdAt,
    };
    return JSON.stringify(line);
  });
  // 末尾换行：JSONL 的惯例，且让 `wc -l` 与消息数相等——
  // 少了它，最后一条消息在按行统计时会消失。
  return new TextEncoder().encode(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
}

export async function getThreadMessagesFile(
  deps: GetThreadMessagesFileDeps,
  input: GetThreadMessagesFileInput,
): Promise<ThreadMessagesFileResult> {
  const outcome = await resolveVisibility(deps, input);
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const existing = await deps.chat.findThreadFile(input.orgId, input.threadId);
  if (existing !== null) return toResult(existing);

  const guarded = await deps.chat.findMessages(input.orgId, input.threadId);
  if (guarded === null) throw new ThreadNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new ThreadNotVisibleError();

  // ⭐ 与 `getThread` 同一条观察者过滤：观察者下载到的文件里**不存在**那些行，
  //   不是「下载了完整文件但界面不显示」。文件一旦落地就脱离了界面的管辖。
  const rows = disclosed.payload.filter((m) =>
    outcome.actor.projectRole === "observer" ? observerMayReadMessage(m, outcome.thread) : true,
  );

  const bytes = messagesToJsonl(rows);
  if (bytes.byteLength === 0) {
    // 空线程物化不出文件（F04 的 `size_bytes > 0`）。这是契约的 `FILE_NOT_MATERIALIZED`，
    // 不是伪造一个 0 字节文件让端口「看起来能用」。
    throw new FileNotMaterializedError();
  }

  let materialized;
  try {
    materialized = await materializeArtifact(deps.materialize, {
      orgId: input.orgId,
      projectId: input.projectId,
      // ⚠ 文件名来自这一档的物化计划，不来自本文件。见文件头。
      source: "conversation",
      title: `对话 ${input.threadId} · messages.jsonl`,
      actorId: input.userId,
      parts: { "messages.jsonl": bytes },
    });
  } catch (e) {
    if (e instanceof MaterializationFailedError) throw new FileNotMaterializedError();
    throw e;
  }

  const record: ThreadFileRecord = {
    artifactId: materialized.artifactId,
    objectKey: materialized.materializedKeys[0]!,
    // 对象的 sha256，不是 artifact 的复合 contentHash：契约的 `sha256` 讲的是
    // **这个文件**，而 `contentHash` 是「版本的各部分哈希再哈希一次」。
    // 一个会话只有一个部分，两者数值会相同，但含义不同——用错了的那天不会有人发现。
    sha256: computeContentHash(bytes),
    sizeBytes: bytes.byteLength,
  };
  await deps.chat.recordThreadFile(input.orgId, input.threadId, record);
  return toResult(record);
}

function toResult(r: ThreadFileRecord): ThreadMessagesFileResult {
  return {
    objectKey: r.objectKey,
    sha256: r.sha256,
    sizeBytes: r.sizeBytes,
    // ⚠ 下载走 API 路由而不是对象存储的直链：直链一旦发出去就绕过了 `resolveVisibility`，
    //   而 I-12 的全部意义就是文件下载与线程读走同一道门。
    downloadUrl: `/chat/threads/${encodeURIComponent(r.artifactId)}/messages-file/download`,
  };
}
