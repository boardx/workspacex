/**
 * `locateCitation` —— UC-15：定位一条引用。
 *
 * ## `ANCHOR_UNRESOLVABLE` 不是"暂时找不到"（I-24）
 *
 * 契约注释逐字："这条引用不合格"——上游若正在定版，定版必须被拒（UC-20 的
 * `CITATION_UNRESOLVABLE_REQUIRES_DRAFT`）。所以这里的判断是**结构性**的：
 *   · `anchor_kind='message'` 却指向一条不存在的消息 ⇒ 那个锚点从写入的那一刻起
 *     就没有对应的原件，不是"这一次读取失败"。
 * 数据库层的 CHECK（迁移 `chat_citations_anchor_field_matches_kind`）已经保证
 * "kind 对应的字段非空"这一半；这里补的是另一半——"那个字段指向的东西真的存在"。
 *
 * ## 可见性取两者中更严格的（I-11）
 *
 * 这里的实现是"引用所在消息"的可见性——`sourceFullName` / 锚点本身不是本仓的
 * 权限对象（它们是引用行的字段，不是线程/项目）。若来源另有更严的可见性（例如
 * 来源材料本身私有），那是下一步要接的口子；本函数登记这条已知边界，而不是
 * 假装已经接了一个尚不存在的"材料可见性"判定（见 `MissingSourceVisibilityGap`
 * 之所以没有——因为目前唯一的来源判定只有 artifact 存在与否，见 `artifactExists`）。
 */
import type { OrgId } from "../../domain/org-id";
import type { ChatCitationRow, ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";

export interface LocateCitationDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
}

export interface LocateCitationInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly citationId: string;
}

export interface LocateCitationResult {
  readonly index: number;
  readonly sourceFullName: string;
  readonly anchor: {
    readonly kind: "page" | "transcript" | "message";
    readonly page: number | null;
    readonly range: string | null;
    readonly messageId: string | null;
  };
  readonly locatable: true;
}

/** 引用不存在——与"不可见"同一个出口套用契约的 `NOT_VISIBLE`，见调用方映射。 */
export class CitationNotFoundError extends Error {
  constructor() {
    super("citation_not_found");
  }
}

/** I-24：这条引用不合格，不是"暂时找不到"。 */
export class AnchorUnresolvableError extends Error {
  constructor(readonly reason: string) {
    super("anchor_unresolvable");
  }
}

/** 来源材料已被删除——契约的 `SOURCE_ARTIFACT_DELETED`。 */
export class SourceArtifactDeletedError extends Error {
  constructor() {
    super("source_artifact_deleted");
  }
}

export async function locateCitation(
  deps: LocateCitationDeps,
  input: LocateCitationInput,
): Promise<LocateCitationResult> {
  const citation = await deps.chat.findCitation(input.orgId, input.citationId);
  if (citation === null) throw new CitationNotFoundError();

  const location = await deps.chat.findMessageLocation(input.orgId, citation.messageId);
  // 引用挂着的消息不存在了——数据一致性上不该发生（外键级联删除会连引用一起删），
  // 但仍然按"不可见/不存在同出口"处理，不把它读成是别的错误。
  if (location === null) throw new ThreadNotVisibleError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: location.projectId,
    threadId: location.threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  // 来源材料被删 ⇒ SOURCE_ARTIFACT_DELETED，在结构性判断之前先查——
  // 一条指向已删除材料的引用，即便锚点字段本身"完整"，也定位不到原件。
  if (citation.sourceArtifactId !== null) {
    const exists = await deps.chat.artifactExists(input.orgId, citation.sourceArtifactId);
    if (!exists) throw new SourceArtifactDeletedError();
  }

  await assertAnchorResolvable(deps.chat, input.orgId, citation);

  return {
    index: citation.index,
    sourceFullName: citation.sourceFullName,
    anchor: {
      kind: citation.anchorKind,
      page: citation.anchorPage,
      range: citation.anchorRange,
      messageId: citation.anchorMessageId,
    },
    locatable: true,
  };
}

/**
 * F114 · V4d 的"100% 可定位"复用这里判断，不另写一遍（一个事实一处声明）。
 *
 * 与 `locateCitation` 判断**完全相同**的两件事——来源材料是否已下架、锚点是否结构性
 * 可解析——只是这里不判可见性（调用方在自己的可见性门之后才拿到这份引用清单），
 * 也不抛异常：定版前置要问的是"这一批引用里有没有一条不合格"，不合格的第一条
 * 出现时调用方要做的是拒绝整个定版请求，不是把某一条的异常甩给客户端。
 */
export async function isCitationLocatable(
  chat: ChatRepository,
  orgId: OrgId,
  citation: ChatCitationRow,
): Promise<boolean> {
  if (citation.sourceArtifactId !== null) {
    const exists = await chat.artifactExists(orgId, citation.sourceArtifactId);
    if (!exists) return false;
  }
  try {
    await assertAnchorResolvable(chat, orgId, citation);
    return true;
  } catch (e) {
    if (e instanceof AnchorUnresolvableError) return false;
    throw e;
  }
}

/**
 * 结构性可定位检查。数据库 CHECK 已保证"kind 对应字段非空"；这里补第二半——
 * "那个字段指向的东西真的存在"。三支穷尽 `anchorKind`（`.strict()` 的三值枚举），
 * 没有 `default`：契约新增第四种锚点会在这里编译不过，而不是悄悄放行。
 */
async function assertAnchorResolvable(
  chat: ChatRepository,
  orgId: OrgId,
  citation: ChatCitationRow,
): Promise<void> {
  switch (citation.anchorKind) {
    case "page":
      if (citation.anchorPage === null || citation.anchorPage <= 0) {
        throw new AnchorUnresolvableError("page anchor missing a positive page number");
      }
      return;
    case "transcript":
      if (citation.anchorRange === null || citation.anchorRange.trim() === "") {
        throw new AnchorUnresolvableError("transcript anchor missing a time range");
      }
      return;
    case "message": {
      if (citation.anchorMessageId === null) {
        throw new AnchorUnresolvableError("message anchor missing a target messageId");
      }
      const exists = await chat.messageExists(orgId, citation.anchorMessageId);
      if (!exists) throw new AnchorUnresolvableError("message anchor points at a message that no longer exists");
      return;
    }
  }
}
