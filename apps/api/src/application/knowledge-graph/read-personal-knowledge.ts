/**
 * 大脑页（/brain）的两个读：本人个人空间（UC-KG-7 getPersonalKnowledge）与会话记忆概况
 * （getBrainOverview）。2026-09-24 人类指令「取消所有的 mockup 的数据」：大脑页只显示真实数据。
 *
 * ## 权限只有两处判定，都不是新发明
 *
 * - 个人空间：只有本人。组织层用 resolve-visibility 个人线程那一支同一个 `authorize`
 *   （合成 id `personal:<userId>`，无项目上下文 ⇒ 只判组织层），再加「查看者就是空间主人」。
 *   读口本来就只按本人 id 查（RLS 也只放本人的 personal 行，I-14），这道判定是守卫读路径要的那张票。
 * - 会话概况 / 个人结论的来源会话：逐个会话走 `visibleThread`（chat 的 `resolveVisibility`），
 *   与打开会话、读会话知识面板同一个判定。看不见的会话整行不出现，也不暴露它的标题。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import { authorize } from "../identity/authorize";
import { AuthzUnavailableError } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { KgReadError, visibleThread, type KnowledgeReadDeps } from "./read-thread-knowledge";

interface Viewer {
  readonly userId: string;
  readonly orgId: OrgId;
}

/** 个人空间 guard ref 的合成 id 前缀（同 resolve-visibility 个人线程判定、pg-knowledge-read 的 `personalSpaceRef`）。 */
const PERSONAL_REF_PREFIX = "personal:";

/**
 * 本人个人空间的判定：组织层通过 且 查看者 = 这份读模型所属空间的主人。
 *
 * 主人取自读口交回的 guard ref（`personal:<userId>`），不是调用方自己再传一遍查看者 id——
 * 否则比较恒真。读口若因为缺陷交回了别人的空间，这里拒绝，内容一个字也不出去。
 */
export async function decidePersonalSpace(deps: KnowledgeReadDeps, viewer: Viewer, space: Guarded<unknown>): Promise<PermissionDecision> {
  let base: PermissionDecision;
  try {
    base = await authorize(
      { repo: deps.repo, ids: deps.ids },
      { userId: viewer.userId, orgId: viewer.orgId, object: { kind: "project", id: `${PERSONAL_REF_PREFIX}${viewer.userId}` }, action: "read.published" },
    );
  } catch {
    // 判定依赖读不到 ⇒ 拒绝并报 503，不降级为放行（同 resolveVisibility）。
    throw new AuthzUnavailableError();
  }
  const ownerId = space.ref.kind === "project" && space.ref.id.startsWith(PERSONAL_REF_PREFIX)
    ? space.ref.id.slice(PERSONAL_REF_PREFIX.length) : null;
  const allowed = base.orgLayer.passed && ownerId === viewer.userId;
  return { ...base, allowed, reasonCode: allowed ? null : base.reasonCode ?? "ORG_SCOPE_DENIED" };
}

export async function getPersonalKnowledge(
  deps: KnowledgeReadDeps,
  input: Viewer,
): Promise<z.infer<typeof KG.knowledgeGraph.getPersonalKnowledge.out>> {
  const guarded = await deps.knowledge.personalKnowledge(input.orgId, input.userId);
  const d = discloseDecided(guarded, await decidePersonalSpace(deps, input, guarded));
  // 不是（或已不是）本组织成员：契约 getPersonalKnowledge.err 的 KG_NOT_VISIBLE（HTTP 403）。
  if (!isDisclosed(d)) throw new KgReadError("KG_NOT_VISIBLE");
  return { scope: { kind: "personal", id: input.userId }, ...d.payload };
}

type Overview = z.infer<typeof KG.knowledgeGraph.getBrainOverview.out>;

/** 概况页最多扫描的候选批数（每批 KG_BRAIN_THREADS_LIMIT 个会话）。 */
export const BRAIN_MAX_CANDIDATE_BATCHES = 20;

export async function getBrainOverview(deps: KnowledgeReadDeps, input: Viewer): Promise<Overview> {
  // 同一个会话只判一次：概况行与来源行经常指向同一批会话。
  const verdicts = new Map<string, Promise<{ base: PermissionDecision; title: string; lastActivityAt: string } | null>>();
  const judge = (threadId: string) => {
    let v = verdicts.get(threadId);
    if (v === undefined) {
      v = (async () => {
        try {
          const t = await visibleThread(deps, input, threadId);
          // 标题是展示字段：判定通过之后才取（chat ports ThreadPresentation 注释）。
          const p = await deps.chat.findThreadPresentation(input.orgId, threadId);
          return p === null ? null : { base: t.base, title: p.title, lastActivityAt: p.lastActivityAt };
        } catch (e) {
          if (e instanceof KgReadError) return null;
          throw e;
        }
      })();
      verdicts.set(threadId, v);
    }
    return v;
  };
  const reveal = async <T>(g: Guarded<T>, threadId: string) => {
    const v = await judge(threadId);
    if (v === null) return null;
    const d = discloseDecided(g, v.base);
    return isDisclosed(d) ? { row: d.payload, title: v.title, lastActivityAt: v.lastActivityAt } : null;
  };

  // 候选按最近活动倒序分批取，逐个判可见性，凑够上限为止：上限作用在「看得见的」会话上，
  // 看不见的（被移出项目等）不会把看得见的挤出这一页。
  // 扫描上限：最多看 BRAIN_MAX_CANDIDATE_BATCHES 批候选（每个候选一次可见性判定），读口出错（例如分页失效、
  // 永远交回同一批）也不会让这一页无限打下去。
  const threads: Overview["threads"] = [];
  for (let offset = 0, batches = 0; threads.length < KG.KG_BRAIN_THREADS_LIMIT && batches < BRAIN_MAX_CANDIDATE_BATCHES;
    offset += KG.KG_BRAIN_THREADS_LIMIT, batches += 1) {
    const batch = await deps.knowledge.threadKnowledgeSummaries(input.orgId, input.userId, KG.KG_BRAIN_THREADS_LIMIT, offset);
    for (const cand of batch) {
      if (threads.length >= KG.KG_BRAIN_THREADS_LIMIT) break;
      const r = await reveal(cand.counts, cand.threadId);
      if (r === null) continue;
      const c = r.row;
      threads.push({
        threadId: c.threadId, projectId: c.projectId, title: r.title, lastActivityAt: r.lastActivityAt,
        claims: c.pending + c.confirmed + c.conflict, pending: c.pending, confirmed: c.confirmed, conflict: c.conflict, objects: c.objects,
      });
    }
    if (batch.length < KG.KG_BRAIN_THREADS_LIMIT) break;
  }

  // 个人空间结论的来源会话：读口只按本人 id 取（scope_id = 查看者），每行再按原结论所在会话判可见性
  // （与打开会话同一个判定；个人线程只放给创建者本人、且要求仍是组织成员）。
  const personalOrigins: Overview["personalOrigins"] = [];
  for (const cand of await deps.knowledge.personalClaimOrigins(input.orgId, input.userId)) {
    const r = await reveal(cand.origin, cand.threadId);
    if (r === null) continue;
    personalOrigins.push({ ...r.row, threadTitle: r.title });
  }
  return { threads, personalOrigins };
}
